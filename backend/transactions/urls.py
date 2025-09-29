from django.urls import path
from .views import ContributionListCreateView, ContributionDetailView, WithdrawalListCreateView, WithdrawalDetailView, TontineContributionStatusView

urlpatterns = [
    path('contributions/', ContributionListCreateView.as_view(), name='contribution-list-create'),
    path('contributions/<int:pk>/', ContributionDetailView.as_view(), name='contribution-detail'),
    path('withdrawals/', WithdrawalListCreateView.as_view(), name='withdrawal-list-create'),
    path('withdrawals/<int:pk>/', WithdrawalDetailView.as_view(), name='withdrawal-detail'),
    path('tontines/<int:tontine_id>/status/', TontineContributionStatusView.as_view(), name='tontine-contribution-status'),
]