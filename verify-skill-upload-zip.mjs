/**
 * 技能 zip 上传与 SkillHub 安装（本地 mock）验收。
 * 跑法：node verify-skill-upload-zip.mjs
 */
import { createServer } from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { strToU8, zipSync } from 'fflate'
import { createCheck, makeProjectsDir, startApp } from './verify-harness.mjs'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const PORT = 5338
const SKILL_ID = 'verify-upload-fixture'
const AGENT_PACK_ID = 'verify-agent-pack'
const HUB_SLUG = 'verify-mock-hub-skill'
const HUB_NS = 'verify-ns'

const SKILL_MD = `---
name: ${SKILL_ID}
description: zip 上传验收夹具（Agent 包）
---
## ${SKILL_ID}
按说明操作；写分镜用内置 submit_shots。
`

const HUB_SKILL_MD = `---
name: ${HUB_SLUG}
description: SkillHub mock Agent 包
---
## ${HUB_SLUG}
mock
`

function zipFromTree(entries) {
  const map = {}
  for (const [p, text] of entries) {
    map[p] = strToU8(text)
  }
  return Buffer.from(zipSync(map))
}

const AGENT_PACK_MD = `---
name: ${AGENT_PACK_ID}
description: |
  SkillHub Agent 包验收
allowed-tools:
  - Read
  - Bash
---
## ${AGENT_PACK_ID}
按 SKILL 操作。
`

const zipUpload = zipFromTree([
  [`${SKILL_ID}/SKILL.md`, SKILL_MD],
])

const GUIDE_TEXT = '# 参考\n这一段必须原样落盘。\n'

/** 3.1：带 references 的上传包，用于验证附件真的落盘并能被列出 */
const zipUploadWithRefs = zipFromTree([
  [`${SKILL_ID}/SKILL.md`, SKILL_MD],
  [`${SKILL_ID}/references/guide.md`, GUIDE_TEXT],
])

const zipAgentPack = zipFromTree([[`${AGENT_PACK_ID}/SKILL.md`, AGENT_PACK_MD]])

const zipHub = zipFromTree([
  [`${HUB_SLUG}/SKILL.md`, HUB_SKILL_MD],
  [`${HUB_SLUG}/references/guide.md`, GUIDE_TEXT],
])

let bad = 0
const unit = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-skill-zip-'))
const esbuild = path.join(ROOT, 'node_modules', '.bin', 'esbuild')

function bundle(entry, name) {
  const out = path.join(outDir, `${name}.mjs`)
  execFileSync(esbuild, [entry, '--bundle', '--platform=node', '--format=esm', '--log-level=error', `--outfile=${out}`])
  return out
}

const zipMod = await import(bundle(path.join(ROOT, 'server', 'skillZip.mjs'), 'skillZip'))

const extracted = zipMod.extractSkillMdFromZip(zipUpload)
unit('zip 解压找到 SKILL.md', extracted.path.endsWith('SKILL.md') && extracted.text.includes('name: verify-upload-fixture'))
unit(
  'manifestName 解析',
  zipMod.manifestNameFromSkillText(SKILL_MD) === SKILL_ID,
  zipMod.manifestNameFromSkillText(SKILL_MD),
)
unit('双层目录剥离为 SKILL.md', extracted.path === 'SKILL.md', extracted.path)

// 1.3：全量条目 —— references 必须一起解出来，不能只挑 SKILL.md
const zipWithRefs = zipUploadWithRefs
const pkg = zipMod.parseSkillPackage(zipWithRefs)
const pkgPaths = pkg.files.map((f) => f.path).sort()
unit(
  '全量条目含 references',
  pkgPaths.join(',') === 'SKILL.md,references/guide.md',
  pkgPaths.join(','),
)
const guideFile = pkg.files.find((f) => f.path === 'references/guide.md')
unit(
  'references 字节一致',
  Boolean(guideFile) && Buffer.from(guideFile.data).toString('utf8') === GUIDE_TEXT,
)

// 1.2：越界路径与符号链接条目都必须拒绝，且错误点名具体条目
try {
  zipMod.parseSkillPackage(zipFromTree([[`${SKILL_ID}/../escape.md`, 'x']]))
  unit('越界路径被拒绝', false)
} catch (e) {
  unit('越界路径被拒绝', String(e.message).includes('越界') && String(e.message).includes('escape.md'), e.message)
}

/** fflate 不写 unix mode，这里补一个中央目录补丁，把条目声明成符号链接。 */
function zipWithSymlinkEntry(name, target) {
  const buf = Buffer.from(zipSync({ [name]: strToU8(target) }))
  const cd = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  if (cd < 0) throw new Error('zipSync 产物缺少中央目录')
  buf.writeUInt16LE(0x0314, cd + 4) // version made by：高字节 3 = unix 宿主
  buf.writeUInt32LE((0xa1ff << 16) >>> 0, cd + 38) // external attrs：unix mode 0o120777
  return buf
}

try {
  zipMod.parseSkillPackage(zipWithSymlinkEntry(`${SKILL_ID}/link.md`, '../../etc/passwd'))
  unit('符号链接条目被拒绝', false)
} catch (e) {
  unit('符号链接条目被拒绝', String(e.message).includes('符号链接') && String(e.message).includes('link.md'), e.message)
}

try {
  zipMod.extractSkillMdFromZip(zipSync({ 'readme.txt': strToU8('no skill') }))
  unit('无 SKILL.md 应失败', false)
} catch (e) {
  unit('无 SKILL.md 应失败', String(e.message).includes('未找到'))
}

const mockHub = createServer((req, res) => {
  const u = new URL(req.url || '/', 'http://127.0.0.1')
  if (u.pathname === `/api/v1/skills/${HUB_SLUG}`) {
    res.setHeader('Content-Type', 'application/json')
    res.end(
      JSON.stringify({
        skill: { slug: HUB_SLUG, displayName: 'Mock Hub Skill' },
        namespace: { handle: HUB_NS },
        latestVersion: { version: '1.0.0' },
      }),
    )
    return
  }
  if (u.pathname === '/api/v1/download') {
    res.setHeader('Content-Type', 'application/zip')
    res.end(zipHub)
    return
  }
  if (u.pathname === '/api/skills') {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ code: 0, data: { skills: [], total: 0 } }))
    return
  }
  if (u.pathname === '/api/v1/categories') {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ items: [{ key: 'other', name: '其他', active: true }] }))
    return
  }
  res.statusCode = 404
  res.end('not found')
})

await new Promise((resolve) => mockHub.listen(0, '127.0.0.1', resolve))
const mockPort = mockHub.address().port
const mockBase = `http://127.0.0.1:${mockPort}`

const PROJECTS = makeProjectsDir('skill-upload-')
const STATE = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-state-'))
const { app, stop } = await startApp({
  projectsDir: PROJECTS,
  port: PORT,
  extraEnv: { SKILLHUB_BASE_URL: mockBase, SB_STATE_ROOT: STATE },
})

const installedDir = (id) => path.join(STATE, 'installed-skills', id)

async function api(p, init) {
  const r = await fetch(`${app}${p}`, init)
  let j = null
  try {
    j = await r.json()
  } catch {
    /* ignore */
  }
  return { status: r.status, json: j }
}

try {
  const up = await api('/api/skills/upload-zip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/zip' },
    body: zipUpload,
  })
  unit('upload-zip 成功', up.json?.ok === true && up.json?.skill?.id === SKILL_ID, JSON.stringify(up.json?.message))
  unit('来源为 upload', up.json?.skill?.source === 'upload', up.json?.skill?.source)
  unit('仅有 SKILL.md 时附件计数为 0', up.json?.skill?.fileCount === 0, String(up.json?.skill?.fileCount))

  // 3.1：带 references 的包整体落盘
  const upRefs = await api('/api/skills/upload-zip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/zip' },
    body: zipUploadWithRefs,
  })
  unit('带 references 上传成功', upRefs.json?.ok === true, upRefs.json?.message)
  const upAtts = (upRefs.json?.skill?.attachments || []).map((a) => a.path)
  unit('响应列出 references/guide.md', upAtts.includes('references/guide.md'), upAtts.join(','))
  const guideOnDisk = path.join(installedDir(SKILL_ID), 'references', 'guide.md')
  unit(
    'references 真的落盘且字节一致',
    fs.existsSync(guideOnDisk) && fs.readFileSync(guideOnDisk, 'utf8') === GUIDE_TEXT,
  )
  unit('落盘位置在状态根而非 skills/', !fs.existsSync(path.join(ROOT, 'skills', SKILL_ID)))

  // 3.2：纯文本上传仍可用，附件计数为 0
  const TEXT_ID = 'verify-text-upload'
  const textUp = await api('/api/skills/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: `---\nname: ${TEXT_ID}\ndescription: 纯文本上传\n---\n## ${TEXT_ID}\n正文\n`,
    }),
  })
  unit('纯文本上传成功', textUp.json?.ok === true && textUp.json?.skill?.id === TEXT_ID, textUp.json?.message)
  unit('纯文本上传附件计数为 0', textUp.json?.skill?.fileCount === 0)
  const textDisk = fs.readdirSync(installedDir(TEXT_ID))
  unit('纯文本包目录只有 SKILL.md', textDisk.length === 1 && textDisk[0] === 'SKILL.md', textDisk.join(','))

  const list = await api('/api/skills')
  const row = (list.json?.skills || []).find((s) => s.id === SKILL_ID)
  unit('列表含上传技能', Boolean(row) && row.source === 'upload', row?.id)
  unit('列表带附件清单', (row?.attachments || []).some((a) => a.path === 'references/guide.md'))

  const ap = await api('/api/skills/upload-zip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/zip' },
    body: zipAgentPack,
  })
  unit('Agent 包 zip 上传成功', ap.json?.ok === true && ap.json?.profile === 'agent-pack', ap.json?.message)
  unit('Agent 包 id 正确', ap.json?.skill?.id === AGENT_PACK_ID, ap.json?.skill?.id)

  const dup = await api('/api/skills/upload-zip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/zip' },
    body: zipUpload,
  })
  unit('重复上传覆盖', dup.json?.ok === true, dup.json?.message)

  const badZip = await api('/api/skills/upload-zip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/zip' },
    body: Buffer.from('not-a-zip'),
  })
  unit('非法 zip 被拒绝', badZip.status === 400, badZip.json?.message)

  const cats = await api('/api/skillhub/categories')
  unit('SkillHub 分类代理', cats.json?.ok === true && Array.isArray(cats.json?.items))

  const market = await api('/api/skillhub/skills?page=1&pageSize=5')
  unit('SkillHub 列表代理', market.json?.ok === true && Array.isArray(market.json?.items))

  const inst = await api('/api/skillhub/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug: HUB_SLUG, namespace: HUB_NS, version: '1.0.0' }),
  })
  unit('SkillHub mock 安装', inst.json?.ok === true && inst.json?.skill?.source === 'skillhub', inst.json?.message)
  unit('安装写入 slug', inst.json?.skill?.skillhub?.slug === HUB_SLUG)
  const hubAtts = (inst.json?.skill?.attachments || []).map((a) => a.path)
  unit('市场安装保留 references', hubAtts.includes('references/guide.md'), hubAtts.join(','))
  unit(
    '市场安装 references 落盘',
    fs.existsSync(path.join(installedDir(HUB_SLUG), 'references', 'guide.md')),
  )

  // 3.4：meta 记录目录、文件数、字节数、来源代次（必须在卸载前查，卸载会删记录）
  try {
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(path.join(PROJECTS, 'storyboard.sqlite'))
    const r = db.prepare('SELECT meta FROM skill_installs WHERE skill_id = ?').get(HUB_SLUG)
    db.close()
    const meta = JSON.parse(String(r?.meta || '{}'))
    unit(
      'meta 记录目录/文件数/字节数/来源',
      Boolean(meta.dir) &&
        Number.isFinite(meta.fileCount) &&
        Number.isFinite(meta.totalBytes) &&
        Boolean(meta.origin),
      JSON.stringify({ dir: meta.dir, fileCount: meta.fileCount, totalBytes: meta.totalBytes, origin: meta.origin }),
    )
  } catch (e) {
    unit('meta 记录目录/文件数/字节数/来源', false, (e && e.message) || String(e))
  }

  // 7.1 端到端：安装含 references 的包 → 按路径读到内容 → 卸载后读不到
  const readOk = await api(`/api/skills/${HUB_SLUG}/files?path=references/guide.md`)
  unit(
    '安装后可按路径读到附件',
    readOk.json?.ok === true && readOk.json?.text === GUIDE_TEXT,
    readOk.json?.message,
  )
  const readMissing = await api(`/api/skills/${HUB_SLUG}/files?path=references/nope.md`)
  unit(
    '读不存在的附件给出清单',
    readMissing.status === 400 && String(readMissing.json?.message || '').includes('references/guide.md'),
    readMissing.json?.message,
  )

  const list2 = await api('/api/skills')
  const hubRow = (list2.json?.skills || []).find((s) => s.id === HUB_SLUG)
  unit('列表含 SkillHub 技能', hubRow?.source === 'skillhub', hubRow?.id)

  const unAp = await api(`/api/skill-installs/${encodeURIComponent(AGENT_PACK_ID)}`, { method: 'DELETE' })
  unit('卸载 Agent 包', unAp.json?.ok === true)

  const un = await api(`/api/skill-installs/${encodeURIComponent(SKILL_ID)}`, { method: 'DELETE' })
  unit('卸载 upload 技能', un.json?.ok === true)
  // 3.3：卸载要连目录一起删
  unit('卸载后安装目录不存在', !fs.existsSync(installedDir(SKILL_ID)))

  const un2 = await api(`/api/skill-installs/${encodeURIComponent(HUB_SLUG)}`, { method: 'DELETE' })
  unit('卸载 SkillHub 技能', un2.json?.ok === true)
  unit('市场技能卸载后目录不存在', !fs.existsSync(installedDir(HUB_SLUG)))
  const readAfterUninstall = await api(`/api/skills/${HUB_SLUG}/files?path=references/guide.md`)
  unit(
    '卸载后同路径读不到',
    readAfterUninstall.status === 400 && String(readAfterUninstall.json?.message || '').includes('不存在'),
    readAfterUninstall.json?.message,
  )

  // 3.3：内置技能不可卸载，且内置文件不受影响
  const unBuiltin = await api('/api/skill-installs/byted-sol-seedance-prompt', { method: 'DELETE' })
  unit(
    '卸载内置技能被拒绝',
    unBuiltin.status === 400 && String(unBuiltin.json?.message || '').includes('内置'),
    unBuiltin.json?.message,
  )
  unit('内置文件未受影响', fs.existsSync(path.join(ROOT, 'skills', 'byted-sol-seedance-prompt', 'SKILL.md')))

  // 3.4：meta 记录目录、文件数、字节数、来源代次
  const metaRow = (list2.json?.skills || []).find((s) => s.id === HUB_SLUG)
  unit('安装响应保留 skillhub 元信息', metaRow?.skillhub?.slug === HUB_SLUG)
} catch (e) {
  console.error('❌ 验收异常', e)
  bad++
} finally {
  stop()
  mockHub.close()
  fs.rmSync(outDir, { recursive: true, force: true })
  fs.rmSync(STATE, { recursive: true, force: true })
  fs.rmSync(PROJECTS, { recursive: true, force: true })
}

if (bad) process.exit(1)
console.log('verify-skill-upload-zip: 全部通过')
