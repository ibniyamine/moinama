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
from django.db.models import Q, Sum, Count
from django.contrib.auth import get_user_model

User = get_user_model()


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


class ContributionListCreateView(generics.ListAPIView):
    queryset = Contribution.objects.all()
    serializer_class = ContributionSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        if not self.request.user.is_authenticated:
            return self.queryset.none()

        queryset = self.queryset.all() # Start with all contributions

        tontine_id = self.request.query_params.get('tontine_id')
        if tontine_id:
            tontine = get_object_or_404(Tontine, pk=tontine_id)
            # For a specific tontine, all members should be visible to the owner or other members
            is_member = TontineMember.objects.filter(tontine=tontine, user=self.request.user, is_active=True).exists()
            if tontine.owner == self.request.user or is_member:
                queryset = queryset.filter(tontine=tontine)
            else:
                # If user is not a member or owner, they can't see any contributions for this tontine
                return self.queryset.none()
        else:
            # If no tontine_id is provided:
            # Show contributions where the user is the member OR the user is the owner of the tontine
            queryset = queryset.filter(Q(member=self.request.user) | Q(tontine__owner=self.request.user)).distinct()
        
        member_id = self.request.query_params.get('member_id')
        if member_id:
            queryset = queryset.filter(member__id=member_id)

        start_date_str = self.request.query_params.get('start_date')
        end_date_str = self.request.query_params.get('end_date')

        if start_date_str:
            queryset = queryset.filter(date__date__gte=start_date_str)
        if end_date_str:
            queryset = queryset.filter(date__date__lte=end_date_str)

        status_filter = self.request.query_params.get('status')
        if status_filter:
            queryset = queryset.filter(status=status_filter)

        return queryset

    def list(self, request, *args, **kwargs):
        tontine_id = request.query_params.get('tontine_id')
        # Only group if a specific tontine_id is requested
        if tontine_id:
            queryset = self.get_queryset().order_by('round', '-date')
            grouped_contributions = {}
            for c in queryset:
                if c.round not in grouped_contributions:
                    grouped_contributions[c.round] = []
                
                # Using serializer for consistency
                serializer = self.get_serializer(c)
                grouped_contributions[c.round].append(serializer.data)
            
            return Response(grouped_contributions)
        
        # Default behavior: return a flat list
        return super().list(request, *args, **kwargs)


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
        
        # Only tontine owner can change status
        if 'status' in serializer.validated_data:
            if self.request.user != serializer.instance.tontine.owner:
                raise PermissionDenied("Only the tontine owner can change the contribution status.")
        
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
        user = self.request.user
        # Show withdrawals where the user is the beneficiary OR the user is the owner of the tontine
        queryset = self.queryset.filter(Q(beneficiary=user) | Q(tontine__owner=user)).distinct()

        tontine_id = self.request.query_params.get('tontine_id')
        if tontine_id:
            queryset = queryset.filter(tontine__id=tontine_id)
        
        start_date_str = self.request.query_params.get('start_date')
        end_date_str = self.request.query_params.get('end_date')

        if start_date_str:
            queryset = queryset.filter(date__date__gte=start_date_str)
        if end_date_str:
            queryset = queryset.filter(date__date__lte=end_date_str)

        return queryset


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

        # Permissions check
        is_owner = tontine.owner == request.user
        is_member = TontineMember.objects.filter(tontine=tontine, user=request.user, is_active=True).exists()
        if not (is_owner or is_member):
            raise PermissionDenied("You do not have permission to view this tontine's contribution status.")

        # --- Round progress ---
        total_rounds = tontine.memberships.filter(is_active=True).count()
        completed_rounds = Withdrawal.objects.filter(tontine=tontine).count()
        withdrawals_for_current_round = Withdrawal.objects.filter(tontine=tontine, round=tontine.current_round).count()
        last_withdrawal = Withdrawal.objects.filter(tontine=tontine).order_by('-date').first()
        last_winner_name = None
        if last_withdrawal and last_withdrawal.beneficiary:
            winner = last_withdrawal.beneficiary
            last_winner_name = f"{winner.first_name} {winner.last_name}".strip() or winner.email

        # --- Member Status for the CURRENT round ---
        members_status = []
        for member_ship in tontine.memberships.filter(is_active=True):
            member = member_ship.user
            
            # Find the contribution for the current round for this member
            contribution_in_round = Contribution.objects.filter(
                tontine=tontine, 
                member=member,
                round=tontine.current_round
            ).first() # .first() is enough since (member, round) should be unique for a tontine

            is_late = False
            if contribution_in_round and contribution_in_round.status in ['pending', 'unpaid']:
                due_date = None
                if tontine.frequency == 'daily':
                    due_date = tontine.current_round_start_date
                elif tontine.frequency == 'weekly':
                    due_date = tontine.current_round_start_date + timedelta(days=7)
                elif tontine.frequency == 'monthly':
                    # Use relativedelta for months to handle month-end correctly
                    due_date = tontine.current_round_start_date + relativedelta(months=1)
                
                if due_date and date.today() > due_date:
                    is_late = True

            members_status.append({
                'member_id': member.id,
                'member_email': member.email,
                'last_contribution_date': contribution_in_round.date.date() if contribution_in_round else None,
                'last_contribution_amount': contribution_in_round.amount if contribution_in_round else None,
                'last_contribution_id': contribution_in_round.id if contribution_in_round else None,
                'status': contribution_in_round.status if contribution_in_round else 'unpaid',
                'is_late': is_late,
                'expected_contribution_amount': tontine.amount,
            })
        
        # Determine if the current user has contributed in the current round
        current_user_has_contributed_this_round = False
        if request.user.is_authenticated:
            current_user_has_contributed_this_round = Contribution.objects.filter(
                tontine=tontine,
                member=request.user,
                round=tontine.current_round
            ).exists()

        return Response({
            'tontine_id': tontine.id,
            'tontine_name': tontine.name,
            'total_rounds': total_rounds,
            'completed_rounds': completed_rounds,
            'withdrawals_for_current_round': withdrawals_for_current_round,
            'last_winner_name': last_winner_name,
            'members_status': members_status,
            'current_user_has_contributed_this_round': current_user_has_contributed_this_round,
        }, status=status.HTTP_200_OK)


class DashboardGlobalStatsView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, format=None):
        # Total Contributions
        total_contributions = Contribution.objects.aggregate(Sum('amount'))['amount__sum'] or 0

        # Total Withdrawals (assuming a similar model for withdrawals exists)
        total_withdrawals = Withdrawal.objects.aggregate(Sum('amount'))['amount__sum'] or 0

        # Total Members (unique users across all tontines)
        total_members = TontineMember.objects.values('user').distinct().count()

        # Total Active Tontines (assuming all tontines are "active" for now, or add an 'is_active' field to Tontine model)
        total_active_tontines = Tontine.objects.count()

        # Contribution Chart Data (e.g., last 30 days)
        today = date.today()
        thirty_days_ago = today - timedelta(days=30)
        
        contributions_last_30_days = Contribution.objects.filter(
            date__date__gte=thirty_days_ago,
            date__date__lte=today
        ).extra({'day': "date(date)"}).values('day').annotate(total_amount=Sum('amount')).order_by('day')

        chart_labels = []
        chart_data = []
        current_date = thirty_days_ago
        while current_date <= today:
            chart_labels.append(current_date.strftime('%Y-%m-%d'))
            # Find data for the current date, or use 0 if no contributions
            data_for_day = next((item for item in contributions_last_30_days if item['day'].strftime('%Y-%m-%d') == current_date.strftime('%Y-%m-%d')), None)
            chart_data.append(data_for_day['total_amount'] if data_for_day else 0)
            current_date += timedelta(days=1)

        # Upcoming Payments (Placeholder for now, as this requires more complex logic)
        # This would involve iterating through tontines and their members to determine next expected contribution dates
        upcoming_payments = [] 

        return Response({
            'total_contributions': total_contributions,
            'total_withdrawals': total_withdrawals,
            'total_members': total_members,
            'total_active_tontines': total_active_tontines,
            'contribution_chart_data': {
                'labels': chart_labels,
                'data': chart_data,
            },
            'upcoming_payments': upcoming_payments,
        }, status=status.HTTP_200_OK)