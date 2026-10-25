import { useCallback, useState } from 'react'
import type { WorkbenchSurface } from './workbenchChat'

const openKey = (surface: WorkbenchSurface) => `workbench-chat:${surface}:open`

/** 每个工作台记住聊天面板开合；首次打开在宽屏默认展开，窄屏默认收起。 */
export function useWorkbenchChatOpen(surface: WorkbenchSurface) {
  const [open, setOpenState] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(openKey(surface))
      if (saved === '1') return true
      if (saved === '0') return false
    } catch {
      /* localStorage 不可用时按视口决定 */
    }
    return typeof window !== 'undefined' && window.innerWidth >= 1440
  })

  const setOpen = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      setOpenState((prev) => {
        const value = typeof next === 'function' ? next(prev) : next
        try {
          localStorage.setItem(openKey(surface), value ? '1' : '0')
        } catch {
          /* 忽略存储失败，不影响本次会话 */
        }
        return value
      })
    },
    [surface],
  )

  return { open, setOpen }
}
