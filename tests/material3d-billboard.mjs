/**
 * 立板校验（内联，避免 Node 直接跑 .ts）
 * 跑法：npx tsx tests/material3d-billboard.mjs 或 node tests/material3d-billboard.mjs（需与 src 逻辑同步）
 */
import assert from 'node:assert/strict'
import { createBillboardObject, resolveDesignBillboardUrl } from '../src/material3d/billboardFromDesign.ts'

const design = {
  id: 'd1',
  kind: 'scene',
  name: '客厅',
  refs: [],
  summaryCn: '',
  promptEn: '',
  keywords: [],
  image: '/project-assets/p/demo.png',
}

let failed = 0
const check = (name, fn) => {
  try {
    fn()
    console.log(`✅ ${name}`)
  } catch (e) {
    failed++
    console.error(`❌ ${name}`, e)
  }
}

check('合法设定图', () => {
  assert.equal(resolveDesignBillboardUrl(design, new Set()), design.image)
  const obj = createBillboardObject(design, new Set())
  assert.equal(obj.kind, 'billboard')
  assert.equal(obj.designId, 'd1')
})

check('无图拒绝', () => {
  assert.throws(() => resolveDesignBillboardUrl({ ...design, image: '' }, new Set()), /没有当前图/)
})

check('缺失文件拒绝', () => {
  assert.throws(
    () => resolveDesignBillboardUrl(design, new Set(['/project-assets/p/demo.png'])),
    /图片缺失/,
  )
})

process.exit(failed ? 1 : 0)