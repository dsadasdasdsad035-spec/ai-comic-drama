import assert from 'node:assert/strict'
import {
  STUDIO_TOOL_NAME_ALIASES,
  expandStudioToolCatalog,
  resolveStudioToolName,
} from '../server/studio-tool-aliases.mjs'

assert.equal(resolveStudioToolName('submit_shot_prompts'), 'submit_prompts')
assert.equal(resolveStudioToolName('submit_prompts'), 'submit_prompts')

const base = [{ name: 'submit_prompts', description: '写提示词', parameters: { type: 'object', properties: {} } }]
const expanded = expandStudioToolCatalog(base)
assert.equal(expanded.length, 1 + Object.keys(STUDIO_TOOL_NAME_ALIASES).length)
assert.ok(expanded.some((t) => t.name === 'submit_shot_prompts'))
console.log('✅ studio-tool-aliases')