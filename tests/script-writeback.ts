/**
 * 剧本写回（submit_episodes / script-v1）验收：按集号合并、未提交的集保留、失败可见。
 */
import assert from 'node:assert/strict'
import { applyProjectDraft, PLATFORM_WRITE_TOOLS, type ProjectDraftCtx } from '../src/platform/projectDraft'
import { builtinPlatformToolNames, createBuiltinPlatformTools } from '../src/agent/builtinPlatformTools'
import { validateContract } from '../src/skills/contracts'
import type { ProjectData, ProjectEpisode } from '../src/api'

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

function ep(no: number, title: string, scenes = 0): ProjectEpisode {
  return {
    no,
    title,
    hook: '',
    targetSeconds: 60,
    scenes: Array.from({ length: scenes }, (_, i) => ({
      no: i + 1,
      slug: `slug-${no}-${i + 1}`,
      place: '客厅',
      time: '夜',
      beats: `第${no}集第${i + 1}场`,
    })),
  } as unknown as ProjectEpisode
}

type Writer = {
  patches: Array<Record<string, unknown>>
  fail?: boolean
}

function ctxOf(project: ProjectData, writer: Writer): ProjectDraftCtx {
  let snap = project
  return {
    projectName: 'demo',
    epNo: 1,
    getSnapshot: () => snap,
    setSnapshot: (p) => {
      snap = p
    },
    writer: {
      patch: async (_name, patch) => {
        if (writer.fail) throw new Error('服务端拒绝')
        writer.patches.push(patch as unknown as Record<string, unknown>)
      },
      mergeShots: async () => {
        if (writer.fail) throw new Error('服务端拒绝')
      },
    },
  }
}

function baseProject(episodes: ProjectEpisode[], logline = '原文梗概'): ProjectData {
  return { name: 'demo', logline, episodes, shots: [], characters: [], designs: [], assets: [] } as unknown as ProjectData
}

async function main() {
  await check('submit_episodes 已注册且进入工具名清单', () => {
    const row = PLATFORM_WRITE_TOOLS.find((x) => x.tool === 'submit_episodes')
    assert.ok(row, 'PLATFORM_WRITE_TOOLS 应含 submit_episodes')
    assert.equal(row?.contract, 'script-v1')
    assert.ok(builtinPlatformToolNames().includes('submit_episodes'))
    const tools = createBuiltinPlatformTools({ projectName: 'demo', epNo: 1 })
    assert.ok(tools.some((t) => t.name === 'submit_episodes'), '平台工具集应真实注册 submit_episodes')
  })

  await check('只提交第 2 集时其余集原样保留', async () => {
    const cur = [ep(1, '第一集', 2), ep(2, '旧标题', 1), ep(3, '第三集', 1)]
    const writer: Writer = { patches: [] }
    const r = await applyProjectDraft(
      'script-v1',
      { episodes: [ep(2, '新标题', 3)] },
      ctxOf(baseProject(cur), writer),
    )
    assert.equal(r.ok, true, r.ok ? '' : r.error)
    const next = writer.patches[0].episodes as ProjectEpisode[]
    assert.equal(next.length, 3)
    assert.equal(next[0].title, '第一集')
    assert.equal(next[1].title, '新标题')
    assert.equal(next[2].title, '第三集')
    assert.equal((next[1] as unknown as { scenes: unknown[] }).scenes.length, 3)
    assert.deepEqual(r.counts, { added: 0, updated: 1, total: 3 })
  })

  await check('首次写回两集按集号顺序落库', async () => {
    const writer: Writer = { patches: [] }
    const r = await applyProjectDraft(
      'script-v1',
      { episodes: [ep(2, '第二集'), ep(1, '第一集')] },
      ctxOf(baseProject([]), writer),
    )
    assert.equal(r.ok, true)
    const next = writer.patches[0].episodes as ProjectEpisode[]
    assert.deepEqual(next.map((e) => Number(e.no)), [1, 2])
    assert.deepEqual(r.counts, { added: 2, updated: 0, total: 2 })
  })

  await check('服务端拒绝时返回失败且不回写快照', async () => {
    const project = baseProject([ep(1, '第一集')])
    let snap = project
    const ctx: ProjectDraftCtx = {
      projectName: 'demo',
      epNo: 1,
      getSnapshot: () => snap,
      setSnapshot: (p) => {
        snap = p
      },
      writer: {
        patch: async () => {
          throw new Error('服务端拒绝')
        },
        mergeShots: async () => {},
      },
    }
    const r = await applyProjectDraft('script-v1', { episodes: [ep(1, '改后')] }, ctx)
    assert.equal(r.ok, false)
    assert.ok(r.error && r.error.includes('服务端拒绝'))
    assert.equal((snap.episodes as ProjectEpisode[])[0].title, '第一集', '失败不得写回乐观快照')
  })

  await check('空 episodes 被拒绝且不落库', async () => {
    const writer: Writer = { patches: [] }
    const r = await applyProjectDraft('script-v1', { episodes: [] }, ctxOf(baseProject([ep(1, '第一集')]), writer))
    assert.equal(r.ok, false)
    assert.equal(writer.patches.length, 0)
  })

  await check('给 logline 时一并写回，不给时保持原值', async () => {
    const writer: Writer = { patches: [] }
    await applyProjectDraft(
      'script-v1',
      { episodes: [ep(1, '第一集')], logline: '新梗概' },
      ctxOf(baseProject([ep(1, '旧')]), writer),
    )
    assert.equal(writer.patches[0].logline, '新梗概')

    const writer2: Writer = { patches: [] }
    await applyProjectDraft('script-v1', { episodes: [ep(1, '第一集')] }, ctxOf(baseProject([ep(1, '旧')]), writer2))
    assert.equal(writer2.patches[0].logline, undefined, '未提交 logline 时不应覆盖')
  })

  await check('script-v1 契约拒绝缺 slug/place/time/beats 的场次', () => {
    const r = validateContract('script-v1', { episodes: [{ no: 1, scenes: [{ slug: 'only-slug' }] }] })
    assert.equal(r.ok, false)
  })

  console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 剧本写回全部通过')
  process.exit(bad ? 1 : 0)
}

void main()
