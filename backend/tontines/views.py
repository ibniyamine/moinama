from django.db.models import Q
from rest_framework import viewsets, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from .models import Tontine, TontineMember
from .serializers import TontineSerializer, TontineMemberSerializer


class IsTontineMember(permissions.BasePermission):
    """Allow access only to members of the tontine for object-level permissions."""

    def has_object_permission(self, request, view, obj):
        user = request.user
        if isinstance(obj, Tontine):
            return TontineMember.objects.filter(tontine=obj, user=user, is_active=True).exists() or obj.owner_id == user.id
        if isinstance(obj, TontineMember):
            return TontineMember.objects.filter(tontine=obj.tontine, user=user, is_active=True).exists() or obj.tontine.owner_id == user.id
        return False


class TontineViewSet(viewsets.ModelViewSet):
    serializer_class = TontineSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        return Tontine.objects.filter(
            Q(owner=user) | Q(memberships__user=user, memberships__is_active=True)
        ).distinct()

    def perform_create(self, serializer):
        tontine = serializer.save(owner=self.request.user)
        # Owner automatically becomes admin member
        TontineMember.objects.get_or_create(tontine=tontine, user=self.request.user, defaults={"role": "admin"})

    @action(detail=True, methods=['get'], permission_classes=[permissions.IsAuthenticated, IsTontineMember])
    def members(self, request, pk=None):
        tontine = self.get_object()
        qs = TontineMember.objects.filter(tontine=tontine)
        return Response(TontineMemberSerializer(qs, many=True).data)


class TontineMemberViewSet(viewsets.ModelViewSet):
    serializer_class = TontineMemberSerializer
    permission_classes = [permissions.IsAuthenticated, IsTontineMember]

    def get_queryset(self):
        user = self.request.user
        tontine_id = self.request.query_params.get('tontine')
        qs = TontineMember.objects.filter(tontine__memberships__user=user, tontine__memberships__is_active=True)
        if tontine_id:
            qs = qs.filter(tontine_id=tontine_id)
        return qs.distinct()