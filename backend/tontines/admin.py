from django.contrib import admin
from .models import Tontine, TontineMember


@admin.register(Tontine)
class TontineAdmin(admin.ModelAdmin):
    list_display = ("name", "owner", "amount", "frequency", "start_date", "end_date")
    search_fields = ("name", "owner__email")


@admin.register(TontineMember)
class TontineMemberAdmin(admin.ModelAdmin):
    list_display = ("tontine", "user", "role", "is_active", "joined_at")
    list_filter = ("role", "is_active")
