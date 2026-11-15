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

/** 31 镜、每镜约 1.4k 字符：一集序列化后远超 24k 预算，逼出续读 */
function makeShots(): Shot[] {
  return Array.from({ length: 31 }, (_, i) => {
    const n = i + 1
    const no = `S${String(n).padStart(2, '0')}`
    return {
      id: `E01-${no}`,
      episode: 1,
      no,
      seconds: 3,
      size: '中景',
      move: '推',
      desc: `第 ${n} 镜：雨夜街口`,
      keyframe_prompt: `keyframe ${no} ` + '画面描述'.repeat(60),
      video_prompt: `video ${no} ` + '运镜描述'.repeat(120),
      transition_out: { relation: 'cut', after_no: no, to_no: `S${String(n + 1).padStart(2, '0')}` },
      refIds: [`char-${n % 3}`, `asset-${n % 4}`],
      refExtras: [`/generated/extra-${n}.jpg`],
      handEdited: ['video_prompt'],
    }
  })
}

function makeEpisodes(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    no: i + 1,
    title: `第 ${i + 1} 集`,
    scenes: [
      {
        no: 1,
        slug: '雨夜街口',
        lines: Array.from({ length: 20 }, () => '台词'.repeat(60)),
      },
    ],
  }))
}

function makeSet(opts: { shots?: Shot[]; episodes?: unknown[]; characters?: unknown[]; designs?: unknown[] } = {}) {
  const shots = opts.shots ?? makeShots()
  const project = {
    source: '原著正文',
    episodes: opts.episodes ?? makeEpisodes(12),
    shots,
    characters: opts.characters ?? [
      { id: 'char-1', name: '陈默', look_en: 'black coat', look: '黑色风衣' },
      { id: 'char-2', name: '林小满', look_en: 'white dress', look: '白裙' },
    ],
    designs: opts.designs ?? [
      { id: 'scene-1', kind: 'scene', name: '雨夜街口', note: '霓虹反光' },
      { id: 'prop-1', kind: 'prop', name: '黑伞', note: '伞骨断了一根' },
    ],
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
  }
  return { set: createStageToolSet(adapter), project, shots }
}

/** 响应必须能被 JSON 序列化再解析：半截 JSON 文本会在这里露馅 */
function asJson(value: unknown) {
  return JSON.parse(JSON.stringify(value))
}

async function main() {
  // ---- 2.1 read_shots 续读 ----
  await check('read_shots 续读覆盖全集：不重不漏且每条都带 video_prompt', async () => {
    const { set, shots } = makeSet()
    const tool = set.byName.get('read_shots')!
    const seen: Shot[] = []
    let cursor: string | undefined
    let rounds = 0
    for (;;) {
      rounds++
      assert.ok(rounds <= 20, '续读次数异常，可能游标没前进')
      const res = (await tool.invoke({ episode: 1, ...(cursor ? { cursor } : {}) })) as {
        ok: boolean
        shots: Shot[]
        total: number
        returned: number
        truncated?: boolean
        nextCursor?: string
      }
      assert.equal(res.ok, true)
      assert.equal(res.total, shots.length, '未过滤范围内 total 应是该集总镜数')
      assert.equal(res.returned, res.shots.length)
      seen.push(...res.shots)
      if (!res.truncated) {
        assert.equal(res.nextCursor, undefined, '读完时不该再给游标')
        break
      }
      assert.ok(res.nextCursor, '截断时必须给 nextCursor')
      cursor = res.nextCursor
    }
    assert.ok(rounds > 1, '31 镜超过预算，应该需要续读')
    assert.equal(seen.length, shots.length, '续读要覆盖全部镜头')
    assert.deepEqual(
      seen.map((s) => s.id),
      shots.map((s) => s.id),
      '顺序与全集一致，不重不漏',
    )
    for (const s of seen) {
      assert.ok(String(s.video_prompt || '').startsWith('video '), '每条都要带视频提示词')
      assert.ok(Array.isArray(s.refIds), 'refIds 不能被丢掉')
      assert.ok(s.transition_out, 'transition_out 不能被丢掉')
    }
  })

  await check('read_shots 游标失效时报错并给可用范围', async () => {
    const { set } = makeSet()
    const tool = set.byName.get('read_shots')!
    const res = (await tool.invoke({ episode: 1, cursor: 'E01-S99' })) as {
      ok: boolean
      error?: string
      hint?: string
      firstIds?: string[]
    }
    assert.equal(res.ok, false)
    assert.match(String(res.error), /E01-S99/)
    assert.match(String(res.hint), /cursor/)
    assert.deepEqual(res.firstIds?.[0], 'E01-S01')
  })

  await check('read_shots 只读第 2 集时游标不会串集', async () => {
    const shots = [
      ...makeShots(),
      ...makeShots().map((s) => ({ ...s, id: String(s.id).replace('E01', 'E02'), episode: 2 })),
    ]
    const { set } = makeSet({ shots })
    const tool = set.byName.get('read_shots')!
    const first = (await tool.invoke({ episode: 1 })) as { shots: Shot[]; nextCursor?: string }
    assert.ok(first.shots.every((s) => Number(s.episode) === 1))
    if (first.nextCursor) {
      const second = (await tool.invoke({ episode: 1, cursor: first.nextCursor })) as { shots: Shot[] }
      assert.ok(second.shots.every((s) => Number(s.episode) === 1), '续读不该读到别的集')
    }
  })

  // ---- 2.1 shotIds 精确读 ----
  await check('read_shots 传 20 个 shotIds 全量返回完整记录', async () => {
    const { set, shots } = makeSet()
    const tool = set.byName.get('read_shots')!
    const ids = shots.slice(0, 20).map((s) => String(s.id))
    const res = (await tool.invoke({ shotIds: ids })) as {
      ok: boolean
      shots: Shot[]
      returned: number
      truncated?: boolean
      notFound?: string[]
    }
    assert.equal(res.shots.length, 20, '20 条必须全部返回，不受列表预算影响')
    assert.equal(res.returned, 20)
    assert.equal(res.truncated, undefined)
    assert.equal(res.notFound, undefined)
    for (const s of res.shots) {
      assert.ok(String(s.video_prompt || '').startsWith('video '))
      assert.ok(String(s.keyframe_prompt || '').startsWith('keyframe'))
    }
  })

  await check('read_shots shotIds 超条数上限时列出未返回的 id', async () => {
    const many = Array.from({ length: 105 }, (_, i) => ({
      ...makeShots()[i % 31],
      id: `E01-X${i}`,
      no: `X${i}`,
      episode: 1,
      video_prompt: '',
      keyframe_prompt: '',
    }))
    const { set } = makeSet({ shots: many })
    const tool = set.byName.get('read_shots')!
    const res = (await tool.invoke({ shotIds: many.map((s) => String(s.id)) })) as {
      shots: Shot[]
      total: number
      truncated?: boolean
      notReturned?: string[]
    }
    assert.equal(res.total, 105)
    assert.equal(res.shots.length, 100)
    assert.equal(res.truncated, true)
    assert.deepEqual(res.notReturned, many.slice(100).map((s) => s.id))
  })

  // ---- 2.2 read_episodes / read_episode ----
  await check('read_episodes 超预算时仍是合法 JSON 且整条返回', async () => {
    const { set } = makeSet()
    const tool = set.byName.get('read_episodes')!
    const res = (await tool.invoke({})) as {
      ok: boolean
      episodes: unknown[]
      total: number
      returned: number
      truncated?: boolean
    }
    assert.equal(res.ok, true)
    assert.equal(res.total, 12)
    assert.equal(res.truncated, true, '12 集远超预算，必须标截断')
    assert.ok(res.returned >= 1 && res.returned < 12)
    const parsed = asJson(res)
    assert.equal(parsed.episodes.length, res.returned, '序列化后条数不变，说明不是半截字符串')
    for (const ep of parsed.episodes as Record<string, unknown>[]) {
      assert.equal(typeof ep, 'object')
      assert.ok(Array.isArray(ep.scenes), '分集记录要完整带场次')
    }
  })

  await check('read_episode 镜头摘要超预算时标截断且不返回残缺条目', async () => {
    const { set, shots } = makeSet()
    const tool = set.byName.get('read_episode')!
    const res = (await tool.invoke({ episode: 1 })) as {
      ok: boolean
      shots: Shot[]
      shotTotal: number
      shotReturned: number
      truncated?: boolean
      note?: string
    }
    assert.equal(res.ok, true)
    assert.equal(res.shotTotal, shots.length)
    assert.ok(res.shotReturned < shots.length)
    assert.equal(res.truncated, true)
    const parsed = asJson(res) as { shots: Shot[] }
    assert.equal(parsed.shots.length, res.shots.length)
    for (const s of parsed.shots) {
      assert.equal(typeof s, 'object')
      assert.ok(String(s.video_prompt || '').startsWith('video '), '摘要里的每条也得是完整镜头')
    }
  })

  // ---- 2.3 其余读工具 ----
  await check('read_characters 过滤语义不变且超限可 parse', async () => {
    const big = Array.from({ length: 12 }, (_, i) => ({
      id: `char-${i}`,
      name: `角色${i}`,
      look_en: 'x'.repeat(800),
    }))
    const { set } = makeSet({ characters: big })
    const tool = set.byName.get('read_characters')!
    const res = (await tool.invoke({})) as {
      characters: Record<string, unknown>[]
      total: number
      truncated?: boolean
    }
    assert.equal(res.total, 12)
    assert.equal(res.truncated, true)
    const parsed = asJson(res) as { characters: Record<string, unknown>[] }
    for (const c of parsed.characters) assert.equal(typeof c.look_en, 'string')

    const filtered = (await tool.invoke({ names: ['角色3'] })) as { characters: { name: string }[] }
    assert.deepEqual(filtered.characters.map((c) => c.name), ['角色3'], '按名过滤语义不变')
  })

  await check('read_designs 的 kind / names 过滤语义不变', async () => {
    const { set } = makeSet()
    const tool = set.byName.get('read_designs')!
    const scenes = (await tool.invoke({ kind: 'scene' })) as { designs: { name: string }[] }
    assert.deepEqual(scenes.designs.map((d) => d.name), ['雨夜街口'])
    const byName = (await tool.invoke({ names: ['黑伞'] })) as { designs: { name: string }[] }
    assert.deepEqual(byName.designs.map((d) => d.name), ['黑伞'])
    // 序列化后字段仍在：没有被字符串切片
    assert.ok('note' in byName.designs[0])
  })

  await check('read_transition_recipes 超限响应可 JSON.parse', async () => {
    const { set } = makeSet()
    const tool = set.byName.get('read_transition_recipes')!
    const res = (await tool.invoke({ limit: 40 })) as {
      recipes: Record<string, unknown>[]
      total: number
      truncated?: boolean
    }
    const parsed = asJson(res) as { recipes: Record<string, unknown>[] }
    assert.equal(parsed.recipes.length, res.recipes.length)
    for (const r of parsed.recipes) {
      assert.equal(typeof r, 'object')
      assert.ok(r.id || r.title, '每条食谱都该有标识字段')
    }
  })

  await check('read_asset_detail 单条超限时整条保留并标 oversized', async () => {
    const huge = [{ id: 'char-1', name: '陈默', look_en: 'x'.repeat(15000) }]
    const { set } = makeSet({ characters: huge })
    const tool = set.byName.get('read_asset_detail')!
    const res = (await tool.invoke({ category: 'characters', key: 'char-1' })) as {
      ok: boolean
      record: Record<string, unknown>
      oversized?: boolean
      chars?: number
    }
    assert.equal(res.ok, true)
    assert.equal(String(res.record.look_en).length, 15000, '不能切字段')
    assert.equal(res.oversized, true)
    assert.ok(Number(res.chars) > 12000)
  })

  // ---- 3.1 read_shot_detail ----
  await check('read_shot_detail 同时给出手改正文、模板渲染正文与渲染元数据', async () => {
    const shots = makeShots()
    shots[2] = {
      ...shots[2],
      video_prompt_override: { text: '手改后的整段出片正文', fingerprint: 'fp-old', createdAt: '2026-01-01' },
      video_prompt_rendered: '九段模板渲染的完整正文',
      video_prompt_render_meta: {
        fingerprint: 'fp-new',
        templateVersion: 'v9',
        renderedAt: '2026-01-02',
        modelKey: 'seedance',
      },
      motionNote: '缓慢推近，雨丝斜落',
    }
    const { set } = makeSet({ shots })
    const tool = set.byName.get('read_shot_detail')!
    const res = (await tool.invoke({ no: 'S03', episode: 1 })) as {
      ok: boolean
      shotId: string
      no: string
      shot: Record<string, unknown>
    }
    assert.equal(res.ok, true)
    assert.equal(res.shotId, 'E01-S03')
    assert.equal(res.no, 'S03')
    const shot = res.shot
    assert.equal((shot.video_prompt_override as { text: string }).text, '手改后的整段出片正文')
    assert.equal(shot.video_prompt_rendered, '九段模板渲染的完整正文')
    assert.equal((shot.video_prompt_render_meta as { templateVersion: string }).templateVersion, 'v9')
    assert.equal(shot.motionNote, '缓慢推近，雨丝斜落')
    assert.ok(shot.transition_out, '转场配置要在')
    assert.ok(Array.isArray(shot.refIds))
    assert.ok(Array.isArray(shot.refExtras))
    assert.ok(Array.isArray(shot.handEdited))
  })

  await check('read_shot_detail 支持 shotId，且镜号不存在时给可用范围', async () => {
    const { set } = makeSet()
    const tool = set.byName.get('read_shot_detail')!
    const byId = (await tool.invoke({ shotId: 'E01-S07' })) as { ok: boolean; no: string }
    assert.equal(byId.ok, true)
    assert.equal(byId.no, 'S07')

    const miss = (await tool.invoke({ no: 'S99', episode: 1 })) as {
      ok: boolean
      error: string
      available: { count: number; shotNos: string[] }
    }
    assert.equal(miss.ok, false)
    assert.match(miss.error, /S99/)
    assert.equal(miss.available.count, 31)
    assert.equal(miss.available.shotNos[0], 'S01')
    assert.ok(miss.available.shotNos.includes('S31'))
  })

  await check('read_shot_detail 缺定位参数与跨集歧义都给可读拒绝', async () => {
    const shots = [...makeShots(), ...makeShots().map((s) => ({ ...s, id: `E02-${s.no}`, episode: 2 }))]
    const { set } = makeSet({ shots })
    const tool = set.byName.get('read_shot_detail')!
    const none = (await tool.invoke({})) as { ok: boolean; error: string }
    assert.equal(none.ok, false)
    assert.match(none.error, /shotId 或 no/)

    const ambiguous = (await tool.invoke({ no: 'S01' })) as { ok: boolean; candidates: { episode: number }[] }
    assert.equal(ambiguous.ok, false)
    assert.deepEqual(ambiguous.candidates.map((c) => c.episode), [1, 2])
  })

  // ---- 3.2 read_shot_video_prompt 四态 ----
  await check('read_shot_video_prompt 四态各命中一次', async () => {
    const base = makeShots()
    const shots: Shot[] = [
      { id: 'E01-S01', episode: 1, no: 'S01', video_prompt_override: { text: '手改正文', fingerprint: 'f1', createdAt: 't' } },
      { id: 'E01-S02', episode: 1, no: 'S02', video_prompt: '语义层正文', keyframe_prompt: '首帧正文' },
      { id: 'E01-S03', episode: 1, no: 'S03', keyframe_prompt: '只有首帧正文' },
      { id: 'E01-S04', episode: 1, no: 'S04', desc: '什么都没有' },
      ...base.slice(4),
    ]
    const { set } = makeSet({ shots })
    const tool = set.byName.get('read_shot_video_prompt')!

    const one = (await tool.invoke({ no: 'S01' })) as { text: string; source: string; stale: boolean }
    assert.deepEqual([one.text, one.source], ['手改正文', 'override'])

    const two = (await tool.invoke({ no: 'S02' })) as { text: string; source: string }
    assert.deepEqual([two.text, two.source], ['语义层正文', 'video_prompt'])

    const three = (await tool.invoke({ no: 'S03' })) as { text: string; source: string }
    assert.deepEqual([three.text, three.source], ['只有首帧正文', 'keyframe_prompt'])

    const four = (await tool.invoke({ no: 'S04' })) as {
      text: null
      source: string
      requiresCanvas: boolean
      note: string
    }
    assert.equal(four.text, null, '拼不出来就给 null，不给近似结果')
    assert.equal(four.source, 'script_assembled')
    assert.equal(four.requiresCanvas, true)
    assert.match(four.note, /画布/)
  })

  await check('read_shot_video_prompt 手改正文逐字返回，指纹不一致标 stale', async () => {
    const text = '  首行\n第二行  结尾空格  '
    const shots: Shot[] = [
      {
        id: 'E01-S01',
        episode: 1,
        no: 'S01',
        video_prompt: '语义层正文',
        video_prompt_override: { text, fingerprint: 'fp-old', createdAt: 't' },
        video_prompt_render_meta: { fingerprint: 'fp-new', templateVersion: 'v9', renderedAt: 't' },
      },
      {
        id: 'E01-S02',
        episode: 1,
        no: 'S02',
        video_prompt: '语义层正文',
        video_prompt_override: { text: '另一段手改', fingerprint: 'fp-new', createdAt: 't' },
        video_prompt_render_meta: { fingerprint: 'fp-new', templateVersion: 'v9', renderedAt: 't' },
      },
    ]
    const { set } = makeSet({ shots })
    const tool = set.byName.get('read_shot_video_prompt')!
    const stale = (await tool.invoke({ no: 'S01' })) as { text: string; stale: boolean }
    assert.equal(stale.text, text, '逐字一致：不做 trim')
    assert.equal(stale.stale, true)

    const fresh = (await tool.invoke({ no: 'S02' })) as { stale: boolean }
    assert.equal(fresh.stale, false)
  })

  // ---- 3.3 只读注册 ----
  await check('两个新工具已注册且是只读', async () => {
    const { set } = makeSet()
    for (const name of ['read_shot_detail', 'read_shot_video_prompt']) {
      assert.ok(set.read.has(name), `${name} 应该在 readByName`)
      assert.ok(set.byName.has(name), `${name} 应该在 byName`)
      assert.ok(!name.startsWith('submit_'))
    }
  })

  // ---- 4.1 三处清单同步 ----
  await check('两个新工具进入平台清单、技能白名单与专家默认工具集', async () => {
    const { builtinPlatformToolNames } = await import('../src/agent/builtinPlatformTools')
    const { KNOWN_TOOL_IDS } = await import('../src/skills/tools')
    const { classifyExpertTool, DEFAULT_EXPERT_PLATFORM_TOOLS, groupExpertPlatformTools } = await import(
      '../src/creative/expertToolGroups'
    )
    const names = builtinPlatformToolNames()
    for (const name of ['read_shot_detail', 'read_shot_video_prompt']) {
      assert.ok(names.includes(name), `${name} 应出现在 builtinPlatformToolNames()`)
      assert.ok(KNOWN_TOOL_IDS.has(name), `${name} 应出现在 KNOWN_TOOL_IDS`)
      assert.ok(DEFAULT_EXPERT_PLATFORM_TOOLS.includes(name), `${name} 应进入默认专家工具集`)
      assert.equal(classifyExpertTool(name), 'read', `${name} 应归到「读项目」分组`)
    }
    assert.deepEqual(groupExpertPlatformTools(['read_shot_detail']), {
      read: ['read_shot_detail'],
      skill: [],
      write: [],
      project: [],
      generate: [],
      other: [],
    })
  })

  console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
  process.exit(bad ? 1 : 0)
}

void main()
