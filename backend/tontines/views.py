from django.db.models import Q
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from .models import Tontine, TontineMember
from .serializers import TontineSerializer, TontineMemberSerializer, TontineMemberAddSerializer
from django.contrib.auth import get_user_model

User = get_user_model()


class IsTontineAdminOrOwner(permissions.BasePermission):
    """Permission to check if the user is an admin or the owner of the tontine."""

    def has_object_permission(self, request, view, obj):
        if not request.user.is_authenticated:
            return False
        
        tontine = obj if isinstance(obj, Tontine) else obj.tontine
        
        is_owner = tontine.owner == request.user
        is_admin = TontineMember.objects.filter(
            tontine=tontine, user=request.user, role='admin', is_active=True
        ).exists()
        
        return is_owner or is_admin


class IsTontineMember(permissions.BasePermission):
    """Allow access only to members of the tontine for object-level permissions."""

    def has_object_permission(self, request, view, obj):
        user = request.user
        if isinstance(obj, Tontine):
            return TontineMember.objects.filter(tontine=obj, user=user, is_active=True).exists() or obj.owner_id == user.id
        if isinstance(obj, TontineMember):
            return IsTontineAdminOrOwner().has_object_permission(request, view, obj)
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
        TontineMember.objects.create(tontine=tontine, user=self.request.user, role="admin")

    @action(detail=True, methods=['get'], permission_classes=[permissions.IsAuthenticated, IsTontineMember])
    def members(self, request, pk=None):
        tontine = self.get_object()
        qs = TontineMember.objects.filter(tontine=tontine)
        return Response(TontineMemberSerializer(qs, many=True).data)

    @action(detail=True, methods=['post'], url_path='add-member', permission_classes=[permissions.IsAuthenticated, IsTontineAdminOrOwner])
    def add_member(self, request, pk=None):
        tontine = self.get_object()
        serializer = TontineMemberAddSerializer(data=request.data)

        if serializer.is_valid():
            user_id = serializer.validated_data['user_id']
            try:
                user_to_add = User.objects.get(pk=user_id)
            except User.DoesNotExist:
                return Response({'error': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)

            if TontineMember.objects.filter(tontine=tontine, user=user_to_add).exists():
                return Response({'error': 'User is already a member of this tontine.'}, status=status.HTTP_400_BAD_REQUEST)

            membership = TontineMember.objects.create(tontine=tontine, user=user_to_add)
            return Response(TontineMemberSerializer(membership).data, status=status.HTTP_201_CREATED)
        
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'], url_path='remove-member', permission_classes=[permissions.IsAuthenticated, IsTontineAdminOrOwner])
    def remove_member(self, request, pk=None):
        tontine = self.get_object()
        serializer = TontineMemberAddSerializer(data=request.data) # Re-using for user_id validation

        if serializer.is_valid():
            user_id = serializer.validated_data['user_id']
            
            if tontine.owner.id == user_id:
                return Response({'error': 'Cannot remove the owner of the tontine.'}, status=status.HTTP_400_BAD_REQUEST)

            try:
                membership = TontineMember.objects.get(tontine=tontine, user_id=user_id)
            except TontineMember.DoesNotExist:
                return Response({'error': 'User is not a member of this tontine.'}, status=status.HTTP_404_NOT_FOUND)

            membership.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)

        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
