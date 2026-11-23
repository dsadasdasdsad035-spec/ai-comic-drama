/**
 * 全屏查看层（图表大图 / 图片放大）。
 *
 * 为什么必须用 portal 挂到 body：书页正文的元素都在 `.script-reader-page > *`
 * 的 `z-index: 1` 堆叠上下文里，`position: fixed` + `z-index: 60` 只在该上下文内
 * 生效，反而会低于根上下文的顶栏（30）。结果就是遮罩被顶栏压住、点不到。
 * 挂到 body 后 z-index 回到根上下文，`--z-modal` 才是真正的最上层。
 */
import { useEffect } from 'react'
import { createPortal } from 'react-dom'

export default function ZoomLayer({
  label,
  onClose,
  children,
}: {
  label: string
  onClose: () => void
  children: React.ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey, true)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = prev
    }
  }, [onClose])

  return createPortal(
    <div
      className="md-diagram-zoom"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={onClose}
    >
      {children}
    </div>,
    document.body,
  )
}
