"""
IMAP 邮件同步核心逻辑

支持功能：
- IMAP SSL 登录
- 按日期增量拉取新邮件
- 自动去重（按 Message-ID）
- 解析主题（复杂编码）、正文（纯文本 + HTML）、发件人
- 支持 QQ/163/Gmail/Outlook 等主流邮箱
"""

import json
import imaplib
import email
from email.header import decode_header
from email.utils import parsedate_to_datetime
from datetime import datetime

from django.utils.timezone import now

from .models import Mailbox, EmailMessage

# 月份英文缩写映射（独立于系统 locale，IMAP SINCE 必须用英文缩写）
_MONTH_NAMES = [
    '', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]


def _imap_since_date(dt):
    """生成 IMAP SINCE 日期字符串，不依赖系统 locale"""
    return f'{dt.day:02d}-{_MONTH_NAMES[dt.month]}-{dt.year}'


def parse_subject(raw_subject: str) -> str:
    """解析邮件主题，处理 =?UTF-8?B?...?= 等编码"""
    if not raw_subject:
        return '(无主题)'
    try:
        parts = decode_header(raw_subject)
        result = ''
        for chunk, encoding in parts:
            if isinstance(chunk, bytes):
                result += chunk.decode(encoding or 'utf-8', errors='ignore')
            else:
                result += chunk
        return result.strip() or '(无主题)'
    except Exception:
        return raw_subject.strip() or '(无主题)'


def decode_mime_header(raw: str) -> str:
    """解码 MIME 编码的 header 值，如 =?utf-8?B?TUMyMDI1X0pJTVk=?="""
    if not raw or '=?' not in raw or '?=' not in raw:
        return raw
    try:
        parts = decode_header(raw)
        result = ''
        for chunk, encoding in parts:
            if isinstance(chunk, bytes):
                result += chunk.decode(encoding or 'utf-8', errors='replace')
            else:
                result += chunk
        return result
    except Exception:
        return raw


def decode_address(raw: str) -> str:
    """解码整个 'Name <email>' 字符串中的 name 部分"""
    if '<' in raw and '>' in raw:
        name = raw.split('<')[0].strip().strip('"')
        addr = raw.split('<')[1].split('>')[0].strip()
        decoded_name = decode_mime_header(name)
        if decoded_name != name or '"' in raw:
            return f'"{decoded_name}" <{addr}>'
        return raw
    return raw


def parse_email_address(raw: str) -> tuple:
    """从 'Name <email@example.com>' 提取 (名字, 邮箱)"""
    if '<' in raw and '>' in raw:
        name = raw.split('<')[0].strip().strip('"')
        addr = raw.split('<')[1].split('>')[0].strip()
        return decode_mime_header(name), addr
    return raw, raw


import re as _re

_HTML_TAG_RE = _re.compile(r'<[^>]+>', _re.DOTALL)
_WHITESPACE_RE = _re.compile(r'\s+')
_STYLE_RE = _re.compile(r'<style[^>]*>.*?</style>', _re.DOTALL | _re.IGNORECASE)
_SCRIPT_RE = _re.compile(r'<script[^>]*>.*?</script>', _re.DOTALL | _re.IGNORECASE)
_COMMENT_RE = _re.compile(r'<!--.*?-->', _re.DOTALL)
_HTML_TAG_PRESENT_RE = _re.compile(r'<[a-z][\s\S]*?>', _re.IGNORECASE)


_BLOCK_RE = _re.compile(
    r'</?(?:p|div|h[1-6]|li|tr|td|th|blockquote|'
    r'section|header|footer|table|tbody|thead|tfoot|'
    r'figure|figcaption|article|nav|aside|details|summary)[^>]*>',
    _re.IGNORECASE,
)
_BR_RE = _re.compile(r'<br\s*/?>', _re.IGNORECASE)


def _html_to_structured_text(html_str: str) -> str:
    """将 HTML 转为保留段落结构的纯文本（最优先使用）"""
    text = html_str
    # 1) 移除 style/script/comment 块
    text = _STYLE_RE.sub('', text)
    text = _SCRIPT_RE.sub('', text)
    text = _COMMENT_RE.sub('', text)
    # 2) 块级标签 → 换行（保留段落结构）
    text = _BLOCK_RE.sub('\n', text)
    text = _BR_RE.sub('\n', text)
    # 3) 移除剩余所有标签
    text = _HTML_TAG_RE.sub('', text)
    # 4) HTML 实体解码
    text = text.replace('&nbsp;', ' ')
    text = text.replace('&amp;', '&')
    text = text.replace('&lt;', '<')
    text = text.replace('&gt;', '>')
    text = text.replace('&quot;', '"')
    text = text.replace('&#39;', "'")
    text = _re.sub(r'&#(\d+);', lambda m: chr(int(m.group(1))), text)
    # 5) 清理多余空白
    text = text.replace('\r', '')
    text = _re.sub(r'[ \t]+\n', '\n', text)   # 行尾空格
    text = _re.sub(r'\n[ \t]+', '\n', text)   # 行首空格
    text = _re.sub(r'\n{3,}', '\n\n', text)   # 多余空行
    text = text.strip()
    return text[:2000]


def _strip_html(html_str: str) -> str:
    """兼容旧模式：直接移除 HTML 标签，合并空白（兜底用）"""
    text = _STYLE_RE.sub(' ', html_str)
    text = _SCRIPT_RE.sub(' ', text)
    text = _COMMENT_RE.sub(' ', text)
    text = _HTML_TAG_RE.sub(' ', text)
    text = _WHITESPACE_RE.sub(' ', text).strip()
    return text[:2000]


def parse_body(msg) -> tuple:
    """解析邮件正文，返回 (text, html)

    text 优先使用 body_text（纯文本部分）：
    - 如果 body_text 为空或全是 HTML，从 body_html 提取带段落结构的纯文本
    - 如果 body_html 也不存在，才用 body_text 原样
    """
    raw_text, raw_html = '', ''
    if msg.is_multipart():
        for part in msg.walk():
            ct = part.get_content_type()
            cd = str(part.get('Content-Disposition', ''))
            if 'attachment' in cd:
                continue
            payload = part.get_payload(decode=True)
            if not payload:
                continue
            charset = part.get_content_charset() or 'utf-8'
            try:
                decoded = payload.decode(charset, errors='ignore')
            except (LookupError, UnicodeDecodeError):
                decoded = payload.decode('utf-8', errors='ignore')
            if ct == 'text/plain':
                raw_text += decoded
            elif ct == 'text/html':
                raw_html += decoded
    else:
        payload = msg.get_payload(decode=True)
        if payload:
            charset = msg.get_content_charset() or 'utf-8'
            try:
                raw_text = payload.decode(charset, errors='ignore')
            except (LookupError, UnicodeDecodeError):
                raw_text = payload.decode('utf-8', errors='ignore')

    # 策略：优先从 body_html 提取带段落结构的文本
    if raw_html.strip():
        text = _html_to_structured_text(raw_html)
    elif raw_text.strip() and not _HTML_TAG_PRESENT_RE.search(raw_text):
        text = raw_text.strip()[:2000]
    elif raw_text.strip():
        text = _strip_html(raw_text)
    else:
        text = ''

    return text, raw_html


import signal


def sync_mailbox(mailbox: Mailbox) -> dict:
    """
    同步单个邮箱的收件箱，拉取新邮件

    支持 IMAP / POP3，SSL / STARTTLS / 无加密

    返回: {"new": int 新邮件数, "error": str|None}
    """
    conn = None
    try:
        if mailbox.service_type == 'pop3':
            # POP3 连接
            if mailbox.encryption == 'ssl':
                import poplib
                conn = poplib.POP3_SSL(mailbox.imap_host, mailbox.imap_port, timeout=30)
            elif mailbox.encryption == 'starttls':
                import poplib
                conn = poplib.POP3(mailbox.imap_host, mailbox.imap_port, timeout=30)
                conn.stls()
            else:
                import poplib
                conn = poplib.POP3(mailbox.imap_host, mailbox.imap_port, timeout=30)
            conn.user(mailbox.email)
            conn.pass_(mailbox.auth_token)
            # POP3 获取邮件数量
            num_messages = len(conn.list()[1])
            new_count = 0
            errors = []
            for i in range(num_messages, 0, -1):
                try:
                    raw_lines = conn.retr(i)[1]
                    msg_bytes = b'\r\n'.join(raw_lines)
                    msg = email.message_from_bytes(msg_bytes)

                    message_id = (msg.get('Message-ID') or '').strip()
                    if not message_id:
                        continue
                    if EmailMessage.objects.filter(message_id=message_id).exists():
                        continue

                    subject = parse_subject(msg.get('Subject', ''))
                    body_text, body_html = parse_body(msg)
                    sender_raw = msg.get('From', '')
                    sender_name, sender_email = parse_email_address(sender_raw)

                    date_str = msg.get('Date', '')
                    try:
                        received_at = parsedate_to_datetime(date_str) if date_str else now()
                    except Exception:
                        received_at = now()

                    to_raw = msg.get('To', '')
                    recipients = []
                    if to_raw:
                        for addr in to_raw.split(','):
                            addr = addr.strip()
                            if addr:
                                recipients.append(decode_address(addr))

                    _, created = EmailMessage.objects.get_or_create(
                        message_id=message_id,
                        defaults={
                            'mailbox': mailbox,
                            'uid': str(i),
                            'subject': subject[:500],
                            'sender': decode_address(sender_raw[:300]),
                            'sender_email': sender_email,
                            'recipients': json.dumps(recipients),
                            'received_at': received_at,
                            'body_text': body_text,
                            'body_html': body_html,
                            'has_attachments': False,
                        },
                    )
                    if created:
                        new_count += 1
                except Exception as e:
                    errors.append(f"MSG {i}: {e}")
                    continue

            conn.quit()
            conn = None
        else:
            # IMAP 连接
            if mailbox.encryption == 'ssl':
                conn = imaplib.IMAP4_SSL(mailbox.imap_host, mailbox.imap_port, timeout=30)
            elif mailbox.encryption == 'starttls':
                conn = imaplib.IMAP4(mailbox.imap_host, mailbox.imap_port, timeout=30)
                conn.starttls()
            else:
                conn = imaplib.IMAP4(mailbox.imap_host, mailbox.imap_port, timeout=30)
            conn.login(mailbox.email, mailbox.auth_token)

            # 发送 IMAP ID（RFC 2971），163/网易系邮箱登录后要求
            # imaplib 不支持 ID 命令，手动发送底层命令
            try:
                tag = conn._new_tag().decode()
                conn.send(f'{tag} ID ("name" "HermesMail" "version" "1.0" '
                          '"vendor" "HermesAgent" '
                          '"support-email" "admin@hermes.local")\r\n'.encode())
                # 读取并丢弃 ID 响应
                while True:
                    line = conn._get_response()
                    if line.startswith(tag.encode()):
                        break
            except Exception:
                pass  # 非 163 邮箱可能不支持 ID 命令，忽略

            # 163 等邮箱需要先 SELECT 才能 SEARCH
            result, data = conn.select('INBOX')
            if result != 'OK':
                err_msg = data[0].decode('utf-8', errors='ignore') if isinstance(data[0], bytes) else str(data[0])
                raise imaplib.IMAP4.error(f"SELECT INBOX 失败: {err_msg}")

            # 构造搜索条件（使用 UID SEARCH，不依赖 locale）
            if mailbox.last_sync_at:
                since_date = _imap_since_date(mailbox.last_sync_at)
            else:
                since_date = _imap_since_date(datetime.now())

            # 使用 UID 模式搜索/拉取，确保 UID 稳定
            _, search_data = conn.uid('SEARCH', None, f'(SINCE {since_date})')
            uid_list = search_data[0].split() if search_data[0] else []

        new_count = 0
        errors = []

        for uid in uid_list:
            try:
                # 使用 UID FETCH 拉取邮件
                _, data = conn.uid('FETCH', uid, '(RFC822 FLAGS)')
                if not data or not data[0]:
                    continue
                msg_bytes = data[0][1]
                msg = email.message_from_bytes(msg_bytes)

                # 获取 Message-ID 用于去重
                message_id = (msg.get('Message-ID') or '').strip()
                if not message_id:
                    continue

                # 去重（get_or_create 配合 unique 约束，消除并发竞态）

                # 解析
                subject = parse_subject(msg.get('Subject', ''))
                body_text, body_html = parse_body(msg)

                sender_raw = msg.get('From', '')
                sender_raw = parse_subject(sender_raw)
                sender_name, sender_email = parse_email_address(sender_raw)

                date_str = msg.get('Date', '')
                try:
                    received_at = parsedate_to_datetime(date_str) if date_str else now()
                except Exception:
                    received_at = now()

                # 提取收件人
                to_raw = msg.get('To', '')
                recipients = []
                if to_raw:
                    for addr in to_raw.split(','):
                        addr = addr.strip()
                        if addr:
                            recipients.append(decode_address(addr))

                uid_val = uid.decode() if isinstance(uid, bytes) else uid
                _, created = EmailMessage.objects.get_or_create(
                    message_id=message_id,
                    defaults={
                        'mailbox': mailbox,
                        'uid': uid_val,
                        'subject': subject[:500],
                        'sender': decode_address(sender_raw[:300]),
                        'sender_email': sender_email,
                        'recipients': json.dumps(recipients),
                        'received_at': received_at,
                        'body_text': body_text,
                        'body_html': body_html,
                        'has_attachments': False,
                    },
                )
                if created:
                    new_count += 1

            except Exception as e:
                errors.append(f"UID {uid}: {e}")
                continue

        # 更新同步时间
        mailbox.last_sync_at = now()
        mailbox.last_error = ''
        mailbox.save(update_fields=['last_sync_at', 'last_error'])

        return {"new": new_count, "error": None}

    except imaplib.IMAP4.error as e:
        error_msg = str(e)
        mailbox.last_error = error_msg[:500]
        mailbox.save(update_fields=['last_error'])
        return {"new": 0, "error": error_msg}

    except Exception as e:
        error_msg = str(e)
        mailbox.last_error = error_msg[:500]
        mailbox.save(update_fields=['last_error'])
        return {"new": 0, "error": error_msg}

    finally:
        if conn:
            try:
                conn.logout()
            except Exception:
                pass
