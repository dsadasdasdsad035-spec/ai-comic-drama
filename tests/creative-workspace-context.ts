import assert from 'node:assert/strict'
import {
  formatCreativeWorkspaceContext,
  buildCreativePiSystem,
  buildExpertSystem,
  buildCreativeTurnPayload,
  creativeWorkspaceNeedsShotEpisode,
} from '../src/creative/creativeTurnPayload'
import { describePiThreadMemory } from '../src/agent/pi/threadMemory'
import type { CreativeExpert } from '../src/creative/expertTypes'

assert.match(
  buildCreativePiSystem(null, { projectName: 'demo', epNo: 2 }),
  /【当前上下文】[\s\S]*项目：demo[\s\S]*分镜默认集号：第 2 集/,
)

assert.match(
  formatCreativeWorkspaceContext({ projectName: 'p' }, { includeShotEpisode: false }),
  /项目：p[\s\S]*项目级/,
)
assert.doesNotMatch(formatCreativeWorkspaceContext({ projectName: 'p' }, { includeShotEpisode: false }), /分镜默认集号/)

// ---- system 与历史压缩状态必须互斥：发生过指针化就不能再承诺「已读可省读」
{
  const normal = buildCreativePiSystem(null, { projectName: 'p', epNo: 1 })
  const compacted = buildCreativePiSystem(null, { projectName: 'p', epNo: 1 }, undefined, {
    historyCompacted: true,
  })
  assert.match(normal, /可不再重复读取/, '未压缩时应保留省读约定')
  assert.doesNotMatch(compacted, /可不再重复读取/, '压缩后不得声明历史并不支持的省读能力')
  assert.match(compacted, /重新读取/, '压缩后必须指示用读工具重取')
  assert.doesNotMatch(compacted, /已读过某技能全文/, '压缩后不应留下旧承诺片段')
}

const characterExpert: CreativeExpert = {
  id: 'expert-character',
  name: '角色设定',
  description: '',
  soul: '你是 {{expertName}} · {{projectName}}',
  skillIds: [],
  toolIds: ['read_characters', 'submit_characters'],
  source: 'builtin',
}

assert.equal(creativeWorkspaceNeedsShotEpisode(characterExpert), false)
assert.match(
  buildExpertSystem(characterExpert, { projectName: 'p', epNo: 3 }),
  /角色与素材为项目级/,
)
assert.doesNotMatch(buildExpertSystem(characterExpert, { projectName: 'p', epNo: 3 }), /分镜默认集号/)
// 压缩后专家也不得隐式假设「历史还在」
assert.doesNotMatch(
  buildExpertSystem(characterExpert, { projectName: 'p', epNo: 3 }),
  /历史提示/,
  '未压缩时不加噪声提示',
)
assert.match(
  buildExpertSystem(characterExpert, { projectName: 'p', epNo: 3 }, { historyCompacted: true }),
  /历史提示[\s\S]*重新读取/,
  '压缩后应指示重取',
)

const storyboardExpert: CreativeExpert = {
  id: 'expert-storyboard',
  name: '分镜教练',
  description: '',
  soul: 'coach',
  skillIds: [],
  toolIds: ['read_shots', 'submit_shots'],
  source: 'builtin',
}

assert.equal(creativeWorkspaceNeedsShotEpisode(storyboardExpert), true)

assert.doesNotMatch(formatCreativeWorkspaceContext({}), /项目：demo/)

// ---- 诊断文本必须说清「送了多少、卸载几条、摘要几轮」
{
  const plain = describePiThreadMemory([], '草稿')
  assert.match(plain, /全文按原文送入模型/)

  const compacted = describePiThreadMemory([], '草稿', {
    stubbed: 7,
    summarized: 3,
    charsBefore: 91_000,
    charsAfter: 40_500,
  })
  assert.match(compacted, /40500/, '应报告本轮送入字符数')
  assert.match(compacted, /91000/, '应报告压缩前字符数')
  assert.match(compacted, /卸载工具结果 7 条/, '应报告指针化条数')
  assert.match(compacted, /摘要 3 轮/, '应报告摘要轮数')

  const unchanged = describePiThreadMemory([], '草稿', {
    stubbed: 0,
    summarized: 0,
    charsBefore: 40_500,
    charsAfter: 40_500,
  })
  assert.doesNotMatch(unchanged, /原始/, '未压缩时不重复播报原始体积')
}

// ---- 载荷把同一份统计带给检查器，并让 system 与压缩状态对齐
{
  const bigHistory = [
    { id: 'u1', role: 'user' as const, parts: [{ type: 'text' as const, text: '先读镜头' }] },
  ]
  for (let i = 0; i < 6; i++) {
    bigHistory.push({
      id: `a${i}`,
      role: 'assistant' as const,
      parts: [
        { type: 'text' as const, text: `第 ${i} 轮` },
        {
          type: 'tool-call' as const,
          toolCallId: `c${i}`,
          toolName: 'read_shots',
          status: 'done' as const,
          args: {},
          result: { shots: 'x'.repeat(9000) },
        },
      ],
    })
  }
  const payload = buildCreativeTurnPayload({
    host: null,
    messages: bigHistory as never,
    draftText: '继续',
  })
  assert.equal(payload.historyBudget.compacted, true, '超预算必须标记为已压缩')
  assert.ok(payload.historyBudget.stubbed > 0, '早期工具结果应被卸载')
  assert.doesNotMatch(payload.system, /可不再重复读取/, '压缩后 system 不得承诺省读')
  assert.match(payload.piMemoryPreview, /卸载工具结果 \d+ 条/)
  assert.match(payload.piMemoryPreview, /摘要 \d+ 轮/)
}

console.log('creative-workspace-context: ok')