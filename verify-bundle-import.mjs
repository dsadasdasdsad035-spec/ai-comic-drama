/**
 * 压缩包导入的回归：
 * 1) ZIP 解析与中文名解码（真实资料包：31 条、19 文本、9 图片）
 * 2) 安全边界：路径穿越、绝对路径、符号链接、嵌套包、macOS 垃圾、超限
 * 3) 分类器：真实资料包的正确用途与集号范围（含两条被实测证伪的旧假设）
 * 4) 冲突检测：两份第 1 集分镜表报冲突
 * 5) 接口往返：POST 上传 → 清单 → GET 取图 → DELETE 清理
 *
 * 跑法：node verify-bundle-import.mjs [bundle.zip]
 * 默认用 fixtures/bundle-cat.zip；不存在则现场从 /tmp/cat-probe 打包，再不行就跳过。
 */
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const PORT = 5315
const APP = `http://127.0.0.1:${PORT}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-'))
const PROJECT = 'bundle-import'

let bad = 0
let skipped = 0
const check = (n, c, e = '') => {
  console.log(`${c ? '✅' : '❌'} ${n}${e ? ' | ' + e : ''}`)
  if (!c) bad++
}
const api = (p, init) =>
  fetch(`${APP}${p}`, init).then(async (r) => ({ ...(await r.json().catch(() => ({}))), status: r.status }))
const skip = (n, why) => {
  console.log(`⏭️  ${n} | ${why}`)
  skipped++
}

// ---------------------------------------------------------------- 准备 zip
function ensureZip() {
  const given = process.argv[2]
  if (given && fs.existsSync(given)) return { file: given, source: 'arg' }
  const fixture = path.join(ROOT, 'fixtures', 'bundle-cat.zip')
  if (fs.existsSync(fixture)) return { file: fixture, source: 'fixture' }
  const probe = '/tmp/cat-probe'
  if (fs.existsSync(probe)) {
    fs.mkdirSync(path.join(ROOT, 'fixtures'), { recursive: true })
    execFileSync('zip', ['-qr', fixture, '.', '-x', '.git/*'], { cwd: probe, stdio: 'ignore' })
    return { file: fixture, source: 'packed' }
  }
  return null
}

const zipInfo = ensureZip()
if (!zipInfo) {
  skip('压缩包测试', '没有可用的 zip；先 git clone --depth 1 https://github.com/dsadasdasdsad035-spec/cat.git /tmp/cat-probe')
  console.log(`\n跳过 ${skipped} 项`)
  process.exit(0)
}
console.log(`使用压缩包：${path.basename(zipInfo.file)}（${zipInfo.source}）\n`)
const zipBytes = fs.readFileSync(zipInfo.file)

// ---------------------------------------------------------------- 纯函数：解析
const Z = await import(path.join(ROOT, 'server', 'zip.mjs'))
const entries = Z.listZip(zipBytes)
check('列出条目', entries.length > 0, String(entries.length))
const texts = entries.filter((e) => Z.entryKind(e) === 'text' && !e.junk)
const images = entries.filter((e) => Z.entryKind(e) === 'image' && !e.junk)
check('识别出文本文档', texts.length >= 19, String(texts.length))
check('识别出图片', images.length >= 9, String(images.length))
check(
  '中文文件名正确解码（未被替换成乱码）',
  texts.some((e) => /第0?1集/.test(e.path)) && !texts.some((e) => e.path.includes('\uFFFD')),
  texts.slice(0, 2).map((e) => e.path).join(' / '),
)
const oneText = texts.find((e) => e.path.includes('03_'))
const textBytes = Z.readEntry(zipBytes, oneText)
check('解出文本字节数等于声明', textBytes.length === oneText.rawSize, `${textBytes.length} vs ${oneText.rawSize}`)
check('文本内容可读', textBytes.toString('utf8').includes('第1集'))
const oneImg = images[0]
const imgBytes = Z.readEntry(zipBytes, oneImg)
check('解出图片字节数等于声明', imgBytes.length === oneImg.rawSize, `${imgBytes.length} vs ${oneImg.rawSize}`)

// ---------------------------------------------------------------- 安全边界
check('拒绝路径穿越', Z.unsafeReason('../../etc/passwd', 0) === '包含 .. 路径段')
check('拒绝绝对路径', Z.unsafeReason('/etc/passwd', 0) === '绝对路径')
check('拒绝盘符路径', Z.unsafeReason('C:/win.ini', 0) === '盘符路径')
check('拒绝符号链接', Z.unsafeReason('link', 0o120000) === '符号链接')
check('接受普通文件', Z.unsafeReason('a/b.md', 0) === null)
check('嵌套包被标为不可解', /嵌套压缩包/.test(Z.unsafeReason('inner.zip', 0) || ''))

// UTF-8 严格判定：GBK 必须失败、macOS 裸 UTF-8 必须成功
const gbk = Buffer.from([0xb5, 0xda, 0x31, 0xbc, 0xaf])
check('GB18030 兜底能解出 GBK 名', Z.decodeEntryName(gbk, 0).name === '第1集', Z.decodeEntryName(gbk, 0).name)
check('未设标志位的裸 UTF-8 名被正确识别', Z.decodeEntryName(Buffer.from('第1集.md'), 0).name === '第1集.md')
check('标志位置位时优先 UTF-8', Z.decodeEntryName(Buffer.from('第1集.md'), 0x800).encoding === 'utf8-flag')

// ---------------------------------------------------------------- 分类器
const outDir = fs.mkdtempSync(path.join(ROOT, '.verify-bundle-'))
const esbuild = path.join(ROOT, 'node_modules', '.bin', 'esbuild')
const bundle = (entry, name) => {
  const out = path.join(outDir, `${name}.mjs`)
  execFileSync(esbuild, [entry, '--bundle', '--platform=node', '--format=esm', '--log-level=error', `--outfile=${out}`])
  return out
}
const C = await import(bundle('src/intake/classify.ts', 'classify'))

const classified = entries
  .filter((e) => !e.junk && !e.dir && !e.unsafe)
  .map((e) => {
    const kind = Z.entryKind(e)
    if (kind === 'other') return null
    const preview = kind === 'text' ? Z.readEntry(zipBytes, e).toString('utf8') : ''
    const r = C.classifyFile({ path: e.path, name: e.path.split('/').pop(), kind, textPreview: preview })
    return { ...r, id: e.safeName, size: e.rawSize, preview }
  })
  .filter(Boolean)

check('分类了全部可导入文件', classified.length >= 28, String(classified.length))
const imgFiles = classified.filter((f) => f.kind === 'image')
check('图片全部标为参考图', imgFiles.every((f) => f.labels.includes('image')), String(imgFiles.length))

const charFile = classified.find((f) => /角色档案/.test(f.name))
check('角色档案被识别', Boolean(charFile) && charFile.labels.includes('characters'), JSON.stringify(charFile?.labels))

const promptFile = classified.find((f) => /提示词/.test(f.name))
check('提示词文档被识别', Boolean(promptFile) && promptFile.labels.includes('prompts'), JSON.stringify(promptFile?.labels))

const ep1Files = classified.filter((f) => /第0?1集|03_/.test(f.path) && f.labels.includes('shotlist'))
check('第 1 集分镜来源有多个（真实存在两份）', ep1Files.length >= 2, JSON.stringify(ep1Files.map((f) => f.name)))

const epFiles = classified.filter((f) => f.labels.includes('script'))
check('10 个分集文件都识别为剧本用', epFiles.length >= 10, String(epFiles.length))
check(
  '分集文件同时带分镜表用途（双用途，不是单类别）',
  epFiles.filter((f) => f.labels.includes('shotlist')).length >= 9,
  JSON.stringify(epFiles.slice(0, 2).map((f) => f.labels)),
)
// 多集大纲也是剧本内容（multi），不能要求全部 single；只要求真正的分集文件是单集
const singleEpFiles = epFiles.filter((f) => f.episodeNo && f.episodeScope === 'single')
check('10 个分集文件都归到单一集号', singleEpFiles.length >= 10, String(singleEpFiles.length))
check(
  '多集大纲被单独标出而不是归给某一集',
  epFiles.some((f) => f.episodeScope === 'multi') && !singleEpFiles.some((f) => /分集大纲/.test(f.name)),
  JSON.stringify(epFiles.filter((f) => f.episodeScope === 'multi').map((f) => f.name)),
)

// 被实测证伪的两条旧规则
const photoReadme = classified.find((f) => f.path.includes('猫咪真实参考照片') && /README/.test(f.name))
check(
  '「图片索引 README」不被误判为分镜表（含「镜头」字样也不行）',
  Boolean(photoReadme) && !photoReadme.labels.includes('shotlist'),
  JSON.stringify(photoReadme?.labels),
)
const outline = classified.find((f) => /分集大纲/.test(f.name))
check(
  '多集大纲被标为 multi 而不是归给第 1 集',
  Boolean(outline) && outline.episodeScope === 'multi',
  JSON.stringify({ scope: outline?.episodeScope, labels: outline?.labels }),
)

// 无关文档
const cleanShot = classified.find((f) => /真实拍摄清单/.test(f.name))
check('拍摄清单不被当成产物', Boolean(cleanShot) && cleanShot.labels.length === 0, JSON.stringify(cleanShot?.labels))

// ---------------------------------------------------------------- 冲突检测
const conflicts = C.findConflicts(
  classified.map((f) => ({
    id: f.id,
    path: f.path,
    name: f.name,
    kind: f.kind,
    size: f.size,
    labels: f.labels,
    episodeScope: f.episodeScope,
    episodeNo: f.episodeNo,
    confidence: f.confidence,
    reason: f.reason,
  })),
)
const ep1Conflict = conflicts.find((c) => c.label === 'shotlist' && c.episodeNo === 1)
check('第 1 集两份分镜表报冲突', Boolean(ep1Conflict) && ep1Conflict.files.length >= 2, JSON.stringify(conflicts.map((c) => `${c.key}(${c.files.length})`)))
check('不同集号的剧本不算冲突', !conflicts.some((c) => c.label === 'script' && c.episodeNo !== 1), JSON.stringify(conflicts.map((c) => c.key)))

const counts = ep1Conflict.files.map((f) => {
  const rec = classified.find((x) => x.id === f.id)
  return C.shotCountOf(rec?.preview || '')
})
check('冲突里能数出各自镜数（供并列显示）', counts.every((n) => n > 0), JSON.stringify(counts))

// ---------------------------------------------------------------- 角色档案解析
const CH = await import(bundle('src/intake/characters.ts', 'characters'))
const charEntry = entries.find((e) => /角色档案/.test(e.path))
const charText = Z.readEntry(zipBytes, charEntry).toString('utf8')
const drafts = CH.parseCharacterDrafts(charText)
check('从真实角色档案抽出角色', drafts.length >= 3, JSON.stringify(drafts.map((d) => d.name)))
check(
  '三个角色名正确（主角猫 / 搭档猫 / 铲屎官）',
  drafts.some((d) => /狸花|主角猫/.test(d.name)) &&
    drafts.some((d) => /白猫|搭档猫/.test(d.name)) &&
    drafts.some((d) => /铲屎官|程序员/.test(d.name)),
  JSON.stringify(drafts.map((d) => d.name)),
)
check(
  '外观锚点来自「外观锚点」小节而不是性格段',
  drafts.every((d) => !/剧情性格|天真|黏人/.test(d.lookCn)),
  JSON.stringify(drafts.map((d) => d.lookCn.slice(0, 30))),
)
check(
  '创作设定备注不进入 lookEn',
  drafts.every((d) => !/性格属于创作设定|不代表/.test(d.lookEn)),
  JSON.stringify(drafts.map((d) => d.lookEn)),
)
check('原文没写英文锚点时留空（不编）', drafts.every((d) => d.lookEn === ''), JSON.stringify(drafts.map((d) => d.lookEn)))

// 与已有角色合并：已有锚点不被覆盖
const existingChars = [
  { id: '主角猫——狸花白手套猫', name: '主角猫——狸花白手套猫', role: '主角', lookCn: '我改的中文', lookEn: 'my locked english', palette: '', keywords: [] },
]
const mergedChars = CH.mergeImportedCharacters(existingChars, drafts)
check('已有英文锚点的角色不被覆盖', mergedChars.skipped.length >= 1 && mergedChars.next.find((c) => c.name === '主角猫——狸花白手套猫')?.lookEn === 'my locked english', JSON.stringify({ skipped: mergedChars.skipped, added: mergedChars.added }))
check('新角色被加入', mergedChars.added.length >= 2, JSON.stringify(mergedChars.added))

// ---------------------------------------------------------------- 接口往返
const child = spawn(
  process.execPath,
  [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'],
  { cwd: ROOT, env: { ...process.env, SB_PROJECTS_DIR: TMP }, stdio: 'ignore' },
)
const waitServer = async () => {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${APP}/api/health`)).ok) return true
    } catch {
      /* 继续等 */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}
try {
  if (!(await waitServer())) throw new Error('dev server 启动失败')

  const up = await fetch(`${APP}/api/import/bundle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: zipBytes,
  }).then((r) => r.json())
  check('上传压缩包返回清单', up.ok === true && Array.isArray(up.files), JSON.stringify(up).slice(0, 160))
  check('清单含文本与图片', (up.files || []).some((f) => f.kind === 'text') && (up.files || []).some((f) => f.kind === 'image'))
  check('清单数量与包一致', (up.files || []).length >= 28, String((up.files || []).length))
  check('文本带预览', (up.files || []).filter((f) => f.kind === 'text').every((f) => typeof f.textPreview === 'string'), '')
  check('清单里没有 __MACOSX / .DS_Store', !(up.files || []).some((f) => /__MACOSX|\.DS_Store/.test(f.path)))
  check('中文名在清单里可读', (up.files || []).some((f) => /第0?1集/.test(f.path)), '')

  const imgRec = (up.files || []).find((f) => f.kind === 'image')
  const got = await fetch(`${APP}/api/import/bundle/${up.bundleId}/file/${encodeURIComponent(imgRec.id)}`)
  const gotBytes = Buffer.from(await got.arrayBuffer())
  check('按 id 取图成功', got.ok && gotBytes.length === imgRec.size, `${got.status} ${gotBytes.length}/${imgRec.size}`)
  check('取图 Content-Type 是图片', /^image\//.test(got.headers.get('content-type') || ''), got.headers.get('content-type') || '')

  const badGet = await fetch(`${APP}/api/import/bundle/${up.bundleId}/file/${encodeURIComponent('../etc/passwd')}`)
  check('取文件拒绝路径穿越', badGet.status === 404, String(badGet.status))
  const missing = await fetch(`${APP}/api/import/bundle/deadbeef/file/x.png`)
  check('未知 bundle 返回 404', missing.status === 404, String(missing.status))

  const del = await fetch(`${APP}/api/import/bundle/${up.bundleId}`, { method: 'DELETE' }).then((r) => r.json())
  check('清理后就删掉了临时目录', del.ok === true && del.removed === true, JSON.stringify(del))
  const afterDel = await fetch(`${APP}/api/import/bundle/${up.bundleId}/file/${encodeURIComponent(imgRec.id)}`)
  check('清理后取文件失败', afterDel.status === 404, String(afterDel.status))

  // 事务性：冲突未解决时前端阻止应用（这里验证接口层不含写入，清单请求是只读的）
  await api(`/api/project?name=${PROJECT}&create=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '解包事务验证' }),
  }).catch(() => ({}))
  const beforeTx = await api(`/api/project?name=${PROJECT}`).catch(() => ({}))
  const up2 = await fetch(`${APP}/api/import/bundle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: zipBytes,
  }).then((r) => r.json())
  const afterTx = await api(`/api/project?name=${PROJECT}`).catch(() => ({}))
  check(
    '解包本身不写项目（应用才写）',
    JSON.stringify(beforeTx.project?.shots ?? null) === JSON.stringify(afterTx.project?.shots ?? null),
    '解包前后项目镜头一致',
  )
  await fetch(`${APP}/api/import/bundle/${up2.bundleId}`, { method: 'DELETE' }).catch(() => {})

  // 非 zip 上传
  const junk = await fetch(`${APP}/api/import/bundle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: Buffer.from('not a zip at all'),
  }).then((r) => r.json())
  check('非 ZIP 上传被拒并说明', junk.ok === false && /ZIP|zip/.test(junk.message || ''), JSON.stringify(junk).slice(0, 140))
} catch (e) {
  check('接口往返', false, e.message)
} finally {
  child.kill('SIGTERM')
  fs.rmSync(outDir, { recursive: true, force: true })
  fs.rmSync(TMP, { recursive: true, force: true })
}

console.log(bad === 0 ? `\n全部通过${skipped ? `（跳过 ${skipped}）` : ''}` : `\n${bad} 项未通过`)
process.exit(bad === 0 ? 0 : 1)
