from rest_framework import serializers
from .models import Tontine, TontineMember
from django.conf import settings
from transactions.models import Contribution
from datetime import date, timedelta
from dateutil.relativedelta import relativedelta

# Get the User model from settings to avoid direct import
User = settings.AUTH_USER_MODEL


class TontineMemberAddSerializer(serializers.Serializer):
    """
    Serializer for adding a member to a tontine.
    Just requires the user's ID.
    """
    user_id = serializers.IntegerField()

    def validate_user_id(self, value):
        """
        Check that the user exists.
        """
        try:
            # This assumes you are using the default Django User model
            from django.contrib.auth import get_user_model
            User = get_user_model()
            User.objects.get(pk=value)
        except User.DoesNotExist:
            raise serializers.ValidationError("User not found.")
        return value


class TontineMemberSerializer(serializers.ModelSerializer):
    user_email = serializers.ReadOnlyField(source="user.email")
    user_first_name = serializers.ReadOnlyField(source="user.first_name")
    user_last_name = serializers.ReadOnlyField(source="user.last_name")
    user_phone = serializers.ReadOnlyField(source="user.phone")

    class Meta:
        model = TontineMember
        fields = [
            'id', 'tontine', 'user', 'user_email', 'user_first_name', 'user_last_name', 'user_phone', 'role', 'joined_at', 'is_active', 'payout_order'
        ]
        read_only_fields = ['id', 'joined_at', 'tontine']


from transactions.serializers import WithdrawalSerializer

class TontineSerializer(serializers.ModelSerializer):
    owner_email = serializers.ReadOnlyField(source="owner.email")
    members = TontineMemberSerializer(many=True, read_only=True, source='memberships')
    has_contributed_this_period = serializers.SerializerMethodField()
    withdrawals = WithdrawalSerializer(many=True, read_only=True)

    class Meta:
        model = Tontine
        fields = [
            'id', 'name', 'description', 'amount', 'frequency', 'start_date', 'end_date', 'owner', 'owner_email', 'created_at', 'members', 'has_contributed_this_period', 'withdrawals'
        ]
        read_only_fields = ['id', 'created_at', 'owner', 'owner_email', 'members']

    def get_has_contributed_this_period(self, obj):
        request = self.context.get('request')
        if not request or not request.user.is_authenticated:
            return False

        member = request.user
        tontine = obj
        today = date.today()

        current_period_start = None
        if tontine.frequency == 'weekly':
            days_since_tontine_start = (today - tontine.start_date).days
            current_week_offset = (days_since_tontine_start // 7) * 7
            current_period_start = tontine.start_date + timedelta(days=current_week_offset)
        elif tontine.frequency == 'monthly':
            tontine_start_day = tontine.start_date.day
            if today.day >= tontine_start_day:
                current_period_start = date(today.year, today.month, tontine_start_day)
            else:
                current_period_start = date(today.year, today.month, tontine_start_day) - relativedelta(months=1)

        if current_period_start:
            return Contribution.objects.filter(
                tontine=tontine,
                member=member,
                date__date__gte=current_period_start,
                date__date__lte=today
            ).exists()
        return False
