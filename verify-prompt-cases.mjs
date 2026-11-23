/**
 * 提示词案例库验收。
 *
 * 分三层，全部不花真实额度：
 *   --unit     存储层：CRUD、许可强制、UPSERT 保收藏、分页
 *   --import   外部来源：vflow fixture 预览与提交、失败路径
 *   --reverse  反推作业：mock 子进程走作业生命周期
 *   --apply    应用到镜头：只改目标字段并标记手改
 *   --facets   分面：推导、同轴 OR/跨轴 AND、计数、人工优先、隐藏/恢复、未映射
 *   无参数全跑
 *
 * 跑法：node verify-prompt-cases.mjs [--unit|--import|--reverse|--apply|--facets]
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const mode = process.argv[2] || ''

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

/** 每个用例一套独立临时状态根，避免互相污染 */
function freshRoot(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `pcl-${tag}-`))
  // 与生产一致：库根由 SB_PROJECTS_DIR 决定（server 用 resolveRoot 算出来的那个）
  process.env.SB_PROJECTS_DIR = dir
  return dir
}

async function loadLib() {
  // db.mjs 的模块级连接按路径缓存，换 root 就是换库
  return import('./server/prompt-cases.mjs')
}

// ---------------------------------------------------------------- unit

async function runUnit() {
  console.log('\n=== 存储层 ===')
  const root = freshRoot('unit')
  const lib = await loadLib()

  const saved = lib.saveCase(root, {
    source: 'manual',
    sourceId: 'case-a',
    title: '雨夜巷口回眸',
    prompt: 'A woman turns in a rainy alley, dolly in',
    model: 'seedance-2-5',
    category: 'cinematic realistic',
    tags: ['雨夜', '回眸'],
    videoUrl: 'https://example.com/a.mp4',
    posterUrl: 'https://example.com/a.jpg',
  })
  check('保存手工案例', saved?.id === 'manual:case-a' && saved.prompt.includes('rainy alley'))
  check('默认许可为仅参考', saved?.license === 'reference-only', saved?.license)
  check('标签归一化', Array.isArray(saved?.tags) && saved.tags.length === 2)

  // 许可强制：客户端传 own 必须被忽略
  const forced = lib.saveCase(root, {
    source: 'vflow',
    sourceId: 'v1',
    title: 'external',
    prompt: 'x',
    license: 'own',
  })
  check('外部来源忽略客户端 license', forced?.license === 'reference-only', forced?.license)

  const own = lib.saveCase(root, {
    source: 'reverse-own',
    sourceId: 'job-1',
    title: '自有片',
    prompt: 'own film',
    license: 'reference-only',
  })
  check('反推来源强制为自有', own?.license === 'own', own?.license)

  // UPSERT 保留 favorite / note
  lib.patchCase(root, saved.id, { favorite: true, note: '这条写法好' })
  const again = lib.saveCase(root, {
    source: 'manual',
    sourceId: 'case-a',
    title: '雨夜巷口回眸（更新标题）',
    prompt: 'updated prompt',
    model: 'seedance-2-5',
    tags: ['雨夜'],
  })
  check('UPSERT 更新内容字段', again?.title.includes('更新标题') && again?.prompt === 'updated prompt')
  check('UPSERT 保留收藏', again?.favorite === true)
  check('UPSERT 保留备注', again?.note === '这条写法好', again?.note)
  check('UPSERT 不新增记录', lib.listCases(root).total === 3, String(lib.listCases(root).total))

  // 分页
  for (let i = 0; i < 30; i += 1) {
    lib.saveCase(root, { source: 'manual', sourceId: `page-${i}`, title: `案例 ${i}`, prompt: `p${i}` })
  }
  const p1 = lib.listCases(root, { pageSize: 10, page: 1 })
  const p2 = lib.listCases(root, { pageSize: 10, page: 2 })
  const pLast = lib.listCases(root, { pageSize: 10, page: 99 })
  check('分页 total', p1.total === 33, String(p1.total))
  check('分页 pageSize', p1.cases.length === 10 && p2.cases.length === 10)
  check('分页不重叠', p1.cases[0].id !== p2.cases[0].id)
  check('超范围页码夹到末页', pLast.page === pLast.totalPages, `${pLast.page}/${pLast.totalPages}`)

  // 筛选
  const bySource = lib.listCases(root, { source: 'vflow' })
  check('按来源筛选', bySource.total === 1)
  const byQ = lib.listCases(root, { q: 'rainy' })
  check('关键词命中正文', byQ.total === 0, `命中 ${byQ.total}（正文已改为 updated prompt）`)
  const byQ2 = lib.listCases(root, { q: 'updated prompt' })
  check('关键词命中更新后的正文', byQ2.total === 1)
  const byFav = lib.listCases(root, { favorite: true })
  check('按收藏筛选', byFav.total === 1)

  // ---- 分面
  const fa = lib.saveCase(root, {
    source: 'manual',
    sourceId: 'facet-a',
    title: '雨夜巷口',
    prompt: '中景，女子回眸，霓虹',
    facets: [
      { axis: 'genre', value: 'cyberpunk', source: 'import' },
      { axis: 'environment', value: 'alley', source: 'derived' },
    ],
  })
  check('保存时写入分面', fa.facets.length === 2, String(fa.facets?.length))
  check(
    '同 (case,axis,value) 重复写入只留一行',
    lib.setCaseFacets(root, fa.id, [
      { axis: 'genre', value: 'cyberpunk', source: 'import' },
      { axis: 'genre', value: 'cyberpunk', source: 'derived' },
    ]).written === 1 && lib.getCaseFacets(root, fa.id).filter((f) => f.axis === 'genre').length === 1,
  )
  lib.setCaseFacets(root, fa.id, [{ axis: 'genre', value: 'cyberpunk', source: 'manual' }])
  lib.setCaseFacets(root, fa.id, [{ axis: 'genre', value: 'cyberpunk', source: 'derived' }])
  check(
    '来源只升不降（manual 不被 derived 覆盖）',
    lib.getCaseFacets(root, fa.id).find((f) => f.axis === 'genre')?.source === 'manual',
  )

  const fb = lib.saveCase(root, { source: 'manual', sourceId: 'facet-b', title: '天台', prompt: '全景 推镜' })
  lib.applyDerivedFacets(root, fb.id, [
    { axis: 'genre', value: 'cyberpunk' },
    { axis: 'environment', value: 'rooftop' },
  ], { taxonomyVersion: 'v-test' })
  check('推导写入分面并带版本', lib.getCaseFacets(root, fb.id).every((f) => f.taxonomyVersion === 'v-test'))
  check('推导结果可筛选', lib.listCases(root, { facetGroups: [{ axis: 'environment', values: ['rooftop'] }] }).total === 1)

  lib.deleteCaseFacet(root, fb.id, 'environment', 'rooftop')
  check('删除自动值后默认不返回', !lib.getCaseFacets(root, fb.id).some((f) => f.value === 'rooftop'))
  check(
    '删除自动值留下隐藏记录',
    lib.getCaseFacets(root, fb.id, { includeSuppressed: true }).some((f) => f.value === 'rooftop' && f.suppressed),
  )
  lib.applyDerivedFacets(root, fb.id, [
    { axis: 'genre', value: 'cyberpunk' },
    { axis: 'environment', value: 'rooftop' },
  ], { taxonomyVersion: 'v-test2' })
  check('重新推导不会复活已删自动值', !lib.getCaseFacets(root, fb.id).some((f) => f.value === 'rooftop'))
  check('恢复被隐藏的值', lib.restoreCaseFacet(root, fb.id, 'environment', 'rooftop') &&
    lib.getCaseFacets(root, fb.id).some((f) => f.value === 'rooftop' && f.source === 'manual'))
  check('重复恢复返回 false', lib.restoreCaseFacet(root, fb.id, 'environment', 'rooftop') === false)

  // 同轴 OR、跨轴 AND
  const orCount = lib.listCases(root, { facetGroups: [{ axis: 'genre', values: ['cyberpunk', 'action'] }] }).total
  const single = lib.listCases(root, { facetGroups: [{ axis: 'genre', values: ['cyberpunk'] }] }).total
  const cross = lib.listCases(root, {
    facetGroups: [
      { axis: 'genre', values: ['cyberpunk'] },
      { axis: 'environment', values: ['rooftop'] },
    ],
  }).total
  check('同轴多值为 OR', orCount >= single, `${orCount} vs ${single}`)
  check('跨轴为 AND', cross <= single, `${cross} vs ${single}`)

  const counts = lib.caseFacetCounts(root, { facetGroups: [{ axis: 'genre', values: ['cyberpunk'] }] })
  const envCount = counts.find((c) => c.axis === 'environment' && c.value === 'rooftop')?.count
  check('分面计数带其他轴条件', envCount === 1, String(envCount))
  const genreCount = counts.find((c) => c.axis === 'genre' && c.value === 'action')
  check('分面计数不看本轴条件（0 值不返回）', genreCount === undefined)

  const stale = lib.listStaleFacetCases(root, 'v-test')
  check('旧版本案例可枚举', stale.total >= 1, String(stale.total))

  const facets = lib.caseFacets(root)
  check('聚合总数', facets.total === 35, String(facets.total))
  check('聚合按来源', facets.bySource.manual === 33, JSON.stringify(facets.bySource))

  // 删除
  check('删除存在案例', lib.deleteCase(root, saved.id) === true)
  check('删除后不可读', lib.getCase(root, saved.id) === null)
  check('删除不存在返回 false', lib.deleteCase(root, 'manual:nope') === false)
}

// ---------------------------------------------------------------- import

async function runImport() {
  console.log('\n=== 外部来源导入 ===')
  const root = freshRoot('import')
  const lib = await loadLib()
  lib.clearCaseSourceCache()
  const fs = await import('node:fs')
  const path = await import('node:path')
  const fixtureDir = path.join(ROOT, 'tests/fixtures/prompt-cases')
  const indexJson = fs.readFileSync(path.join(fixtureDir, 'vflow-index.json'), 'utf8')
  const itemDir = path.join(fixtureDir, 'vflow-items')
  const itemJson = (id) => {
    const file = path.join(itemDir, `${id}.json`)
    if (!fs.existsSync(file)) throw new Error(`fixture 缺条目 ${id}`)
    return fs.readFileSync(file, 'utf8')
  }
  const deps = { indexJson, itemJson }

  // 来源清单
  const sources = lib.listCaseSources()
  const vflow = sources.find((s) => s.id === 'vflow')
  const flatkey = sources.find((s) => s.id === 'flatkey')
  check('来源清单含 vflow 且启用', vflow?.enabled === true)
  check('closed 来源带关闭原因', flatkey?.enabled === false && Boolean(flatkey?.reason), flatkey?.reason)
  let disabledErr = ''
  try {
    await lib.previewCasesFromSource({ source: 'flatkey' }, deps)
  } catch (e) {
    disabledErr = e.message
  }
  check('未启用来源拒绝预览', disabledErr.includes('未启用'), disabledErr)

  // 预览
  const preview = await lib.previewCasesFromSource({ source: 'vflow', limit: 10 }, deps)
  check('预览返回条目', preview.items.length === 10, String(preview.items.length))
  check('预览带令牌', typeof preview.token === 'string' && preview.token.length > 10)
  check('预览的许可为仅参考', preview.license === 'reference-only', preview.license)
  check('预览不落库', lib.listCases(root).total === 0, String(lib.listCases(root).total))
  check('条目带外链封面', preview.items.every((i) => !i.posterUrl || /^https?:/.test(i.posterUrl)))

  // 按模型过滤
  const onlySeedance = await lib.previewCasesFromSource({ source: 'vflow', model: 'seedance-2-5', limit: 20 }, deps)
  check('按模型过滤生效', onlySeedance.items.length > 0 && onlySeedance.items.every((i) => i.model === 'seedance-2-5'), `${onlySeedance.items.length} 条`)

  // 分类保真：逐条 JSON 不带分类，靠索引行回填
  const parsedIndex = lib.parseVflowIndex(indexJson)
  const multiCat = parsedIndex.items.find((i) => (i.categories || []).length >= 2)
  const single = lib.parseVflowItem(itemJson(multiCat.id), { categories: multiCat.categories })
  check('逐条解析保留索引分类', single.categories.length >= 2 && Boolean(single.category), JSON.stringify(single.categories))
  check('预览条目带分类与分面摘要', preview.items.every((i) => Array.isArray(i.categories) && Array.isArray(i.facets)))
  check('预览分面摘要非空', preview.items.some((i) => i.facets.length > 0))
  const catPreview = await lib.previewCasesFromSource(
    { source: 'vflow', category: multiCat.categories[0], limit: 20 },
    deps,
  )
  check('按分类过滤预览', catPreview.items.length > 0 && catPreview.items.length <= preview.total, `${catPreview.items.length}`)

  // 关键词过滤
  const kw = await lib.previewCasesFromSource({ source: 'vflow', q: 'claymation', limit: 20 }, deps)
  check('关键词过滤生效', kw.items.length >= 1)

  // 提交
  const ids = preview.items.slice(0, 3).map((i) => i.id)
  const imported = await lib.importCasesFromSource(root, { source: 'vflow', token: preview.token, ids }, deps)
  check('导入新增数', imported.created === 3, JSON.stringify({ created: imported.created }))
  check('导入后入库', lib.listCases(root, { source: 'vflow' }).total === 3)
  check('导入写入分面', imported.facetsWritten > 0, String(imported.facetsWritten))
  const facetRowCount = () =>
    lib
      .listCases(root, { source: 'vflow', pageSize: 96 })
      .cases.reduce((n, c) => n + (c.facets?.length || 0), 0)
  const rowsAfterFirst = facetRowCount()
  check('导入案例详情带分面与来源', rowsAfterFirst > 0 &&
    lib.listCases(root, { source: 'vflow' }).cases.every((c) => c.facets.every((f) => f.source)))

  // 幂等
  const again = await lib.importCasesFromSource(root, { source: 'vflow', token: preview.token, ids }, deps)
  check('重复导入全部为更新', again.created === 0 && again.updated === 3, JSON.stringify(again))
  check('重复导入分面行数不增长', facetRowCount() === rowsAfterFirst, `${facetRowCount()} vs ${rowsAfterFirst}`)

  // 收藏与备注在重导后保留
  const first = lib.listCases(root, { source: 'vflow' }).cases[0]
  lib.patchCase(root, first.id, { favorite: true, note: '留着' })
  await lib.importCasesFromSource(root, { source: 'vflow', token: preview.token, ids }, deps)
  const after = lib.getCase(root, first.id)
  check('重导保留收藏与备注', after.favorite === true && after.note === '留着')

  // 伪造 id
  let forgedErr = ''
  try {
    await lib.importCasesFromSource(root, { source: 'vflow', token: preview.token, ids: ['not-in-preview'] }, deps)
  } catch (e) {
    forgedErr = e.message
  }
  check('拒绝预览外 id', forgedErr.includes('不在本次预览结果')||forgedErr.includes('不在本次预览'), forgedErr)

  // 过期/伪造 token
  let tokenErr = ''
  try {
    await lib.importCasesFromSource(root, { source: 'vflow', token: 'bogus', ids }, deps)
  } catch (e) {
    tokenErr = e.message
  }
  check('拒绝伪造令牌', tokenErr.includes('预览已过期'), tokenErr)

  // 失败路径：索引非 JSON
  lib.clearCaseSourceCache()
  let badIndex = ''
  try {
    await lib.previewCasesFromSource({ source: 'vflow' }, { indexJson: '<html>not json</html>' })
  } catch (e) {
    badIndex = e.message
  }
  check('索引非 JSON 报可读错误', badIndex.includes('不是合法 JSON'), badIndex)

  // 失败路径：单条超时/失败只影响该条
  lib.clearCaseSourceCache()
  const preview2 = await lib.previewCasesFromSource({ source: 'vflow', limit: 3 }, deps)
  const badDeps = {
    ...deps,
    itemJson: (id) => {
      if (id === preview2.items[1].id) throw new Error('模拟单条超时')
      return itemJson(id)
    },
  }
  const partial = await lib.importCasesFromSource(
    root,
    { source: 'vflow', token: preview2.token, ids: preview2.items.map((i) => i.id) },
    badDeps,
  )
  check('单条失败不影响其余', partial.failed.length === 1 && partial.imported === 2, JSON.stringify(partial.failed))

  // 失败路径：内网地址被拒（索引地址指向 127.0.0.1）
  lib.clearCaseSourceCache()
  let ssrf = ''
  try {
    await lib.previewCasesFromSource(
      { source: 'vflow' },
      { indexUrl: 'http://127.0.0.1:1/index.json' },
    )
  } catch (e) {
    ssrf = e.message
  }
  check('拒绝内网地址', ssrf.includes('本机') || ssrf.includes('内网'), ssrf)
}

// ---------------------------------------------------------------- reverse

async function waitJob(lib, id, timeoutMs = 20_000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const job = lib.getReverseJob(id)
    if (!job) return null
    if (job.status !== 'queued' && job.status !== 'running') return job
    await new Promise((r) => setTimeout(r, 120))
  }
  return lib.getReverseJob(id)
}

async function runReverse() {
  console.log('\n=== 反推作业 ===')
  const root = freshRoot('reverse')
  const lib = await loadLib()
  const rea = await import('./server/rea-video.mjs')
  rea.resetReverseState()

  const mock = path.join(ROOT, 'tests/fixtures/prompt-cases/rea/mock-rea.mjs')
  const breakdownFixture = path.join(ROOT, 'tests/fixtures/prompt-cases/rea/breakdown.json')

  // 可执行文件探测
  // 必须同时清空 PATH：本机可能真的装了 rea-video，否则「未安装」用例会被
  // PATH 兜底探测到真实 CLI 而误判。只在本用例内改，结束时恢复。
  const savedPath = process.env.PATH
  process.env.REA_VIDEO_BIN = '/nonexistent/rea-video'
  process.env.PATH = '/nonexistent-bin'
  let missing = await rea.reaHealth({ force: true })
  check('未安装返回 not-installed', missing.ok === false && missing.reason === 'not-installed')
  check('未安装给安装命令', missing.message.includes('uv tool install'), missing.message.slice(0, 40))

  process.env.REA_VIDEO_BIN = mock
  process.env.PATH = savedPath
  const health = await rea.reaHealth({ force: true })
  check('真实可执行文件判为可用', health.ok === true && health.path === mock)

  // 档位
  const tiers = rea.listReverseTiers()
  const quick = tiers.find((t) => t.id === 'quick')
  const full = tiers.find((t) => t.id === 'full')
  check('快速档零下载', quick.downloadMb === 0 && quick.downloads.length === 0)
  check('完整档列出下载项', full.downloadMb === 411, String(full.downloadMb))
  check('缺省档位为快速', rea.normalizeTier('') === 'quick' && rea.normalizeTier('nope') === 'quick')

  // 视觉模型环境
  // 视觉环境变量只经中转注入；直连路径已移除（见下面的回归断言）
  const envOk = rea.vlmEnvFrom(
    { model: 'doubao-vision' },
    { baseUrl: 'https://ark.example.com/api/v3/', apiKey: 'sk-test' },
    { localProxy: 'http://127.0.0.1:5400/api/prompt-cases/vlm-proxy', internalToken: 'tok' },
  )
  check(
    '注入视觉环境变量',
    envOk.configured && envOk.env.REA_VLM_MODEL === 'doubao-vision' && envOk.env.REA_VLM_BASE_URL.endsWith('/vlm-proxy/v1'),
    envOk.env.REA_VLM_BASE_URL,
  )
  const envMissing = rea.vlmEnvFrom({ model: 'x' }, { baseUrl: '', apiKey: '' })
  check('缺配置时不注入', envMissing.configured === false && Object.keys(envMissing.env).length === 0)

  /**
   * 回归：没有中转令牌时**不得**静默退回直连。
   *
   * 直连有两条实测走不通的路径（APIMart 只回 SSE、子进程无代理），
   * 静默降级会让用户看到「VLM 调用失败」而不是「视觉复核不可用」。
   * 之前还因此让「已选模型」的请求被误判成「未配置模型」。
   */
  const noToken = rea.vlmEnvFrom({ model: 'x' }, { baseUrl: 'https://api.example.com', apiKey: 'sk-x' }, {})
  check('无内部令牌时不退回直连', noToken.configured === false, JSON.stringify(noToken))
  check('无令牌给出可读原因', noToken.reason === 'no-internal-token', noToken.reason)

  // 有令牌时必须走中转，且 base 带 /v1 后缀（rea-video 会再拼 /chat/completions）
  const viaProxy = rea.vlmEnvFrom(
    { model: 'gemini-3.5-flash' },
    { baseUrl: 'https://api.example.com', apiKey: 'sk-x' },
    { localProxy: 'http://127.0.0.1:5400/api/prompt-cases/vlm-proxy', internalToken: 'tok' },
  )
  check('有令牌时走中转', viaProxy.configured === true && viaProxy.viaProxy === true)
  check('中转发往 /v1（子进程会拼 /chat/completions）', viaProxy.env.REA_VLM_BASE_URL.endsWith('/v1'), viaProxy.env.REA_VLM_BASE_URL)
  check('子进程只拿到内部令牌', viaProxy.env.REA_VLM_API_KEY === 'tok')

  // 造一个假的源视频文件
  const videoPath = path.join(root, 'sample.mp4')
  fs.writeFileSync(videoPath, Buffer.from('not-a-real-video-but-exists'))

  process.env.MOCK_REA_MODE = 'ok'
  process.env.MOCK_REA_FIXTURE = breakdownFixture
  const created = await rea.createReverseJob(root, {
    videoPath,
    videoUrl: '/videos/sample.mp4',
    durationSec: 9.6,
    tier: 'quick',
    title: '测试片',
    vlm: envOk,
  })
  check('创建作业返回 id', created?.id?.startsWith('rea-'), created?.id)
  const done = await waitJob(rea, created.id)
  check('作业完成', done?.status === 'done', `${done?.status} ${done?.error || ''}`)
  check('结果含镜头数', done?.result?.shots === 3, String(done?.result?.shots))
  check('结果标注视觉判定未完全生效', done?.result?.vlmStatus === 'partial' && done?.result?.vlmNote.includes('部分'), done?.result?.vlmNote)

  // 产物解析细节
  // 证据帧复制
  const mediaRoot = path.join(root, 'public', 'prompt-cases', created.id)
  check('证据帧落到媒体目录', fs.existsSync(mediaRoot) && fs.readdirSync(mediaRoot).length > 0, mediaRoot)

  // 失败模式
  process.env.MOCK_REA_MODE = 'fail'
  const bad = await rea.createReverseJob(root, { videoPath, durationSec: 5, tier: 'quick' })
  const badDone = await waitJob(rea, bad.id)
  check('非零退出标记失败', badDone?.status === 'error' && badDone.error.includes('退出码'), badDone?.error)
  check('失败不保留产物目录', !fs.existsSync(path.join(root, '.rea-jobs', bad.id)))

  // 停滞检测：把上限压到 1.2s，mock 只打一行就睡死
  process.env.MOCK_REA_MODE = 'stall'
  const stallJob = await rea.createReverseJob(root, { videoPath, durationSec: 5, tier: 'quick', stallMs: 1200 })
  const stall = await waitJob(rea, stallJob.id, 15_000)
  check('停滞被终止并标记失败', stall?.status === 'error' && stall.error.includes('没有进展'), stall?.error)

  // 取消：再造一个长跑作业
  process.env.MOCK_REA_MODE = 'slow'
  const cancelJob = await rea.createReverseJob(root, { videoPath, durationSec: 5, tier: 'quick' })
  await new Promise((r) => setTimeout(r, 150))
  const cancelled = rea.cancelReverseJob(cancelJob.id, '测试取消')
  check('取消标记 cancelled', cancelled?.status === 'cancelled', cancelled?.status)
  check('取消后不落案例', lib.listCases(root).total === 0, String(lib.listCases(root).total))
  check('取消后删掉作业目录', !fs.existsSync(path.join(root, '.rea-jobs', cancelJob.id)))

  process.env.MOCK_REA_MODE = 'ok'

  // 并发上限：连发 3 个，同时运行的不超过 1
  rea.resetReverseState()
  const ids = []
  for (let i = 0; i < 3; i += 1) {
    const j = await rea.createReverseJob(root, { videoPath, durationSec: 3, tier: 'quick' })
    ids.push(j.id)
  }
  const states = ids.map((id) => rea.getReverseJob(id)?.status)
  const runningCount = states.filter((s) => s === 'running').length
  const queuedCount = states.filter((s) => s === 'queued').length
  check('并发默认 1，其余排队', runningCount <= 1 && queuedCount >= 2, `running=${runningCount} queued=${queuedCount}`)
  for (const id of ids) await waitJob(rea, id, 30_000)
  const final = ids.map((id) => rea.getReverseJob(id)?.status)
  check('排队作业最终完成', final.every((s) => s === 'done'), final.join(','))

  // 解析器：未知分类保留原值
  const doc = JSON.parse(fs.readFileSync(breakdownFixture, 'utf8'))
  const parsedDoc = rea.parseBreakdown(doc)
  check('逐镜时间范围', parsedDoc.shots[0].start === 0 && parsedDoc.shots[0].end === 2.5)
  check('制作方式中文标签', parsedDoc.shots[0].kindLabel === 'AI 生成视频', parsedDoc.shots[0].kindLabel)
  check('未知分类保留原值并标记', parsedDoc.shots[2].unknownKind === true && parsedDoc.shots[2].kind === 'brand_new_kind')
  check('缺提示词的镜头标为缺失', parsedDoc.shots[1].promptMissing === true)
  check('有提示词的镜头不标缺失', parsedDoc.shots[0].promptMissing === false)
  check('证据取 base.evidence', parsedDoc.shots[0].evidence.length === 2)
  check('全局风格可读', parsedDoc.globalStyle.includes('冷青'))
  check('视觉状态透出', parsedDoc.vlmStatus === 'partial')

  // 反推入库 → 逐镜制作方式落到 style-medium
  const adoptable = ids.find((id) => rea.getReverseJob(id)?.status === 'done')
  const adopted = rea.adoptReverseJob(adoptable, { title: '反推分面' })
  const adoptedCase = lib.saveCase(root, adopted)
  const adoptedFacets = lib.refreshCaseFacets(root, adoptedCase.id)
  check(
    '反推逐镜制作方式写入风格轴',
    adoptedFacets.some((f) => f.axis === 'style-medium' && f.value === 'ai-generated' && f.source === 'import'),
    JSON.stringify(adoptedFacets.filter((f) => f.axis === 'style-medium')),
  )
  check(
    '未知制作方式不写入词表外值',
    !adoptedFacets.some((f) => f.axis === 'style-medium' && f.value === 'brand_new_kind'),
  )
}

// ---------------------------------------------------------------- apply

/**
 * 应用到镜头的端到端：服务端侧只验证「案例 → 镜头字段」的写入语义。
 *
 * 浏览器里真正点击的那一步由 verify-prompt-cases-ui.mjs 覆盖；这里守的是
 * 写进去以后项目还能读回来、且没污染其他字段。
 */
async function runApply() {
  console.log('\n=== 应用到镜头 ===')
  const root = freshRoot('apply')
  const lib = await loadLib()
  const { createProject, readProject, writeProject } = await import('./server/db.mjs')

  createProject(root, 'apply-demo', { title: 'apply' })
  writeProject(root, 'apply-demo', {
    shots: [
      { id: 'E01-S01', episode: 1, no: 'S01', seconds: 3, size: '中景', move: '固定', desc: '测试镜', keyframe_prompt: '原始画面词', video_prompt: '原始运动词' },
      { id: 'E01-S02', episode: 1, no: 'S02', seconds: 3, size: '中景', move: '固定', desc: '第二镜', keyframe_prompt: '第二镜画面' },
    ],
  })

  const saved = lib.saveCase(root, {
    source: 'vflow',
    sourceId: 'apply-1',
    title: '可应用案例',
    prompt: 'A woman turns in a rainy alley, slow dolly in',
    model: 'seedance-2-5',
  })
  const one = lib.getCase(root, saved.id)
  check('案例可读回并带正文', Boolean(one?.prompt), one?.prompt?.slice(0, 30))

  // 模拟 App.applyPromptCase 的写入语义：只改目标字段
  const before = readProject(root, 'apply-demo')
  const target = before.shots.find((x) => x.no === 'S01')
  const nextShots = before.shots.map((x) =>
    x.id === target.id ? { ...x, keyframe_prompt: one.prompt, handEdited: [...new Set([...(x.handEdited || []), 'keyframe_prompt'])] } : x,
  )
  writeProject(root, 'apply-demo', { shots: nextShots })

  const after = readProject(root, 'apply-demo')
  const s1 = after.shots.find((x) => x.no === 'S01')
  const s2 = after.shots.find((x) => x.no === 'S02')
  check('目标镜头写入案例正文', s1.keyframe_prompt === one.prompt)
  check('其他镜头未被改动', s2.keyframe_prompt === '第二镜画面')
  check('运动提示词未被误改', s1.video_prompt === '原始运动词')
  check('标记为手改，重生成不会覆盖', Array.isArray(s1.handEdited) && s1.handEdited.includes('keyframe_prompt'))

  // 运动槽位
  const nextShots2 = after.shots.map((x) =>
    x.id === target.id ? { ...x, video_prompt: one.prompt } : x,
  )
  writeProject(root, 'apply-demo', { shots: nextShots2 })
  const after2 = readProject(root, 'apply-demo')
  check('运动提示词槽位可写', after2.shots.find((x) => x.no === 'S01').video_prompt === one.prompt)

  // 许可：外部案例不可能被标自有
  check('外部案例许可为仅参考', one.license === 'reference-only', one.license)
}

// ---------------------------------------------------------------- facets

async function runFacets() {
  console.log('\n=== 分面 ===')
  const root = freshRoot('facets')
  const lib = await loadLib()
  const { openDatabase } = await import('./server/db.mjs')

  const facetsOf = (id) => lib.getCase(root, id).facets || []
  const has = (list, axis, value) => list.some((f) => f.axis === axis && f.value === value)
  const totalFor = (groups) => lib.listCases(root, { facetGroups: groups }).total
  const countOf = (list, axis, value) => list.find((c) => c.axis === axis && c.value === value)?.count

  const a = lib.saveCase(root, {
    source: 'manual',
    sourceId: 'facet-a',
    title: '雨夜巷口',
    prompt: 'A woman turns in a rainy alley, medium shot, slow push in, neon light',
    category: 'cinematic realistic',
  })
  const b = lib.saveCase(root, {
    source: 'manual',
    sourceId: 'facet-b',
    title: '定格黏土',
    prompt: 'stop motion clay puppet in a bright kitchen, wide shot, static camera',
    category: 'claymation',
  })
  const c = lib.saveCase(root, {
    source: 'manual',
    sourceId: 'facet-c',
    title: '霓虹梦核',
    prompt: 'a dragon flies over mountains, aerial shot',
    category: 'neon-dreamcore',
  })
  for (const item of [a, b, c]) lib.refreshCaseFacets(root, item.id)

  const fa = facetsOf(a.id)
  check('文本推导景别', has(fa, 'shot-size', 'medium'), JSON.stringify(fa.map((f) => `${f.axis}:${f.value}`)))
  check('文本推导运镜', has(fa, 'camera-move', 'push-in'))
  check('文本推导环境', has(fa, 'environment', 'alley'))
  check('分类映射到风格且来源为 import', fa.some((f) => f.axis === 'style-medium' && f.source === 'import'))

  // 同轴 OR、跨轴 AND
  check('单值筛选命中 1 条', totalFor([{ axis: 'shot-size', values: ['medium'] }]) === 1)
  check('同轴两值 OR 命中 2 条', totalFor([{ axis: 'shot-size', values: ['medium', 'wide'] }]) === 2)
  check('跨轴 AND 命中 1 条', totalFor([{ axis: 'shot-size', values: ['medium'] }, { axis: 'environment', values: ['alley'] }]) === 1)
  check('跨轴互斥为空', totalFor([{ axis: 'shot-size', values: ['medium'] }, { axis: 'environment', values: ['kitchen'] }]) === 0)

  // 计数：算某轴时排除该轴自身条件，其余轴保留
  const allCounts = lib.caseFacetCounts(root, {})
  check('计数含景别', countOf(allCounts, 'shot-size', 'medium') === 1, JSON.stringify(countOf(allCounts, 'shot-size', 'medium')))
  const filteredCounts = lib.caseFacetCounts(root, { facetGroups: [{ axis: 'shot-size', values: ['medium'] }] })
  check('计数排除自身轴', countOf(filteredCounts, 'shot-size', 'wide') === 1 && countOf(filteredCounts, 'shot-size', 'medium') === 1)
  check('计数保留其他轴条件', countOf(filteredCounts, 'environment', 'alley') === 1 && countOf(filteredCounts, 'environment', 'kitchen') == null)

  // 人工值优先：同轴不再写推导值
  lib.setCaseFacets(root, a.id, [{ axis: 'shot-size', value: 'close-up', source: 'manual' }])
  lib.refreshCaseFacets(root, a.id)
  const fa2 = facetsOf(a.id)
  check('人工分面保留', has(fa2, 'shot-size', 'close-up'))
  check('推导值不覆盖人工轴', !has(fa2, 'shot-size', 'medium'))
  check('人工值可筛选', totalFor([{ axis: 'shot-size', values: ['close-up'] }]) === 1)

  // 删除自动值 → 隐藏；重推导不复活；恢复后回到列表
  check('定格案例有风格分面', has(facetsOf(b.id), 'style-medium', 'stop-motion-puppet'))
  lib.deleteCaseFacet(root, b.id, 'style-medium', 'stop-motion-puppet')
  check('删除后默认不返回', !has(facetsOf(b.id), 'style-medium', 'stop-motion-puppet'))
  lib.refreshCaseFacets(root, b.id)
  check('重推导不复活被删值', !has(facetsOf(b.id), 'style-medium', 'stop-motion-puppet'))
  lib.restoreCaseFacet(root, b.id, 'style-medium', 'stop-motion-puppet')
  check('恢复后可再筛出', totalFor([{ axis: 'style-medium', values: ['stop-motion-puppet'] }]) === 1)

  // 未映射分类：原文保留、可筛出、不计入计数、不拖累同条其他分面
  const fc = facetsOf(c.id)
  const unmapped = fc.find((f) => f.value === 'neon-dreamcore')
  check('未映射按原文保留', Boolean(unmapped) && unmapped.unmapped === true && unmapped.axis === 'genre')
  check('未映射可筛出', totalFor([{ axis: 'genre', values: ['neon-dreamcore'] }]) === 1)
  check('未映射不计入计数', !lib.caseFacetCounts(root, {}).some((x) => x.value === 'neon-dreamcore'))
  check('未映射不影响同条其他分面', has(fc, 'camera-move', 'aerial'))

  // 幂等：重复推导不增长行数
  const d = openDatabase(root)
  const rows = () => Number(d.prepare('SELECT COUNT(*) c FROM case_facets').get()?.c) || 0
  const before = rows()
  lib.refreshCaseFacets(root, c.id)
  check('重复推导行数不变', rows() === before, `${before} → ${rows()}`)
}

// ---------------------------------------------------------------- main




if (!mode) {
  // 每套用例独立进程：db.mjs 的模块级连接按首次 open 的路径缓存，
  // 同进程里换 root 不会换库，必须隔离。
  const { spawnSync } = await import('node:child_process')
  let failed = 0
  for (const m of ['--unit', '--import', '--reverse', '--apply', '--facets']) {
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), m], { stdio: 'inherit' })
    if (r.status !== 0) failed += 1
  }
  console.log(`\n${failed === 0 ? '全部通过' : `${failed} 个套件失败`}`)
  process.exit(failed === 0 ? 0 : 1)
}

if (mode === '--unit') await runUnit()
if (mode === '--import') await runImport()
if (mode === '--reverse') await runReverse()
if (mode === '--apply') await runApply()
if (mode === '--facets') await runFacets()

console.log(`\n${bad === 0 ? '全部通过' : `${bad} 项失败`}`)
process.exit(bad === 0 ? 0 : 1)
