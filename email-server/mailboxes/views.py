import json
import time
from datetime import datetime

import requests
from django.db.models import Q, Count
from django.db import models
from django.utils.timezone import now

from rest_framework import viewsets, status
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync

from .models import Mailbox, EmailMessage, SyncLog
from .serializers import (
    MailboxSerializer, MailboxListSerializer,
    EmailListSerializer, EmailDetailSerializer, SyncLogSerializer,
)
from .imap_sync import sync_mailbox


# 同步超时（秒）
SYNC_TIMEOUT = 45

# 内部推送地址 — Daphne HTTP 端口
INTERNAL_PUSH_URL = "http://127.0.0.1:9122/api/internal/push/"


def push_to_frontend(event_type: str, data: dict):
    """通过 HTTP POST 到 Daphne 内部推送接口"""
    try:
        requests.post(
            INTERNAL_PUSH_URL,
            json={"type": event_type, "data": data},
            timeout=2,
        )
    except requests.exceptions.RequestException:
        pass  # 推送失败不影响主流程


def run_sync_with_timeout(mailbox):
    """用线程执行同步，自带超时控制，不阻塞 Daphne 事件循环"""
    import threading
    start = time.time()
    result = {"new": 0, "error": "同步异常"}

    def _sync():
        nonlocal result
        try:
            result = sync_mailbox(mailbox)
        except Exception as e:
            result = {"new": 0, "error": str(e)}

    t = threading.Thread(target=_sync, daemon=True)
    t.start()
    t.join(timeout=SYNC_TIMEOUT)

    if t.is_alive():
        result = {"new": 0, "error": "同步超时（>45秒）"}

    result["duration_ms"] = int((time.time() - start) * 1000)
    return result


def push_sync_status(mailbox_id: int, mailbox_name: str, status: str,
                     new_count: int, error_message: str, duration_ms: int):
    push_to_frontend("sync_status", {
        "mailbox_id": mailbox_id,
        "mailbox_name": mailbox_name,
        "status": status,
        "new_count": new_count,
        "error_message": error_message,
        "duration_ms": duration_ms,
    })


def do_sync_and_log(mailbox, push=True):
    """执行同步并记录日志，返回结果"""
    result = run_sync_with_timeout(mailbox)

    # 确定状态
    if result["error"]:
        if "超时" in result["error"]:
            sync_status = "timeout"
        else:
            sync_status = "failed"
    else:
        sync_status = "success"

    # 写日志
    SyncLog.objects.create(
        mailbox=mailbox,
        status=sync_status,
        new_count=result.get("new", 0),
        error_message=result.get("error") or "",
        duration_ms=result.get("duration_ms", 0),
    )

    # WS 推送
    if push:
        push_sync_status(
            mailbox_id=mailbox.id,
            mailbox_name=mailbox.name,
            status=sync_status,
            new_count=result.get("new", 0),
            error_message=result.get("error") or "",
            duration_ms=result.get("duration_ms", 0),
        )

    if result['new'] > 0:
        push_mail_notification(mailbox.id, mailbox.name, result['new'])

    return result


def push_mail_notification(mailbox_id: int, mailbox_name: str, count: int):
    push_to_frontend("new_email", {
        "mailbox_id": mailbox_id,
        "mailbox_name": mailbox_name,
        "count": count,
    })


class MailboxViewSet(viewsets.ModelViewSet):
    """邮箱配置 CRUD"""

    queryset = Mailbox.objects.all()

    def get_serializer_class(self):
        if self.action == 'list':
            return MailboxListSerializer
        return MailboxSerializer

    @action(detail=True, methods=['post'])
    def sync(self, request, pk=None):
        """手动触发单个邮箱同步"""
        mailbox = self.get_object()
        result = do_sync_and_log(mailbox)

        return Response({
            "new": result.get("new", 0),
            "error": result.get("error"),
            "status": "timeout" if (result.get("error") and "超时" in result["error"]) else
                      "failed" if result.get("error") else "success",
            "duration_ms": result.get("duration_ms", 0),
        })

    @action(detail=False, methods=['post'])
    def sync_all(self, request):
        """同步所有活跃邮箱"""
        results = []
        total_new = 0
        for mailbox in Mailbox.objects.filter(is_active=True):
            result = do_sync_and_log(mailbox)
            total_new += result.get('new', 0)
            results.append({
                "mailbox_id": mailbox.id,
                "mailbox_name": mailbox.name,
                "email": mailbox.email,
                "new": result.get("new", 0),
                "error": result.get("error"),
                "status": "timeout" if (result.get("error") and "超时" in result["error"]) else
                          "failed" if result.get("error") else "success",
                "duration_ms": result.get("duration_ms", 0),
            })

        return Response({
            "total_new": total_new,
            "details": results,
        })


class EmailViewSet(viewsets.ReadOnlyModelViewSet):
    """邮件查看（只读）"""

    queryset = EmailMessage.objects.select_related('mailbox').all()
    serializer_class = EmailListSerializer

    def get_serializer_class(self):
        if self.action == 'retrieve':
            return EmailDetailSerializer
        return EmailListSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        mailbox_id = self.request.query_params.get('mailbox')
        if mailbox_id:
            qs = qs.filter(mailbox_id=mailbox_id)
        return qs

    @action(detail=False, methods=['get'])
    def search(self, request):
        """搜索邮件（按主题、发件人、正文内容）"""
        q = request.query_params.get('q', '').strip()
        if not q:
            return Response({"error": "缺少搜索关键词 q"}, status=status.HTTP_400_BAD_REQUEST)

        qs = self.get_queryset().filter(
            Q(subject__icontains=q) |
            Q(sender__icontains=q) |
            Q(sender_email__icontains=q) |
            Q(body_text__icontains=q)
        )[:50]

        serializer = EmailListSerializer(qs, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['post'])
    def mark_read(self, request, pk=None):
        """标记邮件为已读"""
        email_msg = self.get_object()
        email_msg.is_read = True
        email_msg.save(update_fields=['is_read'])
        return Response({"status": "ok"})

    @action(detail=True, methods=['post'])
    def mark_unread(self, request, pk=None):
        """标记邮件为未读"""
        email_msg = self.get_object()
        email_msg.is_read = False
        email_msg.save(update_fields=['is_read'])
        return Response({"status": "ok"})

    @action(detail=False, methods=['get'])
    def summary(self, request):
        """收件箱概况"""
        total = EmailMessage.objects.count()
        unread = EmailMessage.objects.filter(is_read=False).count()
        mailbox_count = Mailbox.objects.filter(is_active=True).count()
        return Response({
            "total_emails": total,
            "unread_emails": unread,
            "active_mailboxes": mailbox_count,
        })


class SyncLogViewSet(viewsets.ReadOnlyModelViewSet):
    """同步日志查看"""

    queryset = SyncLog.objects.select_related('mailbox').all()
    serializer_class = SyncLogSerializer

    @action(detail=False, methods=['get'])
    def stats(self, request):
        """运维统计概览"""
        total = SyncLog.objects.count()
        success = SyncLog.objects.filter(status='success').count()
        failed = SyncLog.objects.filter(status='failed').count()
        timeout = SyncLog.objects.filter(status='timeout').count()

        # 最近24小时
        from django.utils import timezone
        since = timezone.now() - timezone.timedelta(hours=24)
        recent = SyncLog.objects.filter(created_at__gte=since)
        recent_total = recent.count()
        recent_failed = recent.filter(status__in=['failed', 'timeout']).count()

        # 各邮箱统计
        per_mailbox = (
            SyncLog.objects.values('mailbox__name', 'mailbox__email')
            .annotate(
                total=Count('id'),
                success=Count('id', filter=models.Q(status='success')),
                failed=Count('id', filter=models.Q(status='failed')),
                timeout=Count('id', filter=models.Q(status='timeout')),
            )
            .order_by('-total')
        )

        return Response({
            "total_syncs": total,
            "success": success,
            "failed": failed,
            "timeout": timeout,
            "recent_24h": {
                "total": recent_total,
                "failed": recent_failed,
            },
            "per_mailbox": list(per_mailbox),
        })


# ─────────────────────────────────────────────
# 内部推送接口 — 仅供本机 cron worker 调用
# ─────────────────────────────────────────────

@api_view(["POST"])
@permission_classes([AllowAny])
def internal_push(request):
    """
    内部推送接口 — 仅供本机 cron worker 调用。
    收到 POST 后，通过 InMemoryChannelLayer 广播给所有 WebSocket 客户端。
    """
    # 仅允许本机请求
    remote_addr = request.META.get('REMOTE_ADDR', '')
    if remote_addr not in ('127.0.0.1', '::1'):
        return Response({"error": "forbidden"}, status=403)

    event_type = request.data.get("type", "")
    data = request.data.get("data", {})

    channel_layer = get_channel_layer()
    async_to_sync(channel_layer.group_send)(
        "email_events",
        {
            "type": "email_notification",
            "data": {
                "event_type": event_type,
                **data,
            },
        },
    )
    return Response({"status": "ok"})
