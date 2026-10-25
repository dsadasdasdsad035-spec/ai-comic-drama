/** 平台徽标：平台色只出现在这个小方块里，不整行染色 */
export default function PlatformBadge({ platform, label }: { platform: string; label?: string }) {
  const known = platform === 'douyin' || platform === 'bilibili' || platform === 'toutiao'
  const text = label || (platform === 'douyin' ? '抖' : platform === 'bilibili' ? 'B' : platform === 'toutiao' ? '头' : platform.slice(0, 1).toUpperCase())
  return (
    <span className={`pb-badge ${known ? platform : 'generic'}`} aria-hidden="true">
      {text}
    </span>
  )
}
