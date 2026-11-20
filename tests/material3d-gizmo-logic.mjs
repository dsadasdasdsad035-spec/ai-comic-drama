/**
 * Gizmo 纯逻辑：metadata 解析与 transform 读出
 * 跑法：node tests/material3d-gizmo-logic.mjs
 */
import assert from 'node:assert/strict'
import {
  MATERIAL3D_OBJECT_META,
  DEFAULT_TRANSFORM,
} from '../src/material3d/material3dTypes.ts'
import {
  nodeToTransform,
  readMaterial3dObjectId,
} from '../src/material3d/gizmoSelection.ts'

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

check('metadata 读取 objectId', () => {
  assert.equal(readMaterial3dObjectId({ [MATERIAL3D_OBJECT_META]: 'obj-1' }), 'obj-1')
  assert.equal(readMaterial3dObjectId({}), null)
})

check('nodeToTransform', () => {
  const node = {
    position: { x: 1, y: 2, z: 3 },
    rotation: { x: 0.1, y: 0, z: 0 },
    scaling: { x: 2, y: 2, z: 2 },
  }
  const t = nodeToTransform(node)
  assert.deepEqual(t.position, node.position)
  assert.deepEqual(t.rotation, node.rotation)
  assert.deepEqual(t.scale, node.scaling)
  assert.notDeepEqual(t, DEFAULT_TRANSFORM)
})

process.exit(failed ? 1 : 0)