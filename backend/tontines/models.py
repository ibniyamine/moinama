from django.db import models
from django.conf import settings


class Tontine(models.Model):
    FREQUENCY_CHOICES = (
        ("daily", "Quotidienne"),
        ("weekly", "Hebdomadaire"),
        ("monthly", "Mensuelle"),
    )

    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    frequency = models.CharField(max_length=20, choices=FREQUENCY_CHOICES)
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='owned_tontines')
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


class TontineMember(models.Model):
    ROLE_CHOICES = (
        ("admin", "Admin"),
        ("member", "Membre"),
    )

    tontine = models.ForeignKey(Tontine, on_delete=models.CASCADE, related_name='memberships')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='tontine_memberships')
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default='member')
    joined_at = models.DateTimeField(auto_now_add=True)
    is_active = models.BooleanField(default=True)
    payout_order = models.PositiveIntegerField(null=True, blank=True)

    class Meta:
        unique_together = ('tontine', 'user')

    def __str__(self):
        return f"{self.user} -> {self.tontine} ({self.role})"
