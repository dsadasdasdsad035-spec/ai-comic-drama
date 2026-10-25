/**
 * 表演契约回归：旧输出兼容、新输出映射、说话角色缺表演拒绝、技能规则存在。
 * 跑法：node verify-performance-skills.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-performance-skills-'))
const entry = path.join(tmp, 'entry.ts')
const abs = (p) => JSON.stringify(path.join(root, p))
fs.writeFileSync(
  entry,
  [`export * from ${abs('src/skills/contracts.ts')}`, `export * from ${abs('src/agent/shotDraft.ts')}`].join('\n') + '\n',
)
const bundle = path.join(tmp, 'bundle.mjs')
execFileSync(path.join(root, 'node_modules', '.bin', 'esbuild'), [
  entry,
  '--bundle',
  '--platform=node',
  '--format=esm',
  '--log-level=error',
  `--outfile=${bundle}`,
])
const lib = await import(bundle)

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

const episodes = [{ no: 1, scenes: [{ no: 1, slug: '街口' }] }]
const oldOutput = {
  shots: [
    {
      no: 'S01',
      scene_no: 1,
      scene_slug: '街口',
      seconds: 3,
      size: '中景',
      move: '固定',
      desc: '陈默站在雨里',
      dialogue: [{ speaker: '陈默', text: '你来了。' }],
      cast: ['陈默'],
    },
  ],
}
const newOutput = {
  shots: [
    {
      ...oldOutput.shots[0],
      performance: [
        { character: '陈默', emotion: 'angry', intensity: 4, action: '压住桌沿', gaze: '林岚', speaks: true },
      ],
      dialogue: [{ speaker: '陈默', text: '你来了。', emotion: 'angry', intensity: 4, pace: 'slow', volume: 'soft' }],
    },
  ],
}

check('旧 shots 输出可通过契约', lib.validateContract('shots-v1', oldOutput).ok)
check('新 shots 输出可通过契约', lib.validateContract('shots-v1', newOutput).ok)

const oldBuilt = lib.buildShotsFromModel(oldOutput.shots, episodes, 1)
check('旧输出：表演为空', oldBuilt.shots[0].performance === undefined && oldBuilt.shots[0].dialogue_delivery === undefined)
check('旧输出：场次回退计数不变', oldBuilt.sceneFallback === 0 && oldBuilt.shots[0].scene_no === 1)

const newBuilt = lib.buildShotsFromModel(newOutput.shots, episodes, 1)
check('新输出：表演映射', newBuilt.shots[0].performance?.[0]?.action === '压住桌沿')
check('新输出：台词表演映射', newBuilt.shots[0].dialogue_delivery?.[0]?.pace === 'slow')
check('新输出：台词文本仍干净', newBuilt.shots[0].dialogue[0].text === '你来了。')

let rejected = ''
try {
  lib.buildShotsFromModel(
    [
      {
        ...newOutput.shots[0],
        performance: [{ character: '林岚', emotion: 'sad', intensity: 2 }],
      },
    ],
    episodes,
    1,
  )
} catch (e) {
  rejected = e.message
}
check('说话角色缺表演：拒绝写入', rejected.includes('缺少说话角色表演') && rejected.includes('陈默'), rejected)

const promptSkill = fs.readFileSync(path.join(root, 'skills/prompt/SKILL.md'), 'utf8')
const shotSkill = fs.readFileSync(path.join(root, 'skills/shotlist/SKILL.md'), 'utf8')
const charSkill = fs.readFileSync(path.join(root, 'skills/character/SKILL.md'), 'utf8')
check('提示词技能：表情与说话状态规则', promptSkill.includes('本镜表情') && promptSkill.includes('说话中的面部'))
check('提示词技能：cast/performance 输入说明', promptSkill.includes('cast、performance'))
check('拆镜技能：performance 输出', shotSkill.includes('"performance"') && shotSkill.includes('有台词的角色必须有条目'))
check('角色技能：身份与表情分离', charSkill.includes('身份与表情分离') && charSkill.includes('不自动生成'))

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
