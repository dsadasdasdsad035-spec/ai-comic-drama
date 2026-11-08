/** 与 src/imageMaterialCrop.ts 一致，供 Node 脚本校验/修图 */
export const MATERIAL_SAFE_MIN = 0.41
export const MATERIAL_SAFE_MAX = 2.49

export function materialAspectRatio(width, height) {
  if (!(width > 0) || !(height > 0)) return 1
  return width / height
}

export function needsMaterialAspectCrop(width, height) {
  const r = materialAspectRatio(width, height)
  return r < MATERIAL_SAFE_MIN || r > MATERIAL_SAFE_MAX
}

export function clampedMaterialAspect(width, height) {
  const r = materialAspectRatio(width, height)
  if (r < MATERIAL_SAFE_MIN) return MATERIAL_SAFE_MIN
  if (r > MATERIAL_SAFE_MAX) return MATERIAL_SAFE_MAX
  return r
}

/** 居中 cover 裁切矩形（像素） */
export function materialCropRect(width, height) {
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
