import { useState, useEffect, useCallback } from 'react'
import { FiActivity, FiCheckCircle, FiXCircle, FiClock, FiRefreshCw, FiMail, FiServer } from 'react-icons/fi'
import { useNavigate, useLocation } from 'react-router-dom'

const API_BASE = 'http://192.168.1.135:9122/api'

interface SyncLogItem {
  id: number
  mailbox: number
  mailbox_name: string
  mailbox_email: string
  status: 'success' | 'failed' | 'timeout'
  new_count: number
  error_message: string
  duration_ms: number
  created_at: string
}

interface OpsStats {
  total_syncs: number
  success: number
  failed: number
  timeout: number
  recent_24h: {
    total: number
    failed: number
  }
  per_mailbox: {
    mailbox__name: string
    mailbox__email: string
    total: number
    success: number
    failed: number
    timeout: number
  }[]
}

export default function OpsPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [logs, setLogs] = useState<SyncLogItem[]>([])
  const [stats, setStats] = useState<OpsStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [logsRes, statsRes] = await Promise.all([
        fetch(`${API_BASE}/sync-logs/?page=${page}&page_size=50`),
        fetch(`${API_BASE}/sync-logs/stats/`),
      ])
      if (logsRes.ok) {
        const logsData = await logsRes.json()
        if (page === 1) {
          setLogs(logsData.results || logsData)
        } else {
          setLogs(prev => [...prev, ...(logsData.results || logsData)])
        }
        setHasMore(!!(logsData.results && logsData.results.length >= 50))
      }
      if (statsRes.ok) {
        setStats(await statsRes.json())
      }
    } catch (e) {
      console.error('加载运维数据失败:', e)
    } finally {
      setLoading(false)
    }
  }, [page])

  useEffect(() => { fetchData() }, [fetchData])

  const statusColor = (s: string) => {
    switch (s) {
      case 'success': return '#4ade80'
      case 'failed': return '#ff6b6b'
      case 'timeout': return '#fbbf24'
      default: return '#62666d'
    }
  }

  const statusText = (s: string) => {
    switch (s) {
      case 'success': return '成功'
      case 'failed': return '失败'
      case 'timeout': return '超时'
      default: return s
    }
  }

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(1)}s`
  }

  // Tab 导航
  const tabs = [
    { path: '/', label: '邮件', icon: FiMail },
    { path: '/ops', label: '运维', icon: FiServer },
  ]

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0a0b0c', color: '#f7f8f8' }}>
      {/* 顶部栏 */}
      <div style={{
        display: 'flex', alignItems: 'center', padding: '0 16px', height: 48,
        borderBottom: '1px solid #1a1b1e', background: '#0c0d0e', gap: 24,
      }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: '#7170ff' }}>邮箱管理</span>
        <div style={{ display: 'flex', gap: 4 }}>
          {tabs.map(tab => (
            <button key={tab.path} onClick={() => navigate(tab.path)}
              style={{
                padding: '6px 14px', borderRadius: 6, fontSize: 13, cursor: 'pointer',
                background: location.pathname === tab.path ? '#1a1b1e' : 'transparent',
                border: 'none', color: location.pathname === tab.path ? '#f7f8f8' : '#62666d',
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
              <tab.icon size={14} />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* 统计面板 */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, padding: 16, borderBottom: '1px solid #1a1b1e', background: '#0c0d0e' }}>
          <StatCard icon={<FiActivity size={18} />} label="同步总次数" value={stats.total_syncs.toString()} color="#7170ff" />
          <StatCard icon={<FiCheckCircle size={18} />} label="成功" value={stats.success.toString()} color="#4ade80" />
          <StatCard icon={<FiXCircle size={18} />} label="失败" value={stats.failed.toString()} color="#ff6b6b" />
          <StatCard icon={<FiClock size={18} />} label="超时" value={stats.timeout.toString()} color="#fbbf24" />
          <StatCard icon={<FiRefreshCw size={18} />} label="24h 总同步" value={stats.recent_24h.total.toString()} color="#a0a2a6" />
          <StatCard icon={<FiXCircle size={18} />} label="24h 失败" value={stats.recent_24h.failed.toString()} color={stats.recent_24h.failed > 0 ? '#ff6b6b' : '#4ade80'} />
        </div>
      )}

      {/* 各邮箱统计 */}
      {stats && stats.per_mailbox.length > 0 && (
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #1a1b1e', fontSize: 13 }}>
          <div style={{ color: '#62666d', marginBottom: 8, fontSize: 12 }}>各邮箱同步情况</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {stats.per_mailbox.map((mb, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '8px 12px', background: '#1a1b1e', borderRadius: 6,
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500 }}>{mb.mailbox__name}</div>
                  <div style={{ color: '#62666d', fontSize: 11 }}>{mb.mailbox__email}</div>
                </div>
                <Bar label="成功" count={mb.success} total={mb.total} color="#4ade80" />
                <Bar label="失败" count={mb.failed} total={mb.total} color="#ff6b6b" />
                <Bar label="超时" count={mb.timeout} total={mb.total} color="#fbbf24" />
                <span style={{ color: '#62666d', fontSize: 12, width: 50, textAlign: 'right' }}>
                  共{mb.total}次
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 日志列表 */}
      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        <div style={{ color: '#62666d', fontSize: 12, marginBottom: 8 }}>同步记录</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {logs.map(log => (
            <div key={log.id} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '8px 12px', borderRadius: 6, fontSize: 13,
              background: '#1a1b1e',
            }}>
              <div style={{
                width: 8, height: 8, borderRadius: '50%',
                background: statusColor(log.status), flexShrink: 0,
              }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontWeight: 500 }}>{log.mailbox_name}</span>
                  <span style={{
                    fontSize: 11, padding: '1px 6px', borderRadius: 4,
                    background: statusColor(log.status) + '20',
                    color: statusColor(log.status),
                  }}>
                    {statusText(log.status)}
                  </span>
                  {log.new_count > 0 && (
                    <span style={{ color: '#4ade80', fontSize: 11 }}>
                      +{log.new_count} 封
                    </span>
                  )}
                </div>
                {log.error_message && (
                  <div style={{ color: '#ff6b6b', fontSize: 11, marginTop: 2, wordBreak: 'break-all' }}>
                    {log.error_message}
                  </div>
                )}
              </div>
              <div style={{ color: '#62666d', fontSize: 11, textAlign: 'right', flexShrink: 0 }}>
                <div>{formatDuration(log.duration_ms)}</div>
                <div>{new Date(log.created_at).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
              </div>
            </div>
          ))}
          {logs.length === 0 && !loading && (
            <div style={{ textAlign: 'center', color: '#62666d', padding: 40, fontSize: 13 }}>暂无同步记录</div>
          )}
          {loading && (
            <div style={{ textAlign: 'center', color: '#62666d', padding: 20, fontSize: 13 }}>加载中...</div>
          )}
        </div>
        {hasMore && !loading && (
          <button onClick={() => setPage(p => p + 1)} style={{
            width: '100%', padding: 10, marginTop: 8, background: '#1a1b1e',
            border: '1px solid #2a2b2e', borderRadius: 6, color: '#a0a2a6',
            fontSize: 13, cursor: 'pointer',
          }}>
            加载更多
          </button>
        )}
      </div>
    </div>
  )
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <div style={{
      padding: '12px 16px', background: '#1a1b1e', borderRadius: 8,
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <div style={{ color }}>{icon}</div>
      <div>
        <div style={{ fontSize: 20, fontWeight: 600, color }}>{value}</div>
        <div style={{ fontSize: 11, color: '#62666d' }}>{label}</div>
      </div>
    </div>
  )
}

function Bar({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? (count / total * 100) : 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, width: 80 }}>
      <div style={{
        flex: 1, height: 6, background: '#0a0b0c', borderRadius: 3, overflow: 'hidden',
      }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: 11, color: '#62666d', width: 20, textAlign: 'right' }}>{count}</span>
    </div>
  )
}
