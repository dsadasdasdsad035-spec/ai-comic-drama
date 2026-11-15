/**
 * Agent 素材工具回归（纯函数，无浏览器、无网络）。
 *
 * 覆盖：
 * 1) 连参考：按名字解析、add 幂等、remove 只删目标、同名歧义与不存在都报错且不写入
 * 2) 运镜参照：中文名与 key 都能绑、歧义报错、解绑写 null（不是留空）、不建素材卡
 * 3) 素材卡契约：合法与非法载荷、按 designId 与「角色+表情总图」去重、项目外地址整批拒绝
 * 4) 角色外观：采纳项目图与素材卡标题、项目外地址拒绝、格位与指纹由系统算、失败格点名
 * 5) 生成三视图与表情总图：未确认不生成、写入当前图并放候选首位、表情总图不被标失效
 *
 * 跑法：node verify-material-tools.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-material-tools-'))
const entry = path.join(tmp, 'entry.ts')
const abs = (p) => JSON.stringify(path.join(root, p))
fs.writeFileSync(
  entry,
  [
    `export * from ${abs('src/agent/materialTools.ts')}`,
    `export * from ${abs('src/agent/refResolve.ts')}`,
    `export * from ${abs('src/assetCards.ts')}`,
    `export * from ${abs('src/skills/contracts.ts')}`,
    `export * from ${abs('src/platform/projectDraft.ts')}`,
    `export * from ${abs('src/expressionSheet.ts')}`,
    `export * from ${abs('src/characters.ts')}`,
    `export * from ${abs('src/creative/expertToolGroups.ts')}`,
  ].join('\n') + '\n',
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
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const CHAR = {
  id: '陈默',
  name: '陈默',
  role: '主角',
  lookCn: '三十出头',
  lookEn: 'chinese man, buzz cut',
  palette: '铁灰',
  keywords: ['机械左手'],
  image: '/project-assets/char/old.png',
  candidates: ['/project-assets/char/old.png'],
}
const OTHER = { ...CHAR, id: '林小雨', name: '林小雨', image: '/project-assets/char/lin.png' }

const PROJECT = {
  name: 'probe',
  shots: [
    { id: 'E01-S01', episode: 1, no: 'S01', refIds: ['ref-old'] },
    { id: 'E01-S02', episode: 1, no: 'S02', refIds: ['char-陈默', 'asset-a1'] },
  ],
  characters: [CHAR, OTHER],
  assets: [],
}

const ASSET_CARDS = [
  { id: 'asset-a1', title: '会议室全景', url: '/project-assets/assets/room.png' },
  { id: 'asset-a2', title: '雨夜天台', url: '/project-assets/assets/roof.png' },
]

/** 造一套 deps；每次调用都是独立状态，避免用例互相污染 */
function makeDeps(over = {}) {
  const state = {
    project: structuredClone(PROJECT),
    written: [],
    committed: [],
    asked: [],
    generated: [],
    snapshots: [],
  }
  const deps = {
    projectName: () => 'probe',
    epNo: () => 1,
    load: async () => state.project,
    setSnapshot: (p) => {
      state.project = p
      state.snapshots.push(p)
    },
    onChanged: () => {},
    writeShot: async (project, next) => {
      state.written.push(next)
      state.project = {
        ...project,
        shots: (project.shots || []).map((s) => (s.id === next.id ? next : s)),
      }
      return { ok: true }
    },
    askCost: async (req) => {
      state.asked.push(req)
      return { ok: true }
    },
    getCanvasAssets: () => ASSET_CARDS,
    commitCharacters: async (next) => {
      state.committed.push(next)
      state.project = { ...state.project, characters: next }
    },
    cropSheet: async (sheet) => ({
      sheet: {
        ...sheet,
        cells: sheet.cells.map((c) =>
          c.emotion === 'fearful'
            ? c
            : { ...c, cropUrl: `/project-assets/crop-${c.emotion}.png`, cropFingerprint: 'fp' },
        ),
      },
      errors: ['fearful：裁剪超时'],
    }),
    io: {
      mediaUrls: async () => [
        '/project-assets/char/old.png',
        '/project-assets/char/lin.png',
        '/project-assets/assets/room.png',
        '/project-assets/assets/roof.png',
        '/project-assets/gen/new.png',
      ],
      importLexicon: async (_p, key) => ({ url: `/project-assets/lexicon/lexicon-${key}.mp4` }),
      generateImage: async (input) => {
        state.generated.push(input)
        const next = `/project-assets/gen/new${state.generated.length}.png`
        return { urls: [next], url: next }
      },
    },
    ...over,
  }
  return { deps, state }
}

const call = (tools, name, args) => {
  const t = tools.find((x) => x.name === name)
  if (!t) throw new Error(`工具未注册：${name}`)
  return t.run(args)
}

// ------------------------------------------------------------ 注册与描述
const { deps } = makeDeps()
const tools = lib.createMaterialTools(deps)
const NAMES = [
  'link_shot_refs',
  'set_shot_camera_lexicon',
  'set_character_visual',
  'generate_character_views',
  'generate_expression_sheet',
]
check('五个工具都已构造', tools.length === 5 && NAMES.every((n) => tools.some((t) => t.name === n)), tools.map((t) => t.name).join(','))
check(
  '描述都写清了寻址/成本/不建卡',
  tools.every((t) => String(t.description ?? '').length > 30),
)
check(
  '连参考描述禁止传节点 id',
  /不要传画布节点 id/.test(tools.find((t) => t.name === 'link_shot_refs').description),
)
check(
  '运镜描述写明不发布素材卡',
  /不发布素材卡/.test(tools.find((t) => t.name === 'set_shot_camera_lexicon').description),
)

// ------------------------------------------------------------ 连参考
{
  const { deps: d, state } = makeDeps()
  const ts = lib.createMaterialTools(d)
  const r = await call(ts, 'link_shot_refs', { no: 'S01', kind: 'character', names: ['陈默'] })
  check('按角色名连上参考', r.ok === true && same(r.refIds, ['ref-old', 'char-陈默']), JSON.stringify(r))
  const again = await call(ts, 'link_shot_refs', { no: 'S01', kind: 'character', names: ['陈默'] })
  check('重复连同一角色幂等', same(again.refIds, ['ref-old', 'char-陈默']), JSON.stringify(again.refIds))

  const asset = await call(ts, 'link_shot_refs', { no: 'S01', kind: 'asset', names: ['会议室全景'] })
  check('按素材标题连上参考', asset.ok === true && asset.refIds.includes('asset-a1'), JSON.stringify(asset.refIds))

  const rm = await call(ts, 'link_shot_refs', { no: 'S02', kind: 'character', names: ['陈默'], action: 'remove' })
  check('remove 只移除目标项', rm.ok === true && same(rm.refIds, ['asset-a1']), JSON.stringify(rm.refIds))

  const missing = await call(ts, 'link_shot_refs', { no: 'S01', kind: 'character', names: ['查无此人'] })
  check('不存在的角色名报错', missing.ok === false && /找不到角色/.test(missing.error), missing.error)
  check('报错时列出可用角色', /陈默、林小雨/.test(missing.error), missing.error)
  const before = state.written.length
  await call(ts, 'link_shot_refs', { no: 'S01', kind: 'character', names: ['查无此人'] })
  check('报错后没有写入', state.written.length === before, String(state.written.length))

  const noShot = await call(ts, 'link_shot_refs', { no: 'S99', kind: 'character', names: ['陈默'] })
  check('镜号不存在报错', noShot.ok === false && /找不到镜号/.test(noShot.error), noShot.error)
}

// 同名素材卡按歧义处理，不替用户选
{
  const dupCards = [...ASSET_CARDS, { id: 'asset-a3', title: '会议室全景', url: '/project-assets/assets/room2.png' }]
  const { deps: d } = makeDeps({ getCanvasAssets: () => dupCards })
  const r = await call(lib.createMaterialTools(d), 'link_shot_refs', {
    no: 'S01',
    kind: 'asset',
    names: ['会议室全景'],
  })
  check('同名素材卡报歧义', r.ok === false && /同名卡/.test(r.error), r.error)
  check('歧义时列出候选 id', /asset-a1/.test(r.error) && /asset-a3/.test(r.error), r.error)
}

// 没有画布上下文时按标题连素材卡必须 fail-closed
{
  const { deps: d } = makeDeps({ getCanvasAssets: undefined })
  const r = await call(lib.createMaterialTools(d), 'link_shot_refs', {
    no: 'S01',
    kind: 'asset',
    names: ['会议室全景'],
  })
  check('无画布上下文时拒绝连素材', r.ok === false && /画布上下文/.test(r.error), r.error)
}

// ------------------------------------------------------------ 运镜参照
{
  let canvasReads = 0
  const { deps: d, state } = makeDeps({
    getCanvasAssets: () => {
      canvasReads++
      return ASSET_CARDS
    },
  })
  const ts = lib.createMaterialTools(d)
  const r = await call(ts, 'set_shot_camera_lexicon', { no: 'S01', entry: '横摇' })
  check('按中文名绑定运镜参照', r.ok === true, JSON.stringify(r))
  const shot = state.written.at(-1)
  check('写入条目 key', shot.lexicon_ref_key === '03_pan', String(shot.lexicon_ref_key))
  check('写入项目内地址', /^\/project-assets\/lexicon\//.test(String(shot.lexicon_ref_url)), String(shot.lexicon_ref_url))
  check('打开运镜参考开关', shot.motion_lexicon_as_ref === true, String(shot.motion_lexicon_as_ref))

  const byKey = await call(ts, 'set_shot_camera_lexicon', { no: 'S02', entry: '01_dolly_in' })
  check('按 key 绑定', byKey.ok === true && byKey.key === '01_dolly_in', JSON.stringify(byKey))

  const unknown = await call(ts, 'set_shot_camera_lexicon', { no: 'S01', entry: '不存在的运镜' })
  check('条目不存在时报错', unknown.ok === false && /没有/.test(unknown.error), unknown.error)

  const clear = await call(ts, 'set_shot_camera_lexicon', { no: 'S01', clear: true })
  const cleared = state.written.at(-1)
  check('解绑成功', clear.ok === true)
  check('解绑写 null 而不是留空', cleared.lexicon_ref_key === null && cleared.lexicon_ref_url === null, JSON.stringify({ k: cleared.lexicon_ref_key, u: cleared.lexicon_ref_url }))
  check('解绑关闭开关', cleared.motion_lexicon_as_ref === false)

  const neither = await call(ts, 'set_shot_camera_lexicon', { no: 'S01' })
  check('既不给 entry 也不 clear 时报错', neither.ok === false && /clear=true/.test(neither.error), neither.error)

  // 运镜参照只改镜上三个字段，不往画布塞卡
  check('绑运镜不读画布素材', canvasReads === 0, String(canvasReads))
  check('绑运镜不新增素材卡', (state.project.assets ?? []).length === 0)
  const bound = state.written.find((s) => s.lexicon_ref_key === '03_pan')
  check('绑运镜载荷里没有素材字段', bound !== undefined && !('assets' in bound) && !('kind' in bound), JSON.stringify(Object.keys(bound ?? {})))
}

// ------------------------------------------------------------ 素材卡契约
const validAsset = lib.validateContract('assets-v1', {
  assets: [{ title: '会议室全景', kind: 'image', url: '/project-assets/assets/room.png' }],
})
check('合法素材卡载荷通过', validAsset.ok === true, JSON.stringify(validAsset))
const badKind = lib.validateContract('assets-v1', {
  assets: [{ title: 'x', kind: 'hologram', url: '/a.png' }],
})
check('非法类型被拒', badKind.ok === false, JSON.stringify(badKind))
const noUrl = lib.validateContract('assets-v1', { assets: [{ title: 'x', kind: 'image' }] })
check('缺地址被拒', noUrl.ok === false)
const emptyAssets = lib.validateContract('assets-v1', { assets: [] })
check('空数组被拒', emptyAssets.ok === false)

const mergedSame = lib.mergeAssetCards(
  [{ kind: 'image', title: '会议室全景', url: '/a.png', designId: 'd1' }],
  [{ kind: 'image', title: '会议室全景（改）', url: '/b.png', designId: 'd1' }],
)
check('同一 designId 视为同一张卡', mergedSame.added.length === 0 && mergedSame.updated.length === 1, JSON.stringify(mergedSame.added))
check('同一卡被更新而不是新增', mergedSame.next.length === 1 && mergedSame.next[0].url === '/b.png')

const mergedSheet = lib.mergeAssetCards(
  [{ kind: 'expression-sheet', title: '陈默 · 表情总图', url: '/x.png', characterName: '陈默' }],
  [{ kind: 'expression-sheet', title: '陈默 · 表情总图', url: '/y.png', characterName: '陈默' }],
)
check('角色表情总图只保留一张', mergedSheet.next.length === 1 && mergedSheet.next[0].url === '/y.png')
check('表情总图更新计入 updated', mergedSheet.updated.length === 1)

const mergedDistinct = lib.mergeAssetCards(undefined, [
  { kind: 'image', title: '甲', url: '/a.png' },
  { kind: 'image', title: '乙', url: '/b.png' },
])
check('不同卡各自新增', mergedDistinct.added.length === 2, String(mergedDistinct.next.length))

// 写回：地址校验整批拒绝
{
  const snapshot = { name: 'probe', assets: [] }
  let patched = null
  let synced = null
  const ctx = {
    projectName: 'probe',
    epNo: 1,
    getSnapshot: () => snapshot,
    setSnapshot: (p) => Object.assign(snapshot, p),
    listMediaUrls: async () => ['/project-assets/assets/room.png'],
    onAssetsWritten: (next) => {
      synced = next
    },
    writer: { patch: async (_n, patch) => { patched = patch } },
  }
  const okWrite = await lib.applyProjectDraft(
    'assets-v1',
    { assets: [{ title: '会议室全景', kind: 'image', url: '/project-assets/assets/room.png' }] },
    ctx,
  )
  check('地址在项目媒体里时写回成功', okWrite.ok === true, JSON.stringify(okWrite))
  check('写回更新了项目素材列表', (patched?.assets ?? []).length === 1)
  check('写回同步了画布', Array.isArray(synced) && synced.length === 1 && synced[0].title === '会议室全景', JSON.stringify(synced))

  // 同一张卡再提交一次：只更新，不追加，画布也只收到同一张
  const againWrite = await lib.applyProjectDraft(
    'assets-v1',
    { assets: [{ title: '会议室全景', kind: 'image', url: '/project-assets/assets/room.png' }] },
    ctx,
  )
  check('重复提交只更新不新增', againWrite.ok === true && (patched?.assets ?? []).length === 1, JSON.stringify(patched?.assets))

  const beforeAssets = snapshot.assets
  const rejected = await lib.applyProjectDraft(
    'assets-v1',
    {
      assets: [
        { title: '好的', kind: 'image', url: '/project-assets/assets/room.png' },
        { title: '外链', kind: 'image', url: 'https://example.com/x.png' },
      ],
    },
    ctx,
  )
  check('项目外地址整批拒绝', rejected.ok === false && /整批拒绝/.test(rejected.error), rejected.error)
  check('拒绝后项目素材未变', same(snapshot.assets, beforeAssets))
}

// ------------------------------------------------------------ 角色外观
{
  const { deps: d, state } = makeDeps()
  const ts = lib.createMaterialTools(d)
  const r = await call(ts, 'set_character_visual', {
    character: '陈默',
    target: 'image',
    url: '/project-assets/assets/room.png',
  })
  check('采纳项目图片为三视图', r.ok === true && r.image === '/project-assets/assets/room.png', JSON.stringify(r))
  const committed = state.committed.at(-1).find((c) => c.name === '陈默')
  check('落库通道收蛇形字段', Boolean(committed) && 'look_en' in committed && !('lookEn' in committed), Object.keys(committed || {}).join(','))
  check('三视图写入角色当前图', committed.image === '/project-assets/assets/room.png')
  check('新图放到候选首位', committed.candidates[0] === '/project-assets/assets/room.png', JSON.stringify(committed.candidates))
  check('采纳记为上传来源', r.source === 'uploaded')
  const reread = (await d.load()).characters.find((c) => c.name === '陈默')
  check('写入后重读项目就能看到新图', reread?.image === '/project-assets/assets/room.png', String(reread?.image))

  const byTitle = await call(ts, 'set_character_visual', {
    character: '林小雨',
    target: 'image',
    assetTitle: '雨夜天台',
  })
  check('按素材卡标题采纳', byTitle.ok === true && byTitle.image === '/project-assets/assets/roof.png', JSON.stringify(byTitle))

  // 项目外地址、外链、查不到的标题三种拒绝
  const outside = await call(ts, 'set_character_visual', { character: '陈默', target: 'image', url: '/etc/passwd' })
  check('项目外地址被拒', outside.ok === false && /不在当前项目媒体里/.test(outside.error), outside.error)
  const remote = await call(ts, 'set_character_visual', {
    character: '陈默',
    target: 'image',
    url: 'https://example.com/a.png',
  })
  check('外链被拒并给下一步', remote.ok === false && /先把外部图片存进项目/.test(remote.error), remote.error)
  const noTitle = await call(ts, 'set_character_visual', { character: '陈默', target: 'image', assetTitle: '没有这张' })
  check('标题不存在被拒', noTitle.ok === false && /画布上没有标题/.test(noTitle.error), noTitle.error)
  check('拒绝时列出可用标题', /会议室全景/.test(noTitle.error), noTitle.error)

  const noChar = await call(ts, 'set_character_visual', { character: '路人甲', target: 'image', url: '/project-assets/char/old.png' })
  check('角色不存在被拒', noChar.ok === false && /找不到角色/.test(noChar.error), noChar.error)

  // 表情总图：格位与指纹由系统算
  const sheetRes = await call(ts, 'set_character_visual', {
    character: '陈默',
    target: 'expression_sheet',
    url: '/project-assets/assets/room.png',
  })
  check('采纳表情总图成功', sheetRes.ok === true, JSON.stringify(sheetRes))
  const sheet = state.committed.at(-1).find((c) => c.name === '陈默').expression_sheet
  check('总图固定四列两行', sheet.columns === 4 && sheet.rows === 2, JSON.stringify([sheet.columns, sheet.rows]))
  check('八格按固定布局生成', sheet.cells.length === 8, String(sheet.cells.length))
  check('指纹取当前外观锚点', sheet.fingerprint === lib.identityFingerprint(CHAR), sheet.fingerprint)
  check('裁剪完成七格并点名失败格', sheetRes.cropped === 7 && /fearful/.test(sheetRes.summary), sheetRes.summary)
  check('失败格没有伪造裁剪', sheet.cells.find((c) => c.emotion === 'fearful').cropUrl === undefined)
}

// ------------------------------------------------------------ 生成三视图
{
  const { deps: d, state } = makeDeps()
  const ts = lib.createMaterialTools(d)
  const r = await call(ts, 'generate_character_views', { character: '陈默' })
  check('生成三视图成功', r.ok === true, JSON.stringify(r))
  check('生成前请求了成本确认', state.asked.length === 1 && state.asked[0].action === 'generate_character_views', JSON.stringify(state.asked[0]))
  const committed = state.committed.at(-1).find((c) => c.name === '陈默')
  check('新图写入当前图', /\/project-assets\/gen\/new1\.png$/.test(committed.image), String(committed.image))
  check('新图在候选首位', committed.candidates[0] === committed.image, JSON.stringify(committed.candidates))
  check('重出三视图不标表情总图失效', committed.expression_sheet === undefined)

  // 先有可用的表情总图，再重出三视图：总图必须原样保留
  const withSheet = {
    ...CHAR,
    expressionSheet: {
      image: '/project-assets/sheet/old.png',
      columns: 4,
      rows: 2,
      cells: lib.buildExpressionSheetCells().map((c) => ({ ...c, cropUrl: `/project-assets/crop/${c.emotion}.png` })),
      source: 'generated',
      fingerprint: lib.identityFingerprint(CHAR),
    },
  }
  const { deps: d2, state: s2 } = makeDeps()
  d2.load = async () => ({ ...s2.project, characters: [withSheet] })
  const r2 = await call(lib.createMaterialTools(d2), 'generate_character_views', { character: '陈默' })
  const kept = s2.committed.at(-1).find((c) => c.name === '陈默')
  check('已有表情总图仍可用', r2.ok === true && kept.expression_sheet?.stale !== true, JSON.stringify(kept.expression_sheet?.stale))
  check('表情总图内容未变', kept.expression_sheet?.image === '/project-assets/sheet/old.png')
}

// 未确认成本时一律不生成
{
  const { deps: d, state } = makeDeps({
    askCost: async (req) => {
      state.asked.push(req)
      return { ok: false, error: '用户取消了本次生成（未发起请求）' }
    },
  })
  const r = await call(lib.createMaterialTools(d), 'generate_character_views', { character: '陈默' })
  check('未确认成本不生成', r.ok === false && state.generated.length === 0, JSON.stringify(r))
  check('未确认时不写角色', state.committed.length === 0)
}

// 没有确认通道时 fail-closed
{
  const { deps: d, state } = makeDeps({ askCost: undefined })
  const r = await call(lib.createMaterialTools(d), 'generate_expression_sheet', { character: '陈默' })
  check('没有确认通道时拒绝生成', r.ok === false && /确认通道/.test(r.error), r.error)
  check('拒绝时没发请求', state.generated.length === 0)
}

// ------------------------------------------------------------ 生成表情总图
{
  const { deps: d, state } = makeDeps()
  const ts = lib.createMaterialTools(d)
  const r = await call(ts, 'generate_expression_sheet', { character: '陈默' })
  check('生成表情总图成功', r.ok === true, JSON.stringify(r))
  check('提示词带四列两行的版式', /exactly 4 columns by 2 rows/.test(state.generated.at(-1).prompt), state.generated.at(-1).prompt.slice(0, 60))
  check('提示词带外观锚点', state.generated.at(-1).prompt.startsWith('chinese man, buzz cut'), state.generated.at(-1).prompt.slice(0, 40))
  const sheet = state.committed.at(-1).find((c) => c.name === '陈默').expression_sheet
  check('生成的总图记为 generated', sheet.source === 'generated')
  check('生成的总图八格齐全', sheet.cells.length === 8 && sheet.fingerprint === lib.identityFingerprint(CHAR))
  check('失败格在结果里点名', /fearful/.test(r.summary), r.summary)

  // 没有锚点也没有图 → 拒绝并给下一步
  const bare = { ...CHAR, lookEn: '', image: undefined, referenceImages: [] }
  const { deps: d3, state: s3 } = makeDeps()
  d3.load = async () => ({ ...s3.project, characters: [bare] })
  const noAnchor = await call(lib.createMaterialTools(d3), 'generate_expression_sheet', { character: '陈默' })
  check('无锚点无图时拒绝', noAnchor.ok === false && /look_en/.test(noAnchor.error), noAnchor.error)
}

// 没有角色落库通道时 fail-closed（否则刷新后图会丢）
{
  const { deps: d } = makeDeps({ commitCharacters: undefined })
  const r = await call(lib.createMaterialTools(d), 'set_character_visual', {
    character: '陈默',
    target: 'image',
    url: '/project-assets/char/old.png',
  })
  check('没有落库通道时拒绝写角色', r.ok === false && /落库通道/.test(r.error), r.error)
}

// ------------------------------------------------------------ 可见性
{
  const ACTIONS = ['link_shot_refs', 'set_shot_camera_lexicon', 'set_character_visual', 'generate_character_views', 'generate_expression_sheet']
  check('动作工具不落在只读组', ACTIONS.every((n) => lib.classifyExpertTool(n) !== 'read' && lib.classifyExpertTool(n) !== 'other'), ACTIONS.map((n) => `${n}=${lib.classifyExpertTool(n)}`).join(','))
  check('动作工具都在默认专家清单里', ACTIONS.every((n) => lib.DEFAULT_EXPERT_PLATFORM_TOOLS.includes(n)))
  check('提交素材归到写草稿组', lib.classifyExpertTool('submit_assets') === 'write')
  const groups = lib.groupExpertPlatformTools([...lib.DEFAULT_EXPERT_PLATFORM_TOOLS, ...ACTIONS, 'submit_assets'])
  check('分组后其它组为空', groups.other.length === 0, groups.other.join(','))
  check('生成类动作进入有成本组', groups.generate.includes('generate_character_views') && groups.generate.includes('generate_expression_sheet'))
}

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 素材工具回归通过')
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(bad ? 1 : 0)
