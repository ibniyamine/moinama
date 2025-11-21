from django.urls import path
from .views import ContributionListCreateView, ContributionDetailView, WithdrawalListCreateView, WithdrawalDetailView, TontineContributionStatusView, DashboardGlobalStatsView, WithdrawalReciprocityView

urlpatterns = [
    path('contributions/', ContributionListCreateView.as_view(), name='contribution-list-create'),
    path('contributions/<int:pk>/', ContributionDetailView.as_view(), name='contribution-detail'),
    path('withdrawals/', WithdrawalListCreateView.as_view(), name='withdrawal-list-create'),
    path('withdrawals/<int:pk>/', WithdrawalDetailView.as_view(), name='withdrawal-detail'),
    path('withdrawals/<int:withdrawal_id>/reciprocity/', WithdrawalReciprocityView.as_view(), name='withdrawal-reciprocity'),
    path('tontines/<int:tontine_id>/status/', TontineContributionStatusView.as_view(), name='tontine-contribution-status'),
    path('dashboard-stats/', DashboardGlobalStatsView.as_view(), name='dashboard-global-stats'),
]