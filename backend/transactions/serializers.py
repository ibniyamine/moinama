from rest_framework import serializers
from .models import Contribution, Withdrawal


class ContributionSerializer(serializers.ModelSerializer):
    member_email = serializers.ReadOnlyField(source='member.email')

    class Meta:
        model = Contribution
        fields = ['id', 'tontine', 'member', 'member_email', 'amount', 'date', 'note']
        read_only_fields = ['id', 'date', 'member_email']

    def create(self, validated_data):
        request = self.context.get('request')
        if request and request.user and not validated_data.get('member'):
            validated_data['member'] = request.user
        return super().create(validated_data)


class WithdrawalSerializer(serializers.ModelSerializer):
    beneficiary_email = serializers.ReadOnlyField(source='beneficiary.email')

    class Meta:
        model = Withdrawal
        fields = ['id', 'tontine', 'beneficiary', 'beneficiary_email', 'amount', 'date', 'note']
        read_only_fields = ['id', 'date', 'beneficiary_email']

    def create(self, validated_data):
        request = self.context.get('request')
        if request and request.user and not validated_data.get('beneficiary'):
            validated_data['beneficiary'] = request.user
        return super().create(validated_data)
