import { saveImageDataUrl } from './api'

/**
 * 本地图片上传的唯一实现：设定卡、画布素材卡、素材选择器、角色卡共用。
 *
 * 为什么集中在一处：这三处原先各写一遍 FileReader，拒绝文案互不一致，有的失败后还把
 * dataURL 直接写回素材卡。这里把「能不能传」与「传到哪」分开，调用方只处理成功值或错误消息。
 */

/** 与服务端 MAX_REF_BYTES 一致（server/media.mjs） */
export const MAX_IMAGE_BYTES = 30 * 1024 * 1024
/** /api 请求体上限（vite.config.ts 的 readJson） */
export const MAX_REQUEST_BYTES = 40 * 1024 * 1024

export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

/** 给 <input type="file"> 用；和校验规则保持同一份来源 */
export const ACCEPT_ATTR = ACCEPTED_IMAGE_TYPES.join(',')

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
}

export type ImageCheck = { ok: true } | { ok: false; reason: string }

function extOf(name: string): string {
  const m = String(name || '').trim().toLowerCase().match(/\.([a-z0-9]+)$/)
  return m ? m[1] : ''
}

/**
 * 归一化图片 MIME：拿到的 type 可能是 image/jpg、也可能是空串（Windows 拖入常见）。
 * 空串时按扩展名兜底，仍认不出返回空串。
 */
export function imageMimeOf(file: { name?: string; type?: string }): string {
  const type = String(file?.type || '').toLowerCase().trim()
  if (type === 'image/jpg') return 'image/jpeg'
  if ((ACCEPTED_IMAGE_TYPES as readonly string[]).includes(type)) return type
  return MIME_BY_EXT[extOf(String(file?.name || ''))] || ''
}

export function mb(bytes: number): string {
  return `${(Number(bytes) / 1024 / 1024).toFixed(1)}MB`
}

/** dataURL 的 base64 部分在请求体里占多少字节（JSON 转义后的开销忽略，上限留了余量） */
export function encodedBodyBytes(bytes: number): number {
  return Math.ceil(Math.max(0, Number(bytes) || 0) / 3) * 4
}

/**
 * JSON 外壳预留：`{"dataUrl":"…","project":"…","prefix":"…"}` 本身也占字节。
 * 30MB 的图 base64 后正好等于 40MB，不预留这几十 KB 就会贴着上限发出去。
 */
const ENVELOPE_BYTES = 64 * 1024

/**
 * 上传前校验：类型白名单 + 服务端字节上限 + 请求体膨胀上限。
 * 三个理由都要能直接展示给用户，因为它解释的是「为什么这次不能传」。
 */
export function pickImageFile(file: { name?: string; size?: number; type?: string } | null | undefined): ImageCheck {
  if (!file) return { ok: false, reason: '没有选择文件' }
  const name = String(file.name || '未命名文件')
  if (!imageMimeOf(file)) {
    return {
      ok: false,
      reason: `只支持 png / jpeg / webp 图片，「${name}」不是这三种格式。HEIC 或 GIF 请先导出为 JPEG。`,
    }
  }
  const size = Number(file.size) || 0
  if (size <= 0) return { ok: false, reason: `「${name}」是空文件，无法上传` }
  if (size > MAX_IMAGE_BYTES) {
    return { ok: false, reason: `「${name}」${mb(size)}，超过 ${mb(MAX_IMAGE_BYTES)} 上限，请先压缩` }
  }
  const encoded = encodedBodyBytes(size) + ENVELOPE_BYTES
  if (encoded > MAX_REQUEST_BYTES) {
    return {
      ok: false,
      reason: `「${name}」${mb(size)}，编码后 ${mb(encoded)} 超过 ${mb(MAX_REQUEST_BYTES)} 请求上限，请压到 ${mb(MAX_IMAGE_BYTES * 0.72)} 以内`,
    }
  }
  return { ok: true }
}

function bytesToBase64(bytes: Uint8Array): string {
  // 分块构造：一次 fromCharCode 展开整张图会顶到调用栈上限
  const CHUNK = 0x8000
  let bin = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

/**
 * 读成 dataURL。用 arrayBuffer 而不是 FileReader：
 * 同一份代码能跑在浏览器与 Node 验收脚本里，不必为了测试另写一条路径。
 */
export async function readImageDataUrl(file: Blob & { type?: string }, mime = ''): Promise<string> {
  const type = mime || imageMimeOf({ name: '', type: file?.type }) || 'image/png'
  const bytes = new Uint8Array(await file.arrayBuffer())
  return `data:${type};base64,${bytesToBase64(bytes)}`
}

/**
 * 校验 → 读成 dataURL → 落成项目媒体文件，返回站内路径。
 *
 * 只有保存成功才返回结果，调用方因此可以「先拿到地址再写状态」，
 * 不会出现「先写地址、失败再回滚」留下的空图占位。
 */
export async function uploadImageFile(
  file: Blob & { name?: string; size?: number; type?: string },
  opts: { project: string; prefix?: string },
  deps: { save?: typeof saveImageDataUrl } = {},
): Promise<string> {
  const project = String(opts?.project || '').trim()
  if (!project) throw new Error('先在顶栏选择项目，再上传图片')
  const check = pickImageFile(file)
  if (!check.ok) throw new Error(check.reason)
  const mime = imageMimeOf(file)
  const dataUrl = await readImageDataUrl(file, mime)
  const save = deps.save ?? saveImageDataUrl
  const url = await save(dataUrl, { project, prefix: opts?.prefix || 'media' })
  if (!url) throw new Error('图片保存失败：服务端没有返回地址')
  return url
}
