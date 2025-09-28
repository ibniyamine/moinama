from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import TontineViewSet

router = DefaultRouter()
router.register(r'', TontineViewSet, basename='tontine')

urlpatterns = [
    path('', include(router.urls)),
]
