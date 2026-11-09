/**
 * 镜间接缝：joins-v1 契约、applyJoinsToShots、食谱 id 解析。
 * 跑法：node verify-joins.mjs
 */
import { build } from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
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
    'data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'),
  )
}

const contracts = await bundle('src/skills/contracts.ts')
const joins = await bundle('src/shotJoins.ts')
const recipes = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/transitionRecipes.json'), 'utf8'))

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
      mode: 'generated',
      taxonomy: 'character',
      recipe_ids: ['match-cut-action'],
      generated: {
        prompt: '动作中段顺势接下一镜',
        sound_prompt: '脚步声连续',
        target_seconds: 1.5,
        taxonomy: 'character',
      },
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
  check('生成转场写入 S02', r.shots[1].transition_out?.mode === 'generated')
  check('taxonomy 透传', r.shots[1].transition_out?.generated?.taxonomy === 'character')
  check('recipeIds 透传', r.shots[1].transition_out?.generated?.recipeIds?.includes('match-cut-action'))
  check('issues 为空', r.issues.length === 0)
}

check('食谱 ≥40 条', recipes.length >= 40, String(recipes.length))
check(
  '食谱含 taxonomy',
  recipes.every((r) => r.taxonomy),
  String(recipes.filter((r) => !r.taxonomy).length),
)
const ids = new Set(recipes.map((r) => r.id))
check('match-cut-action 存在', ids.has('match-cut-action'))

{
  const badId = joins.applyJoinsToShots([s1, s2], [
    { after_no: 'S99', to_no: 'S02', relation: 'transition', mode: 'generated' },
  ])
  check('无效镜号产生 issue', badId.issues.length === 1)
}

{
  const next = joins.nextShotInEpisodeOrder([s1, s2, s3], s1)
  check('播放序下一镜', next?.id === 'sh2')
}

process.exit(bad ? 1 : 0)
