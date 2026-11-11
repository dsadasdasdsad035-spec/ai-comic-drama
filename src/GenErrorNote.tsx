/** 生成失败原因：可展开全文 + 复制（避免顶栏/底栏截断） */
export default function GenErrorNote({
  message,
  compact = false,
  summary = '失败详情',
}: {
  message: string
  /** 画布卡片等窄位：默认折叠，仅一行摘要 */
  compact?: boolean
  summary?: string
}) {
  const copy = () => {
    void navigator.clipboard?.writeText(message)
  }
  return (
    <details className={`gen-error-note ${compact ? 'gen-error-note--compact' : ''}`} open={!compact}>
      <summary title={message}>{summary}</summary>
      <pre className="gen-error-note-text">{message}</pre>
      <button type="button" className="btn-mini gen-error-note-copy" onClick={copy}>
        复制全文
      </button>
    </details>
  )
}
