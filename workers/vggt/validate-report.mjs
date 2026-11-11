/**
 * 校验 report v1 结构（无 ajv 依赖的轻量检查）。
 * 用法：node workers/vggt/validate-report.mjs [report.json]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = path.dirname(fileURLToPath(import.meta.url))
const file = process.argv[2] || path.join(__dir, 'report.sample.json')

function fail(msg) {
  console.error('❌', msg)
  process.exit(1)
}

function checkReport(j) {
  if (j?.version !== 1) fail('version 必须为 1')
  if (!String(j?.sourceFingerprint || '').length) fail('缺少 sourceFingerprint')
  const conf = j?.confidence
  if (!['high', 'medium', 'low'].includes(conf)) fail('confidence 无效')
  if (!Array.isArray(j?.keyframes) || !j.keyframes.length) fail('keyframes 为空')
  for (const k of j.keyframes) {
    if (!Number.isFinite(k.t)) fail('keyframes.t 无效')
    if (!Array.isArray(k.position) || k.position.length !== 3) fail('keyframes.position 无效')
    if (!Array.isArray(k.rotationQuat) || k.rotationQuat.length !== 4) fail('keyframes.rotationQuat 无效')
    if (!Number.isFinite(k.fovDeg)) fail('keyframes.fovDeg 无效')
    if (!Number.isFinite(k.confidence) || k.confidence < 0 || k.confidence > 1) fail('keyframes.confidence 无效')
  }
  if (!String(j?.motionSummaryZh || '').trim()) fail('缺少 motionSummaryZh')
  if (!Array.isArray(j?.warnings)) fail('warnings 必须为数组')
  const probe = j?.probe
  if (!probe || typeof probe !== 'object') fail('缺少 probe')
}

let raw
try {
  raw = JSON.parse(fs.readFileSync(file, 'utf8'))
} catch (e) {
  fail(`无法读取 ${file}: ${e?.message || e}`)
}
checkReport(raw)
console.log(`✅ ${file} 通过 report v1 校验`)
