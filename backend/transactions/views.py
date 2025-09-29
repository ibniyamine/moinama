from rest_framework import generics, permissions, status
from .models import Contribution, Withdrawal
from .serializers import ContributionSerializer, WithdrawalSerializer
from tontines.models import TontineMember, Tontine
from rest_framework.exceptions import ValidationError, PermissionDenied
from django.shortcuts import get_object_or_404
from rest_framework.views import APIView
from rest_framework.response import Response
from datetime import date, timedelta
from dateutil.relativedelta import relativedelta
from django.db.models import Q


class IsTontineOwnerOrReadOnly(permissions.BasePermission):
    """
    Custom permission to only allow owners of a tontine to edit it.
    """

    def has_object_permission(self, request, view, obj):
        # Read permissions are allowed to any authenticated request,
        # so we'll always allow GET, HEAD or OPTIONS requests.
        if request.method in permissions.SAFE_METHODS:
            return True

        # Write permissions are only allowed to the owner of the tontine.
        # For Contribution, the owner is the tontine's owner.
        return obj.tontine.owner == request.user


class ContributionListCreateView(generics.ListCreateAPIView):
    queryset = Contribution.objects.all()
    serializer_class = ContributionSerializer
    permission_classes = [permissions.IsAuthenticated]

    def perform_create(self, serializer):
        tontine = serializer.validated_data['tontine']
        member = self.request.user

        # Check if the user is a member of the tontine
        if not TontineMember.objects.filter(tontine=tontine, user=member, is_active=True).exists():
            raise ValidationError("You are not an active member of this tontine.")

        # Validate contribution amount against tontine's expected amount
        if serializer.validated_data['amount'] != tontine.amount:
            raise ValidationError(f"Contribution amount must be exactly {tontine.amount}.")

        serializer.save(member=member)

    def get_queryset(self):
        if not self.request.user.is_authenticated:
            print(f"[DEBUG] User is not authenticated.")
            return self.queryset.none()

        print(f"[DEBUG] Current User: {self.request.user.get_username()} (ID: {self.request.user.id})")

        tontine_id = self.request.query_params.get('tontine_id')
        if tontine_id:
            tontine = get_object_or_404(Tontine, pk=tontine_id)
            if tontine.owner == self.request.user:
                return self.queryset.filter(tontine=tontine)
            else:
                return self.queryset.filter(tontine=tontine, member=self.request.user)
        
        # If no tontine_id is provided:
        # Show contributions where the user is the member OR the user is the owner of the tontine
        queryset = self.queryset.filter(Q(member=self.request.user) | Q(tontine__owner=self.request.user)).distinct()
        print(f"[DEBUG] Queryset for user {self.request.user.get_username()}: {[c.id for c in queryset]}")
        print(f"[DEBUG] Number of contributions in queryset: {queryset.count()}")
        return queryset

        # If no tontine_id is provided:
        # Show contributions where the user is the member OR the user is the owner of the tontine
        return self.queryset.filter(Q(member=self.request.user) | Q(tontine__owner=self.request.user)).distinct()


class ContributionDetailView(generics.RetrieveUpdateDestroyAPIView):
    queryset = Contribution.objects.all()
    serializer_class = ContributionSerializer
    permission_classes = [permissions.IsAuthenticated, IsTontineOwnerOrReadOnly]

    def get_queryset(self):
        # Ensure users can only access their own contributions or contributions in tontines they own
        if self.request.user.is_authenticated:
            pk = self.kwargs.get('pk')
            if pk:
                try:
                    contribution = self.queryset.get(pk=pk)
                    if contribution.member == self.request.user or contribution.tontine.owner == self.request.user:
                        return self.queryset.filter(pk=pk)
                except Contribution.DoesNotExist:
                    pass
        return self.queryset.none()

    def perform_update(self, serializer):
        # Prevent changing tontine or member after creation
        if 'tontine' in serializer.validated_data and serializer.validated_data['tontine'] != serializer.instance.tontine:
            raise ValidationError("Cannot change tontine for an existing contribution.")
        if 'member' in serializer.validated_data and serializer.validated_data['member'] != serializer.instance.member:
            raise ValidationError("Cannot change member for an existing contribution.")
        
        # Only tontine owner can change is_confirmed status
        if 'is_confirmed' in serializer.validated_data:
            if self.request.user != serializer.instance.tontine.owner:
                raise PermissionDenied("Only the tontine owner can confirm contributions.")
        
        tontine = serializer.validated_data.get('tontine', serializer.instance.tontine)
        if 'amount' in serializer.validated_data and serializer.validated_data.get('amount') != tontine.amount:
            raise ValidationError(f"Contribution amount must be exactly {tontine.amount}.")

        serializer.save()

    def perform_destroy(self, instance):
        # Only tontine owner can delete contributions
        if self.request.user != instance.tontine.owner:
            raise PermissionDenied("Only the tontine owner can delete contributions.")
        instance.delete()


class WithdrawalListCreateView(generics.ListCreateAPIView):
    queryset = Withdrawal.objects.all()
    serializer_class = WithdrawalSerializer
    permission_classes = [permissions.IsAuthenticated]

    def perform_create(self, serializer):
        tontine = serializer.validated_data['tontine']
        beneficiary = self.request.user

        # Check if the user is a member of the tontine
        if not TontineMember.objects.filter(tontine=tontine, user=beneficiary, is_active=True).exists():
            raise ValidationError("You are not an active member of this tontine.")
        
        # Further validation for withdrawals (e.g., check if it's the beneficiary's turn, sufficient funds)
        # This would require more complex logic, potentially in a service layer or custom manager
        
        serializer.save(beneficiary=beneficiary)

    def get_queryset(self):
        # Allow filtering withdrawals by tontine_id
        tontine_id = self.request.query_params.get('tontine_id')
        if tontine_id:
            return Withdrawal.objects.filter(tontine__id=tontine_id, beneficiary=self.request.user)
        return Withdrawal.objects.filter(beneficiary=self.request.user)


class WithdrawalDetailView(generics.RetrieveUpdateDestroyAPIView):
    queryset = Withdrawal.objects.all()
    serializer_class = WithdrawalSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        # Ensure users can only access their own withdrawals
        return self.queryset.filter(beneficiary=self.request.user)

    def perform_update(self, serializer):
        # Prevent changing tontine or beneficiary after creation
        if 'tontine' in serializer.validated_data and serializer.validated_data['tontine'] != serializer.instance.tontine:
            raise ValidationError("Cannot change tontine for an existing withdrawal.")
        if 'beneficiary' in serializer.validated_data and serializer.validated_data['beneficiary'] != serializer.instance.beneficiary:
            raise ValidationError("Cannot change beneficiary for an existing withdrawal.")
        
        serializer.save()

    def perform_destroy(self, instance):
        # Add any specific logic for deleting withdrawals if needed
        instance.delete()


class TontineContributionStatusView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, tontine_id, format=None):
        tontine = get_object_or_404(Tontine, pk=tontine_id)

        # Check if the user is the owner or a member of the tontine
        if not (tontine.owner == request.user or TontineMember.objects.filter(tontine=tontine, user=request.user, is_active=True).exists()):
            raise PermissionDenied("You do not have permission to view this tontine's contribution status.")

        members_status = []
        for member_ship in tontine.memberships.all():
            member = member_ship.user
            last_contribution = Contribution.objects.filter(tontine=tontine, member=member).order_by('-date').first()
            
            is_late = False
            if tontine.start_date and tontine.frequency:
                # Determine the effective start date for this member's contributions
                # This could be the tontine's start_date or the member's joined_at date, whichever is later
                effective_start_date = tontine.start_date
                member_ship_obj = TontineMember.objects.filter(tontine=tontine, user=member).first()
                if member_ship_obj and member_ship_obj.joined_at.date() > effective_start_date:
                    effective_start_date = member_ship_obj.joined_at.date()

                # Calculate the next expected contribution date
                expected_next_contribution_date = effective_start_date
                if last_contribution:
                    # Start calculating from the last contribution date
                    current_calc_date = last_contribution.date.date()
                else:
                    # If no contributions, start from the effective start date
                    current_calc_date = effective_start_date

                while expected_next_contribution_date <= date.today():
                    if tontine.frequency == 'daily':
                        expected_next_contribution_date = current_calc_date + timedelta(days=1)
                    elif tontine.frequency == 'weekly':
                        expected_next_contribution_date = current_calc_date + timedelta(weeks=1)
                    elif tontine.frequency == 'monthly':
                        expected_next_contribution_date = current_calc_date + relativedelta(months=1)
                    else:
                        break # Unknown frequency
                    
                    if expected_next_contribution_date <= date.today():
                        is_late = True
                        current_calc_date = expected_next_contribution_date # Move to next period
                    else:
                        is_late = False # Not late yet for the next one
                        break

            members_status.append({
                'member_id': member.id,
                'member_email': member.email,
                'last_contribution_date': last_contribution.date.date() if last_contribution else None,
                'last_contribution_amount': last_contribution.amount if last_contribution else None,
                'last_contribution_id': last_contribution.id if last_contribution else None,
                'is_confirmed': last_contribution.is_confirmed if last_contribution else False,
                'is_late': is_late,
                'expected_contribution_amount': tontine.amount,
            })
        
        return Response({
            'tontine_id': tontine.id,
            'tontine_name': tontine.name,
            'members_status': members_status
        }, status=status.HTTP_200_OK)