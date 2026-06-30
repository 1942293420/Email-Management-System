import { useState, useEffect, useCallback, useRef } from 'react'
import EmailBody from '../components/EmailBody'
import { FiMail, FiPlus, FiSearch, FiTrash2, FiRefreshCw, FiAlertCircle, FiCheck, FiEyeOff, FiEye, FiEdit2, FiServer, FiInbox, FiClock, FiSend } from 'react-icons/fi'
import { useNavigate } from 'react-router-dom'

interface Mailbox {
  id: number
  name: string
  email: string
  service_type: string
  encryption: string
  imap_host: string
  imap_port: number
  is_active: boolean
  last_sync_at: string | null
  last_error: string
  created_at: string
}

interface EmailItem {
  id: number
  mailbox: number
  mailbox_name: string
  subject: string
  sender: string
  sender_email: string
  received_at: string
  is_read: boolean
  is_flagged: boolean
  has_attachments: boolean
}

interface EmailDetail extends EmailItem {
  recipients: string
  body_text: string
  body_html: string
}

interface MailSummary {
  total_emails: number
  unread_emails: number
  active_mailboxes: number
}

interface MailboxFormData {
  name: string
  email: string
  service_type: string
  encryption: string
  imap_host: string
  imap_port: number
  auth_token: string
}

const API_BASE = 'http://192.168.1.135:9122/api'
const WS_URL = 'ws://192.168.1.135:9122/ws/events/'

export default function MailPage() {
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([])
  const [emails, setEmails] = useState<EmailItem[]>([])
  const [selectedMailbox, setSelectedMailbox] = useState<number | null>(null)
  const [selectedEmail, setSelectedEmail] = useState<EmailDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<EmailItem[] | null>(null)
  const [summary, setSummary] = useState<MailSummary>({ total_emails: 0, unread_emails: 0, active_mailboxes: 0 })
  const [showModal, setShowModal] = useState(false)
  const [editingMailbox, setEditingMailbox] = useState<Mailbox | null>(null)
  const [syncing, setSyncing] = useState<number | null>(null)
  const [notification, setNotification] = useState<{ mailbox_name: string; count: number } | null>(null)
  const [toastMsg, setToastMsg] = useState<string | null>(null)

  // 用于 WS 回调 — ref 持有最新 selectedMailbox，闭包内始终读到最新值
  const mailboxRef = useRef<number | null>(null)

  // 同步结果提示自动消失
  useEffect(() => {
    if (toastMsg) {
      const t = setTimeout(() => setToastMsg(null), 4000)
      return () => clearTimeout(t)
    }
  }, [toastMsg])

  // 常见服务器预设
  const MAIL_PRESETS: { label: string; service_type: string; encryption: string; host: string; port: number }[] = [
    { label: 'QQ邮箱', service_type: 'imap', encryption: 'ssl', host: 'imap.qq.com', port: 993 },
    { label: 'QQ邮箱(POP3)', service_type: 'pop3', encryption: 'ssl', host: 'pop.qq.com', port: 995 },
    { label: '网易163邮箱', service_type: 'imap', encryption: 'ssl', host: 'imap.163.com', port: 993 },
    { label: '网易126邮箱', service_type: 'imap', encryption: 'ssl', host: 'imap.126.com', port: 993 },
    { label: 'Outlook/Office365', service_type: 'imap', encryption: 'ssl', host: 'outlook.office365.com', port: 993 },
    { label: 'Gmail', service_type: 'imap', encryption: 'ssl', host: 'imap.gmail.com', port: 993 },
    { label: '新浪邮箱', service_type: 'imap', encryption: 'ssl', host: 'imap.sina.com', port: 993 },
    { label: 'Yahoo邮箱', service_type: 'imap', encryption: 'ssl', host: 'imap.mail.yahoo.com', port: 993 },
    { label: '阿里云邮箱', service_type: 'imap', encryption: 'ssl', host: 'imap.aliyun.com', port: 993 },
    { label: '腾讯企业邮', service_type: 'imap', encryption: 'ssl', host: 'imap.exmail.qq.com', port: 993 },
    { label: '自定义', service_type: 'imap', encryption: 'ssl', host: '', port: 993 },
  ]
  const [presetKey, setPresetKey] = useState(0)

  const applyPreset = (idx: number) => {
    const p = MAIL_PRESETS[idx]
    setForm({ ...form, service_type: p.service_type, encryption: p.encryption, imap_host: p.host, imap_port: p.port })
    setPresetKey(idx)
  }

  const [form, setForm] = useState<MailboxFormData>({
    name: '', email: '', service_type: 'imap', encryption: 'ssl', imap_host: 'imap.qq.com', imap_port: 993, auth_token: ''
  })
  const [formError, setFormError] = useState('')
  const navigate = useNavigate()

  const fetchMailboxes = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/mailboxes/`)
      setMailboxes(await res.json())
    } catch (e) { console.error('获取邮箱列表失败:', e) }
  }, [])

  const fetchEmails = useCallback(async (mailboxId?: number) => {
    setLoading(true)
    try {
      const params = mailboxId ? `?mailbox=${mailboxId}` : ''
      const res = await fetch(`${API_BASE}/emails/${params}`)
      setEmails(await res.json())
    } catch (e) { console.error('获取邮件列表失败:', e) }
    setLoading(false)
  }, [])

  const fetchSummary = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/emails/summary/`)
      setSummary(await res.json())
    } catch (e) { /* ignore */ }
  }, [])

  useEffect(() => {
    fetchMailboxes()
    fetchEmails()
    fetchSummary()
  }, [fetchMailboxes, fetchEmails, fetchSummary])

  // WebSocket
  useEffect(() => {
    let ws: WebSocket | null = null;
    let retryDelay = 1000;
    let retryTimer: number | null = null;

    // 同步最新的 selectedMailbox 到 ref
    mailboxRef.current = selectedMailbox;

    const connect = () => {
      ws = new WebSocket(WS_URL);
      ws.onopen = () => { retryDelay = 1000; };
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'new_email') {
            fetchEmails(mailboxRef.current ?? undefined);
            fetchSummary();
            setToastMsg(`📬 [${msg.data.mailbox_name}] ${msg.data.count} 封新邮件`);
          } else if (msg.type === 'sync_status') {
            if (msg.data.status === 'success') {
              fetchEmails(mailboxRef.current ?? undefined);
              fetchSummary();
            }
          }
        } catch (e) { /* ignore */ }
      };
      ws.onclose = () => {
        retryTimer = window.setTimeout(() => {
          retryDelay = Math.min(retryDelay * 2, 30000);
          connect();
        }, retryDelay);
      };
      ws.onerror = () => ws?.close();
    };
    connect();

    return () => {
      if (retryTimer) clearTimeout(retryTimer);
      ws?.close();
    };
  }, [fetchEmails, fetchSummary])

  const openAddModal = () => {
    setEditingMailbox(null)
    setForm({ name: '', email: '', service_type: 'imap', encryption: 'ssl', imap_host: 'imap.qq.com', imap_port: 993, auth_token: '' })
    setFormError('')
    setPresetKey(0)
    setShowModal(true)
  }

  const openEditModal = (mb: Mailbox) => {
    setEditingMailbox(mb)
    setForm({ name: mb.name, email: mb.email, service_type: mb.service_type || 'imap', encryption: mb.encryption || 'ssl', imap_host: mb.imap_host, imap_port: mb.imap_port, auth_token: '' })
    setFormError('')
    setPresetKey(-1)
    setShowModal(true)
  }

  const handleSubmit = async () => {
    setFormError('')
    if (!form.name || !form.email) { setFormError('请填写名称和邮箱地址'); return }
    if (!editingMailbox && !form.auth_token) { setFormError('请填写 IMAP 授权码'); return }
    try {
      if (editingMailbox) {
        const body: any = { name: form.name, email: form.email, service_type: form.service_type, encryption: form.encryption, imap_host: form.imap_host, imap_port: form.imap_port }
        if (form.auth_token) body.auth_token = form.auth_token
        const res = await fetch(`${API_BASE}/mailboxes/${editingMailbox.id}/`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        })
        if (!res.ok) { const err = await res.json(); setFormError(err.detail?.[0]?.msg || JSON.stringify(err)); return }
      } else {
        const res = await fetch(`${API_BASE}/mailboxes/`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
        })
        if (!res.ok) { const err = await res.json(); setFormError(err.detail?.[0]?.msg || JSON.stringify(err)); return }
      }
      setShowModal(false)
      fetchMailboxes()
      fetchSummary()
    } catch (e: any) { setFormError(e.message) }
  }

  const handleDeleteMailbox = async (id: number) => {
    if (!confirm('确定删除此邮箱配置？')) return
    try {
      await fetch(`${API_BASE}/mailboxes/${id}/`, { method: 'DELETE' })
      fetchMailboxes()
      fetchSummary()
      if (selectedMailbox === id) { setSelectedMailbox(null); fetchEmails() }
    } catch (e) { console.error('删除失败:', e) }
  }

  const handleSync = async (id: number) => {
    setSyncing(id)
    try {
      const res = await fetch(`${API_BASE}/mailboxes/${id}/sync/`, { method: 'POST' })
      const data = await res.json()
      if (data.error) { setToastMsg(`❌ ${getMailboxName(id)} 同步失败: ${data.error}`) }
      else if (data.new > 0) { setToastMsg(`✅ ${getMailboxName(id)} 同步成功，新增 ${data.new} 封邮件`) }
      else { setToastMsg(`✅ ${getMailboxName(id)} 同步完成，没有新邮件`) }
      fetchEmails(selectedMailbox ?? undefined)
      fetchSummary()
    } catch (e) { setToastMsg(`❌ ${getMailboxName(id)} 同步异常`); console.error('同步失败:', e) }
    setSyncing(null)
  }

  const handleSyncAll = async () => {
    setSyncing(-1)
    try {
      const res = await fetch(`${API_BASE}/mailboxes/sync_all/`, { method: 'POST' })
      const data = await res.json()
      const failed = data.details?.filter((d: any) => d.error) || []
      if (failed.length > 0) { setToastMsg(`⚠️ ${failed.length} 个邮箱同步失败: ${failed.map((d: any) => d.mailbox_name).join(', ')}`) }
      else if (data.total_new > 0) { setToastMsg(`✅ 全部同步完成，新增 ${data.total_new} 封邮件`) }
      else { setToastMsg(`✅ 全部同步完成，没有新邮件`) }
      fetchEmails(selectedMailbox ?? undefined)
      fetchSummary()
    } catch (e) { setToastMsg(`❌ 同步异常`); console.error('同步失败:', e) }
    setSyncing(null)
  }

  const getMailboxName = (id: number) => mailboxes.find(mb => mb.id === id)?.name || `邮箱#${id}`

  const handleSelectMailbox = (id: number | null) => {
    setSelectedMailbox(id)
    setSelectedEmail(null)
    setSearchResults(null)
    fetchEmails(id ?? undefined)
  }

  const handleSearch = async () => {
    if (!searchQuery.trim()) { setSearchResults(null); return }
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/emails/search/?q=${encodeURIComponent(searchQuery)}`)
      setSearchResults(await res.json())
    } catch (e) { console.error('搜索失败:', e) }
    setLoading(false)
  }

  const handleSelectEmail = async (id: number) => {
    try {
      const res = await fetch(`${API_BASE}/emails/${id}/`)
      const data = await res.json()
      setSelectedEmail(data)
      if (!data.is_read) {
        await fetch(`${API_BASE}/emails/${id}/mark_read/`, { method: 'POST' })
        fetchEmails(selectedMailbox ?? undefined)
        fetchSummary()
      }
    } catch (e) { console.error('获取邮件详情失败:', e) }
  }

  const toggleRead = async (email: EmailDetail) => {
    const action = email.is_read ? 'mark_unread' : 'mark_read'
    await fetch(`${API_BASE}/emails/${email.id}/${action}/`, { method: 'POST' })
    setSelectedEmail({ ...email, is_read: !email.is_read })
    fetchEmails(selectedMailbox ?? undefined)
    fetchSummary()
  }

  const displayEmails = searchResults !== null ? searchResults : emails

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg-page)', color: 'var(--color-text-primary)' }}>
      {/* 顶部栏 */}
      <header style={{
        display: 'flex', alignItems: 'center',
        padding: '0 20px', height: 48,
        borderBottom: '1px solid var(--color-border-default)',
        background: 'var(--color-bg-panel)', gap: 20,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <FiMail size={18} color="var(--color-feishu)" />
          <span style={{ fontSize: 15, fontWeight: 600 }}>邮箱管理平台</span>
        </div>
        <div style={{ display: 'flex', gap: 2, background: 'var(--color-bg-surface)', borderRadius: 4, padding: 2 }}>
          {[
            { path: '/', label: '邮件', icon: FiMail },
            { path: '/ops', label: '运维', icon: FiServer },
          ].map(tab => (
            <button key={tab.path} onClick={() => navigate(tab.path)}
              style={{
                padding: '5px 14px', borderRadius: 3, fontSize: 13,
                cursor: 'pointer',
                background: tab.path === '/' ? '#fff' : 'transparent',
                border: 'none',
                color: tab.path === '/' ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
                display: 'flex', alignItems: 'center', gap: 5,
                boxShadow: tab.path === '/' ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
              }}>
              <tab.icon size={13} />
              {tab.label}
            </button>
          ))}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 16, fontSize: 13, color: 'var(--color-text-tertiary)' }}>
          <span>{summary.active_mailboxes} 个邮箱</span>
          <span style={{ background: 'var(--color-bg-surface)', padding: '2px 8px', borderRadius: 3, color: 'var(--color-text-secondary)' }}>
            未读: {summary.unread_emails}
          </span>
          <span>{summary.total_emails} 封邮件</span>
        </div>
      </header>

      {/* Toast */}
      {toastMsg && (
        <div className="toast-container"
          style={{
            background: toastMsg.startsWith('✅') ? 'rgba(0,185,107,0.08)' :
                        toastMsg.startsWith('⚠️') ? 'rgba(255,125,0,0.08)' :
                        toastMsg.startsWith('❌') ? 'rgba(245,63,63,0.08)' : 'rgba(51,112,255,0.08)',
            border: toastMsg.startsWith('✅') ? '1px solid rgba(0,185,107,0.3)' :
                     toastMsg.startsWith('⚠️') ? '1px solid rgba(255,125,0,0.3)' :
                     toastMsg.startsWith('❌') ? '1px solid rgba(245,63,63,0.3)' : '1px solid rgba(51,112,255,0.3)',
          }}>
          <span>{toastMsg}</span>
        </div>
      )}

      <div style={{ display: 'flex', height: 'calc(100vh - 49px)' }}>
        {/* 左侧栏 — 飞书蓝 */}
        <div className="sidebar">
          <div className="sidebar-header">
            <button onClick={openAddModal} className="btn-sidebar-action">
              <FiPlus size={14} /> 添加邮箱
            </button>
            <button onClick={handleSyncAll}
              style={{
                padding: '7px 10px', background: 'rgba(255,255,255,0.15)', color: '#fff',
                border: 'none', borderRadius: 4, cursor: 'pointer', display: 'flex', alignItems: 'center',
              }}
              title="同步全部">
              <FiRefreshCw size={14} className={syncing === -1 ? 'spinning' : ''} />
            </button>
          </div>

          <div className="sidebar-list">
            <div className={`sidebar-item ${selectedMailbox === null ? 'active' : ''}`}
              onClick={() => handleSelectMailbox(null)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <FiInbox size={14} />
                <span className="sidebar-item-name">所有邮件</span>
              </div>
            </div>
            {mailboxes.map(mb => {
              const isSelected = selectedMailbox === mb.id
              return (
                <div key={mb.id}
                  className={`sidebar-item ${isSelected ? 'active' : ''}`}
                  onClick={() => handleSelectMailbox(mb.id)}
                  style={isSelected ? { background: 'rgba(255,255,255,0.18)' } : {}}
                >
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <div className="sidebar-item-name" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <FiMail size={12} style={{ opacity: 0.7 }} />
                      {mb.name}
                    </div>
                    <div className="sidebar-item-sub">
                      {mb.email}{mb.last_error ? '  ⚠' : ''}
                    </div>
                  </div>
                  <div className="email-actions" style={{ display: isSelected ? 'flex' : 'none', gap: 1 }}>
                    <button onClick={(e) => { e.stopPropagation(); openEditModal(mb) }}
                      style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', padding: '2px 4px', borderRadius: 2, fontSize: 11 }}
                      title="编辑"
                    ><FiEdit2 size={11} /></button>
                    <button onClick={(e) => { e.stopPropagation(); handleSync(mb.id) }}
                      style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', padding: '2px 4px', borderRadius: 2, fontSize: 11 }}
                      title="同步"
                    ><FiRefreshCw size={11} className={syncing === mb.id ? 'spinning' : ''} /></button>
                    <button onClick={(e) => { e.stopPropagation(); handleDeleteMailbox(mb.id) }}
                      style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', padding: '2px 4px', borderRadius: 2, fontSize: 11 }}
                      title="删除"
                    ><FiTrash2 size={11} /></button>
                  </div>
                </div>
              )
            })}
            {mailboxes.length === 0 && (
              <div className="sidebar-item-tip">还没有添加邮箱</div>
            )}
          </div>
        </div>

        {/* 中间栏 — 邮件列表 */}
        <div className="mail-list-panel">
          <div className="mail-list-header">
            <div className="search-box">
              <FiSearch size={14} color="var(--color-text-tertiary)" />
              <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                placeholder="搜索邮件..."
                className="input-base"
                style={{ padding: '7px 0' }}
              />
            </div>
            <button onClick={handleSearch} className="btn-primary" style={{ padding: '7px 14px', fontSize: 13 }}>
              搜索
            </button>
          </div>

          <div className="mail-list-body">
            {loading && (
              <div className="empty-state" style={{ padding: 40, fontSize: 13 }}>加载中...</div>
            )}
            {!loading && displayEmails.length === 0 && (
              <div className="empty-state" style={{ padding: 40, fontSize: 13 }}>
                {searchResults !== null ? '没有搜索结果' : '暂无邮件'}
              </div>
            )}
            {displayEmails.map(email => (
              <div key={email.id}
                onClick={() => handleSelectEmail(email.id)}
                className={`email-row ${selectedEmail?.id === email.id ? 'selected' : ''} ${!email.is_read ? 'unread' : ''}`}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span className="email-sender">
                    {email.sender_email || email.sender || '(未知)'}
                  </span>
                  <span className="email-time">
                    {new Date(email.received_at).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <div className="email-subject" style={{ marginBottom: 3 }}>
                  {email.subject || '(无主题)'}
                </div>
                <div className="email-mailbox-tag">
                  <span style={{ background: 'var(--color-bg-surface)', padding: '1px 6px', borderRadius: 3, fontSize: 11 }}>
                    {email.mailbox_name}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 右侧 — 邮件详情 */}
        <div className="detail-panel">
          {selectedEmail ? (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              {/* 邮件头部 */}
              <div className="detail-header">
                <h2 className="detail-subject">
                  {selectedEmail.subject || '(无主题)'}
                </h2>
                <div className="detail-sender-area">
                  <div className="detail-avatar">
                    {(selectedEmail.sender_email?.[0] || '?').toUpperCase()}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500, color: 'var(--color-text-primary)' }}>
                      {selectedEmail.sender || selectedEmail.sender_email}
                    </div>
                    <div style={{ color: 'var(--color-text-tertiary)', fontSize: 13, marginTop: 2 }}>
                      {(() => {
                        try {
                          const r = JSON.parse(selectedEmail.recipients);
                          return Array.isArray(r) ? `收件人: ${r.join(', ')}` : selectedEmail.recipients;
                        } catch { return selectedEmail.recipients; }
                      })()}
                    </div>
                    <div style={{ color: 'var(--color-text-tertiary)', fontSize: 13 }}>
                      <FiClock size={11} style={{ marginRight: 3, verticalAlign: 'middle' }} />
                      {new Date(selectedEmail.received_at).toLocaleString('zh-CN')}
                    </div>
                  </div>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                    <button onClick={() => toggleRead(selectedEmail)} className="btn-ghost" style={{ fontSize: 12, padding: '5px 10px', display: 'flex', alignItems: 'center', gap: 4 }}>
                      {selectedEmail.is_read ? <><FiEyeOff size={12} /> 标记未读</> : <><FiCheck size={12} /> 标记已读</>}
                    </button>
                  </div>
                </div>
              </div>

              {/* 正文 */}
              <div className="detail-body">
                {(selectedEmail.body_text || selectedEmail.body_html) ? (
                  <EmailBody
                    bodyText={selectedEmail.body_text}
                    bodyHtml={selectedEmail.body_html}
                  />
                ) : (
                  <div style={{ color: 'var(--color-text-tertiary)', fontSize: 14 }}>(无正文内容)</div>
                )}
              </div>
            </div>
          ) : (
            <div className="empty-state">
              <FiMail size={48} style={{ marginBottom: 16, opacity: 0.25 }} />
              <div style={{ fontSize: 14 }}>选择一封邮件查看详情</div>
            </div>
          )}
        </div>
      </div>

      {/* 弹窗：添加/编辑邮箱 */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                {editingMailbox ? '编辑邮箱' : '添加邮箱'}
              </h3>
              <button onClick={() => setShowModal(false)} className="btn-icon" title="关闭"
                style={{ fontSize: 16, width: 28, height: 28 }}>
                ✕
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>显示名称</label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder='如 "客服邮箱"' style={inputStyle} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>邮箱地址</label>
                <input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
                  placeholder="your@email.com" style={inputStyle} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>常见邮箱服务</label>
                <select value={presetKey === -1 ? -1 : presetKey}
                  onChange={e => { const v = parseInt(e.target.value); if (v >= 0) applyPreset(v) }}
                  style={selectStyle}>
                  <option value={-1} disabled>{editingMailbox ? '（编辑中，手动输入）' : '请选择预设...'}</option>
                  {MAIL_PRESETS.map((p, i) => (<option key={i} value={i}>{p.label}</option>))}
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>服务类型</label>
                  <select value={form.service_type} onChange={e => setForm({ ...form, service_type: e.target.value })}
                    style={selectStyle}>
                    <option value="imap">IMAP</option>
                    <option value="pop3">POP3</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>加密方式</label>
                  <select value={form.encryption} onChange={e => setForm({ ...form, encryption: e.target.value })}
                    style={selectStyle}>
                    <option value="ssl">SSL/TLS</option>
                    <option value="starttls">STARTTLS</option>
                    <option value="none">无加密</option>
                  </select>
                </div>
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>服务器地址</label>
                <input value={form.imap_host} onChange={e => setForm({ ...form, imap_host: e.target.value })}
                  placeholder="imap.example.com" style={inputStyle} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>端口</label>
                <input value={form.imap_port} onChange={e => setForm({ ...form, imap_port: parseInt(e.target.value) || 993 })}
                  type="number" style={inputStyle} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>
                  IMAP 授权码
                  {editingMailbox && (
                    <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginLeft: 8 }}>（留空则不修改）</span>
                  )}
                </label>
                <input value={form.auth_token} onChange={e => setForm({ ...form, auth_token: e.target.value })}
                  type="text" placeholder={editingMailbox ? "留空则不修改授权码" : "邮箱设置中生成的授权码"}
                  style={inputStyle} />
              </div>
              <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', background: 'var(--color-bg-surface)', padding: 8, borderRadius: 4 }}>
                需要先在邮箱设置中开启 IMAP/POP3 服务并生成授权码
              </div>
              {formError && (
                <div style={{ fontSize: 12, color: 'var(--color-danger)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <FiAlertCircle size={12} /> {formError}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
                <button onClick={() => setShowModal(false)} className="btn-ghost">
                  取消
                </button>
                <button onClick={handleSubmit} className="btn-primary" style={{ padding: '7px 20px' }}>
                  {editingMailbox ? '保存' : '添加'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        input:focus { border-color: var(--color-accent) !important; }
        select:focus { border-color: var(--color-accent) !important; }
      `}</style>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '7px 10px', background: 'var(--color-bg-panel)',
  border: '1px solid var(--color-border-strong)', borderRadius: 4,
  color: 'var(--color-text-primary)',
  fontSize: 13, outline: 'none', boxSizing: 'border-box',
}

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: 'pointer',
  appearance: 'auto',
} as const
