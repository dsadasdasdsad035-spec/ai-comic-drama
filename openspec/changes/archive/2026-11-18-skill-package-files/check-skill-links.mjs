/**
 * 技能包链接完整性检查：正文里指向同包文件的本地链接，是否真的能在磁盘上读到。
 *
 * 只统计 markdown 链接目标指向的包内相对路径，例如 `](references/x.md)`。
 * 不统计反引号里的路径：那多半是正文举例或命令片段，不是「这个文件必须存在」的承诺。
 * 跳过外链、纯锚点、占位符（含 < > * { } 的模板路径）。
 *
 * 用法：node openspec/changes/archive/2026-11-18-skill-package-files/check-skill-links.mjs [--json]
 * 需要 dev server 在 5273 上跑着（读的是当前生效正文，而不是磁盘裸文件）。
 */
import fs from 'node:fs'
import path from 'node:path'

const APP = process.env.APP_URL || 'http://127.0.0.1:5273'
const ROOT = process.cwd()
const JSON_OUT = process.argv.includes('--json')

/** 包内文件常见的顶层目录；正文里出现这些前缀才当作本地链接 */
const PKG_DIRS = ['references/', 'scripts/', 'assets/', 'examples/', 'agents/']
const EXTERNAL = /^(https?:|mailto:|data:|#|\/)/i

function extractCandidates(text) {
  // markdown 链接与图片：`[文字](target)` / `![alt](target)`
  return [...text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map((m) => m[1])
}

function normalize(raw) {
  let s = String(raw || '').trim()
  if (!s || EXTERNAL.test(s)) return null
  s = s.replace(/^\.\//, '')
  s = s.split('#')[0].split('?')[0]
  if (!s) return null
  // 模板占位符与通配不是真实路径
  if (/[<>*{}$]/.test(s)) return null
  const hasPkgDir = PKG_DIRS.some((d) => s.startsWith(d) || s.includes('/' + d))
  if (!hasPkgDir) return null
  // 去掉前缀路径，只保留从包目录开始的部分
  const idx = PKG_DIRS.map((d) => s.indexOf(d)).filter((i) => i >= 0).sort((a, b) => a - b)[0]
  s = s.slice(idx)
  if (s.endsWith('/')) return null
  return s
}

const res = await fetch(`${APP}/api/skills`)
if (!res.ok) {
  console.error(`GET /api/skills 失败：HTTP ${res.status}`)
  process.exit(1)
}
const { skills } = await res.json()

let total = 0
const missing = []
const perSkill = []

for (const s of skills) {
  const candidates = extractCandidates(s.text || '')
  const links = [...new Set(candidates.map(normalize).filter(Boolean))]
  if (!links.length) continue
  let miss = 0
  for (const rel of links) {
    total++
    const candidatesDirs = [
      path.join(ROOT, 'installed-skills', s.id),
      path.join(ROOT, 'skills', s.id),
    ].filter((d) => fs.existsSync(d))
    const hit = candidatesDirs.some((d) => {
      try {
        return fs.statSync(path.join(d, rel)).isFile()
      } catch {
        return false
      }
    })
    if (!hit) {
      miss++
      missing.push({ id: s.id, path: rel, source: s.source })
    }
  }
  perSkill.push({ id: s.id, links: links.length, missing: miss, source: s.source })
}

if (JSON_OUT) {
  console.log(JSON.stringify({ total, missing: missing.length, perSkill, detail: missing }, null, 2))
} else {
  for (const r of perSkill.sort((a, b) => b.missing - a.missing)) {
    if (r.missing) console.log(`  ${r.id.padEnd(30)} 链接 ${r.links} / 缺失 ${r.missing}（${r.source}）`)
  }
  console.log(`\n本地链接 ${total} 处，缺失 ${missing.length} 处`)
  if (missing.length) {
    const byId = new Map()
    for (const m of missing) byId.set(m.id, [...(byId.get(m.id) || []), m.path])
    for (const [id, paths] of byId) {
      console.log(`\n[${id}] 缺失 ${paths.length}：`)
      for (const p of [...new Set(paths)].slice(0, 6)) console.log(`  - ${p}`)
    }
  }
}

process.exit(missing.length ? 1 : 0)
