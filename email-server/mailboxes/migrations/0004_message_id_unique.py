# Generated manually — add unique constraint to message_id, remove duplicate index
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('mailboxes', '0003_mailbox_encryption_mailbox_service_type_and_more'),
    ]

    operations = [
        # 1) 移除旧的 message_id 普通索引（unique=True 会自带索引）
        migrations.RemoveIndex(
            model_name='emailmessage',
            name='mailboxes_e_message_b87188_idx',
        ),
        # 2) 将 message_id 改为 unique
        migrations.AlterField(
            model_name='emailmessage',
            name='message_id',
            field=models.CharField(max_length=500, unique=True),
        ),
    ]
