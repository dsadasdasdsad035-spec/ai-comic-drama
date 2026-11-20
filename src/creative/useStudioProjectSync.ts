import { useEffect, useRef } from 'react'

const POLL_VISIBLE_MS = 2000
const POLL_IDLE_MS = 5000

/** 壳是否应因远端 revision 升高而重载项目（便于单测） */
export function shellNeedsProjectRefresh(local: number, remote: number) {
  const l = Math.max(0, Math.floor(Number(local) || 0))
  const r = Math.max(0, Math.floor(Number(remote) || 0))
  return r > l
}

export type StudioProjectSyncInput = {
  /** 顶栏当前项目（已就绪） */
  projectName: string
  /** 创意入口已挂载（曾进入过创意 / keepalive） */
  studioMounted: boolean
  /** 创意视图当前可见（keepalive 容器 active） */
  studioVisible: boolean
  /** 读取壳内快照 revision */
  getLocalRevision: () => number
  /** 重读项目并水合画布（不传 fit） */
  onRefresh: () => Promise<void>
  /** 写后立刻推送 canvas-context */
  onPushCanvas: () => void
}

/**
 * 创意宿主写库与外壳内存快照对齐：轮询 revision，升高时刷新一次。
 */
export function useStudioProjectSync(input: StudioProjectSyncInput) {
  const busy = useRef(false)
  const inputRef = useRef(input)
  inputRef.current = input

  useEffect(() => {
    const name = String(input.projectName || '').trim()
    if (!name || !input.studioMounted) return

    const interval = input.studioVisible ? POLL_VISIBLE_MS : POLL_IDLE_MS

    const probe = async () => {
      const { getLocalRevision, onRefresh, onPushCanvas } = inputRef.current
      if (busy.current) return
      if (document.visibilityState === 'hidden') return
      let remote = 0
      try {
        const res = await fetch(
          `/api/studio/project-revision?name=${encodeURIComponent(name)}`,
          { credentials: 'include', cache: 'no-store' },
        )
        const body = (await res.json()) as { ok?: boolean; revision?: number }
        if (!res.ok || body.ok === false) return
        remote = Math.max(0, Math.floor(Number(body.revision) || 0))
      } catch {
        return
      }
      const local = getLocalRevision()
      if (!shellNeedsProjectRefresh(local, remote)) return
      busy.current = true
      try {
        await onRefresh()
        onPushCanvas()
      } finally {
        busy.current = false
      }
    }

    const onFocus = () => void probe()
    const onVis = () => {
      if (document.visibilityState === 'visible') void probe()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVis)
    const timer = window.setInterval(() => void probe(), interval)
    void probe()
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [input.projectName, input.studioMounted, input.studioVisible])
}