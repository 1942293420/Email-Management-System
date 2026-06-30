from rest_framework import serializers
from .models import Mailbox, EmailMessage, SyncLog


class MailboxSerializer(serializers.ModelSerializer):
    """邮箱配置序列化器"""

    class Meta:
        model = Mailbox
        fields = '__all__'


class MailboxListSerializer(serializers.ModelSerializer):
    """邮箱列表"""

    class Meta:
        model = Mailbox
        fields = '__all__'


class EmailListSerializer(serializers.ModelSerializer):
    """邮件列表（不包含正文内容）"""
    mailbox_name = serializers.CharField(source='mailbox.name', read_only=True)

    class Meta:
        model = EmailMessage
        fields = [
            'id', 'mailbox', 'mailbox_name',
            'subject', 'sender', 'sender_email',
            'received_at', 'is_read', 'is_flagged', 'has_attachments',
            'created_at',
        ]


class EmailDetailSerializer(serializers.ModelSerializer):
    """邮件详情（包含正文）"""
    mailbox_name = serializers.CharField(source='mailbox.name', read_only=True)

    class Meta:
        model = EmailMessage
        fields = [
            'id', 'mailbox', 'mailbox_name',
            'subject', 'sender', 'sender_email', 'recipients',
            'received_at', 'is_read', 'is_flagged', 'has_attachments',
            'body_text', 'body_html',
            'created_at',
        ]


class EmailSearchSerializer(serializers.Serializer):
    q = serializers.CharField(required=True, help_text='搜索关键词')


class SyncLogSerializer(serializers.ModelSerializer):
    """同步日志序列化器"""
    mailbox_name = serializers.CharField(source='mailbox.name', read_only=True)
    mailbox_email = serializers.EmailField(source='mailbox.email', read_only=True)

    class Meta:
        model = SyncLog
        fields = '__all__'
