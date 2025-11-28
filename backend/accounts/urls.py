from django.urls import path
from .views import RegisterView, MeView, UserListView, RedeemInvitationCodeView

urlpatterns = [
    path('register/', RegisterView.as_view(), name='register'),
    path('me/', MeView.as_view(), name='me'),
    path('users/', UserListView.as_view(), name='user-list'),
    path('redeem-code/', RedeemInvitationCodeView.as_view(), name='redeem-code'),
]
