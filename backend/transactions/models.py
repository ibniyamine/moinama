from django.db import models
from django.conf import settings
from tontines.models import Tontine


class Contribution(models.Model):
    tontine = models.ForeignKey(Tontine, on_delete=models.CASCADE, related_name='contributions')
    member = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='contributions')
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    date = models.DateTimeField(auto_now_add=True)
    note = models.CharField(max_length=255, blank=True)
    STATUS_CHOICES = (
        ('pending', 'En attente'),
        ('paid', 'Payé'),
        ('unpaid', 'Non payé'),
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="pending")
    round = models.PositiveIntegerField(default=1)

    def __str__(self):
        return f"Contribution {self.amount} - {self.member} -> {self.tontine}"


class Withdrawal(models.Model):
    tontine = models.ForeignKey(Tontine, on_delete=models.CASCADE, related_name='withdrawals')
    beneficiary = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='withdrawals')
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    round = models.PositiveIntegerField(default=1)
    date = models.DateTimeField(auto_now_add=True)
    note = models.CharField(max_length=255, blank=True)

    def __str__(self):
        return f"Withdrawal {self.amount} - {self.beneficiary} <- {self.tontine}"
