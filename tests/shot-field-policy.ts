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
  transition_out: { kind: 'dissolve' },
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
    assert.deepEqual(s.transition_out, { kind: 'dissolve' })
    assert.equal(s.prod_kind, 'video')
    assert.equal(s.motion_note, '横移跟拍')
    assert.deepEqual(s.video_prompt_override, { text: '新手改', fingerprint: 'fp-new', createdAt: 't2' })
    assert.equal(s.video_prompt_rendered, '新渲染正文')
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

  await check('策略表是唯一真相：agent = import + 扩展，且不含任何产物字段', () => {
    const pipeline = new Set<string>(SHOT_PIPELINE_FIELDS)
    for (const k of SHOT_FIELD_POLICY.agent) {
      assert.ok(!pipeline.has(String(k)), `agent 策略不该包含产线字段 ${String(k)}`)
    }
    for (const k of SHOT_IMPORT_FIELDS) {
      assert.ok(SHOT_FIELD_POLICY.agent.includes(k), `agent 策略应包含 import 字段 ${String(k)}`)
      assert.ok(!pipeline.has(String(k)), `import 策略不该包含产线字段 ${String(k)}`)
    }
    assert.equal(SHOT_FIELD_POLICY.agent.length, SHOT_IMPORT_FIELDS.length + SHOT_AGENT_EXTRA_FIELDS.length)
  })

  await check('不同集的镜头不受影响', () => {
    const other = { id: 'E02-S01', episode: 2, no: 'S01', desc: '别的集' } as ProjectShot
    const r = mergeShotsDraft([OLD, other], [INCOMING], 1, 'merge', 'agent')
    assert.equal(r.shots.length, 2)
    assert.equal((r.shots.find((s) => s.id === 'E02-S01') as ProjectShot).desc, '别的集')
  })

  console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 分镜字段策略全部通过')
  process.exit(bad ? 1 : 0)
}

void main()
