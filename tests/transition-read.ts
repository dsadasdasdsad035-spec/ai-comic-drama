import assert from 'node:assert/strict'
import { createStageToolSet } from '../src/agent/stageTools'
import type { WorkbenchChatAdapter } from '../src/agent/workbenchChat'
import type { ProjectData } from '../src/api'

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

/**
 * 两镜接缝：S01 → S02。
 * `generated` 里的正文是独特字符串，用来验证工具不回传正文。
 */
function makeShots(generated: Record<string, unknown> = {}): Shot[] {
  return [
    {
      id: 'E01-S01',
      episode: 1,
      no: 'S01',
      seconds: 3,
      size: '中景',
      move: '推',
      video_prompt: '雨夜街口，林小满回头',
      refIds: ['char-林小满'],
      // 转场的风格参考只合并 asset / extra（角色不走这条通道），用它验证互斥扫描表
      refExtras: ['/generated/extra-a.jpg'],
      transition_out: {
        to: 'E01-S02',
        mode: 'generated',
        generated: {
          targetSeconds: 2,
          prompt: '独特正文标记-桥接-A',
          ...generated,
        },
      },
    },
    {
      id: 'E01-S02',
      episode: 1,
      no: 'S02',
      seconds: 3,
      size: '近景',
      move: '固定',
      video_prompt: '陈默撑伞走近',
      refIds: ['char-陈默'],
      refExtras: ['/generated/extra-b.jpg'],
    },
  ]
}

function makeSet(opts: { shots?: Shot[]; characters?: unknown[]; assets?: unknown[]; shotVideoContext?: WorkbenchChatAdapter['shotVideoContext'] } = {}) {
  const shots = opts.shots ?? makeShots()
  const project = {
    source: '原著正文',
    episodes: [{ no: 1, title: '第一集' }],
    shots,
    characters: opts.characters ?? [
      { name: '陈默', image: '/generated/chen.png', look_cn: '黑色风衣' },
      { name: '林小满', image: '/generated/lin.png', look_cn: '白裙' },
    ],
    ...(opts.assets ? { assets: opts.assets } : {}),
  } as unknown as ProjectData

  const adapter: WorkbenchChatAdapter = {
    surface: 'shots',
    skillId: 'shotlist',
    stage: 'shot',
    artifact: 'shots',
    writeTool: 'submit_shots',
    writeContract: 'shots-v1',
    threadKey: { project: 'demo', surface: 'shots', episode: 1 },
    inputs: () => ({ style: 'S', aspect: '16:9', brief: 'B', target: 60 }),
    ownDraft: () => shots,
    projectSnapshot: async () => project,
    applyDraft: () => ({ ok: true, summary: 'ok' }),
    ...(opts.shotVideoContext ? { shotVideoContext: opts.shotVideoContext } : {}),
  }
  return { set: createStageToolSet(adapter), project, shots }
}

const LAST_FRAME_MODEL = {
  label: 'Seedance 2.5',
  model: 'seedance-2.5',
  providerKind: 'seedance',
  features: { lastFrame: true, textToVideo: true },
}

async function main() {
  // ---- 有序参考与提交模式 ----
  await check('read_transition_video_inputs 按提交顺序给出参考与尾帧互斥原因', async () => {
    // 转场的风格参考只认 generated.refIds 显式补充（normalize 恒关 inheritRefs）
    const shots = makeShots({
      refIds: ['asset-cv-style'],
      boundary: { out: '/generated/boundary-out.png', in: '/generated/boundary-in.png' },
    })
    const { set } = makeSet({
      shots,
      assets: [{ canvasId: 'cv-style', url: '/generated/style.png', title: '冷调参考', kind: 'prop' }],
    })
    const tool = set.byName.get('read_transition_video_inputs')!
    const res = (await tool.invoke({
      after_no: 'S01',
      episode: 1,
      // 模型要通过 shotVideoContext 传：尾帧能力判错会让互斥判断反掉
    })) as {
      ok: boolean
      inputMode: string
      submitsLastFrame: boolean
      seconds: number
      requestSeconds: number
      refs: { index: number; label: string; purpose: string }[]
      refTotal: number
      styleRefs: { token: string; submitted: boolean; omittedReason?: string }[]
      styleOmitted: { token: string; reason: string }[]
      submittedStyleCount: number
      seam: { after_no: string; to_no: string; mode: string }
      blocking: { code: string }[]
      promptEmpty: boolean
    }
    assert.equal(res.ok, true)
    assert.equal(res.seam.after_no, 'S01')
    assert.equal(res.seam.to_no, 'S02')
    assert.equal(res.inputMode, 'boundary')
    assert.equal(res.submitsLastFrame, true)
    assert.equal(res.seconds, 2)
    assert.ok(res.requestSeconds >= res.seconds)
    // 首尾帧通道下参考图与尾帧互斥：显式补充的素材参考应被整体标掉
    assert.ok(res.styleRefs.length > 0, '显式 refIds 指向存在的素材卡，扫描表不能是空的')
    for (const r of res.styleRefs) assert.equal(r.submitted, false, `${r.token} 在尾帧通道下不应提交`)
    assert.equal(res.submittedStyleCount, 0)
    assert.ok(
      res.styleRefs.some((r) => r.omittedReason === 'morph-last-frame-ref-mutex'),
      '互斥原因要写明，不能只标 false',
    )
    assert.equal(res.promptEmpty, false, '正文已写，不应报空')
    assert.equal(res.blocking.find((b) => b.code === 'transition-prompt-empty'), undefined)
  })

  await check('read_transition_video_inputs 不返回正文，只回来源与空态', async () => {
    const { set } = makeSet()
    const tool = set.byName.get('read_transition_video_inputs')!
    const res = (await tool.invoke({ after_no: 'S01', episode: 1 })) as Record<string, unknown>
    const json = JSON.stringify(res)
    assert.equal(json.includes('独特正文标记-桥接-A'), false, '工具不得把正文塞进输入清单')
    assert.equal(res.promptSource, 'auto')
    assert.equal(res.promptStale, false)
    assert.equal(res.promptEmpty, false)
  })

  await check('read_transition_video_inputs 正文为空时提前给出 transition-prompt-empty', async () => {
    const shots = makeShots({ prompt: '' })
    const { set } = makeSet({ shots })
    const tool = set.byName.get('read_transition_video_inputs')!
    const res = (await tool.invoke({ after_no: 'S01', episode: 1 })) as {
      promptEmpty: boolean
      blocking: { code: string; message: string }[]
    }
    assert.equal(res.promptEmpty, true)
    const empty = res.blocking.find((b) => b.code === 'transition-prompt-empty')
    assert.ok(empty, '空正文必须给阻断项')
    assert.match(empty.message, /正文/)
  })

  // ---- 错误路径 ----
  await check('read_transition_video_inputs 源镜不存在时报可读错误', async () => {
    const { set } = makeSet()
    const res = (await set.byName.get('read_transition_video_inputs')!.invoke({ after_no: 'S99', episode: 1 })) as {
      ok: boolean
      error: string
    }
    assert.equal(res.ok, false)
    assert.match(res.error, /S99|找不到/)
  })

  await check('read_transition_video_inputs 未配置转场时报可读错误', async () => {
    const shots = makeShots()
    delete shots[0].transition_out
    const { set } = makeSet({ shots })
    const res = (await set.byName.get('read_transition_video_inputs')!.invoke({ after_no: 'S01', episode: 1 })) as {
      ok: boolean
      error: string
    }
    assert.equal(res.ok, false)
    assert.match(res.error, /未配置转场/)
    assert.match(res.error, /submit_joins/, '要给出下一步')
  })

  await check('read_transition_video_inputs 目标镜不存在时报可读错误', async () => {
    const shots = makeShots()
    ;(shots[0].transition_out as Record<string, unknown>).to = 'E01-S99'
    const { set } = makeSet({ shots })
    const res = (await set.byName.get('read_transition_video_inputs')!.invoke({ after_no: 'S01', episode: 1 })) as {
      ok: boolean
      error: string
    }
    assert.equal(res.ok, false)
    assert.match(res.error, /E01-S99/)
  })

  // ---- 显式目标镜 ----
  await check('read_transition_video_inputs 显式目标镜覆盖 transition_out.to 并标明接缝', async () => {
    const shots = makeShots()
    shots.push({
      id: 'E01-S03',
      episode: 1,
      no: 'S03',
      seconds: 3,
      size: '全景',
      move: '拉',
      video_prompt: '雨停',
    })
    const { set } = makeSet({ shots })
    const tool = set.byName.get('read_transition_video_inputs')!
    const auto = (await tool.invoke({ after_no: 'S01', episode: 1 })) as { seam: { overridden: boolean; to_no: string } }
    assert.equal(auto.seam.overridden, false)
    assert.equal(auto.seam.to_no, 'S02')

    const explicit = (await tool.invoke({ after_no: 'S01', to_no: 'S03', episode: 1 })) as {
      ok: boolean
      seam: { overridden: boolean; to_no: string; recorded_to: string }
    }
    assert.equal(explicit.ok, true)
    assert.equal(explicit.seam.to_no, 'S03')
    assert.equal(explicit.seam.overridden, true, '与 transition_out.to 不一致时要标明')
    assert.equal(explicit.seam.recorded_to, 'E01-S02')
  })

  // ---- 与宿主上下文一致 ----
  await check('read_transition_video_inputs 尾帧能力取自宿主模型，读到的就是会提交的', async () => {
    const shots = makeShots({ boundary: { out: '/generated/boundary-out.png', in: '/generated/boundary-in.png' } })
    // 只给模型：节点由工具按项目快照重建（Pi 创意会话就是这条路径）
    const { set } = makeSet({
      shots,
      shotVideoContext: () => ({
        model: LAST_FRAME_MODEL as never,
        resolution: '1080p',
      }),
    })
    const res = (await set.byName.get('read_transition_video_inputs')!.invoke({ after_no: 'S01', episode: 1 })) as {
      ok: boolean
      supportsLastFrame: boolean
      submitsLastFrame: boolean
      modelLabel: string
    }
    assert.equal(res.ok, true)
    assert.equal(res.supportsLastFrame, true, '不能因为没传 features 就说模型不支持尾帧')
    assert.equal(res.submitsLastFrame, true)
    assert.equal(res.modelLabel, 'Seedance 2.5')
  })

  // ---- 6.2 Pi 与画布两条路径读到同一份输入 ----
  await check('read_transition_video_inputs 在 Pi（无画布）与画布（有节点）两条路径上结果一致', async () => {
    const shots = makeShots({
      refIds: ['asset-cv-style'],
      boundary: { out: '/generated/boundary-out.png', in: '/generated/boundary-in.png' },
    })
    const assets = [{ canvasId: 'cv-style', url: '/generated/style.png', title: '冷调参考', kind: 'prop' }]
    // 画布路径的节点就是同一份项目快照的投影（真实画布只多带未保存改动）
    const { assetNodesFromAssets, composeShotCanvasNodes } = await import('../src/canvasShots')
    const hostNodes = composeShotCanvasNodes(assetNodesFromAssets(assets as never), shots as never)
    const pi = makeSet({ shots, assets, shotVideoContext: () => ({ model: LAST_FRAME_MODEL as never }) })
    const canvas = makeSet({
      shots,
      assets,
      shotVideoContext: () => ({
        nodes: hostNodes as never,
        characters: [
          { name: '陈默', image: '/generated/chen.png', look_cn: '黑色风衣' },
          { name: '林小满', image: '/generated/lin.png', look_cn: '白裙' },
        ] as never,
        missingMedia: new Set<string>(),
        model: LAST_FRAME_MODEL as never,
        resolution: '1080p',
      }),
    })
    const a = (await pi.set.byName.get('read_transition_video_inputs')!.invoke({ after_no: 'S01', episode: 1 })) as Record<
      string,
      unknown
    >
    const b = (await canvas.set.byName.get('read_transition_video_inputs')!.invoke({ after_no: 'S01', episode: 1 })) as Record<
      string,
      unknown
    >
    assert.deepEqual(a.refs, b.refs, '参考顺序必须一致')
    assert.equal(a.refTotal, b.refTotal)
    assert.equal(a.submitsLastFrame, b.submitsLastFrame)
    assert.equal(a.requestSeconds, b.requestSeconds)
    assert.deepEqual(a.styleRefs, b.styleRefs)
    assert.deepEqual(a.omitted, b.omitted)
  })

  console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
  process.exit(bad ? 1 : 0)
}

void main()
