/**
 * 分镜写回字段策略验收。
 *
 * 两条硬约束：
 * 1) `import`（文件导入）行为逐字不变——只写原来那 10 个标量字段；
 * 2) `agent`（模型写回）能改选角/表演/参考连线/转场，但绝不许写产线产物。
 */
import assert from 'node:assert/strict'
import {
  SHOT_AGENT_EXTRA_FIELDS,
  SHOT_FIELD_POLICY,
  SHOT_IMPORT_FIELDS,
  SHOT_PIPELINE_FIELDS,
  mergeShotsDraft,
} from '../src/shotSync'
import type { ProjectShot } from '../src/api'
import { isLegacyHardCut } from '../src/transition'

let bad = 0
function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`✅ ${name}`)
    })
    .catch((e) => {
      bad++
      console.log(`❌ ${name}\n   ${(e as Error).message}`)
    })
}

const OLD = {
  id: 'E01-S01',
  episode: 1,
  no: 'S01',
  seconds: 3,
  size: '中景',
  move: '固定',
  desc: '旧描述',
  dialogue: '旧台词',
  keyframe_prompt: '旧首帧提示词',
  video_prompt: '旧视频提示词',
  cast: ['旧角色'],
  performance: [{ character: '旧角色', note: '旧表演' }],
  dialogue_delivery: [{ line: 0, emotion: '平静' }],
  refIds: ['ref-old'],
  refExtras: ['/old.png'],
  transition_out: { kind: 'cut' },
  prod_kind: 'image',
  motion_note: '旧运动说明',
  video_prompt_override: { text: '旧手改', fingerprint: 'fp-old', createdAt: 't' },
  video_prompt_rendered: '旧渲染正文',
  keyframe: '/generated/old.jpg',
  clip: '/videos/old.mp4',
  audio_ref: { character: '旧角色', url: '/voices/old.mp3' },
  audio_meta: { fingerprint: 'fp-audio', createdAt: 't' },
  voice_meta: { fingerprint: 'fp-voice' },
  lip_sync: { mode: 'auto' },
  video_meta: { fingerprint: 'fp-video' },
  candidates: ['/generated/old-2.jpg'],
  genState: { phase: 'done' },
} as unknown as ProjectShot

/** 模型交来的「全字段」载荷：用来验证禁写集合真的被挡住 */
const INCOMING = {
  id: 'E01-S01',
  episode: 1,
  no: 'S01',
  seconds: 5,
  size: '近景',
  move: '推',
  desc: '新描述',
  dialogue: '新台词',
  keyframe_prompt: '新首帧提示词',
  video_prompt: '新视频提示词',
  cast: ['阿岚', '老周'],
  performance: [{ character: '阿岚', note: '压低声线' }],
  dialogue_delivery: [{ line: 0, emotion: '克制' }],
  refIds: ['ref-new'],
  refExtras: ['/new.png'],
  // 当前模型：转场是 mode:'effect' + effect 对象。`kind` 是已退役的旧字段（见 types.ts 的
  // TransitionOut），所以这里的载荷必须用现在的形状，否则连 normalizeTransitionOut 都过不了。
  transition_out: {
    to: 'E01-S02',
    mode: 'effect',
    effect: { type: 'dissolve', seconds: 0.5, presetId: 'dissolve' },
  },
  prod_kind: 'video',
  motion_note: '横移跟拍',
  video_prompt_override: { text: '新手改', fingerprint: 'fp-new', createdAt: 't2' },
  video_prompt_rendered: '新渲染正文',
  keyframe: '/generated/new.jpg',
  clip: '/videos/new.mp4',
  audio_ref: { character: '阿岚', url: '/voices/new.mp3' },
  audio_meta: { fingerprint: 'fp-audio-new', createdAt: 't2' },
  voice_meta: { fingerprint: 'fp-voice-new' },
  lip_sync: { mode: 'manual' },
  video_meta: { fingerprint: 'fp-video-new' },
  candidates: ['/generated/new-2.jpg'],
  genState: { phase: 'queued' },
} as unknown as ProjectShot

function run(policy: 'import' | 'agent') {
  const r = mergeShotsDraft([OLD], [INCOMING], 1, 'merge', policy)
  assert.equal(r.shots.length, 1)
  return r.shots[0] as unknown as Record<string, unknown>
}

async function main() {
  await check('默认策略仍是 import（不传参数与显式传 import 等价）', () => {
    const auto = mergeShotsDraft([OLD], [INCOMING], 1, 'merge').shots[0] as unknown as Record<string, unknown>
    assert.deepEqual(auto, run('import'))
  })

  // 表格导入带来了选角/表演/台词表演/参考连线：这四项与标量同属「文件说了就算」，
  // 剩下的 agent 专属字段（refExtras / 转场 / 工位 / 手改提示词）仍不该被导入碰。
  const IMPORT_WRITABLE = new Set(['cast', 'performance', 'dialogue_delivery', 'refIds'])

  await check('import 策略写标量字段与表格带来的四个字段', () => {
    const s = run('import')
    for (const k of ['seconds', 'size', 'move', 'desc', 'dialogue', 'keyframe_prompt', 'video_prompt']) {
      assert.notEqual(s[k], (OLD as unknown as Record<string, unknown>)[k], `${k} 应被写入`)
    }
    assert.deepEqual(s.cast, ['阿岚', '老周'])
    assert.deepEqual(s.performance, [{ character: '阿岚', note: '压低声线' }])
    assert.deepEqual(s.dialogue_delivery, [{ line: 0, emotion: '克制' }])
    // 参考连线是增补语义：文件里的新连线追加，既有连线保留（旧项不因文件没提而断开）
    assert.deepEqual(s.refIds, ['ref-old', 'ref-new'])
  })

  await check('import 策略不碰 agent 专属字段', () => {
    const s = run('import')
    for (const k of SHOT_AGENT_EXTRA_FIELDS) {
      if (k === 'handEdited' || IMPORT_WRITABLE.has(k)) continue
      assert.deepEqual(
        s[k],
        (OLD as unknown as Record<string, unknown>)[k],
        `import 策略不该改 ${String(k)}`,
      )
    }
  })

  await check('agent 策略可写选角、表演、参考连线、转场、生成方式', () => {
    const s = run('agent')
    assert.deepEqual(s.cast, ['阿岚', '老周'])
    assert.deepEqual(s.performance, [{ character: '阿岚', note: '压低声线' }])
    assert.deepEqual(s.dialogue_delivery, [{ line: 0, emotion: '克制' }])
    // 参考连线是增补语义：文件里的新连线追加，既有连线保留（旧项不因文件没提而断开）
    assert.deepEqual(s.refIds, ['ref-new'])
    assert.deepEqual(s.refExtras, ['/new.png'])
    // 转场按当前模型归一：mode 恒为 effect，effect 完整保留（presetId/type/seconds）
    assert.deepEqual(s.transition_out, {
      to: 'E01-S02',
      mode: 'effect',
      effect: { type: 'dissolve', seconds: 0.5, presetId: 'dissolve' },
    })
    assert.equal(s.prod_kind, 'video')
    assert.equal(s.motion_note, '横移跟拍')
  })

  await check('agent 策略不得经 submit_shots 改写提示词字段', () => {
    const s = run('agent')
    const old = OLD as unknown as Record<string, unknown>
    for (const k of ['keyframe_prompt', 'video_prompt', 'video_prompt_override', 'video_prompt_rendered']) {
      assert.deepEqual(s[k], old[k], `agent 不应写 ${k}`)
    }
  })

  await check('agent 策略禁写产线产物：载荷里给了也不许改', () => {
    const s = run('agent')
    const old = OLD as unknown as Record<string, unknown>
    for (const k of SHOT_PIPELINE_FIELDS) {
      assert.deepEqual(s[k], old[k], `产线字段 ${String(k)} 被写坏了`)
    }
  })

  await check('agent 策略下未提交的字段不被清空', () => {
    const partial = { id: 'E01-S01', no: 'S01', desc: '只改描述' } as unknown as ProjectShot
    const r = mergeShotsDraft([OLD], [partial], 1, 'merge', 'agent')
    const s = r.shots[0] as unknown as Record<string, unknown>
    assert.equal(s.desc, '只改描述')
    assert.equal(s.seconds, OLD.seconds)
    assert.deepEqual(s.cast, OLD.cast)
    assert.deepEqual(s.performance, OLD.performance)
    assert.equal(s.keyframe, OLD.keyframe)
    assert.equal(s.keyframe_prompt, OLD.keyframe_prompt)
  })

  await check('handEdited 保护在 agent 策略下仍生效', () => {
    const locked = { ...OLD, handEdited: ['seconds'] } as unknown as ProjectShot
    const r = mergeShotsDraft([locked], [{ id: 'E01-S01', no: 'S01', seconds: 9 } as ProjectShot], 1, 'merge', 'agent')
    const s = r.shots[0] as unknown as Record<string, unknown>
    assert.equal(s.seconds, OLD.seconds, '人改过的时长必须保留')
    assert.deepEqual(s.handEdited, ['seconds'])
  })

  await check('策略表是唯一真相：agent = import（无提示词）+ 扩展（无提示词），且不含任何产物字段', () => {
    const pipeline = new Set<string>(SHOT_PIPELINE_FIELDS)
    const promptOnly = new Set(['keyframe_prompt', 'video_prompt', 'video_prompt_override', 'video_prompt_rendered'])
    for (const k of SHOT_FIELD_POLICY.agent) {
      assert.ok(!pipeline.has(String(k)), `agent 策略不该包含产线字段 ${String(k)}`)
      assert.ok(!promptOnly.has(String(k)), `agent 策略不该包含提示词字段 ${String(k)}`)
    }
    for (const k of SHOT_IMPORT_FIELDS) {
      if (promptOnly.has(String(k))) continue
      assert.ok(SHOT_FIELD_POLICY.agent.includes(k), `agent 策略应包含 import 字段 ${String(k)}`)
      assert.ok(!pipeline.has(String(k)), `import 策略不该包含产线字段 ${String(k)}`)
    }
    const agentPromptSkipped =
      SHOT_IMPORT_FIELDS.filter((k) => promptOnly.has(String(k))).length +
      SHOT_AGENT_EXTRA_FIELDS.filter((k) => promptOnly.has(String(k))).length
    assert.equal(
      SHOT_FIELD_POLICY.agent.length,
      SHOT_IMPORT_FIELDS.length + SHOT_AGENT_EXTRA_FIELDS.length - agentPromptSkipped,
    )
  })

  await check('agent 策略不含 video_prompt：正文只能经 submit_prompts 写', () => {
    assert.ok(
      !(SHOT_FIELD_POLICY.agent as readonly string[]).includes('video_prompt'),
      'agent 策略不该直接写 video_prompt，必须走 prompts-v1',
    )
    assert.ok(
      (SHOT_IMPORT_FIELDS as readonly string[]).includes('video_prompt'),
      'video_prompt 必须仍可经文件导入写回',
    )
  })

  await check('handEdited 含 video_prompt 时合并保留人工正文', () => {
    const locked = {
      ...OLD,
      video_prompt: '人工写的出片正文',
      handEdited: ['video_prompt'],
    } as unknown as ProjectShot
    const incoming = {
      id: 'E01-S01',
      no: 'S01',
      video_prompt: '模型重新生成的新正文',
    } as unknown as ProjectShot
    const r = mergeShotsDraft([locked], [incoming], 1, 'merge', 'agent')
    const s = r.shots[0] as unknown as Record<string, unknown>
    assert.equal(s.video_prompt, '人工写的出片正文', '手改锁必须回填人工正文')
    assert.deepEqual(s.handEdited, ['video_prompt'])
  })

  await check('不同集的镜头不受影响', () => {
    const other = { id: 'E02-S01', episode: 2, no: 'S01', desc: '别的集' } as ProjectShot
    const r = mergeShotsDraft([OLD, other], [INCOMING], 1, 'merge', 'agent')
    assert.equal(r.shots.length, 2)
    assert.equal((r.shots.find((s) => s.id === 'E02-S01') as ProjectShot).desc, '别的集')
  })

  /**
   * 升级前的转场是 `{kind:'cut'|'dissolve'}`，现在统一成 `{mode:'effect', effect}`，
   * 硬切用「没有转场」表达。老记录如果直接被 normalizeTransitionOut 吃掉，
   * `kind:'cut'` 会变成 0.5s 叠化 —— 等于替用户改了片子，且看不出来。
   */
  await check('legacy {kind:cut} 读入后是硬切，不是 0.5s 叠化', () => {
    assert.equal(isLegacyHardCut({ kind: 'cut' }), true)
    assert.equal(isLegacyHardCut({ kind: 'dissolve' }), false)
    assert.equal(isLegacyHardCut({}), false)
    assert.equal(isLegacyHardCut(null), false)

    // 写回路径：agent 交来 legacy 硬切，结果必须是「无转场」
    const legacyCut = { id: 'E01-S01', no: 'S01', transition_out: { kind: 'cut' } } as unknown as ProjectShot
    const r = mergeShotsDraft([OLD], [legacyCut], 1, 'merge', 'agent')
    const s = r.shots[0] as unknown as Record<string, unknown>
    assert.equal(s.transition_out, null, 'legacy 硬切应清空转场，而不是变成叠化')

    // 对照：非硬切的 legacy 值仍按当前模型归一
    const legacyDissolve = {
      id: 'E01-S01',
      no: 'S01',
      transition_out: { kind: 'dissolve' },
    } as unknown as ProjectShot
    const r2 = mergeShotsDraft([OLD], [legacyDissolve], 1, 'merge', 'agent')
    const s2 = r2.shots[0] as unknown as Record<string, unknown>
    assert.equal((s2.transition_out as Record<string, unknown>)?.mode, 'effect')
  })

  console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 分镜字段策略全部通过')
  process.exit(bad ? 1 : 0)
}

void main()
