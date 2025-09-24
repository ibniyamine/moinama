# Moinama (Django + PostgreSQL)

## Objectifs
- Simplifier la gestion des tontines.
- Assurer la transparence des transactions.
- Suivi en temps réel des contributions et retraits.
- Communication facile entre les membres.

## Stack
- Django, Django REST Framework, SimpleJWT
- PostgreSQL
- CORS, django-environ

## Démarrage rapide

1. Créer un environnement virtuel et installer les dépendances:
```powershell
py -m venv .venv
.venv\Scripts\activate
python -m pip install -r requirements.txt
```

2. Configurer l'environnement:
- Copier `.env.example` vers `.env` et ajuster les variables si nécessaire.

3. Préparer la base de données:
- Créez une base PostgreSQL selon les variables `.env` (POSTGRES_DB, etc.)

4. Migrations:
```powershell
python manage.py makemigrations
python manage.py migrate
```

5. Créer un superuser:
```powershell
python manage.py createsuperuser --email admin@example.com
```

6. Lancer le serveur:
```powershell
python manage.py runserver
```

## Endpoints principaux
- Auth JWT: `POST /api/auth/token/`, `POST /api/auth/token/refresh/`
- Accounts:
  - `POST /api/accounts/register/` (body: email, phone, first_name, last_name, password)
  - `GET /api/accounts/me/` (JWT requis)

## À venir
- Modèles et endpoints Tontines (règles, membres, rôles)
- Transactions (contributions, retraits, historique, notifications)
- Messagerie interne (optionnel) et notifications push
