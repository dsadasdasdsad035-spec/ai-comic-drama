import assert from 'node:assert/strict'
import {
  designContractToSheet,
  mergeDesignDraft,
  mergeDesigns,
  newDesignId,
} from '../src/designExtract'
import { applyProjectDraft, type ProjectDraftCtx } from '../src/platform/projectDraft'
import { createBuiltinPlatformTools } from '../src/agent/builtinPlatformTools'
import type { DesignSheet, ProjectData } from '../src/api'

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

function sheet(over: Partial<DesignSheet> & { name: string }): DesignSheet {
  return {
    id: '',
    kind: 'scene',
    refs: [],
    summaryCn: '',
    promptEn: '',
    keywords: [],
    ...over,
  }
}

function project(designs: DesignSheet[]): ProjectData {
  return { name: 'a', characters: [], designs, shots: [], episodes: [], assets: [] } as unknown as ProjectData
}

async function main() {
  // ---- 1.1 契约字段映射 ----
  await check('契约蛇形字段映射到卡片驼峰字段', () => {
    const s = designContractToSheet(
      {
        name: '雨夜空地',
        refs: ['E01-S03'],
        summary_cn: '雨夜的街口空地',
        prompt_en: 'rainy night empty lot',
        keywords: ['雨', '夜'],
        id: 'design-scene-x',
        image: '/project-assets/a/design-scene-1.jpg',
        candidates: ['/a.jpg', '/b.jpg'],
        active_idx: 1,
      },
      'scene',
    )
    assert.ok(s)
    assert.equal(s.name, '雨夜空地')
    assert.equal(s.kind, 'scene')
    assert.equal(s.summaryCn, '雨夜的街口空地')
    assert.equal(s.promptEn, 'rainy night empty lot')
    assert.deepEqual(s.refs, ['E01-S03'])
    assert.deepEqual(s.keywords, ['雨', '夜'])
    assert.equal(s.id, 'design-scene-x')
    assert.equal(s.image, '/project-assets/a/design-scene-1.jpg')
    assert.deepEqual(s.candidates, ['/a.jpg', '/b.jpg'])
    assert.equal(s.activeIdx, 1)
  })

  await check('空名称条目被丢弃', () => {
    assert.equal(designContractToSheet({ name: '   ' }, 'scene'), null)
  })

  // ---- 1.2 合并语义 ----
  await check('同名同类型不新增，关联镜号取并集', () => {
    const cur = [sheet({ id: 'design-1', name: '雨夜空地', refs: ['E01-S03'] })]
    const r = mergeDesigns(cur, [sheet({ name: '雨夜空地', refs: ['E01-S05'] })])
    assert.equal(r.next.length, 1)
    assert.deepEqual(r.next[0].refs, ['E01-S03', 'E01-S05'])
    assert.deepEqual(r.added, [])
    assert.deepEqual(r.updated, ['雨夜空地'])
  })

  await check('异名新增，未提交的旧卡保留', () => {
    const cur = [sheet({ id: 'design-1', name: '雨夜空地' })]
    const r = mergeDesigns(cur, [sheet({ name: '天台', kind: 'scene' })])
    assert.equal(r.next.length, 2)
    assert.deepEqual(r.added, ['天台'])
    assert.ok(r.next.some((d) => d.name === '雨夜空地'))
  })

  await check('同名不同类不合并', () => {
    const cur = [sheet({ id: 'd1', name: '旧钥匙', kind: 'prop' })]
    const r = mergeDesigns(cur, [sheet({ name: '旧钥匙', kind: 'scene' })])
    assert.equal(r.next.length, 2)
  })

  await check('设计卡名称规范化：空白与大小写不影响合并', () => {
    const cur = [sheet({ id: 'd1', name: 'Rainy  Lot' })]
    const r = mergeDesigns(cur, [sheet({ name: 'rainy lot ' })])
    assert.equal(r.next.length, 1)
  })

  // ---- 1.3 标识 ----
  await check('两张新卡各获得非空且互不相同的标识', () => {
    const r = mergeDesignDraft([], {
      scenes: [{ name: '雨夜空地' }],
      props: [{ name: '旧钥匙' }],
    })
    assert.equal(r.next.length, 2)
    const ids = r.next.map((d) => d.id)
    assert.ok(ids.every((id) => id.trim().length > 0))
    assert.equal(new Set(ids).size, 2)
  })

  await check('已有空标识的旧卡在合并时补齐', () => {
    const cur = [sheet({ id: '', name: '雨夜空地', image: '/x.jpg' })]
    const r = mergeDesignDraft(cur, { scenes: [] })
    assert.equal(r.next.length, 1)
    assert.ok(r.next[0].id.trim().length > 0)
    assert.equal(r.next[0].image, '/x.jpg')
  })

  await check('改名不换标识：按标识命中旧卡', () => {
    const cur = [sheet({ id: 'design-scene-1', name: '雨夜空地' })]
    const r = mergeDesignDraft(cur, { scenes: [{ id: 'design-scene-1', name: '雨夜空地' }] })
    assert.equal(r.next.length, 1)
    assert.equal(r.next[0].id, 'design-scene-1')
    assert.equal(r.next[0].name, '雨夜空地')
  })

  await check('标识生成器同类不同次不重复', () => {
    const ids = new Set([newDesignId('scene'), newDesignId('scene'), newDesignId('prop')])
    assert.equal(ids.size, 3)
  })

  // ---- 1.4 手改保护 ----
  await check('同名提交只补空字段，图片与候选不被覆盖', () => {
    const cur = [
      sheet({
        id: 'design-scene-1',
        name: '雨夜空地',
        promptEn: '手工锚点',
        image: '/keep.jpg',
        candidates: ['/c1.jpg', '/c2.jpg'],
        activeIdx: 1,
        summaryCn: '已有摘要',
      }),
    ]
    const r = mergeDesignDraft(cur, {
      scenes: [{ name: '雨夜空地', summary_cn: '新摘要', prompt_en: '新锚点' }],
    })
    assert.equal(r.next.length, 1)
    assert.equal(r.next[0].image, '/keep.jpg')
    assert.deepEqual(r.next[0].candidates, ['/c1.jpg', '/c2.jpg'])
    assert.equal(r.next[0].activeIdx, 1)
    assert.equal(r.next[0].promptEn, '手工锚点')
    assert.equal(r.next[0].summaryCn, '已有摘要')
  })

  await check('只补空字段：旧卡缺锚点时才采纳新值', () => {
    const cur = [sheet({ id: 'design-scene-1', name: '雨夜空地' })]
    const r = mergeDesignDraft(cur, { scenes: [{ name: '雨夜空地', prompt_en: '新锚点' }] })
    assert.equal(r.next[0].promptEn, '新锚点')
  })

  // ---- 3.3 失败可见 ----
  await check('落库失败时返回失败且不回写快照', async () => {
    const before = project([sheet({ id: 'design-scene-1', name: '雨夜空地', image: '/keep.jpg' })])
    let snapshot: ProjectData = before
    let setCalls = 0
    const ctx: ProjectDraftCtx = {
      projectName: 'a',
      epNo: 1,
      getSnapshot: () => snapshot,
      setSnapshot: (p) => {
        setCalls++
        snapshot = p
      },
      writer: {
        patch: async () => {
          throw new Error('UNIQUE constraint failed: designs.project_id, designs.design_id')
        },
      },
    }
    const r = await applyProjectDraft(
      'designs-v1',
      { scenes: [{ name: '雨夜空地', prompt_en: 'x' }, { name: '天台' }] },
      ctx,
    )
    assert.equal(r.ok, false)
    assert.match(String(r.error), /UNIQUE/)
    assert.equal(setCalls, 0)
    assert.equal(snapshot, before)
  })

  await check('落库成功才回写快照，且带上合并结果', async () => {
    const before = project([sheet({ id: 'design-scene-1', name: '雨夜空地', image: '/keep.jpg' })])
    let snapshot: ProjectData = before
    let pushed: unknown = null
    const ctx: ProjectDraftCtx = {
      projectName: 'a',
      epNo: 1,
      getSnapshot: () => snapshot,
      setSnapshot: (p) => {
        snapshot = p
      },
      writer: {
        patch: async (_name, patch) => {
          pushed = patch
        },
      },
    }
    const r = await applyProjectDraft('designs-v1', { scenes: [{ name: '天台' }] }, ctx)
    assert.equal(r.ok, true)
    assert.deepEqual(r.counts, { total: 1, added: 1, updated: 0 })
    const designs = (pushed as { designs: DesignSheet[] }).designs
    assert.equal(designs.length, 2)
    assert.ok(designs.every((d) => d.id.trim().length > 0))
    assert.equal((snapshot.designs || []).length, 2)
  })

  await check('未加载项目时直接失败，不调用落库', async () => {
    let called = 0
    const ctx: ProjectDraftCtx = {
      projectName: 'a',
      epNo: 1,
      getSnapshot: () => null,
      setSnapshot: () => {},
      writer: {
        patch: async () => {
          called++
        },
      },
    }
    const r = await applyProjectDraft('designs-v1', { scenes: [{ name: '天台' }] }, ctx)
    assert.equal(r.ok, false)
    assert.equal(called, 0)
  })

  // ---- 4.1 模型可见描述 ----
  await check('submit_designs 的工具描述说明合并语义', () => {
    const tools = createBuiltinPlatformTools({ projectName: 'a', epNo: 1 })
    const byName = new Map(tools.map((t) => [t.name, t]))
    const submit = byName.get('submit_designs')
    assert.ok(submit)
    assert.match(submit.description, /合并/)
    assert.match(submit.description, /未提交的卡不会被删除/)
  })

  console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
  process.exit(bad ? 1 : 0)
}

void main()
