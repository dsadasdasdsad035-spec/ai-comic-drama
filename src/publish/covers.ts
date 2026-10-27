/**
 * 封面的唯一落盘入口。
 *
 * 抽帧与上传都产出 dataURL，只有落成站内文件后才有资格写进发布配置：
 * 配置里存的是服务端可解析的路径，预检、发布包与自动投递才能用同一份判定。
 */
import { saveImageDataUrl } from '../api'
import { loadVideoFrameAt } from './frames'
import type { CoverAspect } from './types'

/** 把 dataURL 存成站内图片，返回 URL；失败抛错，调用方不得把 dataURL 当封面 */
export async function persistCoverImage(dataUrl: string, aspect: CoverAspect): Promise<string> {
  if (!/^data:image\/(png|jpe?g|webp);base64,/.test(dataUrl)) {
    throw new Error('封面图片格式不可用')
  }
  const url = await saveImageDataUrl(dataUrl, { prefix: `cover-${aspect.replace(':', 'x')}` })
  if (!url || !url.startsWith('/')) throw new Error('保存封面失败：服务端没有返回文件地址')
  return url
}

/** 按比例位置抽帧并落盘；返回可直接写入配置的文件地址 */
export async function captureCoverFromVideo(
  videoUrl: string,
  aspect: CoverAspect,
  atPercent = 0.5,
): Promise<string> {
  const dataUrl = await loadVideoFrameAt(videoUrl, atPercent, 720, aspect)
  return persistCoverImage(dataUrl, aspect)
}
