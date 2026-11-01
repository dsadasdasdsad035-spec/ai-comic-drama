/**
 * 工作台聊天的通用附件来源：图片上传 + 从项目素材里选。
 *
 * 为什么抽出来：四个工作台（剧本/素材/分镜/提示词）要的行为完全一致——
 * 上传落成项目媒体、从 MediaPicker 选一条图片、两者都只进本次对话。
 * 写在各自的组件里会重复三份同样的分支，而且很快就会分叉。
 *
 * 角色工作台不走这里：它同样不预填项目图片，但选择器由角色板自己挂载，
 * 提示文案也是「生成角色的过程输入」，与这里刻意保持区别。
 */
import { listMedia } from '../api'
import { uploadImageFile } from '../mediaUpload'
import type { WorkbenchAttachmentSource } from './workbenchChat'

export type ProjectImagePicker = {
  /** 打开项目素材选择器；返回 null 表示取消 */
  open: () => Promise<{ url: string; title?: string; name?: string } | null>
}

/**
 * 建一个「只收图片」的附件来源。
 *
 * @param projectName 当前项目；为空时上传与选择都会给出可读错误
 * @param prefix      上传文件的文件名前缀，便于在项目媒体目录里辨认来源
 * @param picker      宿主提供的素材选择器（各工作台自己持有 MediaPicker 的挂载点）
 * @param onBusy      选择器开关的 UI 状态回调；宿主用它禁用重复点击
 */
export function projectImageAttachmentSource(input: {
  projectName: string
  prefix: string
  picker: ProjectImagePicker
  onBusy?: (busy: boolean) => void
  hint?: string
  /** 上限；默认 4，与角色聊天保持一致 */
  limit?: number
}): WorkbenchAttachmentSource {
  return {
    kinds: ['image'],
    persist: 'thread',
    limit: input.limit ?? 4,
    /**
     * 快捷缩略图留空：这四个工作台没有「一眼能点」的语义，
     * 全部走「从素材选」，避免把项目图片铺满输入区。
     */
    available: () => [],
    upload: async (file: File) => {
      const project = String(input.projectName || '').trim()
      if (!project) throw new Error('先在顶栏选择项目，再上传图片')
      const url = await uploadImageFile(file, { project, prefix: input.prefix })
      return { key: url, kind: 'image', label: file.name || '上传的图片', url }
    },
    pick: async () => {
      input.onBusy?.(true)
      try {
        const item = await input.picker.open()
        if (!item) return null
        return { key: item.url, kind: 'image', label: item.title || item.name || '项目图片', url: item.url }
      } finally {
        input.onBusy?.(false)
      }
    },
    ...(input.hint ? { hint: input.hint } : {}),
  }
}

/**
 * 项目里的图片清单，供需要快捷缩略图的调用方使用。
 * 只返回图片：视频/音频在只收图片的面里不该出现在候选里。
 */
export async function projectImageOptions(projectName: string): Promise<{ key: string; label: string; url: string }[]> {
  if (!projectName) return []
  const media = await listMedia(projectName)
  const seen = new Set<string>()
  const out: { key: string; label: string; url: string }[] = []
  for (const x of media.images) {
    if (!x.url || seen.has(x.url)) continue
    seen.add(x.url)
    out.push({ key: x.url, label: x.name || '项目图片', url: x.url })
  }
  return out
}
