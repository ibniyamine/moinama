from rest_framework import serializers
from .models import Message


class MessageSerializer(serializers.ModelSerializer):
    sender_email = serializers.ReadOnlyField(source='sender.email')

    class Meta:
        model = Message
        fields = ['id', 'tontine', 'sender', 'sender_email', 'content', 'created_at']
        read_only_fields = ['id', 'created_at', 'sender_email']

    def create(self, validated_data):
        request = self.context.get('request')
        if request and request.user and not validated_data.get('sender'):
            validated_data['sender'] = request.user
        return super().create(validated_data)
