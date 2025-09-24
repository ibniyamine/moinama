from rest_framework import serializers
from .models import Tontine, TontineMember


class TontineMemberSerializer(serializers.ModelSerializer):
    user_email = serializers.ReadOnlyField(source="user.email")

    class Meta:
        model = TontineMember
        fields = [
            'id', 'tontine', 'user', 'user_email', 'role', 'joined_at', 'is_active', 'payout_order'
        ]
        read_only_fields = ['id', 'joined_at']


class TontineSerializer(serializers.ModelSerializer):
    owner_email = serializers.ReadOnlyField(source="owner.email")

    class Meta:
        model = Tontine
        fields = [
            'id', 'name', 'description', 'amount', 'frequency', 'start_date', 'end_date', 'owner', 'owner_email', 'created_at'
        ]
        read_only_fields = ['id', 'created_at', 'owner_email']

    def create(self, validated_data):
        # Ensure request.user is set as owner if not provided
        request = self.context.get('request')
        if request and request.user and not validated_data.get('owner'):
            validated_data['owner'] = request.user
        return super().create(validated_data)
