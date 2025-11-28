from rest_framework import generics, permissions
from rest_framework.response import Response
from rest_framework.renderers import JSONRenderer
from .models import User
from .serializers import RegisterSerializer, UserSerializer
from django.shortcuts import render, redirect
from django.views.decorators.csrf import ensure_csrf_cookie
from django.contrib.auth.forms import AuthenticationForm
from django.contrib import auth


class UserListView(generics.ListAPIView):
    queryset = User.objects.all()
    serializer_class = UserSerializer
    permission_classes = [permissions.IsAuthenticated]


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


class RedeemInvitationCodeView(generics.GenericAPIView):
    permission_classes = [permissions.IsAuthenticated]
    
    VALID_CODE = 'tontine26'
    
    def post(self, request, *args, **kwargs):
        code = request.data.get('code', '').strip()
        
        if not code:
            return Response({'detail': 'Code requis.'}, status=400)
        
        # Check if user already has permission
        if request.user.can_create_tontines:
            return Response({'detail': 'Vous avez déjà le pouvoir de créer des tontines.'}, status=400)
        
        # Verify the code
        if code != self.VALID_CODE:
            return Response({'detail': 'Code invalide.'}, status=400)
        
        # Grant permission to create tontines
        request.user.can_create_tontines = True
        request.user.save()
        
        return Response({'detail': 'Code validé avec succès ! Vous pouvez maintenant créer des tontines.'})

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
    return render(request, 'frontend/index.html')

def logout_view(request):
    logout(request)
    return redirect('login_page') # Redirect to login page after logout
