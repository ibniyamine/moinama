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
    
    def calculate_eligible_amount(self):
        """
        Calcule le montant éligible basé sur la réciprocité:
        Le bénéficiaire ne reçoit que des membres pour qui il a cotisé dans les tours précédents.
        """
        from decimal import Decimal
        
        # Récupérer toutes les contributions du tour actuel (payées)
        current_round_contributions = Contribution.objects.filter(
            tontine=self.tontine,
            round=self.round,
            status='paid'
        )
        
        # Pour chaque contribution, vérifier si le bénéficiaire a cotisé pour ce membre dans ses tours précédents
        eligible_amount = Decimal('0.00')
        excluded_contributions = []
        eligible_contributions = []
        
        for contrib in current_round_contributions:
            contributor = contrib.member
            
            # Si c'est le bénéficiaire lui-même, on ne compte pas sa propre contribution
            if contributor == self.beneficiary:
                continue
            
            # Vérifier si le bénéficiaire a cotisé pour ce membre dans les tours précédents
            # On cherche le tour où ce membre était bénéficiaire
            contributor_round = Withdrawal.objects.filter(
                tontine=self.tontine,
                beneficiary=contributor,
                round__lt=self.round  # Tours précédents uniquement
            ).first()
            
            if contributor_round:
                # Vérifier si le bénéficiaire actuel a cotisé pour ce tour
                beneficiary_contributed = Contribution.objects.filter(
                    tontine=self.tontine,
                    member=self.beneficiary,
                    round=contributor_round.round,
                    status='paid'
                ).exists()
                
                if beneficiary_contributed:
                    eligible_amount += contrib.amount
                    eligible_contributions.append({
                        'contributor': contributor,
                        'amount': contrib.amount,
                        'reason': 'reciprocal'
                    })
                else:
                    excluded_contributions.append({
                        'contributor': contributor,
                        'amount': contrib.amount,
                        'reason': 'no_reciprocity'
                    })
            else:
                # Le contributeur n'a pas encore eu son tour, on accepte sa contribution
                eligible_amount += contrib.amount
                eligible_contributions.append({
                    'contributor': contributor,
                    'amount': contrib.amount,
                    'reason': 'no_prior_round'
                })
        
        return {
            'eligible_amount': eligible_amount,
            'total_contributions': current_round_contributions.count(),
            'eligible_contributions': eligible_contributions,
            'excluded_contributions': excluded_contributions
        }
