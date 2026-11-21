/**
 * 镜间接缝：joins-v1 契约、applyJoinsToShots。
 * 生成式转场已退役，本脚本只验证效果接缝的写入与校验。
 * 跑法：node verify-joins.mjs
 */
import { build } from 'esbuild'

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

const bundle = async (entry) => {
  const out = await build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    logLevel: 'error',
  })
  return await import(
    'data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64')
  )
}

const contracts = await bundle('src/skills/contracts.ts')
const joins = await bundle('src/shotJoins.ts')

const shot = (id, no, ep = 1) => ({
  id,
  no,
  episode: ep,
  seconds: 3,
  desc: 'test',
  scene_no: '1',
  size: '中景',
})

const s1 = shot('sh1', 'S01')
const s2 = shot('sh2', 'S02')
const s3 = shot('sh3', 'S03')

const sampleJoins = {
  joins: [
    { after_no: 'S01', to_no: 'S02', relation: 'cut' },
    {
      after_no: 'S02',
      to_no: 'S03',
      relation: 'transition',
      mode: 'effect',
      effect: { preset_id: 'wipe', type: 'wipe', seconds: 0.6 },
    },
  ],
}

{
  const v = contracts.validateContract('joins-v1', sampleJoins)
  check('joins-v1 样例通过校验', v.ok, v.ok ? '' : v.errors?.join(';'))
}

{
  const r = joins.applyJoinsToShots([s1, s2, s3], sampleJoins.joins)
  check('applyJoins 写入 2 条', r.applied === 2, String(r.applied))
  check('硬切清空 transition_out', r.shots[0].transition_out == null)
  check('效果转场写入 S02', r.shots[1].transition_out?.mode === 'effect')
  check('预设透传', r.shots[1].transition_out?.effect?.seconds === 0.6)
  check('issues 为空', r.issues.length === 0)
}

// ---- 生成模式已被契约拒绝 ----
{
  const v = contracts.validateContract('joins-v1', {
    joins: [
      {
        after_no: 'S01',
        to_no: 'S02',
        relation: 'transition',
        mode: 'generated',
        generated: { prompt: '桥接', target_seconds: 1.5 },
      },
    ],
  })
  check('mode: generated 被拒绝', !v.ok, JSON.stringify(v.errors || []).slice(0, 120))
}

// ---- 不合法镜号 ----
{
  const badId = joins.applyJoinsToShots([s1, s2], [
    { after_no: 'S99', to_no: 'S02', relation: 'transition', mode: 'effect' },
  ])
  check('无效镜号产生 issue', badId.issues.length === 1)
}

// ---- 播放序 ----
{
  const next = joins.nextShotInEpisodeOrder([s1, s2, s3], s1)
  check('播放序下一镜', next?.id === 'sh2')
}

// ---- 摘要 ----
{
  check(
    '效果接缝摘要',
    joins.seamSummary(
      { to: 'sh2', mode: 'effect', effect: { type: 'wipe', dir: 'right', seconds: 0.6 } },
      'transition',
    ) === '效果 wipe-right 0.6s',
  )
  check('硬切摘要', joins.seamSummary(null, 'cut') === '硬切')
}

process.exit(bad ? 1 : 0)
