/**
 * 创意会话等价验收（不调用大模型）：
 * 1) Agent 用 read_shot_video_inputs 拿到参考槽位顺序
 * 2) 按槽位写出带 [图N] 映射的正文
 * 3) submit_prompts 落库
 * 4) 从落库后的镜头重建出片请求，正文必须与写出的正文逐字一致
 *
 * 跑法：npx tsx tests/shot-video-inputs-session.ts
 */
import assert from 'node:assert/strict'
import { createStageToolSet } from '../src/agent/stageTools'
import type { WorkbenchChatAdapter } from '../src/agent/workbenchChat'
import type { ProjectData } from '../src/api'
import { buildShotNodes } from '../src/canvasShots'
import { readCharacters } from '../src/charMap'
import { buildShotVideoRequest } from '../src/videoPrompt'

let bad = 0
function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`✅ ${name}`))
    .catch((e) => {
      bad++
      console.log(`❌ ${name}\n   ${(e as Error).message}`)
    })
}

type Shot = Record<string, unknown>

const originalShot: Shot = {
  id: 'E01-S01',
  episode: 1,
  no: 'S01',
  seconds: 3,
  size: '中景',
  move: '推',
  keyframe_prompt: '雨夜街口，陈默与林小满对视',
  video_prompt: '',
  cast: ['陈默', '林小满'],
  dialogue: [{ speaker: '陈默', text: '你来了。' }],
  performance: [{ character: '陈默', emotion: 'calm', intensity: 3, action: '抬头', speaks: true }],
  refIds: ['char-陈默', 'char-林小满'],
  refExtras: ['/generated/prop.jpg'],
}

let shots: Shot[] = [originalShot]

const project = {
  name: 'session-test',
  style: '赛博',
  aspect: '16:9',
  episodes: [{ no: 1, title: '第 1 集' }],
  shots,
  characters: [
    { name: '陈默', image: '/generated/chen.png', look_cn: '黑色风衣' },
    { name: '林小满', image: '/generated/lin.png', look_cn: '白裙' },
  ],
  designs: [],
} as unknown as ProjectData

/** 宿主写回：按镜号把正文合并进项目镜头（与工作台 applyDraft 行为等价） */
function applyPrompts(payload: unknown): { ok: boolean; summary: string } {
  const list = (payload as { shots?: { no: string; keyframe_prompt?: string; video_prompt: string }[] }).shots ?? []
  shots = shots.map((s) => {
    const hit = list.find((x) => String(x.no) === String(s.no))
    if (!hit) return s
    return {
      ...s,
      ...(hit.keyframe_prompt ? { keyframe_prompt: hit.keyframe_prompt } : {}),
      video_prompt: hit.video_prompt,
    }
  })
  ;(project as unknown as { shots: Shot[] }).shots = shots
  return { ok: true, summary: `已写回 ${list.length} 镜正文` }
}

const adapter: WorkbenchChatAdapter = {
  surface: 'shots',
  skillId: 'shotlist',
  stage: 'shot',
  artifact: 'shots',
  writeTool: 'submit_prompts',
  writeContract: 'prompts-v1',
  threadKey: { project: 'session-test', surface: 'shots', episode: 1 },
  inputs: () => ({ style: '赛博', aspect: '16:9', brief: '', target: 60 }),
  ownDraft: () => shots,
  projectSnapshot: async () => project,
  applyDraft: (payload) => applyPrompts(payload),
}

/** 从落库后的项目重建出片请求：与画布出片走同一个入口 */
function requestFromProject(no: string) {
  const nodes = buildShotNodes([], (project.shots ?? []) as never)
  const node = nodes.find((n) => String(n.data?.no ?? '') === no)!
  assert.ok(node, `镜头 ${no} 应能重建为画布节点`)
  return buildShotVideoRequest({
    data: node.data,
    nodeId: node.id,
    nodes,
    characters: readCharacters(project.characters),
    missingMedia: new Set<string>(),
  })
}

async function main() {
  const set = createStageToolSet(adapter)
  const readInputs = set.byName.get('read_shot_video_inputs')!
  const submit = set.byName.get('submit_prompts')!
  assert.ok(readInputs, 'read_shot_video_inputs 必须注册')
  assert.ok(submit, 'submit_prompts 必须注册')

  let composed = ''

  await check('① 空正文时工具明确提示补写', async () => {
    const res = (await readInputs.invoke({ no: 'S01', episode: 1 })) as {
      promptEmpty: boolean
      blocking: { code: string }[]
    }
    assert.equal(res.promptEmpty, true)
    assert.ok(res.blocking.some((b) => b.code === 'shot-prompt-empty'))
  })

  await check('② Agent 按工具返回的槽位顺序组织正文', async () => {
    const res = (await readInputs.invoke({ shotId: 'E01-S01' })) as {
      refs: { index: number; label: string; purpose: string }[]
      mode: string
    }
    assert.equal(res.mode, 'ref')
    assert.deepEqual(res.refs.map((r) => r.index), [1, 2, 3])
    // 正文完全由工具返回的槽位映射生成：不凭 refIds 猜顺序
    const mapping = res.refs.map((r) => `[图${r.index}]=${r.label}`).join('；')
    composed = `${mapping}。雨夜街口，镜头缓慢推近，陈默抬头说话，雨丝斜切画面。`
    assert.ok(composed.includes('[图1]=角色「陈默」外观'))
    assert.ok(composed.includes('[图2]=角色「林小满」外观'))
    assert.ok(composed.includes('[图3]=手工参考图'))
  })

  await check('③ submit_prompts 落库后镜头正文逐字保留', async () => {
    const res = (await submit.invoke({
      reply: '已按参考顺序写好出片正文',
      shots: [{ no: 'S01', keyframe_prompt: '雨夜街口，陈默与林小满对视', video_prompt: composed }],
    })) as { ok: boolean }
    assert.equal(res.ok, true)
    const saved = shots.find((s) => String(s.no) === 'S01')!
    assert.equal(saved.video_prompt, composed, '正文必须逐字落库')
  })

  await check('④ 出片请求正文与写出的正文逐字一致，且不含任何指令段', () => {
    const req = requestFromProject('S01')
    assert.equal(req.prompt, composed)
    assert.equal(req.textSource, 'video_prompt')
    for (const mark of ['【运镜】', '【台词】', '【表演方向】', '声音：', '参考图：', '@视频1', '【约束】']) {
      assert.ok(!req.prompt.includes(mark), `正文不应含 ${mark}`)
    }
    assert.equal(req.blocking.length, 0, JSON.stringify(req.blocking))
    assert.deepEqual(req.refs.map((r) => r.index), [1, 2, 3], '提交槽位与工具报告一致')
  })

  await check('⑤ read_shot_video_prompt 回读也是同一段正文', async () => {
    const res = (await set.byName.get('read_shot_video_prompt')!.invoke({ no: 'S01', episode: 1 })) as {
      text: string | null
      source: string
    }
    assert.equal(res.source, 'video_prompt')
    assert.equal(res.text, composed)
  })

  console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
  process.exit(bad ? 1 : 0)
}

void main()
