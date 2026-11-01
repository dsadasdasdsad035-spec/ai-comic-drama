/**
 * 工具契约的声明形状验收：
 * 1) 六个业务契约的必填字段覆盖「不可省略」的业务字段
 * 2) input 语义：带默认值的可选字段不得进入 required
 * 3) 契约仍可直接转成 JSON Schema（原生工具声明的前提）
 *
 * 跑法：node verify-tool-contracts.mjs
 */
import { build } from 'esbuild'

const out = await build({
  entryPoints: ['src/skills/contracts.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
})
const lib = await import(
  'data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64')
)

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

const json = (id) => {
  const schema = lib.getContractSchema(id)
  if (!schema) throw new Error(`缺少契约：${id}`)
  const out = schema.toJSONSchema({ io: 'input' })
  delete out.$schema
  delete out.$id
  return out
}

// ---------------------------------------------------------------- 必填覆盖
{
  const script = json('script-v1')
  const scene = script.properties.episodes.items.properties.scenes.items
  const need = ['slug', 'place', 'time', 'beats']
  check(
    'script-v1 场次必填叙事字段',
    need.every((k) => scene.required?.includes(k)),
    JSON.stringify(scene.required),
  )
  check(
    'script-v1 风格字段仍可选',
    !scene.required?.includes('intensity') && !scene.required?.includes('tone'),
    JSON.stringify(scene.required),
  )
}

{
  const shots = json('shots-v1')
  const shot = shots.properties.shots.items
  const need = ['no', 'scene_no', 'seconds', 'size', 'desc']
  check(
    'shots-v1 必填可生产字段',
    need.every((k) => shot.required?.includes(k)),
    JSON.stringify(shot.required),
  )
  check(
    'shots-v1 对白与表演仍可选',
    !shot.required?.includes('dialogue') && !shot.required?.includes('performance'),
    JSON.stringify(shot.required),
  )
}

{
  const prompts = json('prompts-v1')
  const shot = prompts.properties.shots.items
  check(
    'prompts-v1 必填两段提示词',
    ['no', 'keyframe_prompt', 'video_prompt'].every((k) => shot.required?.includes(k)),
    JSON.stringify(shot.required),
  )
}

{
  const reverse = json('reverse-v1')
  const shot = reverse.properties.shots.items
  check(
    'reverse-v1 必填时间与两段提示词',
    ['start', 'end', 'size', 'keyframe_prompt', 'video_prompt'].every((k) =>
      shot.required?.includes(k),
    ),
    JSON.stringify(shot.required),
  )
  check(
    'reverse-v1 evidence_frames 不进 required',
    !shot.required?.includes('evidence_frames'),
    JSON.stringify(shot.required),
  )
}

for (const id of ['characters-v1', 'designs-v1']) {
  const schema = lib.getContractSchema(id)
  const item = schema.def?.type === 'union' ? schema.def.options?.[0] : schema
  void item
  // 空数组是合法结果；只要求条目上的 name，不接受「有外壳没内容」的必填升级。
  const res = lib.validateContract(id, id === 'characters-v1' ? { characters: [] } : { scenes: [], props: [] })
  check(`${id} 允许空结果`, res.ok === true, JSON.stringify(res).slice(0, 120))
}

// ---------------------------------------------------------------- input 语义
{
  const designs = json('designs-v1')
  check(
    'designs-v1 带默认值的数组不进 required',
    !designs.required?.includes('scenes') && !designs.required?.includes('props'),
    JSON.stringify(designs.required),
  )
}

// ---------------------------------------------------------------- 校验不变
{
  const emptyShot = lib.validateContract('shots-v1', { shots: [{ no: 'S01' }] })
  check('shots-v1 拒绝只有镜号的空镜头', emptyShot.ok === false, JSON.stringify(emptyShot.errors || '').slice(0, 140))

  const okShot = lib.validateContract('shots-v1', {
    shots: [
      {
        no: 'S01',
        scene_no: 1,
        scene_slug: '街口',
        seconds: 3,
        size: '中景',
        move: '固定',
        desc: '雨夜街口，陈默冲进雨里',
      },
    ],
  })
  check('shots-v1 接受完整镜头', okShot.ok === true, JSON.stringify(okShot).slice(0, 120))

  const badScene = lib.validateContract('script-v1', {
    episodes: [{ no: 1, scenes: [{ slug: '街口' }] }],
  })
  check('script-v1 拒绝缺叙事字段的场次', badScene.ok === false, JSON.stringify(badScene.errors || '').slice(0, 140))

  const emptyEpisodes = lib.validateContract('script-v1', { episodes: [] })
  check('script-v1 仍拒绝空分集', emptyEpisodes.ok === false)
}

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 工具契约声明验收通过')
process.exit(bad ? 1 : 0)
