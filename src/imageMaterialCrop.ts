/** 视频 reference_image / 首帧素材在上游的宽高比约束（宽/高） */
export const MATERIAL_MIN_ASPECT = 0.4
export const MATERIAL_MAX_ASPECT = 2.5

export type MaterialCropRect = { sx: number; sy: number; sw: number; sh: number }

export function materialAspectRatio(width: number, height: number): number {
  if (!(width > 0) || !(height > 0)) return 1
  return width / height
}

export function needsMaterialAspectCrop(width: number, height: number): boolean {
  const r = materialAspectRatio(width, height)
  return r < MATERIAL_MIN_ASPECT || r > MATERIAL_MAX_ASPECT
}

/** 将当前比例钳到合法区间（用于展示目标比例） */
export function clampedMaterialAspect(width: number, height: number): number {
  const r = materialAspectRatio(width, height)
  if (r < MATERIAL_MIN_ASPECT) return MATERIAL_MIN_ASPECT
  if (r > MATERIAL_MAX_ASPECT) return MATERIAL_MAX_ASPECT
  return r
}

/**
 * 居中 cover 裁切：在保留最大画面前提下，使结果宽高比落入 [0.4, 2.5]。
 * 已合规时返回 null。
 */
export function materialCropRect(width: number, height: number): MaterialCropRect | null {
  if (!needsMaterialAspectCrop(width, height)) return null
  const r = materialAspectRatio(width, height)
  const target = clampedMaterialAspect(width, height)
  if (r < target) {
    const sh = width / target
    return { sx: 0, sy: (height - sh) / 2, sw: width, sh }
  }
  const sw = height * target
  return { sx: (width - sw) / 2, sy: 0, sw, sh: height }
}

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片加载失败'))
    }
    img.src = url
  })
}

function loadImageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = url
  })
}

function rectToOutputFile(
  img: HTMLImageElement,
  rect: MaterialCropRect,
  fileName: string,
  mime: string,
): Promise<File> {
  const sw = Math.max(1, Math.round(rect.sw))
  const sh = Math.max(1, Math.round(rect.sh))
  const sx = Math.max(0, Math.round(rect.sx))
  const sy = Math.max(0, Math.round(rect.sy))
  const canvas = document.createElement('canvas')
  canvas.width = sw
  canvas.height = sh
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.reject(new Error('无法创建画布'))
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)
  const outMime = mime === 'image/png' ? 'image/png' : 'image/jpeg'
  const quality = outMime === 'image/jpeg' ? 0.92 : undefined
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('裁切编码失败'))
          return
        }
        const base = fileName.replace(/\.[^.]+$/, '') || 'crop'
        const ext = outMime === 'image/png' ? 'png' : 'jpg'
        resolve(new File([blob], `${base}-crop.${ext}`, { type: outMime }))
      },
      outMime,
      quality,
    )
  })
}

export type MaterialCropPlan = {
  rect: MaterialCropRect
  fromRatio: number
  toRatio: number
  previewUrl: string
  croppedFile: File
}

/** 分析上传文件；需要裁切时返回裁切方案（含预览 data URL 与裁切后 File） */
export async function planMaterialCropForFile(file: File): Promise<MaterialCropPlan | null> {
  const img = await loadImageFromFile(file)
  const rect = materialCropRect(img.naturalWidth, img.naturalHeight)
  if (!rect) return null
  const fromRatio = materialAspectRatio(img.naturalWidth, img.naturalHeight)
  const toRatio = clampedMaterialAspect(img.naturalWidth, img.naturalHeight)
  const croppedFile = await rectToOutputFile(img, rect, file.name, file.type || 'image/jpeg')
  const previewUrl = URL.createObjectURL(croppedFile)
  return { rect, fromRatio, toRatio, previewUrl, croppedFile }
}

export function formatAspectRatio(r: number): string {
  if (!Number.isFinite(r) || r <= 0) return '—'
  return r.toFixed(2)
}

export function materialCropNotice(plan: MaterialCropPlan): string {
  return `图片过${plan.fromRatio < MATERIAL_MIN_ASPECT ? '竖' : '宽'}（${formatAspectRatio(plan.fromRatio)}），已裁为 ${formatAspectRatio(plan.toRatio)}，避免视频出片报错。`
}

/** 设为三视图等：对已有站内 URL 裁切并返回新 File（供 uploadImageFile） */
export async function planMaterialCropForUrl(url: string, label: string): Promise<MaterialCropPlan | null> {
  const img = await loadImageFromUrl(url)
  const rect = materialCropRect(img.naturalWidth, img.naturalHeight)
  if (!rect) return null
  const fromRatio = materialAspectRatio(img.naturalWidth, img.naturalHeight)
  const toRatio = clampedMaterialAspect(img.naturalWidth, img.naturalHeight)
  const croppedFile = await rectToOutputFile(img, rect, label, 'image/jpeg')
  const previewUrl = URL.createObjectURL(croppedFile)
  return { rect, fromRatio, toRatio, previewUrl, croppedFile }
}
