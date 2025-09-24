from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import TontineViewSet, TontineMemberViewSet

router = DefaultRouter()
router.register(r'tontines', TontineViewSet, basename='tontine')
router.register(r'members', TontineMemberViewSet, basename='tontine-member')

urlpatterns = [
    path('', include(router.urls)),
]
