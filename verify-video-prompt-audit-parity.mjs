/**
 * 浏览器侧映射与审计核的口径一致性验收（5.1）。
 *
 * `auditVideoPrompt`（浏览器，src/promptAudit.ts）只做字段换算，
 * 判定必须与 `auditVideoPromptCore`（工具写回）完全一致：
 * 同一镜头在两条路径下返回相同的 check id / applicable / ok。
 *
 * 跑法：node verify-video-prompt-audit-parity.mjs
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const ESBUILD = path.join(ROOT, 'node_modules', '.bin', 'esbuild')
// 产物必须落在仓库内：/tmp 下解析不到 node_modules
const tmp = fs.mkdtempSync(path.join(ROOT, '.verify-vpa-parity-'))
const out = path.join(tmp, 'entry.mjs')

fs.writeFileSync(
  path.join(tmp, 'entry.ts'),
  `
import { auditVideoPrompt } from ${JSON.stringify(path.join(ROOT, 'src/promptAudit.ts'))}
import { auditVideoPromptCore } from ${JSON.stringify(path.join(ROOT, 'src/promptAuditCore.mjs'))}
import { AUDIT_VOCAB } from ${JSON.stringify(path.join(ROOT, 'src/videoPromptVocab.ts'))}
export { auditVideoPrompt, auditVideoPromptCore, AUDIT_VOCAB }
`,
)

execFileSync(
  ESBUILD,
  [path.join(tmp, 'entry.ts'), '--bundle', '--platform=node', '--format=esm', '--packages=external', '--alias:@=./src', '--log-level=error', `--outfile=${out}`],
  { cwd: ROOT, stdio: 'inherit' },
)

const { auditVideoPrompt, auditVideoPromptCore, AUDIT_VOCAB } = await import(out)

let bad = 0
const unit = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

const episodes = [
  {
    no: 1,
    title: '第一集',
    scenes: [
      { no: 1, slug: 'EP001-SC001', place: '咖啡厅', time: '夜', beats: '暴雨。更鼓敲过三响。' },
      { no: 2, slug: 'EP001-SC002', place: '后巷', time: '夜', beats: '两人对坐。' },
    ],
  },
]

const episodeShots = [
  {
    id: 'E01-S01',
    episode: 1,
    no: 'S01',
    seconds: 4,
    size: '中景',
    move: '固定',
    desc: '雨夜推门',
    scene_no: 1,
    scene_slug: 'EP001-SC001',
    video_prompt: '中景构图，机位保持固定。她推开木门走进来。',
    dialogue: [{ speaker: '林一', text: '你来了' }],
    cast: ['林一'],
    refIds: ['char-林一'],
  },
  {
    id: 'E01-S02',
    episode: 1,
    no: 'S02',
    seconds: 4,
    size: '中景',
    move: '固定',
    desc: '后巷对视',
    scene_no: 2,
    scene_slug: 'EP001-SC002',
    video_prompt: '中景，机位固定，她走进来，最终停在门边。',
    dialogue: [],
    cast: [],
    refIds: [],
  },
]

const characters = [
  { id: 'c1', name: '林一', lookEn: 'short black hair', lookCn: '短发' },
]

const shot = episodeShots[0]

/* ---- 浏览器路径 ---- */
const viaBrowser = auditVideoPrompt({
  shot,
  episodeShots,
  episodes,
  chars: characters,
  refs: [{ kind: 'character', name: '林一' }],
  castSceneNames: ['咖啡厅'],
  propNames: [],
})

/* ---- 核心路径（手工复刻浏览器映射的入参） ---- */
const viaCore = auditVideoPromptCore(shot, {
  vocab: AUDIT_VOCAB,
  sceneBeats: '暴雨。更鼓敲过三响。',
  refs: [{ kind: 'character', name: '林一' }],
  chars: [{ name: '林一', lookEn: 'short black hair' }],
  castSceneNames: ['咖啡厅'],
  propNames: [],
  dialogueSource: [
    '暴雨。更鼓敲过三响。',
    '两人对坐。',
    ...episodeShots.map((s) => `${s.desc} ${JSON.stringify(s.dialogue)}`),
    '林一 短发 short black hair',
  ].join('\n'),
  nextShot: episodeShots[1],
  isLastShot: false,
})

const key = (c) => `${c.id}:${c.applicable}:${c.ok}:${c.level}`
const bKeys = viaBrowser.checks.map(key).sort()
const cKeys = viaCore.checks.map(key).sort()

unit('两条路径检查项数一致', bKeys.length === cKeys.length, `${bKeys.length} vs ${cKeys.length}`)
unit(
  '两条路径 id/applicable/ok/level 完全一致',
  JSON.stringify(bKeys) === JSON.stringify(cKeys),
  bKeys.filter((k) => !cKeys.includes(k)).join(',') || '',
)
unit(
  '两条路径 blocker 一致',
  JSON.stringify(viaBrowser.blockers.map((c) => c.id).sort()) ===
    JSON.stringify(viaCore.blockers.map((c) => c.id).sort()),
  viaBrowser.blockers.map((c) => c.id).join(','),
)

console.log(bad ? `\nverify-video-prompt-audit-parity: ${bad} failed` : '\nverify-video-prompt-audit-parity: all green')
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(bad ? 1 : 0)
