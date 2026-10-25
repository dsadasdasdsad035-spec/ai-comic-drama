import assert from 'node:assert/strict'
import { createCreativeToolSet, creativeModelFor } from '../src/creative/tools'
import type { AppSettings } from '../src/api'
import type { CreativeSessionSummary } from '../src/creative/sessionStore'

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

const settings = {
  providers: [],
  models: [
    { key: 'mock-text', label: 'Mock Text', cap: 'text', provider: 'p', model: 'mock-text' },
    { key: 'mock-image', label: 'Mock Image', cap: 'image', provider: 'p', model: 'mock-image' },
    { key: 'mock-vision', label: 'Mock Vision', cap: 'vision', provider: 'p', model: 'mock-vision' },
    { key: 'mock-video', label: 'Mock Video', cap: 'video', provider: 'p', model: 'mock-video' },
    { key: 'mock-audio', label: 'Mock Audio', cap: 'audio', provider: 'p', model: 'mock-audio' },
  ],
  defaults: { text: 'mock-text', image: 'mock-image', vision: 'mock-vision', video: 'mock-video', audio: 'mock-audio' },
  apiKey: '',
  rules: {},
} as unknown as AppSettings

const session = {
  id: 'cs-demo',
  title: '测试',
  mode: 'reverse',
  createdAt: '',
  updatedAt: '',
  sourceCount: 1,
  artifactCount: 0,
  messageCount: 0,
  sources: [
    {
      id: 'src-1',
      sessionId: 'cs-demo',
      kind: 'video',
      platform: 'local',
      platformId: '',
      author: '',
      title: '样例',
      url: '',
      cover: '',
      file: '/creative/cs-demo/sources/a.mp4',
      bytes: 100,
      duration: 3.6,
      width: 320,
      height: 240,
      fps: 25,
      bitrate: null,
      vcodec: 'h264',
      acodec: '',
      hasAudio: false,
      meta: {},
      createdAt: '',
    },
  ],
  artifacts: [],
  shots: {
    'src-1': [
      { id: 1, sourceId: 'src-1', index: 1, start: 0, end: 1.2, frames: ['/creative/cs-demo/frames/f1.jpg'], status: 'framed', analysis: null, updatedAt: '' },
      { id: 2, sourceId: 'src-1', index: 2, start: 1.2, end: 2.4, frames: [], status: 'pending', analysis: null, updatedAt: '' },
    ],
  },
} as unknown as CreativeSessionSummary

const validPack = {
  source: { platform: 'local', duration: 3.6, width: 320, height: 240 },
  global_style: 'bw',
  shots: [
    {
      index: 1,
      start: 0,
      end: 1.2,
      size: 'close-up',
      keyframe_prompt: 'a frame',
      video_prompt: 'static',
      evidence_frames: ['/creative/cs-demo/frames/f1.jpg'],
    },
  ],
}

async function main() {
  await check('按能力解析模型：创意覆盖优先', () => {
    const r = creativeModelFor(settings, { models: { image: 'mock-vision' } }, 'image')
    // mock-vision 不是 image 模型，但配置里写了就原样返回供报错
    assert.equal(r.key, 'mock-vision')
    const d = creativeModelFor(settings, {}, 'image')
    assert.equal(d.key, 'mock-image')
  })

  await check('read_video_shots 只读快照并返回镜头', async () => {
    const set = createCreativeToolSet({ sessionId: 'cs-demo', getSnapshot: async () => session, settings })
    const tool = set.byName.get('read_video_shots')!
    const out = (await tool.invoke({})) as { ok: boolean; total: number; shots: unknown[] }
    assert.equal(out.ok, true)
    assert.equal(out.total, 2)
    assert.equal(out.shots.length, 2)
  })

  await check('read_frame_detail 无帧时拒绝', async () => {
    const set = createCreativeToolSet({ sessionId: 'cs-demo', getSnapshot: async () => session, settings })
    const tool = set.byName.get('read_frame_detail')!
    const out = (await tool.invoke({ index: 2 })) as { ok: boolean; error?: string }
    assert.equal(out.ok, false)
    assert.match(String(out.error), /证据帧/)
  })

  await check('用户拒绝成本时不发起生图', async () => {
    let confirmed = 0
    let generated = 0
    const set = createCreativeToolSet({
      sessionId: 'cs-demo',
      getSnapshot: async () => session,
      settings,
      creative: {},
      confirmCost: async () => {
        confirmed++
        return false
      },
      generateImage: async () => {
        generated++
        return { url: '/x.png' }
      },
    })
    const out = (await set.byName.get('generate_image')!.invoke({ prompt: 'a cup' })) as {
      ok: boolean
      error?: string
    }
    assert.equal(confirmed, 1)
    assert.equal(generated, 0)
    assert.equal(out.ok, false)
    assert.match(String(out.error), /取消/)
  })

  await check('确认后生图只调用一次', async () => {
    let generated = 0
    const set = createCreativeToolSet({
      sessionId: 'cs-demo',
      getSnapshot: async () => session,
      settings,
      creative: {},
      confirmCost: async () => true,
      generateImage: async () => {
        generated++
        return { url: '/x.png' }
      },
    })
    const out = (await set.byName.get('generate_image')!.invoke({ prompt: 'a cup' })) as { ok: boolean }
    assert.equal(out.ok, true)
    assert.equal(generated, 1)
  })

  await check('轮次上限超限时拒绝且不发请求', async () => {
    let generated = 0
    const paidCalls = { count: 2, max: 2 }
    const set = createCreativeToolSet({
      sessionId: 'cs-demo',
      getSnapshot: async () => session,
      settings,
      creative: {},
      confirmCost: async () => true,
      paidCalls,
      generateVoice: async () => {
        generated++
        return { url: '/a.mp3' }
      },
    })
    const out = (await set.byName.get('generate_voice')!.invoke({ text: '你好' })) as {
      ok: boolean
      error?: string
    }
    assert.equal(out.ok, false)
    assert.match(String(out.error), /上限/)
    assert.equal(generated, 0)
  })

  await check('能力解析只返回该能力的模型', () => {
    const video = creativeModelFor(settings, {}, 'video')
    assert.equal(video.key, 'mock-video')
    const audio = creativeModelFor(settings, {}, 'audio')
    assert.equal(audio.key, 'mock-audio')
    // 完全没有该类模型时返回空键，绝不回落到文本模型
    const none = creativeModelFor({ ...settings, models: settings.models.filter((m) => m.cap === 'text') } as never, {}, 'image')
    assert.equal(none.key, '')
    assert.match(none.label, /未配置/)
  })

  await check('seedance 类调用始终要求确认（不受「不再询问」影响）', async () => {
    let asked = 0
    const set = createCreativeToolSet({
      sessionId: 'cs-demo',
      getSnapshot: async () => session,
      settings,
      creative: {},
      confirmCost: async (req) => {
        asked++
        // 语义：alwaysConfirm 的调用必须带标记，宿主据此跳过「不再询问」
        assert.equal(req.alwaysConfirm, true, '视频生成必须标记 alwaysConfirm')
        return false
      },
      generateVideo: async () => ({ url: '/v.mp4' }),
    })
    const out = (await set.byName.get('generate_video')!.invoke({ prompt: 'a shot' })) as {
      ok: boolean
      error?: string
    }
    assert.equal(asked, 1)
    assert.equal(out.ok, false)
  })

  await check('submit_reverse_pack 拒绝时间倒置', async () => {
    const set = createCreativeToolSet({ sessionId: 'cs-demo', getSnapshot: async () => session, settings })
    // 契约在工具入参 schema 上就会被拦下：非法值不会进 func，错误信息可读
    await assert.rejects(
      async () =>
        set.byName.get('submit_reverse_pack')!.invoke({
          source: {},
          shots: [{ start: 2, end: 1, size: 'x', keyframe_prompt: 'a', video_prompt: 'b' }],
        }),
      (e: Error) => {
        assert.match(String(e.message), /end 必须大于 start/)
        return true
      },
    )
  })

  await check('submit_reverse_pack 合法时校验通过', async () => {
    // 不落库：只验证契约层放行（保存走 HTTP，不在单测范围内）
    const { validateContract } = await import('../src/skills/contracts')
    const r = validateContract('reverse-v1', validPack)
    assert.equal(r.ok, true, r.ok ? '' : r.errors.join('；'))
  })

  await check('只读技能拿不到付费与写入工具', async () => {
    const { bindCreativeTools } = await import('../src/creative/tools')
    const set = createCreativeToolSet({ sessionId: 'cs-demo', getSnapshot: async () => session, settings })
    const skill = {
      id: 'video-reverse',
      manifest: {
        name: 'video-reverse',
        description: '',
        stage: 'creative',
        runtime: 'json-tools',
        tools: ['read_video_shots', 'submit_reverse_pack', 'generate_image'],
        inputs: [],
        output: 'reverse-v1',
        contracts: ['reverse-v1'],
        version: 1,
      },
      role: '',
      task: '',
      text: '',
      source: 'builtin',
    } as never
    const names = bindCreativeTools(set, [{ skill, mode: 'readonly' }]).map((t) => t.name)
    assert.deepEqual(names, ['read_video_shots'])
  })

  console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
  process.exit(bad ? 1 : 0)
}

main()
