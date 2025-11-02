from django.db.models import Q
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from .models import Tontine, TontineMember
from .serializers import TontineSerializer, TontineMemberSerializer, TontineMemberAddSerializer
from django.contrib.auth import get_user_model
from transactions.models import Contribution, Withdrawal
from datetime import date, timedelta
from dateutil.relativedelta import relativedelta
import random
from django.db.models import Sum

User = get_user_model()


class IsTontineAdminOrOwner(permissions.BasePermission):
    """Permission to check if the user is an admin or the owner of the tontine.
    Allows read-only access for any authenticated member of the tontine.
    """

    def has_object_permission(self, request, view, obj):
        if not request.user.is_authenticated:
            return False
        
        tontine = obj if isinstance(obj, Tontine) else obj.tontine

        # Allow read-only access for any authenticated member of the tontine
        if request.method in permissions.SAFE_METHODS:
            return TontineMember.objects.filter(tontine=tontine, user=request.user, is_active=True).exists() or tontine.owner == request.user
        
        # Write permissions are only for owner or admin
        is_owner = tontine.owner == request.user
        is_admin = TontineMember.objects.filter(
            tontine=tontine, user=request.user, role='admin', is_active=True
        ).exists()
        
        return is_owner or is_admin


class IsTontineMember(permissions.BasePermission):
    """Allow access only to members of the tontine for object-level permissions."""

    def has_object_permission(self, request, view, obj):
        user = request.user
        if isinstance(obj, Tontine):
            return TontineMember.objects.filter(tontine=obj, user=user, is_active=True).exists() or obj.owner_id == user.id
        if isinstance(obj, TontineMember):
            return IsTontineAdminOrOwner().has_object_permission(request, view, obj)
        return False


class TontineViewSet(viewsets.ModelViewSet):
    serializer_class = TontineSerializer
    permission_classes = [permissions.IsAuthenticated, IsTontineAdminOrOwner]

    def get_queryset(self):
        user = self.request.user
        return Tontine.objects.filter(
            Q(owner=user) | Q(memberships__user=user, memberships__is_active=True)
        ).distinct()

    def get_serializer_context(self):
        return {'request': self.request}

    def perform_create(self, serializer):
        tontine = serializer.save(owner=self.request.user)
        # Set the start date for the first round
        if tontine.start_date:
            tontine.current_round_start_date = tontine.start_date
        tontine.current_round = 1
        tontine.save()
        
        # Create the owner's membership
        TontineMember.objects.create(tontine=tontine, user=self.request.user, role="admin")
        
        # Create the initial pending contribution for the owner for round 1
        Contribution.objects.create(
            tontine=tontine,
            member=self.request.user,
            amount=tontine.amount,
            status='pending',
            round=1
        )

    @action(detail=True, methods=['post'], url_path='designate-recipient', permission_classes=[permissions.IsAuthenticated, IsTontineAdminOrOwner])
    def designate_recipient(self, request, pk=None):
        tontine = self.get_object()
        user_id = request.data.get('user_id')

        if not user_id:
            return Response({'error': 'User ID manquant.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            recipient_to_designate = User.objects.get(id=user_id)
        except User.DoesNotExist:
            return Response({'error': 'Utilisateur non trouvé.'}, status=status.HTTP_404_NOT_FOUND)

        if not TontineMember.objects.filter(tontine=tontine, user=recipient_to_designate, is_active=True).exists():
            return Response({'error': 'L\'utilisateur désigné n\'est pas un membre actif de cette tontine.'}, status=status.HTTP_400_BAD_REQUEST)

        if Withdrawal.objects.filter(tontine=tontine, beneficiary=recipient_to_designate).exists():
            return Response({'error': 'Ce membre a déjà reçu son paiement pour cette tontine.'}, status=status.HTTP_400_BAD_REQUEST)

        tontine.designated_recipient = recipient_to_designate
        tontine.save()

        recipient_name = f"{recipient_to_designate.first_name} {recipient_to_designate.last_name}".strip() or recipient_to_designate.email
        return Response({'message': f'{recipient_name} a été désigné comme prochain bénéficiaire.'}, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'], url_path='process-payout', permission_classes=[permissions.IsAuthenticated, IsTontineAdminOrOwner])
    def process_payout(self, request, pk=None):
        tontine = self.get_object()
        
        if not tontine.designated_recipient:
            return Response({'error': 'Aucun bénéficiaire n\'a été désigné pour ce tour.'}, status=status.HTTP_400_BAD_REQUEST)

        # Check if a withdrawal has already been made for the current round
        if Withdrawal.objects.filter(tontine=tontine, round=tontine.current_round).exists():
            return Response({'error': f'Un paiement a déjà eu lieu pour le tour {tontine.current_round}. Validez le tour pour commencer le suivant.'}, status=status.HTTP_400_BAD_REQUEST)

        # Calculate payout based on paid contributions
        paid_contributions = Contribution.objects.filter(
            tontine=tontine, 
            round=tontine.current_round, 
            status='paid'
        )

        # Create withdrawal for the current round with whatever amount has been paid
        payout_amount = paid_contributions.aggregate(total=Sum('amount'))['total'] or 0
        Withdrawal.objects.create(
            tontine=tontine,
            beneficiary=tontine.designated_recipient,
            amount=payout_amount,
            round=tontine.current_round,
            note=f"Paiement du tour {tontine.current_round}"
        )

        winner_name = f"{tontine.designated_recipient.first_name} {tontine.designated_recipient.last_name}".strip() or tontine.designated_recipient.email
        
        # Reset designated recipient for the next round
        tontine.designated_recipient = None
        tontine.save()

        return Response({'message': f'Le paiement de {payout_amount} pour {winner_name} (Tour {tontine.current_round}) a été enregistré.'}, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'], url_path='validate-round', permission_classes=[permissions.IsAuthenticated, IsTontineAdminOrOwner])
    def validate_round(self, request, pk=None):
        tontine = self.get_object()

        # Check if a payout has occurred for the current round
        if not Withdrawal.objects.filter(tontine=tontine, round=tontine.current_round).exists():
            return Response({'error': f'Impossible de valider. Le paiement pour le tour {tontine.current_round} n\'a pas encore été effectué.'}, status=status.HTTP_400_BAD_REQUEST)

        # Mark all pending contributions for the current round as 'unpaid'
        Contribution.objects.filter(
            tontine=tontine, 
            round=tontine.current_round, 
            status='pending'
        ).update(status='unpaid')

        # Advance the round
        tontine.current_round += 1
        tontine.current_round_start_date = date.today()
        tontine.save()

        # Create pending contributions for all active members for the new round
        active_members = tontine.memberships.filter(is_active=True)
        for membership in active_members:
            Contribution.objects.create(
                tontine=tontine,
                member=membership.user,
                amount=tontine.amount,
                status='pending',
                round=tontine.current_round
            )

        return Response({'message': f'Tour validé. Le tour {tontine.current_round} a commencé.'}, status=status.HTTP_200_OK)

    @action(detail=True, methods=['get'], permission_classes=[permissions.IsAuthenticated, IsTontineMember])
    def members(self, request, pk=None):
        tontine = self.get_object()
        qs = TontineMember.objects.filter(tontine=tontine)
        return Response(TontineMemberSerializer(qs, many=True).data)

    @action(detail=True, methods=['post'], url_path='add-member', permission_classes=[permissions.IsAuthenticated, IsTontineAdminOrOwner])
    def add_member(self, request, pk=None):
        tontine = self.get_object()
        serializer = TontineMemberAddSerializer(data=request.data)

        if serializer.is_valid():
            user_id = serializer.validated_data['user_id']
            try:
                user_to_add = User.objects.get(pk=user_id)
            except User.DoesNotExist:
                return Response({'error': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)

            if TontineMember.objects.filter(tontine=tontine, user=user_to_add).exists():
                return Response({'error': 'User is already a member of this tontine.'}, status=status.HTTP_400_BAD_REQUEST)

            membership = TontineMember.objects.create(tontine=tontine, user=user_to_add)
            
            # Create a pending contribution for the new member for the current round
            Contribution.objects.get_or_create(
                tontine=tontine,
                member=user_to_add,
                round=tontine.current_round,
                defaults={'amount': tontine.amount, 'status': 'pending'}
            )

            return Response(TontineMemberSerializer(membership).data, status=status.HTTP_201_CREATED)
        
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'], url_path='remove-member', permission_classes=[permissions.IsAuthenticated, IsTontineAdminOrOwner])
    def remove_member(self, request, pk=None):
        tontine = self.get_object()
        serializer = TontineMemberAddSerializer(data=request.data) # Re-using for user_id validation

        if serializer.is_valid():
            user_id = serializer.validated_data['user_id']
            
            if tontine.owner.id == user_id:
                return Response({'error': 'Cannot remove the owner of the tontine.'}, status=status.HTTP_400_BAD_REQUEST)

            try:
                membership = TontineMember.objects.get(tontine=tontine, user_id=user_id)
            except TontineMember.DoesNotExist:
                return Response({'error': 'User is not a member of this tontine.'}, status=status.HTTP_404_NOT_FOUND)

            membership.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)

        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
