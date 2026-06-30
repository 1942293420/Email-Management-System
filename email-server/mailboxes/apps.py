from django.apps import AppConfig


class MailboxesConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'mailboxes'

    def ready(self):
        pass  # 定时同步由外部 cron 脚本触发
