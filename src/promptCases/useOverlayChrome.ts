/**
 * 覆盖层的行为外壳：Esc 关闭、body 滚动锁、焦点陷阱、关闭后焦点归还。
 *
 * 为什么在 `src/promptCases/` 而不是 `src/` 顶层公共模块：仓库里已有四处各自实现的
 * 焦点陷阱（MediaPicker / Preview / NewProjectDialog / PromptDialog），风格互不相同。
 * 抽公共层要动这四处，超出本次改版范围；先在案例库做对，将来可作为迁移范本。
 *
 * 焦点陷阱算法照 `src/MediaPicker.tsx` 的既有实现（Tab 循环、首尾 focus）——
 * 那一份是本仓库验证过能用的版本。
 */
import { useEffect, useRef } from 'react'

/** 可聚焦元素选择器：与 MediaPicker 保持一致 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export type OverlayChromeOptions = {
  /** 为 true 时启用全部行为 */
  open: boolean
  /** Esc / 主动关闭时调用 */
  onClose: () => void
}

/**
 * @param containerRef 覆盖层根节点（面板本身，不含 backdrop）
 *
 * 返回的对象目前为空，保留是为了将来暴露 focusFirst 之类的命令式入口。
 */
export function useOverlayChrome({ open, onClose }: OverlayChromeOptions) {
  const containerRef = useRef<HTMLDivElement>(null)
  /**
   * 打开前的焦点元素。
   *
   * 必须在「打开」那一刻记录，而不是在 effect 里从 document.activeElement 读：
   * 面板挂载后浏览器可能已经把焦点移进面板，那时读到的就不是触发按钮。
   */
  const returnFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    const el = containerRef.current
    const doc = document
    /** 记录触发元素；它可能是卡片里的按钮 */
    returnFocusRef.current =
      doc.activeElement instanceof HTMLElement ? doc.activeElement : null

    /** 滚动锁：overflow hidden 会让布局抖动（滚动条宽度消失），补 padding 抵消 */
    const bodyStyle = doc.body.style
    const prevOverflow = bodyStyle.overflow
    const prevPaddingRight = bodyStyle.paddingRight
    const scrollbar = window.innerWidth - doc.documentElement.clientWidth
    bodyStyle.overflow = 'hidden'
    if (scrollbar > 0) bodyStyle.paddingRight = `${scrollbar}px`

    /** 初始焦点：面板内第一个可聚焦元素，没有就把焦点给面板本身 */
    const focusables = () =>
      Array.from(el?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
        (node) => node.offsetParent !== null || node === doc.activeElement,
      )
    const first = focusables()[0]
    if (first) first.focus()
    else if (el) {
      el.tabIndex = -1
      el.focus()
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        e.preventDefault()
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const list = focusables()
      if (!list.length) return
      const firstNode = list[0]
      const lastNode = list[list.length - 1]
      const active = doc.activeElement as HTMLElement | null
      /** 焦点跑到面板外（或还没进来）时拉回首尾，而不是放任穿到背景 */
      if (!active || !el?.contains(active)) {
        e.preventDefault()
        ;(e.shiftKey ? lastNode : firstNode).focus()
        return
      }
      if (e.shiftKey && active === firstNode) {
        e.preventDefault()
        lastNode.focus()
      } else if (!e.shiftKey && active === lastNode) {
        e.preventDefault()
        firstNode.focus()
      }
    }

    doc.addEventListener('keydown', onKeyDown, true)
    return () => {
      doc.removeEventListener('keydown', onKeyDown, true)
      bodyStyle.overflow = prevOverflow
      bodyStyle.paddingRight = prevPaddingRight
      /** 焦点归还：面板卸载后回到触发按钮，键盘用户不会掉到 document.body */
      const target = returnFocusRef.current
      returnFocusRef.current = null
      if (target && doc.contains(target)) {
        // 等一帧：卸载当帧 focus 会被浏览器忽略
        requestAnimationFrame(() => target.focus())
      }
    }
  }, [open, onClose])

  return { containerRef }
}
