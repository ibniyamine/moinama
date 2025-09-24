from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import ContributionViewSet, WithdrawalViewSet

router = DefaultRouter()
router.register(r'contributions', ContributionViewSet, basename='contribution')
router.register(r'withdrawals', WithdrawalViewSet, basename='withdrawal')

urlpatterns = [
    path('', include(router.urls)),
]
