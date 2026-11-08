import { pickImageFile } from './mediaUpload'
import { planMaterialCropForFile, planMaterialCropForUrl, type MaterialCropPlan } from './imageMaterialCrop'

export function releaseMaterialCropPlan(plan: MaterialCropPlan | null | undefined) {
  if (plan?.previewUrl) URL.revokeObjectURL(plan.previewUrl)
}

/** 本地文件上传前：合规直接过，不合规返回裁切方案（须确认后再上传） */
export async function materialUploadGateFromFile(
  file: File,
): Promise<
  | { ok: true; mode: 'direct'; file: File }
  | { ok: true; mode: 'crop'; plan: MaterialCropPlan }
  | { ok: false; reason: string }
> {
  const check = pickImageFile(file)
  if (!check.ok) return { ok: false, reason: check.reason }
  try {
    const plan = await planMaterialCropForFile(file)
    if (plan) return { ok: true, mode: 'crop', plan }
    return { ok: true, mode: 'direct', file }
  } catch (e) {
    return { ok: false, reason: (e as Error).message || '图片读取失败' }
  }
}

/** 站内图设为参考前：不合规时返回裁切方案，加载失败则允许原图 */
export async function materialUploadGateFromUrl(
  url: string,
  label: string,
): Promise<
  { ok: true; mode: 'direct' } | { ok: true; mode: 'crop'; plan: MaterialCropPlan }
> {
  try {
    const plan = await planMaterialCropForUrl(url, label)
    if (plan) return { ok: true, mode: 'crop', plan }
    return { ok: true, mode: 'direct' }
  } catch {
    return { ok: true, mode: 'direct' }
  }
}
