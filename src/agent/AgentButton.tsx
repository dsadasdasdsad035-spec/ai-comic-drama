import { Sparkles } from 'lucide-react'

/** 五个工作台统一的助手入口：同一个位置、同一个开合语义、运行/未保存点在按钮上。 */
export function AgentButton({
  open,
  onToggle,
  disabled,
  disabledReason,
  running,
  dirty,
  controlsId,
}: {
  open: boolean
  onToggle: () => void
  disabled?: boolean
  /** 禁用原因；缺省沿用工作台通用的「先选择项目」。发布台等原因不同，需要传自己的。 */
  disabledReason?: string
  running?: boolean
  dirty?: boolean
  controlsId: string
}) {
  const title = disabled
    ? disabledReason || '先选择项目'
    : running
      ? '助手正在改，点击收起'
      : dirty
        ? '助手改过草稿，尚未保存'
        : open
          ? '收起助手'
          : '打开助手'
  return (
    <button
      type="button"
      className="btn agent-btn"
      onClick={onToggle}
      disabled={disabled}
      aria-expanded={open}
      aria-controls={controlsId}
      aria-label={open ? '收起助手' : '打开助手'}
      title={title}
    >
      <Sparkles size={14} />
      <span>{open ? '收起' : '助手'}</span>
      {(running || dirty) && (
        <span
          className={`agent-dot ${running ? 'running' : 'dirty'}`}
          role="status"
          aria-label={running ? '助手运行中' : '草稿未保存'}
        />
      )}
    </button>
  )
}
