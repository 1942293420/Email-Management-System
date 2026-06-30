from django.contrib import admin
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from mailboxes.views import MailboxViewSet, EmailViewSet, SyncLogViewSet, internal_push

router = DefaultRouter()
router.register(r'mailboxes', MailboxViewSet, basename='mailbox')
router.register(r'emails', EmailViewSet, basename='email')
router.register(r'sync-logs', SyncLogViewSet, basename='synclog')

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include(router.urls)),
    path('api/internal/push/', internal_push),
]
