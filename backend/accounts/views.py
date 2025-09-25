from rest_framework import generics, permissions
from rest_framework.response import Response
from rest_framework.renderers import JSONRenderer
from .models import User
from .serializers import RegisterSerializer, UserSerializer
from django.shortcuts import render
from django.views.decorators.csrf import ensure_csrf_cookie


class RegisterView(generics.CreateAPIView):
    serializer_class = RegisterSerializer
    permission_classes = [permissions.AllowAny]
    renderer_classes = [JSONRenderer]


class MeView(generics.GenericAPIView):
    serializer_class = UserSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, *args, **kwargs):
        serializer = self.get_serializer(request.user)
        return Response(serializer.data)

@ensure_csrf_cookie
def login_view(request):
    return render(request, 'auth/login.html')

from django.contrib.auth.decorators import login_required

@ensure_csrf_cookie
def register_view(request):
    return render(request, 'auth/register.html')

@login_required
@ensure_csrf_cookie
def dashboard_view(request):
    return render(request, 'dashboard.html')
