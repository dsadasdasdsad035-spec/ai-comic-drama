import assert from 'node:assert/strict'
import { createTransitionRefTools } from '../src/agent/transitionRefTools'
import { createStageToolSet } from '../src/agent/stageTools'
import type { WorkbenchChatAdapter } from '../src/agent/workbenchChat'
import { nativeAudioFingerprint } from '../src/nativeAudio'
import { parseDialogue } from '../src/prompts'
import type { ProjectData, ProjectShot } from '../src/api'
import type { VideoModelInput } from '../src/videoPrompt'

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

function makeShots(generated: Record<string, unknown> = {}): Shot[] {
  return [
    {
      id: 'E01-S01',
      episode: 1,
      no: 'S01',
      seconds: 3,
      dialogue: '陈默：走这边。',
      refExtras: ['/generated/extra-a.jpg'],
      transition_out: {
        to: 'E01-S02',
        mode: 'generated',
        generated: { targetSeconds: 2, prompt: '桥接正文', ...generated },
      },
    },
    { id: 'E01-S02', episode: 1, no: 'S02', seconds: 3 },
  ]
}

const NATIVE_MODEL: VideoModelInput = {
  label: 'Seedance 2.5 原生声音',
  model: 'seedance-2.5',
  providerKind: 'apimart',
  features: { lastFrame: true, textToVideo: true, audioOut: true },
}

type Harness = {
  tools: ReturnType<typeof createTransitionRefTools>
  project: ProjectData
  shot: () => Shot
  writes: number
  marks: { afterShotId: string; toShotId: string; tokens: string[] }[]
  setModel: (m: VideoModelInput | null) => void
}

function harness(opts: {
  shots?: Shot[]
  characters?: unknown[]
  assets?: unknown[]
  model?: VideoModelInput | null
} = {}): Harness {
  const shots = (opts.shots ?? makeShots()) as unknown as ProjectShot[]
  const project: ProjectData = {
    source: '原著',
    episodes: [{ no: 1, title: '第一集' }],
    shots,
    characters: (opts.characters ?? [
      {
        name: '陈默',
        image: '/generated/chen.png',
        voiceSample: { url: '/generated/chen.wav', text: '样本', seconds: 6, engine: 'e', voiceId: 'v', fingerprint: 'f' },
      },
      { name: '林小满', image: '/generated/lin.png' },
    ]) as never,
    ...(opts.assets ? { assets: opts.assets } : {}),
  } as unknown as ProjectData
  let model: VideoModelInput | null = opts.model ?? null
  const h: Harness = {
    tools: [] as never,
    project,
    writes: 0,
    marks: [],
    shot: () => (project.shots as unknown as Shot[])[0],
    setModel: (m) => {
      model = m
    },
  }
  h.tools = createTransitionRefTools({
    projectName: () => 'demo',
    epNo: () => 1,
    load: async () => project,
    setSnapshot: () => {},
    writeShot: async (_p, next) => {
      h.writes++
      project.shots = (project.shots || []).map((s) => (s.id === next.id ? next : s))
      return { ok: true }
    },
    getSelectedVideoModel: () => model,
    onRefsWritten: (info) => h.marks.push(info),
  })
  return h
}

function tool(h: Harness, name: string) {
  return h.tools.find((t) => t.name === name)!
}

const refIds = (h: Harness) =>
  ((h.shot().transition_out as Record<string, unknown>).generated as Record<string, unknown>).refIds as
    | string[]
    | undefined

async function main() {
  // ---- 2.1 add / 幂等 / remove ----
  await check('按角色名添加参考，写回 refIds 并返回有序 [图N]', async () => {
    const h = harness()
    const res = (await tool(h, 'attach_transition_refs').invoke({
      after_no: 'S01',
      kind: 'character',
      names: ['林小满'],
    })) as { ok: boolean; refs: { index: number; label: string; source: string }[] }
    assert.equal(res.ok, true)
    assert.deepEqual(refIds(h), ['char-林小满'])
    assert.equal(res.refs.length, 1)
    assert.equal(res.refs[0].index, 1)
    assert.equal(res.refs[0].source, 'character')
  })

  await check('重复 add 同一角色是幂等并集，不会重复写入', async () => {
    const h = harness()
    const t = tool(h, 'attach_transition_refs')
    await t.invoke({ after_no: 'S01', kind: 'character', names: ['林小满'] })
    await t.invoke({ after_no: 'S01', kind: 'character', names: ['林小满'] })
    assert.deepEqual(refIds(h), ['char-林小满'])
  })

  await check('remove 只移除目标项，其余顺序不变', async () => {
    const h = harness({ assets: [{ canvasId: 'cv-scene', url: '/generated/scene.png', title: '雨夜街口', kind: 'scene' }] })
    const t = tool(h, 'attach_transition_refs')
    await t.invoke({ after_no: 'S01', kind: 'character', names: ['林小满'] })
    await t.invoke({ after_no: 'S01', kind: 'asset', names: ['雨夜街口'] })
    await t.invoke({ after_no: 'S01', kind: 'url', names: ['/generated/extra-a.jpg'] })
    assert.equal(refIds(h)?.length, 3)
    const removed = (await t.invoke({
      after_no: 'S01',
      kind: 'asset',
      names: ['雨夜街口'],
      action: 'remove',
    })) as {
      ok: boolean
      removed: string[]
      refs: { index: number; label: string }[]
    }
    assert.equal(removed.ok, true)
    assert.deepEqual(removed.removed, ['asset-cv-scene'])
    assert.deepEqual(refIds(h), ['char-林小满', 'extra:/generated/extra-a.jpg'])
    assert.deepEqual(
      removed.refs.map((r) => r.index),
      [1, 2],
    )
  })

  await check('移除本来就不存在的项时报错且不改配置', async () => {
    const h = harness()
    const res = (await tool(h, 'attach_transition_refs').invoke({
      after_no: 'S01',
      kind: 'url',
      names: ['/generated/extra-a.jpg'],
      action: 'remove',
    })) as { ok: boolean }
    assert.equal(res.ok, false)
    assert.equal(refIds(h), undefined)
    assert.equal(h.writes, 0)
  })

  // ---- 2.2 失败路径 ----
  await check('角色名找不到时报错并列出候选，refIds 保持原值', async () => {
    const h = harness()
    const before = JSON.stringify(refIds(h))
    const res = (await tool(h, 'attach_transition_refs').invoke({
      after_no: 'S01',
      kind: 'character',
      names: ['不存在的人'],
    })) as { ok: boolean; error: string }
    assert.equal(res.ok, false)
    assert.match(res.error, /找不到角色/)
    assert.match(res.error, /陈默/, '错误里要给出可选角色')
    assert.equal(JSON.stringify(refIds(h)), before)
  })

  await check('同名角色歧义时不写入', async () => {
    const h = harness({
      characters: [
        { name: '阿明', image: '/generated/a1.png' },
        { name: '阿明', image: '/generated/a2.png' },
      ],
    })
    const res = (await tool(h, 'attach_transition_refs').invoke({
      after_no: 'S01',
      kind: 'character',
      names: ['阿明'],
    })) as { ok: boolean; error: string }
    assert.equal(res.ok, false)
    assert.match(res.error, /重名/)
    assert.equal(refIds(h), undefined)
  })

  await check('没有外观图的角色不能作为转场参考', async () => {
    const h = harness({ characters: [{ name: '路人甲' }] })
    const res = (await tool(h, 'attach_transition_refs').invoke({
      after_no: 'S01',
      kind: 'character',
      names: ['路人甲'],
    })) as { ok: boolean; error: string }
    assert.equal(res.ok, false)
    assert.match(res.error, /不能作为转场参考|外观/)
    assert.equal(refIds(h), undefined)
  })

  await check('候选池外的 URL 被拒绝并给出可执行指引', async () => {
    const h = harness()
    const res = (await tool(h, 'attach_transition_refs').invoke({
      after_no: 'S01',
      kind: 'url',
      names: ['https://example.com/nope.png'],
    })) as { ok: boolean; error: string }
    assert.equal(res.ok, false)
    assert.match(res.error, /不在转场候选池/)
    assert.match(res.error, /手工参考/)
    assert.equal(refIds(h), undefined)
  })

  await check('接缝不存在时报错', async () => {
    const h = harness()
    const res = (await tool(h, 'attach_transition_refs').invoke({
      after_no: 'S99',
      kind: 'character',
      names: ['林小满'],
    })) as { ok: boolean; error: string }
    assert.equal(res.ok, false)
    assert.match(res.error, /S99|找不到/)
  })

  await check('视频素材卡不能当转场参考图片', async () => {
    const h = harness({ assets: [{ canvasId: 'cv-vid', url: '/generated/motion.mp4', title: '推镜', kind: 'video' }] })
    const res = (await tool(h, 'attach_transition_refs').invoke({
      after_no: 'S01',
      kind: 'asset',
      names: ['推镜'],
    })) as { ok: boolean; error: string }
    assert.equal(res.ok, false)
    assert.match(res.error, /不能作为转场参考/)
    assert.match(res.error, /图片素材卡/)
  })

  // ---- 2.3 返回值与 handEdited ----
  await check('写入后不追加 handEdited，并按提交顺序编号', async () => {
    const h = harness({ assets: [{ canvasId: 'cv-scene', url: '/generated/scene.png', title: '雨夜街口', kind: 'scene' }] })
    const t = tool(h, 'attach_transition_refs')
    await t.invoke({ after_no: 'S01', kind: 'character', names: ['林小满'] })
    const res = (await t.invoke({ after_no: 'S01', kind: 'asset', names: ['雨夜街口'] })) as {
      refs: { index: number; label: string; source: string }[]
    }
    assert.deepEqual(
      res.refs.map((r) => r.index),
      [1, 2],
    )
    assert.equal(res.refs[1].source, 'asset')
    assert.equal(h.shot().handEdited, undefined, 'Agent 写参考不能把自己标成手改')
  })

  await check('单次超过 8 项时截断并给出 omitted 原因', async () => {
    const chars = Array.from({ length: 10 }, (_, i) => ({ name: `角色${i}`, image: `/generated/c${i}.png` }))
    const h = harness({ characters: chars })
    const res = (await tool(h, 'attach_transition_refs').invoke({
      after_no: 'S01',
      kind: 'character',
      names: chars.map((c) => c.name),
    })) as { ok: boolean; refs: unknown[]; omitted: { name: string; reason: string }[] }
    assert.equal(res.ok, true)
    assert.equal(refIds(h)?.length, 8)
    assert.equal(res.omitted.length, 2)
    assert.match(res.omitted[0].reason, /最多 8 项/)
  })

  await check('Agent 写入标记带上接缝与 token', async () => {
    const h = harness()
    await tool(h, 'attach_transition_refs').invoke({ after_no: 'S01', kind: 'character', names: ['林小满'] })
    assert.equal(h.marks.length, 1)
    assert.equal(h.marks[0].afterShotId, 'E01-S01')
    assert.equal(h.marks[0].toShotId, 'E01-S02')
    assert.deepEqual(h.marks[0].tokens, ['char-林小满'])
  })

  // ---- 3.1 / 3.2 原生音频 ----
  await check('开启原生音频：写回音色引用与元数据，指纹与出片一致', async () => {
    const h = harness({ model: NATIVE_MODEL })
    const res = (await tool(h, 'set_transition_audio').invoke({
      after_no: 'S01',
      mode: 'native',
      character: '陈默',
    })) as {
      ok: boolean
      audio: { mode: string; character?: string }
      requestSeconds: number
      trimTo?: number
    }
    assert.equal(res.ok, true)
    assert.equal(res.audio.mode, 'native')
    const g = (h.shot().transition_out as Record<string, unknown>).generated as Record<string, unknown>
    assert.equal(g.audioMode, 'native')
    assert.deepEqual(g.audioRef, { character: '陈默', url: '/generated/chen.wav', label: '陈默 音色' })
    const meta = g.audioMeta as { fingerprint: string; modelKey?: string }
    const expected = nativeAudioFingerprint({
      modelKey: 'seedance-2.5',
      audioRef: { character: '陈默', url: '/generated/chen.wav', label: '陈默 音色' },
      dialogue: parseDialogue('陈默：走这边。'),
    })
    assert.equal(meta.fingerprint, expected)
    assert.equal(meta.modelKey, 'seedance-2.5')
    assert.ok(res.requestSeconds >= 5, '原生音频请求须抬到最小视频秒数 + 1')
    assert.equal(res.trimTo, 2, '单首帧/无尾帧时仍按目标时长裁剪')
  })

  await check('角色没有音色样本时拒绝并指向角色卡，配置不变', async () => {
    const h = harness({ model: NATIVE_MODEL })
    const res = (await tool(h, 'set_transition_audio').invoke({
      after_no: 'S01',
      mode: 'native',
      character: '陈默',
    })) as { ok: boolean; error: string }
    // 陈默在默认角色表里有样本；换成没有样本的说话角色
    assert.equal(res.ok, true)
    const h2 = harness({
      model: NATIVE_MODEL,
      characters: [{ name: '陈默', image: '/generated/chen.png' }],
    })
    const res2 = (await tool(h2, 'set_transition_audio').invoke({
      after_no: 'S01',
      mode: 'native',
      character: '陈默',
    })) as { ok: boolean; error: string }
    assert.equal(res2.ok, false)
    assert.match(res2.error, /音色样本/)
    const g = (h2.shot().transition_out as Record<string, unknown>).generated as Record<string, unknown>
    assert.equal(g.audioMode, undefined)
  })

  await check('音色样本失效时拒绝并要求重生成', async () => {
    const h = harness({
      model: NATIVE_MODEL,
      characters: [
        {
          name: '陈默',
          image: '/generated/chen.png',
          voiceSample: { url: '/generated/chen.wav', text: '样本', seconds: 6, engine: 'e', voiceId: 'v', fingerprint: 'f', stale: true },
        },
      ],
    })
    const res = (await tool(h, 'set_transition_audio').invoke({
      after_no: 'S01',
      mode: 'native',
      character: '陈默',
    })) as { ok: boolean; error: string }
    assert.equal(res.ok, false)
    assert.match(res.error, /失效/)
    const g = (h.shot().transition_out as Record<string, unknown>).generated as Record<string, unknown>
    assert.equal(g.audioMode, undefined)
  })

  await check('多说话人时拒绝并给出拆镜建议', async () => {
    const shots = makeShots()
    ;(shots[1] as Record<string, unknown>).dialogue = '林小满：等一下。'
    const h = harness({ shots, model: NATIVE_MODEL })
    const res = (await tool(h, 'set_transition_audio').invoke({
      after_no: 'S01',
      mode: 'native',
    })) as { ok: boolean; error: string }
    assert.equal(res.ok, false)
    assert.match(res.error, /单说话人/)
  })

  await check('台词缺失时拒绝', async () => {
    const shots = makeShots()
    delete (shots[0] as Record<string, unknown>).dialogue
    const h = harness({ shots, model: NATIVE_MODEL })
    const res = (await tool(h, 'set_transition_audio').invoke({ after_no: 'S01', mode: 'native' })) as {
      ok: boolean
      error: string
    }
    assert.equal(res.ok, false)
    assert.match(res.error, /没有台词/)
  })

  await check('模型没有通过音频探测时拒绝', async () => {
    const h = harness({ model: { label: '普通模型', model: 'seedance-2.5', providerKind: 'seedance' } })
    const res = (await tool(h, 'set_transition_audio').invoke({
      after_no: 'S01',
      mode: 'native',
      character: '陈默',
    })) as { ok: boolean; error: string }
    assert.equal(res.ok, false)
    assert.match(res.error, /音频参考探测/)
  })

  await check('指定角色与唯一说话人不一致时拒绝', async () => {
    const h = harness({ model: NATIVE_MODEL })
    const res = (await tool(h, 'set_transition_audio').invoke({
      after_no: 'S01',
      mode: 'native',
      character: '林小满',
    })) as { ok: boolean; error: string }
    assert.equal(res.ok, false)
    assert.match(res.error, /不属于角色/)
  })

  await check('mode off 把 audioMode 置为 off 并清空 audioRef / audioMeta', async () => {
    const h = harness({ model: NATIVE_MODEL })
    const t = tool(h, 'set_transition_audio')
    await t.invoke({ after_no: 'S01', mode: 'native', character: '陈默' })
    const res = (await t.invoke({ after_no: 'S01', mode: 'off' })) as { ok: boolean; audio: { mode: string } }
    assert.equal(res.ok, true)
    assert.equal(res.audio.mode, 'off')
    const g = (h.shot().transition_out as Record<string, unknown>).generated as Record<string, unknown>
    assert.equal(g.audioMode, 'off')
    assert.equal(g.audioRef, undefined)
    assert.equal(g.audioMeta, undefined)
  })

  // ---- 6.1 A/B：工具写入与面板勾选必须得到同一份提交顺序 ----
  await check('工具写入与面板勾选同一组参考时，读到的 [图N] 顺序与标签完全一致', async () => {
    const assets = [{ canvasId: 'cv-scene', url: '/generated/scene.png', title: '雨夜街口', kind: 'scene' }]
    const viaTool = harness({ assets })
    await tool(viaTool, 'attach_transition_refs').invoke({ after_no: 'S01', kind: 'character', names: ['林小满'] })
    await tool(viaTool, 'attach_transition_refs').invoke({ after_no: 'S01', kind: 'asset', names: ['雨夜街口'] })

    // 面板路径：勾选同样两项，直接写 generated.refIds（与 toggleDedicatedRef 等价）
    const viaPanel = harness({
      shots: makeShots({ refIds: ['char-林小满', 'asset-cv-scene'] }),
      assets,
    })

    const read = (h: Harness) => {
      const adapter: WorkbenchChatAdapter = {
        surface: 'shots',
        skillId: 'shotlist',
        stage: 'shot',
        artifact: 'shots',
        writeTool: 'submit_shots',
        writeContract: 'shots-v1',
        threadKey: { project: 'demo', surface: 'shots', episode: 1 },
        inputs: () => ({ style: 'S', aspect: '16:9', brief: 'B', target: 60 }),
        ownDraft: () => h.project.shots ?? [],
        projectSnapshot: async () => h.project,
        applyDraft: () => ({ ok: true, summary: 'ok' }),
      }
      return createStageToolSet(adapter)
    }
    const a = (await read(viaTool).byName.get('read_transition_video_inputs')!.invoke({
      after_no: 'S01',
      episode: 1,
    })) as { refs: { index: number; label: string; source: string }[] }
    const b = (await read(viaPanel).byName.get('read_transition_video_inputs')!.invoke({
      after_no: 'S01',
      episode: 1,
    })) as { refs: { index: number; label: string; source: string }[] }
    assert.deepEqual(a.refs, b.refs, '两条路径的参考顺序与标签必须一致')
  })

  await check('工具说明写明只接受角色名、不接受音频地址', async () => {
    const h = harness()
    const desc = tool(h, 'set_transition_audio').description
    assert.match(desc, /不接受音频地址/)
    assert.match(desc, /音色样本/)
  })

  console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
  process.exit(bad ? 1 : 0)
}

void main()
