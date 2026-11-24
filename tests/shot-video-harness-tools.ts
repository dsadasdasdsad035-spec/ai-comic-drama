/**
 * 镜级出片 harness 写工具与 generate_clip 参数语义
 */
import assert from 'node:assert/strict'
import { createBuiltinPlatformTools } from '../src/agent/builtinPlatformTools'
import type { ProjectData, ProjectShot } from '../src/api'

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

function toolOf(tools: { name: string }[], name: string) {
  const t = tools.find((x) => x.name === name)
  assert.ok(t, `缺少工具 ${name}`)
  return t as never as { invoke: (a: unknown) => Promise<Record<string, unknown>> }
}

function shots(): ProjectShot[] {
  return [
    {
      id: 'E01-S01',
      episode: 1,
      no: 'S01',
      seconds: 5,
      desc: '雨夜',
      video_prompt: '',
      refIds: ['char-阿岚'],
      dialogue: '阿岚：别回头。',
      prod_kind: 'video',
    } as ProjectShot,
    {
      id: 'E01-S02',
      episode: 1,
      no: 'S02',
      seconds: 4,
      video_prompt: '横移',
      keyframe: '/old/s01.jpg',
      refIds: [],
    } as ProjectShot,
  ]
}

function project(): ProjectData {
  return {
    name: '演示',
    aspect: '16:9',
    shots: shots(),
    characters: [{ id: 'c1', name: '阿岚', image: '/project-assets/demo/lan.png', voiceId: 'v1' }],
    assets: [],
    episodes: [{ no: 1, title: '第一集' }],
    designs: [],
  } as unknown as ProjectData
}

async function main() {
  await check('四件 harness 写工具已注册', () => {
    const tools = createBuiltinPlatformTools({ projectName: '演示', epNo: 1 })
    for (const n of [
      'set_shot_video_options',
      'set_shot_video_override',
      'set_shot_ref_extras',
      'set_shot_neighbor_refs',
    ]) {
      assert.ok(tools.some((t) => t.name === n), n)
    }
  })

  await check('generate_clip 无 override 时参数 prompt 参与提交', async () => {
    const calls: { body?: string }[] = []
    const prev = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/api/seedance')) calls.push({ body: String(init?.body ?? '') })
      return {
        ok: true,
        status: 200,
        json: async () => (url.includes('/api/seedance') ? { ok: true, id: 'j1' } : { ok: true }),
      } as Response
    }) as typeof fetch
    try {
      let snap = project()
      const tools = createBuiltinPlatformTools({
        projectName: '演示',
        epNo: 1,
        getSnapshot: () => snap,
        setSnapshot: (p) => (snap = p),
        askCost: async () => true,
      })
      const r = await toolOf(tools, 'generate_clip').invoke({
        no: 'S01',
        prompt: '本次临时正文',
      })
      assert.equal(r.ok, true, String(r.error))
      const body = JSON.parse(calls[0]?.body || '{}')
      assert.equal(body.prompt, '本次临时正文')
    } finally {
      globalThis.fetch = prev
    }
  })

  await check('set_shot_neighbor_refs 写入 shot-prev', async () => {
    const prev = globalThis.fetch
    globalThis.fetch = (async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      }) as Response) as typeof fetch
    try {
      let snap = project()
      const tools = createBuiltinPlatformTools({
        projectName: '演示',
        epNo: 1,
        getSnapshot: () => snap,
        setSnapshot: (p) => (snap = p),
      })
      const r = await toolOf(tools, 'set_shot_neighbor_refs').invoke({ no: 'S02', neighbor: 'prev', action: 'add' })
      assert.equal(r.ok, true, String(r.error))
      assert.ok((r.refIds as string[])?.includes('shot-prev'))
      const written = snap.shots.find((s) => s.id === 'E01-S02')
      assert.ok(written?.refIds?.includes('shot-prev'))
    } finally {
      globalThis.fetch = prev
    }
  })

  await check('set_shot_ref_extras 拒绝外链', async () => {
    let snap = project()
    const tools = createBuiltinPlatformTools({
      projectName: '演示',
      epNo: 1,
      getSnapshot: () => snap,
      setSnapshot: (p) => (snap = p),
      // 无媒体清单时外链必拒
    })
    const r = await toolOf(tools, 'set_shot_ref_extras').invoke({
      no: 'S01',
      urls: ['https://evil.example/x.jpg'],
    })
    assert.equal(r.ok, false)
  })

  /**
   * 原生音频不再做强门镜：只有「模型没有音频能力」才拒绝。
   * 缺音色样本 / 多说话人 / 说话人不在角色库都要照常写入 audio_mode=native，
   * 出片阶段只发 generate_audio，声音由模型决定。
   */
  await check('set_shot_video_options 无音色样本仍开启 native', async () => {
    let snap = project()
    const prev = globalThis.fetch
    // 写回走 deps.writeShot → POST /api/project；这里只需要它返回 ok
    globalThis.fetch = (async () =>
      ({ ok: true, status: 200, json: async () => ({ ok: true }) }) as Response) as typeof fetch
    try {
      const tools = createBuiltinPlatformTools({
        projectName: '演示',
        epNo: 1,
        getSnapshot: () => snap,
        setSnapshot: (p) => (snap = p),
        getSelectedVideoModel: () => ({
          key: 'v25',
          model: 'seedance-2.5',
          providerKind: 'apimart',
          audioOut: true,
        }),
      })
      const r = await toolOf(tools, 'set_shot_video_options').invoke({ no: 'S01', audioMode: 'native' })
      assert.equal(r.ok, true, String(r.error))
      const written = snap.shots.find((s) => s.id === 'E01-S01')
      assert.equal(written?.audio_mode, 'native')
      assert.ok(!written?.audio_ref?.url, '没有样本时不该写 audio_ref')
    } finally {
      globalThis.fetch = prev
    }
  })

  await check('set_shot_video_options 模型无能力才拒绝', async () => {
    let snap = project()
    const tools = createBuiltinPlatformTools({
      projectName: '演示',
      epNo: 1,
      getSnapshot: () => snap,
      setSnapshot: (p) => (snap = p),
      getSelectedVideoModel: () => ({ key: 'v10', model: 'seedance-1-0-pro', providerKind: 'ark' }),
    })
    const r = await toolOf(tools, 'set_shot_video_options').invoke({ no: 'S01', audioMode: 'native' })
    assert.equal(r.ok, false)
    assert.match(String(r.error), /不支持原生音频/)
  })

  if (bad) {
    console.error(`\n${bad} 项失败`)
    process.exit(1)
  }
  console.log('\n镜级出片 harness 工具测试通过')
}

main()