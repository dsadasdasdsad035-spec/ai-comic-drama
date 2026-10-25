import type { PlatformBadgeInfo } from './types'

/**
 * 平台徽标：平台色只出现在这个小方块里，不整行染色。
 * 缩写与品牌色来自平台能力表；缺声明时回退到 id 首字母 + 通用样式，
 * 这样新增平台不需要改这个组件。
 */
export default function PlatformBadge({
  platform,
  label,
  badge,
}: {
  platform: string
  label?: string
  badge?: PlatformBadgeInfo
}) {
  const text = badge?.text || label || platform.slice(0, 1).toUpperCase()
  const style = badge?.color ? { background: badge.color } : undefined
  return (
    <span className={`pb-badge ${badge?.color ? 'branded' : 'generic'}`} style={style} aria-hidden="true">
      {text}
    </span>
  )
}
