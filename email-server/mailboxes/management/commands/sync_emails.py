import requests
from django.core.management.base import BaseCommand
from mailboxes.models import Mailbox
from mailboxes.imap_sync import sync_mailbox
from mailboxes.views import push_mail_notification


class Command(BaseCommand):
    help = '同步所有活跃邮箱，完成后通过 HTTP 推送到 Daphne WebSocket'

    def handle(self, *args, **options):
        self.stdout.write("开始邮箱同步...")
        total_new = 0

        for mailbox in Mailbox.objects.filter(is_active=True):
            result = sync_mailbox(mailbox)
            if result['new'] > 0:
                total_new += result['new']
                push_mail_notification(
                    mailbox.id, mailbox.name, result['new']
                )
            self.stdout.write(
                f"  {mailbox.email}: {'+' + str(result['new']) if result['new'] else '无新邮件'}"
                + (f" (错误: {result['error']})" if result['error'] else "")
            )

        self.stdout.write(self.style.SUCCESS(f"同步完成，共 {total_new} 封新邮件"))
