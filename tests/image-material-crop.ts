import assert from 'node:assert/strict'
import {
  clampedMaterialAspect,
  materialAspectRatio,
  materialCropRect,
  MATERIAL_MAX_ASPECT,
  MATERIAL_MIN_ASPECT,
  needsMaterialAspectCrop,
} from '../src/imageMaterialCrop.ts'

function check(name: string, fn: () => void) {
  try {
    fn()
    console.log(`✅ ${name}`)
  } catch (e) {
    console.error(`❌ ${name}`, e)
    process.exitCode = 1
  }
}

check('465x1672 需裁切', () => {
  assert.equal(needsMaterialAspectCrop(465, 1672), true)
  const r = materialCropRect(465, 1672)!
  assert.ok(r.sw > 0 && r.sh > 0)
  const out = materialAspectRatio(r.sw, r.sh)
  assert.ok(out >= MATERIAL_MIN_ASPECT - 0.001 && out <= MATERIAL_MAX_ASPECT + 0.001)
  assert.ok(Math.abs(out - 0.4) < 0.02)
})

check('16:9 不裁切', () => {
  assert.equal(needsMaterialAspectCrop(1920, 1080), false)
  assert.equal(materialCropRect(1920, 1080), null)
})

check('1:1 不裁切', () => {
  assert.equal(needsMaterialAspectCrop(1000, 1000), false)
})

check('超宽裁切', () => {
  assert.equal(needsMaterialAspectCrop(5000, 1000), true)
  const r = materialCropRect(5000, 1000)!
  const out = materialAspectRatio(r.sw, r.sh)
  assert.ok(Math.abs(out - MATERIAL_MAX_ASPECT) < 0.02)
})

check('钳制比例', () => {
  assert.equal(clampedMaterialAspect(465, 1672), MATERIAL_MIN_ASPECT)
  assert.equal(clampedMaterialAspect(5000, 1000), MATERIAL_MAX_ASPECT)
})

if (process.exitCode !== 1) console.log('\n全部通过')
