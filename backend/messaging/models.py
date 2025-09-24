from django.db import models
from django.conf import settings
from tontines.models import Tontine


class Message(models.Model):
    tontine = models.ForeignKey(Tontine, on_delete=models.CASCADE, related_name='messages')
    sender = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='sent_messages')
    content = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Message by {self.sender} in {self.tontine}"
