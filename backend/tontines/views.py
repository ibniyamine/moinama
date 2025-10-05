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
        TontineMember.objects.create(tontine=tontine, user=self.request.user, role="admin")

    @action(detail=True, methods=['post'], url_path='draw-winner', permission_classes=[permissions.IsAuthenticated, IsTontineAdminOrOwner])
    def draw_winner(self, request, pk=None):
        tontine = self.get_object()
        today = date.today()

        if not tontine.start_date:
            return Response({'error': 'La tontine n\'a pas de date de début.'}, status=status.HTTP_400_BAD_REQUEST)

        # Determine the current contribution period
        current_period_start = None
        if tontine.frequency == 'weekly':
            days_since_start = (today - tontine.start_date).days
            current_week_offset = (days_since_start // 7) * 7
            current_period_start = tontine.start_date + timedelta(days=current_week_offset)
        elif tontine.frequency == 'monthly':
            start_day = tontine.start_date.day
            current_period_start = date(today.year, today.month, start_day)
            if today.day < start_day:
                current_period_start -= relativedelta(months=1)
        else: # daily
            current_period_start = today

        if not current_period_start:
            return Response({'error': 'Impossible de déterminer la période de contribution actuelle.'}, status=status.HTTP_400_BAD_REQUEST)

        # Check if a withdrawal has already occurred for the current period
        if Withdrawal.objects.filter(tontine=tontine, date__gte=current_period_start).exists():
            return Response({'error': 'Un tirage au sort a déjà eu lieu pour la période actuelle.'}, status=status.HTTP_400_BAD_REQUEST)

        # Check if all contributions for the current round are paid
        active_members = tontine.memberships.filter(is_active=True)
        contributions_in_period = Contribution.objects.filter(tontine=tontine, date__gte=current_period_start)
        paid_contributions = contributions_in_period.filter(status='paid')

        if paid_contributions.count() < active_members.count():
            return Response({'error': 'Toutes les cotisations pour ce tour n\'ont pas été marquées comme payées.'}, status=status.HTTP_400_BAD_REQUEST)

        # Identify eligible members (those who haven't won yet)
        previous_winners = User.objects.filter(withdrawals__tontine=tontine)
        eligible_members = [m.user for m in active_members if m.user not in previous_winners]

        if not eligible_members:
            return Response({'error': 'Tous les membres ont déjà reçu leur paiement.'}, status=status.HTTP_400_BAD_REQUEST)

        # Draw winner
        winner = random.choice(eligible_members)

        # Create withdrawal
        payout_amount = paid_contributions.aggregate(total=Sum('amount'))['total'] or 0
        Withdrawal.objects.create(
            tontine=tontine,
            beneficiary=winner,
            amount=payout_amount,
            note=f"Paiement du tour du {today.strftime('%Y-%m-%d')}"
        )

        winner_name = f"{winner.first_name} {winner.last_name}".strip() or winner.email
        return Response({'message': f'Le gagnant est {winner_name} ! Le retrait a été enregistré.', 'winner_name': winner_name}, status=status.HTTP_200_OK)

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
