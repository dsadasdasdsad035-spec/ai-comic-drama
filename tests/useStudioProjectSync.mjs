import assert from 'node:assert/strict'
import { shellNeedsProjectRefresh } from '../src/creative/useStudioProjectSync.ts'

assert.equal(shellNeedsProjectRefresh(1, 2), true)
assert.equal(shellNeedsProjectRefresh(2, 2), false)
assert.equal(shellNeedsProjectRefresh(3, 2), false)
console.log('✅ useStudioProjectSync 比对逻辑')