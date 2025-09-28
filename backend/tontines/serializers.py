from rest_framework import serializers
from .models import Tontine, TontineMember
from django.conf import settings

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

    class Meta:
        model = TontineMember
        fields = [
            'id', 'tontine', 'user', 'user_email', 'role', 'joined_at', 'is_active', 'payout_order'
        ]
        read_only_fields = ['id', 'joined_at', 'tontine']


class TontineSerializer(serializers.ModelSerializer):
    owner_email = serializers.ReadOnlyField(source="owner.email")
    members = TontineMemberSerializer(many=True, read_only=True, source='memberships')

    class Meta:
        model = Tontine
        fields = [
            'id', 'name', 'description', 'amount', 'frequency', 'start_date', 'end_date', 'owner', 'owner_email', 'created_at', 'members'
        ]
        read_only_fields = ['id', 'created_at', 'owner', 'owner_email', 'members']
