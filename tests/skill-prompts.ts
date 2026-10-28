import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { SCENE_CODE_ABI } from '../src/sceneCodePrompt'
import { buildSceneJobSystem } from '../src/skills/sceneJob'
import {
  ASSET_BASE,
  ASSET_SYS,
  CHARACTER_BASE,
  CHARACTER_SYS,
  PROMPT_BASE,
  PROMPT_SYS,
  SCRIPT_BASE,
  SCRIPT_SYS,
  STORYBOARD_BASE,
  STORYBOARD_SYS,
} from '../src/skills/legacyPrompts'
import { validateContract } from '../src/skills/contracts'
import { parseSkillText } from '../src/skills/parse'
import { buildSkillPrompt } from '../src/skills/render'

const root = process.cwd()
const read = (id: string) => fs.readFileSync(path.join(root, 'skills', id, 'SKILL.md'), 'utf8')
const parse = (id: string) => parseSkillText(id, read(id), 'builtin')

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

const script = parse('script')
const character = parse('character')
const asset = parse('asset')
const shotlist = parse('shotlist')
const prompt = parse('prompt')
const scene3d = parse('scene3d')
const sceneCode = parse('scene-code')
const sceneCodeChat = parse('scene-code-chat')

check('script 角色层逐字等于旧 SCRIPT_SYS', () => assert.equal(script.role, SCRIPT_SYS))
check('character 角色层逐字等于旧 CHARACTER_SYS', () => assert.equal(character.role, CHARACTER_SYS))
check('asset 角色层逐字等于旧 ASSET_SYS', () => assert.equal(asset.role, ASSET_SYS))
check('shotlist 角色层逐字等于旧 STORYBOARD_SYS', () => assert.equal(shotlist.role, STORYBOARD_SYS))
check('prompt 角色层逐字等于旧 PROMPT_SYS', () => assert.equal(prompt.role, PROMPT_SYS))
check('script BASE 未被拆开', () => assert.ok(SCRIPT_BASE.length > 0 && script.role.startsWith(SCRIPT_BASE)))
check('character BASE 未被拆开', () => assert.ok(CHARACTER_BASE.length > 0 && character.role.startsWith(CHARACTER_BASE)))
check('asset BASE 未被拆开', () => assert.ok(ASSET_BASE.length > 0 && asset.role.startsWith(ASSET_BASE)))
check('shotlist BASE 未被拆开', () => assert.ok(STORYBOARD_BASE.length > 0 && shotlist.role.startsWith(STORYBOARD_BASE)))
check('prompt BASE 未被拆开', () => assert.ok(PROMPT_BASE.length > 0 && prompt.role.startsWith(PROMPT_BASE)))

const rendered = (skill: ReturnType<typeof parse>, inputs: Record<string, unknown>) =>
  buildSkillPrompt(skill, inputs, 'inline').task

check('script 任务模板逐字等于旧 inline prompt', () => {
  const expected =
    `原著：\nSRC\n\n要求：拆 3 集，每集目标时长约 75 秒。\n画风：科幻写实`
  assert.equal(
    rendered(script, { source: 'SRC', epCount: 3, targetSeconds: 75, style: '科幻写实' }),
    expected,
  )
})

check('character 任务模板逐字等于旧 inline prompt', () => {
  const expected =
    `以下是第 1 集的剧本场次与分镜。\n\nSCENE\n\n【本集分镜出场与台词】\nSHOT\n\n` +
    `要求：找出所有需要出镜的具名角色（含只在台词里出现的说话人）。跑龙套同样并入具体角色，不要单列「路人」；每个角色给出可直接生图的外观锚点。`
  assert.equal(
    rendered(character, {
      scopeLabel: '第 1 集的剧本场次与分镜',
      sceneText: 'SCENE',
      shotBlock: '\n\n【本集分镜出场与台词】\nSHOT',
    }),
    expected,
  )
})

check('character 无分镜时不产生多余空行', () => {
  const expected =
    `以下是全剧的原文梗概与分集场次。\n\nSCENE\n\n` +
    `要求：找出所有需要出镜的具名角色（含只在台词里出现的说话人）。跑龙套同样并入具体角色，不要单列「路人」；每个角色给出可直接生图的外观锚点。`
  assert.equal(
    rendered(character, {
      scopeLabel: '全剧的原文梗概与分集场次',
      sceneText: 'SCENE',
      shotBlock: '',
    }),
    expected,
  )
})

check('asset 任务模板逐字等于旧 inline prompt', () => {
  const expected =
    `以下是第 1 集的剧本场次与分镜。\n\nSCENE\n\n【镜头摘要】\nSHOT\n\n` +
    `要求：按场景 scenes、道具 props 两类输出；同一地点/同一道具合并成一条，refs 列出所有出现过的镜号；只拆可复用的空间和剧情关键道具。`
  assert.equal(
    rendered(asset, {
      scopeLabel: '第 1 集的剧本场次与分镜',
      sceneText: 'SCENE',
      shotBlock: '\n\n【镜头摘要】\nSHOT',
    }),
    expected,
  )
})

check('shotlist 任务模板保持稳定', () => {
  const expected =
    `画风：S\n画幅：16:9\n\nBRIEF\n\n` +
    `目标总时长 60 秒。相邻镜头景别要有变化。\n` +
    `每镜必须带 scene_no（输入场次号）和 scene_slug（场次简称），同一场的镜头用同一个编号。\n` +
    `另外每镜补一个 cast 字段：该镜画面内真正出现的角色名数组。\n` +
    `只在台词/描述里被提到、实际在画外的角色不要写进去。\n` +
    `再补 performance：有台词的角色必须有条目；写看得见的表情/动作/视线，不写心理活动。不要给没有入画的角色编表演。`
  assert.equal(rendered(shotlist, { style: 'S', aspect: '16:9', brief: 'BRIEF', target: 60 }), expected)
})

check('prompt 任务模板保持稳定', () => {
  const expected =
    `画风锁：S\n\n角色外观锚点：\nBIBLE\n\n` +
    `分镜（每镜包含 cast、performance、dialogue 与逐行 delivery）：\n[{"no":"S01"}]\n\n` +
    `输出要求：\n` +
    `1. 每一镜都要给 keyframe_prompt 与 video_prompt，no 必须与输入一致\n` +
    `2. keyframe_prompt 里凡出现角色，一律用 {{角色名}} 占位代替整段 look_en（例如 {{陈默}}），由我在保存前原样替换回原文 —— 不要自己展开那整段描述\n` +
    `3. 只使用本镜 cast 里的角色；不要给没有入画的角色加动作或情绪\n` +
    `4. 有 performance 时逐角色写可见表演，多人镜头分别写，不合并成一句“所有人”\n` +
    `5. 没有 performance 时按 desc 与台词写，不自行发明情绪\n` +
    `6. 只输出 JSON`
  assert.equal(rendered(prompt, { style: 'S', bible: 'BIBLE', briefJson: '[{"no":"S01"}]' }), expected)
})

check('prompt 里的 {{角色名}} 不被当成占位符', () => {
  const out = rendered(prompt, { style: 'S', bible: 'BIBLE', briefJson: '[]' })
  assert.ok(out.includes('{{角色名}}') && out.includes('{{陈默}}'))
})

check('scene3d 任务模板承载验收要求', () => {
  assert.equal(rendered(scene3d, { requirements: '\n验收要求：\n1. A' }), '\n验收要求：\n1. A')
})

check('scene3d 锁定契约包含完整 ABI', () => {
  const p = buildSkillPrompt(scene3d, { requirements: '' }, 'inline')
  assert.ok(p.system.includes(SCENE_CODE_ABI))
  assert.ok(p.system.includes('def build(ctx)'))
})

check('scene3d 角色层可编辑但 ABI 保持锁定', () => {
  const edited = { ...scene3d, role: '自定义 3D 角色层' }
  const p = buildSkillPrompt(edited, { requirements: '\n验收要求：\n1. A' }, 'inline')
  assert.ok(p.system.includes('自定义 3D 角色层'))
  assert.ok(p.system.includes(SCENE_CODE_ABI))
  assert.equal(p.task, '\n验收要求：\n1. A')
})

check('一次性代码生成 system 含技能角色与锁定 ABI', () => {
  const system = buildSceneJobSystem(sceneCode)
  assert.ok(system.includes(sceneCode.role))
  assert.ok(system.includes(SCENE_CODE_ABI))
})

check('代码改写 system 含技能角色与锁定 ABI', () => {
  const system = buildSceneJobSystem(sceneCodeChat)
  assert.ok(system.includes(sceneCodeChat.role))
  assert.ok(system.includes(SCENE_CODE_ABI))
})

check('代码技能正文不含 ABI（只在锁定契约里）', () => {
  for (const skill of [sceneCode, sceneCodeChat]) {
    assert.ok(!skill.role.includes(SCENE_CODE_ABI))
    assert.ok(!skill.task.includes(SCENE_CODE_ABI))
    assert.equal(skill.manifest.contracts[0], 'scene3d-code-v1')
  }
})

check('chat 模式大输入只留引用', () => {
  const p = buildSkillPrompt(script, {
    source: 'x'.repeat(3000),
    epCount: 3,
    targetSeconds: 75,
    style: 'S',
  }, 'chat', 2000)
  assert.ok(p.task.includes('读工具'))
  assert.ok(p.task.includes('3000'))
  assert.deepEqual(p.references, [{ key: 'source', chars: 3000 }])
})

check('缺输入被标记', () => {
  const p = buildSkillPrompt(script, { source: 'S', epCount: 3, style: 'S' }, 'inline')
  assert.deepEqual(p.missing, ['targetSeconds'])
})

check('契约校验：合法剧本', () => {
  const r = validateContract('script-v1', {
    logline: 'L',
    episodes: [{ no: 1, title: 'T', hook: 'H', scenes: [{ no: 1, slug: 'S', characters: ['A'] }] }],
  })
  assert.equal(r.ok, true)
})

check('契约校验：缺 episodes 拒绝', () => {
  const r = validateContract('script-v1', { logline: 'L' })
  assert.equal(r.ok, false)
})

// 空结果不是契约违规：内容里确实没有可拆的素材时，模型返回空列表是对的。
// 原实现要求「至少一项」，导致调用方写好的「没给出场景或道具，换个范围再试」
// 永远走不到，用户只能看到「模型输出不符合技能契约」这种无法行动的报错。
check('契约校验：空素材是合法结果', () => {
  const r = validateContract('designs-v1', { scenes: [], props: [] })
  assert.equal(r.ok, true)
})

check('契约校验：形状不对仍拒绝（缺 name）', () => {
  const r = validateContract('designs-v1', { scenes: [{ prompt_en: 'x' }], props: [] })
  assert.equal(r.ok, false)
})

check('契约校验：提示词缺 video_prompt 拒绝', () => {
  const r = validateContract('prompts-v1', { shots: [{ no: 'S01', keyframe_prompt: 'K' }] })
  assert.equal(r.ok, false)
})

check('契约校验：空角色列表是合法结果', () => {
  const r = validateContract('characters-v1', { characters: [] })
  assert.equal(r.ok, true)
})

check('契约校验：角色顶层数组也接受', () => {
  const r = validateContract('characters-v1', [{ name: '陈默', look_en: 'x' }])
  assert.equal(r.ok, true)
})

check('契约校验：合法角色', () => {
  const r = validateContract('characters-v1', {
    characters: [{ name: '陈默', role: '主角', look_cn: '...', look_en: '...' }],
  })
  assert.equal(r.ok, true)
})

check('契约校验：合法场景/道具', () => {
  const r = validateContract('designs-v1', { scenes: [{ name: '井道' }], props: [] })
  assert.equal(r.ok, true)
})

check('契约校验：合法镜头表', () => {
  const r = validateContract('shots-v1', {
    shots: [{ no: 'S01', scene_no: 1, seconds: 3, size: '中景', move: '固定', desc: '...' }],
  })
  assert.equal(r.ok, true)
})

check('契约校验：合法提示词', () => {
  const r = validateContract('prompts-v1', {
    shots: [{ no: 'S01', keyframe_prompt: 'K', video_prompt: 'V' }],
  })
  assert.equal(r.ok, true)
})

check('契约校验：合法 3D 代码', () => {
  const r = validateContract('scene3d-code-v1', { reply: 'R', code: 'def build(ctx):\n  pass' })
  assert.equal(r.ok, true)
})

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
