/**
 * 壳刷新与宿主审批用的写工具名单须一致。
 */
import assert from 'node:assert/strict'
import { STUDIO_SHELL_SYNC_TOOLS } from '../server/dsh-plugins/creative-tools/shell-sync-tools.mjs'
import { isStudioShellSyncTool } from '../server/dsh-plugins/creative-tools/shell-sync-tools.mjs'

const REQUIRED = [
  'submit_shots',
  'submit_episodes',
  'delete_shots',
  'link_shot_refs',
]

for (const name of REQUIRED) {
  assert.ok(STUDIO_SHELL_SYNC_TOOLS.has(name), `缺少壳同步工具：${name}`)
  assert.ok(isStudioShellSyncTool(name))
}
assert.ok(!isStudioShellSyncTool('read_shots'))
console.log('✅ 壳同步写工具名单完整')