"""
邮箱自动同步脚本 - 由 cron 定时触发
每 3 分钟执行一次，同步所有活跃邮箱
"""
import os, sys
from datetime import datetime

# 设置 Django 环境
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

import django
django.setup()

from mailboxes.models import Mailbox
from mailboxes.imap_sync import sync_mailbox
from mailboxes.views import push_mail_notification

now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
print(f'[{now}] 开始邮箱同步...')

results = []
for mailbox in Mailbox.objects.filter(is_active=True):
    result = sync_mailbox(mailbox)
    if result['new'] > 0:
        push_mail_notification(mailbox.id, mailbox.name, result['new'])
    results.append({
        'mailbox': mailbox.email,
        'new': result['new'],
        'error': result['error'],
    })

# 统计
total_new = sum(r['new'] for r in results)
errors = [r for r in results if r['error']]
if total_new > 0:
    print(f'  新邮件: {total_new} 封')
if errors:
    print(f'  错误: {len(errors)} 个')
    for e in errors:
        print(f'    [{e["mailbox"]}] {e["error"]}')
else:
    print('  全部成功')

print(f'[{datetime.now().strftime("%Y-%m-%d %H:%M:%S")}] 同步完成')
