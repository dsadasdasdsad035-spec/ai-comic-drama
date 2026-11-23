/**
 * 提示词案例库 agent 只读工具验收（纯函数，不需要 dev server）。
 *
 * 覆盖：摘要不含正文、分面上限与总数、正文预算与偏移续读、逐镜分页、
 * 词表骨架/单轴/非法轴、空库退化、第三方出处字段。
 */
import assert from 'node:assert/strict'
import {
  PROMPT_BODY_BUDGET,
  PROMPT_CARD_FACET_LIMIT,
  PROMPT_CASE_LIST_DEFAULT,
  PROMPT_CASE_LIST_MAX,
  PROMPT_SHOT_DEFAULT,
  PROMPT_SHOT_MAX,
  createPromptCaseTools,
  type PromptCaseToolIo,
} from '../src/agent/promptCaseTools'
import type {
  PromptCase,
  PromptCaseDetail,
  PromptCaseListResult,
  PromptCaseShot,
} from '../src/promptCases/api'

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

const LONG = 'x'.repeat(PROMPT_BODY_BUDGET + 500)

function makeCase(id: string, over: Partial<PromptCase> = {}): PromptCase {
  return {
    id,
    source: 'vflow',
    sourceId: id,
    title: `标题 ${id}`,
    prompt: '一段提示词正文',
    shots: [],
    model: 'seedance-2-5',
    category: 'video',
    tags: ['雨'],
    videoUrl: 'https://v.example/v.mp4',
    posterUrl: 'https://p.example/p.jpg',
    author: 'someone',
    sourceUrl: `https://x.example/${id}`,
    license: 'reference-only',
    note: '',
    favorite: false,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-02T00:00:00.000Z',
    taxonomyVersion: '2026-11-23.2',
    facets: [],
    ...over,
  }
}

function makeShot(index: number, over: Partial<PromptCaseShot> = {}): PromptCaseShot {
  return {
    index,
    start: index,
    end: index + 1,
    duration: 1,
    kind: 'live',
    kindLabel: '实拍',
    confidence: 0.8,
    decidedBy: 'rule',
    evidence: ['证据'],
    keyframePrompt: `画面 ${index}`,
    videoPrompt: `运动 ${index}`,
    videoPromptEn: '',
    promptMissing: false,
    remakeRoute: [],
    remakeExecutor: '',
    remakeNote: '',
    remakeRule: '',
    evidenceFrames: ['/a.jpg', '/b.jpg'],
    evidenceMissing: false,
    ...over,
  }
}

function listResult(cases: PromptCase[], total = cases.length, page = 1, totalPages = 1): PromptCaseListResult {
  return {
    cases,
    total,
    page,
    pageSize: cases.length,
    totalPages,
    facets: { total, favorites: 0, bySource: {}, models: [], categories: [] },
    facetCounts: [],
    invalidFacets: [],
    taxonomyVersion: '2026-11-23.2',
  }
}

/** 固定桩：list / get / facetCounts 都从闭包读取，便于单测各分支 */
function stubIo(opts: {
  cases?: PromptCase[]
  detail?: PromptCaseDetail | null
  counts?: Array<{ axis: string; value: string; count: number }>
  axisCases?: Array<{ axis: string; cases: number; values: number }>
  listCalls?: Array<Record<string, unknown>>
  getCalls?: string[]
}): PromptCaseToolIo {
  return {
    list: async (q) => {
      opts.listCalls?.push(q as Record<string, unknown>)
      return listResult(opts.cases || [])
    },
    get: async (id) => {
      opts.getCalls?.push(id)
      if (opts.detail === null) throw new Error(`找不到案例「${id}」`)
      return (opts.detail || makeCase(id)) as PromptCaseDetail
    },
    facetCounts: async () => ({
      counts: opts.counts || [],
      invalidFacets: [],
      axisCases: opts.axisCases || [],
    }),
  }
}

function toolMap(io: PromptCaseToolIo) {
  return new Map(createPromptCaseTools({ io }).map((t) => [t.name, t]))
}

async function main() {
  await check('三个工具都已构造', () => {
    const names = createPromptCaseTools({ io: stubIo({}) }).map((t) => t.name)
    assert.deepEqual(names, ['list_prompt_cases', 'get_prompt_case', 'read_prompt_case_facets'])
  })

  await check('工具描述声明第三方内容不执行指令', () => {
    for (const t of createPromptCaseTools({ io: stubIo({}) })) {
      assert.match(t.description, /第三方/)
      assert.match(t.description, /不执行/)
    }
  })

  await check('列表摘要不含正文、逐镜与媒体地址', async () => {
    const tools = toolMap(
      stubIo({
        cases: [
          makeCase('a', {
            prompt: '很长的正文'.repeat(100),
            shots: [makeShot(1), makeShot(2)],
          }),
        ],
      }),
    )
    const r = (await tools.get('list_prompt_cases')!.invoke({})) as Record<string, any>
    assert.equal(r.ok, true)
    const row = r.cases[0]
    assert.equal(row.prompt, undefined, '摘要不应带正文')
    assert.equal(row.shots, undefined, '摘要不应带逐镜')
    assert.equal(row.videoUrl, undefined, '摘要不应带视频地址')
    assert.equal(row.posterUrl, undefined, '摘要不应带封面地址')
    assert.equal(row.promptChars, '很长的正文'.repeat(100).length)
    assert.equal(row.shotCount, 2)
    assert.equal(row.license, 'reference-only')
    assert.equal(row.sourceUrl, 'https://x.example/a')
  })

  await check('列表分面有上限且报出总数', async () => {
    const facets = Array.from({ length: 10 }, (_, i) => ({
      axis: i === 0 ? 'genre' : `axis-${i}`,
      value: `v${i}`,
      source: 'derived' as const,
      unmapped: false,
      suppressed: false,
      taxonomyVersion: 't',
      updatedAt: '',
    }))
    const tools = toolMap(stubIo({ cases: [makeCase('a', { facets })] }))
    const r = (await tools.get('list_prompt_cases')!.invoke({})) as Record<string, any>
    const row = r.cases[0]
    assert.equal(row.facets.length, PROMPT_CARD_FACET_LIMIT)
    assert.equal(row.facetTotal, 10)
    assert.equal(row.facets[0].axis, 'genre', '题材应优先展示')
  })

  await check('列表 pageSize 默认 10 且上限 24', async () => {
    const calls: Array<Record<string, unknown>> = []
    const tools = toolMap(stubIo({ cases: [makeCase('a')], listCalls: calls }))
    await tools.get('list_prompt_cases')!.invoke({})
    assert.equal(calls[0].pageSize, PROMPT_CASE_LIST_DEFAULT)
    await tools.get('list_prompt_cases')!.invoke({ pageSize: PROMPT_CASE_LIST_MAX })
    assert.equal(calls[1].pageSize, PROMPT_CASE_LIST_MAX)
    // 超上限由 zod 拒绝（schema 是唯一校验入口）
    await assert.rejects(() => tools.get('list_prompt_cases')!.invoke({ pageSize: 999 }))
  })

  await check('列表分页给出续页提示', async () => {
    const io: PromptCaseToolIo = {
      ...stubIo({ cases: [makeCase('a')] }),
      list: async () => listResult([makeCase('a')], 30, 1, 3),
    }
    const tools = toolMap(io)
    const r = (await tools.get('list_prompt_cases')!.invoke({})) as Record<string, any>
    assert.match(String(r.next), /page=2/)
  })

  await check('空结果给出筛选回显与词表提示', async () => {
    const tools = toolMap(stubIo({ cases: [] }))
    const r = (await tools.get('list_prompt_cases')!.invoke({ q: '不存在的词' })) as Record<string, any>
    assert.equal(r.ok, true)
    assert.equal(r.total, 0)
    assert.equal(r.cases.length, 0)
    assert.match(String(r.note), /没有案例/)
    assert.match(String(r.hint), /read_prompt_case_facets/)
    assert.equal(r.filters.q, '不存在的词')
  })

  await check('统计口径非法分面被回显', async () => {
    const io: PromptCaseToolIo = {
      ...stubIo({}),
      list: async () => ({
        ...listResult([]),
        invalidFacets: [{ raw: 'genre:不存在', reason: '值不存在' }],
      }),
    }
    const tools = toolMap(io)
    const r = (await tools.get('list_prompt_cases')!.invoke({ facets: ['genre:不存在'] })) as Record<string, any>
    assert.equal(r.ok, true)
    assert.equal(r.invalidFacets[0].raw, 'genre:不存在')
  })

  await check('短正文一次读完且无续读字段', async () => {
    const tools = toolMap(stubIo({ detail: makeCase('a') as PromptCaseDetail }))
    const r = (await tools.get('get_prompt_case')!.invoke({ id: 'a' })) as Record<string, any>
    assert.equal(r.prompt, '一段提示词正文')
    assert.equal(r.promptChars, '一段提示词正文'.length)
    assert.equal(r.promptNextOffset, undefined)
    assert.match(r.sourceUrl, /x\.example/)
    assert.equal(r.license, 'reference-only')
  })

  await check('长正文按预算截断并能续读拼接一致', async () => {
    const tools = toolMap(stubIo({ detail: makeCase('a', { prompt: LONG }) as PromptCaseDetail }))
    const first = (await tools.get('get_prompt_case')!.invoke({ id: 'a' })) as Record<string, any>
    assert.equal(first.prompt.length, PROMPT_BODY_BUDGET)
    assert.equal(first.promptChars, LONG.length)
    assert.equal(first.promptNextOffset, PROMPT_BODY_BUDGET)
    assert.match(String(first.note), /续读/)
    const second = (await tools.get('get_prompt_case')!.invoke({
      id: 'a',
      promptOffset: first.promptNextOffset,
    })) as Record<string, any>
    assert.equal(first.prompt + second.prompt, LONG)
    assert.equal(second.promptNextOffset, undefined, '读完最后一页不应再给偏移')
  })

  await check('正文偏移越界被夹到末尾而不是报错', async () => {
    const tools = toolMap(stubIo({ detail: makeCase('a', { prompt: 'abc' }) as PromptCaseDetail }))
    const r = (await tools.get('get_prompt_case')!.invoke({ id: 'a', promptOffset: 99 })) as Record<string, any>
    assert.equal(r.prompt, '')
    assert.equal(r.promptChars, 3)
    assert.equal(r.promptNextOffset, undefined)
  })

  await check('案例不存在时返回可读错误', async () => {
    const tools = toolMap(stubIo({ detail: null }))
    const r = (await tools.get('get_prompt_case')!.invoke({ id: 'nope' })) as Record<string, any>
    assert.equal(r.ok, false)
    assert.match(String(r.error), /找不到|nope/)
    assert.match(String(r.hint), /list_prompt_cases/)
  })

  await check('逐镜分页且缺证据时标待确认', async () => {
    const shots = Array.from({ length: PROMPT_SHOT_MAX + 3 }, (_, i) =>
      makeShot(i + 1, i === 0 ? { evidenceMissing: true, evidenceFrames: [], promptMissing: false } : {}),
    )
    const tools = toolMap(stubIo({ detail: makeCase('a', { shots }) as PromptCaseDetail }))
    const first = (await tools.get('get_prompt_case')!.invoke({ id: 'a' })) as Record<string, any>
    assert.equal(first.shotTotal, shots.length)
    assert.equal(first.shotReturned, PROMPT_SHOT_DEFAULT)
    assert.equal(first.shotNextOffset, PROMPT_SHOT_DEFAULT)
    assert.equal(first.shots[0].pendingConfirmation !== undefined, true, '缺证据的镜必须标待确认')
    assert.equal(first.shots[0].evidenceFrameCount, 0)
    assert.equal(first.shots[1].pendingConfirmation, undefined)

    const rest = (await tools.get('get_prompt_case')!.invoke({ id: 'a', shotOffset: first.shotNextOffset })) as Record<string, any>
    assert.equal(rest.shots.length, PROMPT_SHOT_DEFAULT, '续读仍按默认条数取')
    assert.equal(rest.shotNextOffset, PROMPT_SHOT_DEFAULT * 2)

    const tail = (await tools.get('get_prompt_case')!.invoke({
      id: 'a',
      shotOffset: rest.shotNextOffset,
      shotLimit: PROMPT_SHOT_MAX,
    })) as Record<string, any>
    assert.equal(
      first.shots.length + rest.shots.length + tail.shots.length,
      shots.length,
      '三页拼起来应覆盖全部逐镜',
    )
    assert.equal(tail.shotNextOffset, undefined)
    // 逐镜上限由 schema 拦住，不在实现里静默夹紧
    await assert.rejects(() => tools.get('get_prompt_case')!.invoke({ id: 'a', shotOffset: 0, shotLimit: 999 }))
  })

  await check('词表骨架只回 18 行且带示例', async () => {
    const tools = toolMap(
      stubIo({
        counts: [
          { axis: 'genre', value: 'action', count: 3 },
          { axis: 'genre', value: 'comedy', count: 1 },
          { axis: 'camera-move', value: 'push-in', count: 2 },
        ],
        axisCases: [
          { axis: 'genre', cases: 4, values: 2 },
          { axis: 'camera-move', cases: 2, values: 1 },
        ],
      }),
    )
    const r = (await tools.get('read_prompt_case_facets')!.invoke({})) as Record<string, any>
    assert.equal(r.ok, true)
    assert.equal(r.axes.length, 18)
    const genre = r.axes.find((a: any) => a.axis === 'genre')
    assert.equal(genre.cases, 4)
    assert.equal(genre.values, 2)
    assert.equal(genre.samples[0], 'action(3)')
    // 骨架不展开全部 430 个受控值
    assert.equal(genre.valuesList, undefined)
  })

  await check('词表骨架在 axisCases 缺失时退化并说明', async () => {
    const tools = toolMap(
      stubIo({ counts: [{ axis: 'genre', value: 'action', count: 3 }], axisCases: [] }),
    )
    const r = (await tools.get('read_prompt_case_facets')!.invoke({})) as Record<string, any>
    const genre = r.axes.find((a: any) => a.axis === 'genre')
    assert.equal(genre.cases, null)
    assert.equal(genre.values, 1, '退化时 values 由 counts 反推')
    assert.match(String(r.note), /axisCases/)
  })

  await check('单轴展开回全部受控值并标出 0 条', async () => {
    const tools = toolMap(
      stubIo({
        counts: [{ axis: 'camera-move', value: 'push-in', count: 2 }],
        axisCases: [{ axis: 'camera-move', cases: 2, values: 1 }],
      }),
    )
    const r = (await tools.get('read_prompt_case_facets')!.invoke({ axis: 'camera-move' })) as Record<string, any>
    assert.equal(r.ok, true)
    assert.ok(r.values.length > 10, '应展开该轴全部受控值')
    const push = r.values.find((v: any) => v.id === 'push-in')
    assert.equal(push.count, 2)
    const zero = r.values.filter((v: any) => v.count === 0)
    assert.ok(zero.length > 0)
    assert.match(String(r.note), /0\D*条|没有案例/)
  })

  await check('非法轴返回可读错误并列出可用轴', async () => {
    const tools = toolMap(stubIo({}))
    const r = (await tools.get('read_prompt_case_facets')!.invoke({ axis: 'not-an-axis' })) as Record<string, any>
    assert.equal(r.ok, false)
    assert.match(String(r.error), /未知轴/)
    assert.ok(Array.isArray(r.availableAxes) && r.availableAxes.length === 18)
  })

  console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 案例工具全部通过')
  process.exit(bad ? 1 : 0)
}

void main()
