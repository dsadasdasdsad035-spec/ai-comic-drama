/**
 * 生成类平台工具验收：首帧 / 出片 / 配音。
 *
 * 三条硬约束：成本确认缺失或取消时一个请求都不发；出片只提交不等待；
 * 生成工具不改参考连线、不创建素材卡。
 */
import assert from 'node:assert/strict'
import { assertPlatformToolConsistency, createBuiltinPlatformTools } from '../src/agent/builtinPlatformTools'
import type { ProjectData, ProjectShot } from '../src/api'

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

type Call = { url: string; init: RequestInit | undefined }

function stubFetch(reply: (url: string, init?: RequestInit) => unknown) {
  const calls: Call[] = []
  const prev = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    const body = reply(url, init)
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response
  }) as typeof fetch
  return { calls, restore: () => (globalThis.fetch = prev) }
}

function toolOf(tools: { name: string }[], name: string) {
  const t = tools.find((x) => x.name === name)
  assert.ok(t, `工具 ${name} 应存在`)
  return t as never as { invoke: (a: unknown) => Promise<Record<string, unknown>> }
}

function shots(): ProjectShot[] {
  return [
    {
      id: 'E01-S01',
      episode: 1,
      no: 'S01',
      seconds: 5,
      desc: '雨夜街口',
      keyframe_prompt: '雨夜街口，霓虹反射',
      video_prompt: '镜头缓慢推进',
      keyframe: '/old/s01.jpg',
      refIds: ['char-阿岚'],
      dialogue: '阿岚：别回头。',
    } as unknown as ProjectShot,
    {
      id: 'E01-S02',
      episode: 1,
      no: 'S02',
      seconds: 4,
      desc: '车灯扫过',
      keyframe_prompt: '车灯扫过墙面',
      video_prompt: '车灯扫过墙面，镜头横移',
      clip: '/old/s02.mp4',
      video_meta: { fingerprint: 'fp', createdAt: 't' },
      dialogue: '老周：走。',
    } as unknown as ProjectShot,
  ]
}

function project(): ProjectData {
  return {
    name: '演示项目',
    aspect: '9:16',
    style: '赛博',
    shots: shots(),
    characters: [
      { id: 'char-lan', name: '阿岚', image: '/project-assets/demo/lan.png', voiceId: 'voice-lan' },
    ],
    designs: [],
    assets: [],
    episodes: [],
  } as unknown as ProjectData
}

function makeTools(opts: { askCost?: (req: { action: string }) => Promise<boolean> } = {}) {
  let snap = project()
  return {
    get snap() {
      return snap
    },
    tools: createBuiltinPlatformTools({
      projectName: '演示项目',
      epNo: 1,
      getSnapshot: () => snap,
      setSnapshot: (p) => (snap = p),
      ...opts,
    }),
  }
}

async function main() {
  await check('三个生成工具都注册且进入清单', () => {
    const { tools } = makeTools()
    const names = tools.map((t) => t.name)
    for (const n of ['generate_keyframe', 'generate_clip', 'generate_voice', 'generate_narration']) {
      assert.ok(names.includes(n), `${n} 未注册`)
    }
    assert.doesNotThrow(() => assertPlatformToolConsistency(names))
  })

  await check('没有成本确认通道时不出图', async () => {
    const { calls, restore } = stubFetch(() => ({ ok: true, urls: ['/generated/x.jpg'] }))
    try {
      const { tools } = makeTools()
      const r = await toolOf(tools, 'generate_keyframe').invoke({ no: 'S01' })
      assert.equal(r.ok, false)
      assert.ok(String(r.error).includes('成本确认'))
      assert.equal(calls.length, 0)
    } finally {
      restore()
    }
  })

  await check('用户取消成本确认时镜头保持原样', async () => {
    const { calls, restore } = stubFetch(() => ({ ok: true, urls: ['/generated/x.jpg'] }))
    try {
      const box = makeTools({ askCost: async () => false })
      const r = await toolOf(box.tools, 'generate_keyframe').invoke({ no: 'S01' })
      assert.equal(r.ok, false)
      const s01 = box.snap.shots.find((s) => s.id === 'E01-S01')!
      assert.equal(s01.keyframe, '/old/s01.jpg')
      assert.equal(calls.length, 0)
    } finally {
      restore()
    }
  })

  await check('生图镜成功出图：写 keyframe、候选首位、不改 refIds', async () => {
    const { calls, restore } = stubFetch((url) => {
      if (url.includes('/api/project')) return { ok: true, shots: [], savedAt: '' }
      return { ok: true, urls: ['/project-assets/demo/s01-new.jpg'], url: '/project-assets/demo/s01-new.jpg' }
    })
    try {
      const box = makeTools({ askCost: async () => true })
      const r = await toolOf(box.tools, 'generate_keyframe').invoke({ no: 'S01' })
      assert.equal(r.ok, true, String(r.error ?? ''))
      assert.equal(r.keyframe, '/project-assets/demo/s01-new.jpg')
      const s01 = box.snap.shots.find((s) => s.id === 'E01-S01')!
      assert.equal(s01.keyframe, '/project-assets/demo/s01-new.jpg')
      assert.deepEqual(s01.candidates, ['/project-assets/demo/s01-new.jpg'])
      assert.deepEqual(s01.refIds, ['char-阿岚'], '生成不得改参考连线')
      assert.equal(box.snap.designs.length, 0, '生成不得创建素材卡')
      const gen = calls.find((c) => c.url.includes('/api/seedream'))
      assert.ok(gen, '应真的调用生图接口')
      const body = JSON.parse(String(gen?.init?.body))
      assert.equal(body.ratio, '9:16', '画幅取项目设置')
      assert.ok(String(body.prompt).startsWith('雨夜街口，霓虹反射'), '默认用该镜的首帧提示词')
      assert.deepEqual(body.refImages, ['/project-assets/demo/lan.png'], '角色连线必须作为参考图送出')
      assert.ok(String(body.prompt).includes('参考图说明'), '参考图要有用途说明')
      assert.ok(String(body.prompt).includes('阿岚'), '说明要标出对应主体')
    } finally {
      restore()
    }
  })

  await check('角色没有三视图时拒绝出图且零消耗', async () => {
    const { calls, restore } = stubFetch(() => ({ ok: true, urls: ['/x.jpg'] }))
    let costAsked = 0
    try {
      let snap = project()
      snap.characters = [{ id: 'char-lan', name: '阿岚' }] as unknown as ProjectData['characters']
      const tools = createBuiltinPlatformTools({
        projectName: '演示项目',
        epNo: 1,
        getSnapshot: () => snap,
        setSnapshot: (p) => (snap = p),
        askCost: async () => {
          costAsked++
          return true
        },
      })
      const r = await toolOf(tools, 'generate_keyframe').invoke({ no: 'S01' })
      assert.equal(r.ok, false)
      assert.ok(String(r.error).includes('三视图'), String(r.error))
      assert.equal(calls.length, 0, '解析失败时不该发任何请求')
      assert.equal(costAsked, 0, '解析失败时不该先问成本')
    } finally {
      restore()
    }
  })

  await check('素材卡不在画布上时报错而不是静默少送', async () => {
    const { calls, restore } = stubFetch(() => ({ ok: true, urls: ['/x.jpg'] }))
    try {
      let snap = project()
      snap.shots[0] = { ...snap.shots[0], refIds: ['asset-not-on-canvas'] }
      const tools = createBuiltinPlatformTools({
        projectName: '演示项目',
        epNo: 1,
        getSnapshot: () => snap,
        setSnapshot: (p) => (snap = p),
        askCost: async () => true,
      })
      const r = await toolOf(tools, 'generate_keyframe').invoke({ no: 'S01' })
      assert.equal(r.ok, false)
      assert.ok(String(r.error).includes('画布'), String(r.error))
      assert.equal(calls.length, 0)
    } finally {
      restore()
    }
  })

  await check('出片镜调用出图被拒，工位与首帧不变', async () => {
    const { calls, restore } = stubFetch(() => ({ ok: true, urls: ['/x.jpg'] }))
    try {
      const box = makeTools({ askCost: async () => true })
      const r = await toolOf(box.tools, 'generate_keyframe').invoke({ no: 'S02' })
      assert.equal(r.ok, false)
      assert.ok(String(r.error).includes('出片'))
      const s02 = box.snap.shots.find((s) => s.id === 'E01-S02')!
      assert.equal(s02.keyframe, undefined)
      assert.equal(calls.length, 0)
    } finally {
      restore()
    }
  })

  await check('出片无 override 时参数 prompt 覆盖镜上正文提交', async () => {
    const { calls, restore } = stubFetch((url) => {
      if (url.includes('/api/seedance')) return { ok: true, id: 'job-prompt', mode: 'ref' }
      return { ok: true }
    })
    try {
      let snap = project()
      snap.shots[0] = { ...snap.shots[0], video_prompt: '旧正文' }
      const tools = createBuiltinPlatformTools({
        projectName: '演示项目',
        epNo: 1,
        getSnapshot: () => snap,
        setSnapshot: (p) => (snap = p),
        askCost: async () => true,
      })
      const r = await toolOf(tools, 'generate_clip').invoke({ no: 'S01', prompt: 'Agent 一次性正文' })
      assert.equal(r.ok, true, String(r.error ?? ''))
      const body = JSON.parse(String(calls.find((c) => c.url.includes('/api/seedance'))?.init?.body))
      assert.equal(body.prompt, 'Agent 一次性正文')
    } finally {
      restore()
    }
  })

  await check('出片任务只提交不等待，返回 jobId 且不写 clip', async () => {
    const { calls, restore } = stubFetch((url) => {
      if (url.includes('/api/seedance')) return { ok: true, id: 'job-123', mode: 'ref' }
      return { ok: true }
    })
    try {
      const box = makeTools({ askCost: async () => true })
      const r = await toolOf(box.tools, 'generate_clip').invoke({ no: 'S01' })
      assert.equal(r.ok, true, String(r.error ?? ''))
      assert.equal(r.jobId, 'job-123')
      const s01 = box.snap.shots.find((s) => s.id === 'E01-S01')!
      assert.equal(s01.clip, undefined, '受理阶段不得写成片')
      assert.equal(calls.filter((c) => c.url.includes('/api/project')).length, 0)
      const body = JSON.parse(String(calls.find((c) => c.url.includes('/api/seedance'))?.init?.body))
      assert.deepEqual(body.refImages, ['/project-assets/demo/lan.png'], '角色连线必须作为参考图送出')
      assert.equal(body.image, undefined, '有参考图时不再退回首帧模式')
      assert.equal(body.seconds, 5)
      assert.equal(body.ratio, '9:16')
      // 正文只由人/Agent 写入：逐字提交，运行时不追加运镜/参考图槽位/约束块
      assert.equal(body.prompt, '镜头缓慢推进', '正文逐字提交，不拼装')
      assert.deepEqual(body.refImages, ['/project-assets/demo/lan.png'], '参考图仍按结构化字段送出，顺序即图序')
    } finally {
      restore()
    }
  })

  await check('相邻镜连线进入出片参考图', async () => {
    const { calls, restore } = stubFetch((url) => {
      if (url.includes('/api/seedance')) return { ok: true, id: 'job-prev' }
      return { ok: true }
    })
    try {
      let snap = project()
      snap.shots[1] = { ...snap.shots[1], refIds: ['shot-prev'] }
      const tools = createBuiltinPlatformTools({
        projectName: '演示项目',
        epNo: 1,
        getSnapshot: () => snap,
        setSnapshot: (p) => (snap = p),
        askCost: async () => true,
      })
      const r = await toolOf(tools, 'generate_clip').invoke({ no: 'S02' })
      assert.equal(r.ok, true, String(r.error ?? ''))
      const body = JSON.parse(String(calls.find((c) => c.url.includes('/api/seedance'))?.init?.body))
      assert.deepEqual(body.refImages, ['/old/s01.jpg'], '上镜首帧要作为连贯参考送出')
    } finally {
      restore()
    }
  })

  await check('没有参考也没有首帧时出片被阻塞且不提交', async () => {
    const { calls, restore } = stubFetch(() => ({ ok: true, id: 'job-x' }))
    try {
      let snap = project()
      snap.shots[1] = { ...snap.shots[1], keyframe: undefined, refIds: [] }
      const tools = createBuiltinPlatformTools({
        projectName: '演示项目',
        epNo: 1,
        getSnapshot: () => snap,
        setSnapshot: (p) => (snap = p),
        askCost: async () => true,
      })
      const r = await toolOf(tools, 'generate_clip').invoke({ no: 'S02' })
      assert.equal(r.ok, false)
      assert.ok(String(r.error).includes('连线'), String(r.error))
      assert.equal(calls.length, 0, '阻塞时不该提交出片')
    } finally {
      restore()
    }
  })

  await check('出片提交失败返回可读失败', async () => {
    const { restore } = stubFetch((url) => {
      if (url.includes('/api/seedance')) return { ok: false, message: '额度不足' }
      return { ok: true }
    })
    try {
      const { tools } = makeTools({ askCost: async () => true })
      const r = await toolOf(tools, 'generate_clip').invoke({ no: 'S01' })
      assert.equal(r.ok, false)
      assert.ok(String(r.error).includes('额度不足'))
    } finally {
      restore()
    }
  })

  await check('配音成功写回声音引用与配音元数据', async () => {
    const { calls, restore } = stubFetch((url) => {
      if (url.includes('/api/voice')) {
        return { ok: true, url: '/audio/s01.mp3', engine: 'tts-x', seconds: 2.4, elapsed: 1 }
      }
      return { ok: true }
    })
    try {
      const box = makeTools({ askCost: async () => true })
      const r = await toolOf(box.tools, 'generate_voice').invoke({ no: 'S01' })
      assert.equal(r.ok, true, String(r.error ?? ''))
      const s01 = box.snap.shots.find((s) => s.id === 'E01-S01')!
      const ref = s01.audio_ref as unknown as { character: string; url: string }
      assert.equal(ref.url, '/audio/s01.mp3')
      assert.equal(ref.character, '阿岚')
      assert.equal((s01.voice_meta as unknown as { engine: string }).engine, 'tts-x')
      const body = JSON.parse(String(calls.find((c) => c.url.includes('/api/voice'))?.init?.body))
      assert.equal(body.voice, 'voice-lan', '说话角色有音色就带上')
    } finally {
      restore()
    }
  })

  await check('配音失败不清空原声音引用', async () => {
    const { restore } = stubFetch((url) => {
      if (url.includes('/api/voice')) return { ok: false, message: '渠道 502' }
      return { ok: true }
    })
    let snap = project()
    snap.shots[0] = { ...snap.shots[0], audio_ref: { character: '阿岚', url: '/audio/old.mp3' } }
    try {
      const tools = createBuiltinPlatformTools({
        projectName: '演示项目',
        epNo: 1,
        getSnapshot: () => snap,
        setSnapshot: (p) => (snap = p),
        askCost: async () => true,
      })
      const r = await toolOf(tools, 'generate_voice').invoke({ no: 'S01' })
      assert.equal(r.ok, false)
      assert.ok(String(r.error).includes('渠道 502'))
      const ref = snap.shots[0].audio_ref as unknown as { url: string }
      assert.equal(ref.url, '/audio/old.mp3')
    } finally {
      restore()
    }
  })

  await check('镜号不存在时给出可读错误', async () => {
    const { calls, restore } = stubFetch(() => ({ ok: true }))
    try {
      const { tools } = makeTools({ askCost: async () => true })
      const r = await toolOf(tools, 'generate_voice').invoke({ no: 'S99' })
      assert.equal(r.ok, false)
      assert.ok(String(r.error).includes('S99'))
      assert.equal(calls.length, 0)
    } finally {
      restore()
    }
  })

  console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 生成工具全部通过')
  process.exit(bad ? 1 : 0)
}

void main()
