from django.db import models


class Mailbox(models.Model):
    """邮箱账户配置"""
    SERVICE_TYPE_CHOICES = [
        ('imap', 'IMAP'),
        ('pop3', 'POP3'),
    ]
    ENCRYPTION_CHOICES = [
        ('ssl', 'SSL/TLS'),
        ('starttls', 'STARTTLS'),
        ('none', '无加密'),
    ]

    name = models.CharField(max_length=100, help_text='显示名称, 如"客服邮箱"')
    email = models.EmailField(unique=True)
    service_type = models.CharField(max_length=10, choices=SERVICE_TYPE_CHOICES, default='imap', help_text='服务类型')
    encryption = models.CharField(max_length=10, choices=ENCRYPTION_CHOICES, default='ssl', help_text='加密方式')
    imap_host = models.CharField(max_length=200, default='imap.qq.com', help_text='IMAP/POP3 服务器地址')
    imap_port = models.IntegerField(default=993, help_text='端口号')

    # IMAP 授权码（明文存储）
    auth_token = models.CharField(max_length=200, help_text='IMAP授权码')

    is_active = models.BooleanField(default=True)
    last_sync_at = models.DateTimeField(null=True, blank=True)
    last_error = models.TextField(blank=True, default='')

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name = '邮箱配置'
        verbose_name_plural = '邮箱配置'

    def __str__(self):
        return f'{self.name} <{self.email}>'


class EmailMessage(models.Model):
    """邮件消息"""
    mailbox = models.ForeignKey(Mailbox, on_delete=models.CASCADE, related_name='emails')

    # IMAP 唯一标识 — 用于去重
    message_id = models.CharField(max_length=500, unique=True)
    uid = models.CharField(max_length=50, blank=True, help_text='IMAP UID')

    subject = models.CharField(max_length=500, blank=True)
    sender = models.CharField(max_length=300, blank=True)
    sender_email = models.EmailField(blank=True)
    recipients = models.TextField(blank=True, help_text='JSON数组')

    received_at = models.DateTimeField(db_index=True, help_text='邮件头部Date字段')

    body_text = models.TextField(blank=True)
    body_html = models.TextField(blank=True)

    is_read = models.BooleanField(default=False)
    is_flagged = models.BooleanField(default=False)
    has_attachments = models.BooleanField(default=False)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-received_at']
        verbose_name = '邮件'
        verbose_name_plural = '邮件'
        indexes = [
            models.Index(fields=['mailbox', '-received_at']),
        ]

    def __str__(self):
        return f'[{self.mailbox.name}] {self.subject or "(无主题)"}'


class SyncLog(models.Model):
    """同步日志 — 记录每次同步操作的结果"""
    mailbox = models.ForeignKey(Mailbox, on_delete=models.CASCADE, related_name='sync_logs')
    status = models.CharField(max_length=20, choices=[
        ('success', '成功'),
        ('failed', '失败'),
        ('timeout', '超时'),
    ], default='success')
    new_count = models.IntegerField(default=0, help_text='新增邮件数')
    error_message = models.TextField(blank=True, default='')
    duration_ms = models.IntegerField(default=0, help_text='同步耗时（毫秒）')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name = '同步日志'
        verbose_name_plural = '同步日志'

    def __str__(self):
        return f'{self.mailbox.name} {self.status} +{self.new_count}'
