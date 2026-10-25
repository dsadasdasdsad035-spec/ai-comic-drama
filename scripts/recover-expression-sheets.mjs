/**
 * 一次性数据修复：把历史遗留的两张表情总图接回角色卡。
 * 依据：两张 2560×1440 总图与 16 张 640×720 裁剪格同批落盘、SSIM 0.998 匹配，
 * 且分别与林清雪/楚阳的三视图同一人。指纹按 src/expressionSheet.ts 的算法重算。
 * 跑法：node scripts/recover-expression-sheets.mjs [--dry]
 */
import fs from 'node:fs'
import path from 'node:path'
import { readProject, writeProject, resolveRoot } from '../server/db.mjs'

const ROOT = resolveRoot(process.cwd())
const PROJECT = 'a'
const DRY = process.argv.includes('--dry')

function fnv1a(str, seed) {
  let h = seed >>> 0
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}
const shortHash = (s) =>
  fnv1a(s, 0x811c9dc5).toString(16).padStart(8, '0') + fnv1a(s, 0x9e3779b9).toString(16).padStart(8, '0')

const EMOTIONS = ['neutral', 'happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised', 'calm']
const cellsFor = (crops) =>
  EMOTIONS.map((emotion, i) => ({
    emotion,
    x: (i % 4) * 0.25,
    y: Math.floor(i / 4) * 0.5,
    w: 0.25,
    h: 0.5,
    ...(crops?.[emotion] ? { cropUrl: crops[emotion] } : {}),
  }))

const identityFingerprint = (c) =>
  [String(c.look_en || '').trim(), String(c.palette || '').trim(), ...(c.keywords ?? [])].join('|')

const sheetFingerprint = (sheet) =>
  shortHash(
    JSON.stringify({
      image: sheet.image,
      identity: sheet.fingerprint,
      cells: sheet.cells.map((cell) => [cell.emotion, cell.x, cell.y, cell.w, cell.h]),
    }),
  )

const cropFingerprint = (sheet, cell) =>
  shortHash(
    JSON.stringify({
      image: sheet.image,
      identity: sheet.fingerprint,
      sheet: sheetFingerprint(sheet),
      cell: [cell.emotion, cell.x, cell.y, cell.w, cell.h],
    }),
  )

/** 把一张总图 + 八张裁剪组装成 expression_sheet（含指纹），坐标与 UI/裁剪保持一致 */
function buildSheet(character, sheetFile, crops) {
  const sheet = {
    image: `/project-assets/${PROJECT}/${sheetFile}`,
    columns: 4,
    rows: 2,
    cells: cellsFor(crops),
    source: 'generated',
    fingerprint: identityFingerprint(character),
    createdAt: new Date(
      fs.statSync(path.join(ROOT, PROJECT, 'assets', sheetFile)).mtimeMs,
    ).toISOString(),
  }
  sheet.cells = sheet.cells.map((cell) =>
    cell.cropUrl
      ? { ...cell, cropFingerprint: cropFingerprint(sheet, cell) }
      : cell,
  )
  return sheet
}

const findCrops = (stampPrefix) => {
  const dir = path.join(ROOT, PROJECT, 'assets')
  const out = {}
  for (const emotion of EMOTIONS) {
    const hit = fs
      .readdirSync(dir)
      .find((f) => f.startsWith(`char-expr-${emotion}-${stampPrefix}`))
    if (hit) out[emotion] = `/project-assets/${PROJECT}/${hit}`
  }
  return out
}

const targets = [
  {
    name: '林清雪',
    sheetFile: 'char-1792852808352-fa6e35.jpg',
    crops: findCrops('1792852808'),
  },
  {
    name: '楚阳',
    sheetFile: 'char-1792855183213-1a29f0.jpg',
    crops: findCrops('1792855183'),
  },
]

const project = readProject(ROOT, PROJECT)
const missingFiles = []
for (const t of targets) {
  if (!fs.existsSync(path.join(ROOT, PROJECT, 'assets', t.sheetFile))) missingFiles.push(t.sheetFile)
  for (const emotion of EMOTIONS) {
    if (!t.crops[emotion]) missingFiles.push(`${t.name}/${emotion}`)
  }
}
if (missingFiles.length) {
  console.error('缺文件，放弃修复：', missingFiles.join(', '))
  process.exit(1)
}

const backupFile = path.join(ROOT, PROJECT, `characters-backup-${Date.now()}.json`)
const next = project.characters.map((c) => {
  const t = targets.find((x) => x.name === c.name)
  if (!t) return c
  const sheet = buildSheet(c, t.sheetFile, t.crops)
  const usable =
    sheet.fingerprint === identityFingerprint(c) &&
    sheet.cells.every((cell) => cell.cropUrl && cell.cropFingerprint)
  console.log(
    `${usable ? '✅' : '❌'} ${c.name} ← ${t.sheetFile} | 8 格裁剪=${sheet.cells.filter((x) => x.cropUrl).length} | 指纹匹配=${sheet.fingerprint === identityFingerprint(c)}`,
  )
  return { ...c, expression_sheet: sheet }
})

if (DRY) {
  console.log('\n[dry] 未写入。备份路径会是：', backupFile)
  process.exit(0)
}

fs.writeFileSync(backupFile, JSON.stringify(project.characters, null, 2))
console.log('已备份原角色表 →', backupFile)
const saved = writeProject(ROOT, PROJECT, { characters: next })
const check = saved.characters.filter((c) => targets.some((t) => t.name === c.name))
console.log(
  `写回完成：${check.map((c) => `${c.name}=${c.expression_sheet?.cells?.length ?? 0}格`).join('，')}`,
)
