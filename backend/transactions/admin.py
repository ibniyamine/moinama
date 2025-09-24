from django.contrib import admin
from .models import Contribution, Withdrawal


@admin.register(Contribution)
class ContributionAdmin(admin.ModelAdmin):
    list_display = ("tontine", "member", "amount", "date")
    list_filter = ("date",)


@admin.register(Withdrawal)
class WithdrawalAdmin(admin.ModelAdmin):
    list_display = ("tontine", "beneficiary", "amount", "date")
    list_filter = ("date",)
