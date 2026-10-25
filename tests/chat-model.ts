import assert from 'node:assert/strict'
import { DynamicStructuredTool } from '@langchain/core/tools'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { z } from 'zod'
import { ZCodeChatModel } from '../src/agent/zcodeChatModel'
import { normalizeSceneCodeArg } from '../src/agent/sceneAgentTools'

let bad = 0
function check(name: string, fn: () => void) {
  try {
    fn()
    console.log(`✅ ${name}`)
  } catch (e) {
    bad++
    console.log(`❌ ${name}\n   ${(e as Error).message}`)
  }
}

const tool = new DynamicStructuredTool({
  name: 'read_source',
  description: '读取原著',
  schema: z.object({}),
  func: async () => ({ ok: true }),
})

let captured: Record<string, unknown> | null = null
const model = new ZCodeChatModel({
  ask: async (o) => {
    captured = o as unknown as Record<string, unknown>
    return { json: { content: '已读取' }, text: '已读取', modelLabel: 'mock' } as never
  },
  tools: [tool],
  maxTokens: 4321,
  temperature: 0.1,
})

await model.invoke([new SystemMessage('SKILL_ROLE_技能正文'), new HumanMessage('你好')])

check('模型调用被捕获', () => assert.ok(captured))
check('技能正文进入 system', () => assert.ok(String(captured?.system).includes('SKILL_ROLE_技能正文')))
check('技能正文不重复进入 user prompt', () => assert.ok(!String(captured?.prompt).includes('SKILL_ROLE_技能正文')))
check('不再写死 3D 身份', () => assert.ok(!String(captured?.system).includes('你是 3D 场景 agent')))
check('协议层仍在 system', () => assert.ok(String(captured?.system).includes('每次回复只输出 JSON')))
check('工具 schema 进入 system', () => assert.ok(String(captured?.system).includes('read_source')))
check('用户消息进入 prompt', () => assert.ok(String(captured?.prompt).includes('[human]\n你好')))
check('maxTokens 可配置', () => assert.equal(captured?.maxTokens, 4321))
check('temperature 可配置', () => assert.equal(captured?.temperature, 0.1))

check('set_scene_code 的字面 \\n 在工具侧还原', () => {
  const literal = 'import bpy\\n\\ndef build(ctx):\\n    pass'
  const normalized = normalizeSceneCodeArg(literal)
  assert.ok(normalized.includes('\n'))
  assert.ok(!normalized.includes('\\n'))
})

check('已有真实换行的代码不被二次处理', () => {
  const code = 'import bpy\n\n# 保留字面 \\n 说明\ndef build(ctx):\n    pass'
  assert.equal(normalizeSceneCodeArg(code), code)
})

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
