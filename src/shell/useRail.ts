import { useCallback, useEffect, useState } from 'react'
import { WIDE_VIEWS, type ViewId } from './nav'

const KEY = 'sb.railCollapsed'

/** 手动折叠状态：0/1 字符串，读不到就是「跟随自动规则」 */
function readManual(): boolean | null {
  try {
    const v = localStorage.getItem(KEY)
    if (v === '1') return true
    if (v === '0') return false
  } catch {
    /* 隐私模式下 localStorage 会抛错，按未设置处理 */
  }
  return null
}

function writeManual(value: boolean) {
  try {
    localStorage.setItem(KEY, value ? '1' : '0')
  } catch {
    /* 存不了就只在本次会话生效 */
  }
}

/**
 * 左栏折叠状态。
 *
 * 规则：画布这类需要横向空间的视图在 <1400 自动折叠到图标栏；<900 一律折叠
 * （CSS 会把折叠态变成抽屉）。用户手动点过折叠/展开后，手动值优先，直到他再点一次。
 */
export function useRailCollapsed(view: ViewId) {
  const [width, setWidth] = useState(() => (typeof window === 'undefined' ? 1440 : window.innerWidth))
  const [manual, setManual] = useState<boolean | null>(readManual)

  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const forced = width < 900
  const auto = forced || (WIDE_VIEWS.includes(view) && width < 1400)
  // 窄屏强制收成图标栏（抽屉会挤掉内容列，也让主题开关在 390px 下不可见）
  const collapsed = forced ? true : (manual ?? auto)

  const toggle = useCallback(() => {
    if (forced) return
    setManual((cur) => {
      const next = !(cur ?? auto)
      writeManual(next)
      return next
    })
  }, [auto, forced])

  // '[' 折叠/展开：不抢输入框里的按键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '[' || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      const tag = t?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || t?.isContentEditable) return
      e.preventDefault()
      toggle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle])

  return { collapsed, toggle }
}
