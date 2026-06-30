import { useState, useEffect, useCallback } from 'react'

interface EmailBodyProps {
  bodyText: string
  bodyHtml: string
}

/**
 * 通用邮件正文渲染组件 — 沙盒 iframe 隔离渲染
 *
 * 渲染策略：
 * 1. bodyHtml 存在 → 通过 sandbox iframe 隔离渲染
 * 2. bodyHtml 不存在 → 显示 bodyText 纯文本
 * 3. 两者都无 → (无正文内容)
 *
 * 所有邮件 HTML 统一包裹在完整文档内，确保样式和布局隔离。
 */
export default function EmailBody({ bodyText, bodyHtml }: EmailBodyProps) {
  const [showPlain, setShowPlain] = useState(false)

  // ── 工具函数 ──────────────────────────────────────────────

  /** 检测是否包含 HTML 标签 */
  const containsHtml = (text: string): boolean =>
    /<[a-z][\s\S]*?>/i.test(text)

  /** 从 HTML 提取保留段落结构的纯文本 */
  const extractStructuredText = (html: string): string => {
    return html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<\/h[1-6]>/gi, '\n\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<\/tr>/gi, '\n')
      .replace(/<\/blockquote>/gi, '\n\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/\r/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^\n+|\n+$/g, '')
      .trim()
  }

  // ── srcDoc 构建 ──────────────────────────────────────────

  const buildSrcDoc = useCallback((): string => {
    const html = bodyHtml || ''

    if (!html.trim()) {
      // 没有 bodyHtml：把 bodyText 包装成美观的 HTML 页面
      const text = (bodyText && !containsHtml(bodyText))
        ? bodyText
        : extractStructuredText(bodyText || '(无正文内容)')
      return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body {
    margin: 0;
    padding: 24px 28px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', Helvetica, Arial, sans-serif;
    font-size: 15px;
    line-height: 1.7;
    color: #1f2329;
    word-wrap: break-word;
    overflow-wrap: break-word;
    white-space: pre-wrap;
  }
</style>
</head>
<body>${text}</body>
</html>`
    }

    // 有 bodyHtml：提取 body 内容并包裹到统一文档框架中
    let bodyContent = html
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)
    if (bodyMatch) {
      bodyContent = bodyMatch[1]
    } else {
      bodyContent = html.replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
    }

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  * { max-width: 100% !important; box-sizing: border-box; }
  body { margin: 0; padding: 0; word-wrap: break-word; overflow-wrap: break-word; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif; }
  img { height: auto !important; }
  table { max-width: 100% !important; word-break: break-word; }
</style>
</head>
<body>${bodyContent}</body>
</html>`
  }, [bodyHtml, bodyText])

  const [srcDoc, setSrcDoc] = useState('')

  useEffect(() => {
    setSrcDoc(buildSrcDoc())
  }, [buildSrcDoc])

  // ── 渲染逻辑 ──────────────────────────────────────────────

  const noContent = !bodyText && !bodyHtml

  const plainText = bodyHtml
    ? extractStructuredText(bodyHtml)
    : (bodyText && !containsHtml(bodyText) ? bodyText : extractStructuredText(bodyText || '(无正文内容)'))

  // 有内容即有切换按钮（iframe → 纯文本）
  const showToggle = (bodyHtml && bodyHtml.trim().length > 50) ||
    (bodyText && bodyText.trim().length > 0)

  // ── 渲染 ──────────────────────────────────────────────────

  if (noContent) {
    return (
      <div style={{ color: 'var(--color-text-tertiary)', fontSize: 14 }}>
        (无正文内容)
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {showPlain ? (
        <pre style={{
          fontSize: 14,
          lineHeight: 1.8,
          color: 'var(--color-text-primary)',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'break-word',
          wordBreak: 'break-word',
          maxWidth: '100%',
          fontFamily: "'Inter', 'PingFang SC', sans-serif",
          margin: 0,
          flex: 1,
        }}>{plainText}</pre>
      ) : (
        <iframe
          srcDoc={srcDoc}
          sandbox="allow-same-origin"
          title="邮件正文"
          style={{
            width: '100%',
            flex: 1,
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 4,
            background: '#fff',
          }}
        />
      )}
      {showToggle && (
        <button onClick={() => setShowPlain(v => !v)}
          style={{
            marginTop: 12,
            padding: '5px 12px',
            background: 'var(--color-bg-surface)',
            color: 'var(--color-text-secondary)',
            border: '1px solid var(--color-border-strong)',
            borderRadius: 4,
            fontSize: 12,
            cursor: 'pointer',
            alignSelf: 'flex-start',
            transition: 'all 0.12s ease',
          }}
          onMouseEnter={e => { (e.target as HTMLElement).style.background = 'var(--color-bg-hover)' }}
          onMouseLeave={e => { (e.target as HTMLElement).style.background = 'var(--color-bg-surface)' }}>
          {showPlain ? '查看网页版' : '查看纯文本'}
        </button>
      )}
    </div>
  )
}
