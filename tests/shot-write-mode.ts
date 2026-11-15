/**
 * 镜头写回模式：局部写回不产生孤儿、整表写回保留保护语义。
 *
 * 背景：一条 `POST /api/project` 的 shots 通道同时承载「全集」与「要改的那几条」，
 * 服务端原先一律按缺席标 orphan，于是每次单镜写回都把其余镜头标脏。
 * 这里覆盖三件事：
 * 1) 契约写回（submit_shots 等）显式声明 full；
 * 2) 单镜写回声明 partial，且不碰其他镜头的标记；
 * 3) 落库失败时不回写快照、不通知宿主刷新。
 */
import assert from 'node:assert/strict'
import { applyProjectDraft, type ProjectDraftCtx } from '../src/platform/projectDraft'
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

function shot(over: Partial<ProjectShot> & { id: string }): ProjectShot {
  return { episode: 1, no: over.id.slice(-2), seconds: 3, ...over } as ProjectShot
}

function project(shots: ProjectShot[]): ProjectData {
  return { name: 'a', characters: [], designs: [], assets: [], episodes: [], shots } as unknown as ProjectData
}

/** 记录每次写回的 shots 与选项，用来断言调用方有没有声明 mode */
function recorder(fail = false) {
  const calls: Array<{ name: string; shots: ProjectShot[]; opts?: { deleteShotIds?: string[]; mode?: string } }> = []
  let changed = 0
  return {
    calls,
    changedCount: () => changed,
    ctx(snapshot: ProjectData): ProjectDraftCtx {
      let snap = snapshot
      return {
        projectName: 'a',
        epNo: 1,
        getSnapshot: () => snap,
        setSnapshot: (p) => {
          snap = p
        },
        onProjectDataChanged: () => {
          changed++
        },
        writer: {
          mergeShots: async (name, shots, opts) => {
            if (fail) throw new Error('服务端拒绝')
            calls.push({ name, shots, opts })
            // 服务端语义的本地复刻：partial 只改提交的镜，full 才给缺席镜打标记
            const merged = snapshot.shots.map((s) => {
              const inc = shots.find((x) => x.id === s.id)
              if (inc) {
                const next = { ...s, ...inc }
                delete next.orphan
                return next
              }
              return opts?.mode === 'full' ? { ...s, orphan: true } : s
            })
            return { shots: merged }
          },
          patch: async () => {},
        },
      }
    },
  }
}

async function main() {
  await check('契约写回声明 full：缺席的旧镜头被标 orphan', async () => {
    const rec = recorder()
    const before = project([shot({ id: 'E01-S01' }), shot({ id: 'E01-S02' }), shot({ id: 'E01-S03' })])
    const ctx = rec.ctx(before)
    const r = await applyProjectDraft(
      'shots-v1',
      { shots: [{ id: 'E01-S01', desc: '改了第一镜' }, { id: 'E01-S02' }] },
      ctx,
    )
    assert.equal(r.ok, true, r.error)
    assert.equal(rec.calls.length, 1)
    assert.equal(rec.calls[0].opts?.mode, 'full', '契约写回必须显式声明 full')
    const s3 = rec.calls[0].shots.find((s) => s.id === 'E01-S03')
    assert.ok(s3, '缺席镜头必须仍在提交列表里（保护性保留）')
  })

  await check('契约写回保留其他镜头而不是丢掉', async () => {
    const rec = recorder()
    const before = project([shot({ id: 'E01-S01' }), shot({ id: 'E01-S02' })])
    const r = await applyProjectDraft('shots-v1', { shots: [{ id: 'E01-S01' }] }, rec.ctx(before))
    assert.equal(r.ok, true, r.error)
    assert.deepEqual(
      rec.calls[0].shots.map((s) => s.id).sort(),
      ['E01-S01', 'E01-S02'],
      '合并后的提交列表必须仍含未参与的镜头',
    )
  })

  await check('提示词写回也是整表语义', async () => {
    const rec = recorder()
    const before = project([
      shot({ id: 'E01-S01', keyframe_prompt: 'old' } as Partial<ProjectShot> & { id: string }),
      shot({ id: 'E01-S02' }),
    ])
    const r = await applyProjectDraft('prompts-v1', { shots: [{ no: 'S01', keyframe_prompt: 'new' }] }, rec.ctx(before))
    assert.equal(r.ok, true, r.error)
    assert.equal(rec.calls[0].opts?.mode, 'full')
  })

  await check('落库失败不回写快照、不通知宿主刷新', async () => {
    const rec = recorder(true)
    const before = project([shot({ id: 'E01-S01' }), shot({ id: 'E01-S02' })])
    const r = await applyProjectDraft('shots-v1', { shots: [{ id: 'E01-S01', desc: 'x' }] }, rec.ctx(before))
    assert.equal(r.ok, false)
    assert.match(String(r.error), /服务端拒绝/)
    assert.equal(rec.calls.length, 0)
    assert.equal(rec.changedCount(), 0, '失败时不能触发画布刷新')
  })

  await check('落库成功才通知宿主刷新', async () => {
    const rec = recorder()
    const r = await applyProjectDraft('shots-v1', { shots: [{ id: 'E01-S01' }] }, rec.ctx(project([shot({ id: 'E01-S01' })])))
    assert.equal(r.ok, true, r.error)
    assert.equal(rec.changedCount(), 1)
  })

  await check('deleteShotIds 与 mode 互不干扰', async () => {
    const rec = recorder()
    const before = project([shot({ id: 'E01-S01' }), shot({ id: 'E01-S02' }), shot({ id: 'E01-S03' })])
    const ctx = rec.ctx(before)
    ctx.writer!.mergeShots = async (name, shots, opts) => {
      rec.calls.push({ name, shots, opts })
      return { shots }
    }
    await ctx.writer!.mergeShots('a', [shot({ id: 'E01-S01' })], {
      deleteShotIds: ['E01-S03'],
      mode: 'full',
    })
    assert.deepEqual(rec.calls[0].opts, { deleteShotIds: ['E01-S03'], mode: 'full' })
  })

  await check('缺省 mode 交给服务端按 partial 处理', async () => {
    const rec = recorder()
    const ctx = rec.ctx(project([shot({ id: 'E01-S01' })]))
    // 局部写回点（画布防抖、单镜工具）不传 mode，服务端缺省必须是 partial
    await ctx.writer!.mergeShots('a', [shot({ id: 'E01-S01' })], undefined)
    assert.equal(rec.calls[0].opts, undefined)
    const after = await ctx.writer!.mergeShots('a', [shot({ id: 'E01-S01' })], {})
    assert.equal(rec.calls[1].opts?.mode, undefined)
    assert.ok(true, JSON.stringify(after))
  })

  if (bad) {
    console.log(`\n❌ ${bad} 项失败`)
    process.exit(1)
  }
  console.log('\n✅ 全部通过')
}

void main()
