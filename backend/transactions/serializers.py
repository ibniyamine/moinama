from rest_framework import serializers
from .models import Contribution, Withdrawal
from accounts.serializers import UserSerializer


class ContributionSerializer(serializers.ModelSerializer):
    member = UserSerializer(read_only=True)
    member_name = serializers.SerializerMethodField()

    class Meta:
        model = Contribution
        fields = ['id', 'tontine', 'member', 'member_name', 'amount', 'date', 'note', 'status', 'round']
        read_only_fields = ['id', 'date', 'member_name', 'round']

    def get_member_name(self, obj):
        if obj.member:
            name = obj.member.get_full_name()
            return name if name.strip() else obj.member.email
        return "Utilisateur inconnu"

    def create(self, validated_data):
        request = self.context.get('request')
        if request and request.user and not validated_data.get('member'):
            validated_data['member'] = request.user
        return super().create(validated_data)


class WithdrawalSerializer(serializers.ModelSerializer):
    beneficiary = UserSerializer(read_only=True)

    class Meta:
        model = Withdrawal
        fields = ['id', 'tontine', 'beneficiary', 'amount', 'date', 'note', 'round']
        read_only_fields = ['id', 'date', 'round']

    def create(self, validated_data):
        request = self.context.get('request')
        if request and request.user and not validated_data.get('beneficiary'):
            validated_data['beneficiary'] = request.user
        return super().create(validated_data)
