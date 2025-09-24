from rest_framework import viewsets, permissions
from rest_framework.exceptions import PermissionDenied
from tontines.models import Tontine, TontineMember
from .models import Contribution, Withdrawal
from .serializers import ContributionSerializer, WithdrawalSerializer


def user_is_member(user, tontine_id):
    return TontineMember.objects.filter(tontine_id=tontine_id, user=user, is_active=True).exists() or Tontine.objects.filter(id=tontine_id, owner=user).exists()


class ContributionViewSet(viewsets.ModelViewSet):
    serializer_class = ContributionSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        return Contribution.objects.filter(tontine__memberships__user=user, tontine__memberships__is_active=True).union(
            Contribution.objects.filter(tontine__owner=user)
        ).distinct()

    def perform_create(self, serializer):
        tontine_id = self.request.data.get('tontine')
        if tontine_id and not user_is_member(self.request.user, tontine_id):
            raise PermissionDenied('Vous devez être membre de la tontine pour enregistrer une contribution.')
        serializer.save(member=self.request.user)


class WithdrawalViewSet(viewsets.ModelViewSet):
    serializer_class = WithdrawalSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        return Withdrawal.objects.filter(tontine__memberships__user=user, tontine__memberships__is_active=True).union(
            Withdrawal.objects.filter(tontine__owner=user)
        ).distinct()

    def perform_create(self, serializer):
        tontine_id = self.request.data.get('tontine')
        if tontine_id and not user_is_member(self.request.user, tontine_id):
            raise PermissionDenied('Vous devez être membre de la tontine pour enregistrer un retrait.')
        serializer.save(beneficiary=self.request.user)
