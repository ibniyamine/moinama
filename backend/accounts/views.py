from rest_framework import generics, permissions
from rest_framework.response import Response
from rest_framework.renderers import JSONRenderer
from .models import User
from .serializers import RegisterSerializer, UserSerializer
from django.shortcuts import render, redirect
from django.views.decorators.csrf import ensure_csrf_cookie
from django.contrib.auth.forms import AuthenticationForm
from django.contrib import auth


def frontend_view(request):
    return render(request, 'frontend/index.html')


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
    if request.method == 'POST':
        form = AuthenticationForm(request, data=request.POST)
        if form.is_valid():
            user = form.get_user()
            auth.login(request, user)
            return redirect('dashboard') # Redirect to dashboard after successful login
        else:
            # If form is not valid, render the login page again with errors
            return render(request, 'auth/login.html', {'form': form})
    else:
        form = AuthenticationForm()
    return render(request, 'auth/login.html', {'form': form})

from django.contrib.auth.decorators import login_required
from django.contrib.auth import logout

@ensure_csrf_cookie
def register_view(request):
    return render(request, 'auth/register.html')

@login_required
@ensure_csrf_cookie
def dashboard_view(request):
    return render(request, 'dashboard.html')

def logout_view(request):
    logout(request)
    return redirect('login_page') # Redirect to login page after logout
