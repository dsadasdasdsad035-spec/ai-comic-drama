/**
 * 把既有的 MediaPicker 包成 promise 语义：调用方 await open() 拿结果，
 * 不需要自己维护 open 状态与 resolver ref。
 *
 * 返回的 picker 必须渲染在组件树里（放在面板任意位置即可，它是覆盖层）。
 */
import { useCallback, useRef, useState, type ReactNode } from 'react'
import MediaPicker from '../MediaPicker'
import type { AssetKind } from '../data'
import type { PickItem } from '../mediaPick'

export type MediaPickerHandle = {
  /** 打开选择器；返回 null 表示用户取消 */
  open: () => Promise<PickItem | null>
  /** 需要渲染到组件树里的覆盖层；未打开时为 null */
  node: ReactNode
  open_now: boolean
}

export function useMediaPicker(
  projectName: string,
  currentKind: AssetKind = 'image',
  /** 只允许这些媒体类型；省略表示不限。入口就排除不可选类型。 */
  accept?: ('image' | 'video' | 'audio')[],
): MediaPickerHandle {
  const [open, setOpen] = useState(false)
  const resolveRef = useRef<((item: PickItem | null) => void) | null>(null)

  const openPicker = useCallback(
    () =>
      new Promise<PickItem | null>((resolve) => {
        resolveRef.current = resolve
        setOpen(true)
      }),
    [],
  )

  const settle = useCallback((item: PickItem | null) => {
    const resolve = resolveRef.current
    resolveRef.current = null
    setOpen(false)
    resolve?.(item)
  }, [])

  const node = open ? (
    <MediaPicker
      projectName={projectName}
      currentKind={currentKind}
      {...(accept ? { accept } : {})}
      onConfirm={settle}
      onClose={() => settle(null)}
    />
  ) : null

  return { open: openPicker, node, open_now: open }
}
