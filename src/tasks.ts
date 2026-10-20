import { useSyncExternalStore } from 'react'

export type TaskKind = 'image' | 'video' | 'voice' | 'text' | 'export'
export type TaskState = 'running' | 'done' | 'error'

export type Task = {
  id: string
  kind: TaskKind
  label: string
  state: TaskState
  startedAt: number
  endedAt?: number
  error?: string
  /** 这一条花了多少钱（只在成功时计入） */
  cost?: number
  /** 失败后可以点重试；没有就给不出按钮 */
  retry?: () => void
}

/**
 * 极简任务台账：全局单例 + useSyncExternalStore。
 *
 * 为什么需要它：批量出图/出片/配音各自在按钮里循环，失败只弹一句 toast 就没了，
 * 也看不到「现在还有几件事在跑、这次会话花了多少」。
 */
let tasks: Task[] = []
const subs = new Set<() => void>()

function emit() {
  for (const fn of subs) fn()
}

function subscribe(fn: () => void) {
  subs.add(fn)
  return () => subs.delete(fn)
}

function snapshot(): Task[] {
  return tasks
}

export function useTasks(): Task[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

let seq = 0

export function startTask(kind: TaskKind, label: string, opts?: { cost?: number; retry?: () => void }): string {
  const id = `t${++seq}-${Date.now()}`
  const task: Task = {
    id,
    kind,
    label,
    state: 'running',
    startedAt: Date.now(),
    cost: opts?.cost,
    retry: opts?.retry,
  }
  tasks = [task, ...tasks].slice(0, 200)
  emit()
  return id
}

export function endTask(id: string, error?: string) {
  tasks = tasks.map((t) =>
    t.id === id
      ? { ...t, state: error ? 'error' : 'done', endedAt: Date.now(), error }
      : t,
  )
  emit()
}

export function clearFinished() {
  tasks = tasks.filter((t) => t.state === 'running')
  emit()
}

/** 成功任务的累计花费（元） */
export function totalCost(list: Task[]): number {
  return list.filter((t) => t.state === 'done' && t.cost).reduce((a, t) => a + (t.cost ?? 0), 0)
}

export const KIND_LABEL: Record<TaskKind, string> = {
  image: '出图',
  video: '出片',
  voice: '配音',
  text: '文本',
  export: '导出',
}
