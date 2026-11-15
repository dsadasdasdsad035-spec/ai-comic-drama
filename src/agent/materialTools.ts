import { z } from 'zod'
import { defineTool, type ToolDef } from './tool'
import {
  generateImage,
  importCameraLexiconPreset,
  listMedia,
  type ProjectData,
  type ProjectShot,
} from '../api'
import {
  EXPRESSION_SHEET_COLUMNS,
  EXPRESSION_SHEET_ROWS,
  TURNAROUND_SUFFIX,
  identityFingerprint,
  type CharacterExpressionSheet,
  type CharacterSheet,
} from '../characters'
import { buildExpressionSheetCells, canGenerateExpressionSheet, expressionSheetPrompt } from '../expressionSheet'
import { cropExpressionSheet } from '../expressionCrop'
import { resolveCameraLexiconByName } from '../cameraLexicon'
import { isProjectMediaUrl } from '../assetCards'
import { applyRefTokens, resolveRefTargets } from './refResolve'

/**
 * 素材/画布类动作工具。
 *
 * 为什么从 `builtinPlatformTools` 里分出来：那一份已经装着读工具、契约写工具与
 * 生成工具，再塞五个「对某个具体对象做一件事」的工具会到一千多行，
 * 而这里每个工具都要碰画布、角色落库与媒体清单三样宿主能力，边界很清楚。
 *
 * 之所以不直接 import 宿主：这些能力（画布节点、角色立即落库、八格裁剪）都住在
 * React 状态与浏览器里，模块级 import 会让工具无法在 node 下被回归脚本直接调用。
 * 全部经 `MaterialToolDeps` 注入，缺哪一项就 fail-closed，不静默降级。
 */

export type MaterialCostRequest = {
  action: 'generate_character_views' | 'generate_expression_sheet'
  title: string
  detail: string
  payload?: Record<string, unknown>
}

export type MaterialToolDeps = {
  /** 当前项目名；空串表示未选项目 */
  projectName: () => string
  epNo: () => number
  load: () => Promise<ProjectData>
  setSnapshot: (p: ProjectData) => void
  onChanged?: () => void
  /** 单镜写回：服务端按 id 字段级合并 */
  writeShot: (project: ProjectData, next: ProjectShot) => Promise<{ ok: true } | { ok: false; error: string }>
  /** 成本确认；缺省时生成类工具 fail-closed */
  askCost?: (req: MaterialCostRequest) => Promise<{ ok: true } | { ok: false; error: string }>
  /** 画布素材卡：id / 标题 / 地址。按标题寻址与画布同步都靠它 */
  getCanvasAssets?: () => { id: string; title: string; url: string }[]
  /** 角色图片类变更立即落库并同步界面 */
  commitCharacters?: (next: CharacterSheet[]) => void | Promise<void>
  /** 八格裁剪；默认浏览器 canvas 实现 */
  cropSheet?: (sheet: CharacterExpressionSheet, project: string) => Promise<{ sheet: CharacterExpressionSheet; errors: string[] }>
  /**
   * 外部调用（HTTP）。默认走真实接口；回归脚本据此把网络挡在外面，
   * 也让「地址校验失败」「生图失败」这类分支不必真发请求就能验。
   */
  io?: {
    mediaUrls?: (project: string) => Promise<string[]>
    importLexicon?: (project: string, key: string) => Promise<{ url: string }>
    generateImage?: (input: {
      prompt: string
      ratio: string
      n: number
      cap: 'image' | 'view'
      project: string
      refImage?: string
      refImages?: string[]
    }) => Promise<{ urls?: string[]; url: string }>
  }
}

function characterRoster(project: ProjectData): CharacterSheet[] {
  return (project.characters || []).filter((c): c is CharacterSheet => Boolean(c && typeof c === 'object'))
}

function findCharacter(project: ProjectData, want: string): CharacterSheet | undefined {
  const key = String(want ?? '').trim()
  if (!key) return undefined
  return characterRoster(project).find((c) => c.id === key || c.name === key)
}

function findShot(project: ProjectData, ep: number, no: string): ProjectShot | undefined {
  const want = String(no ?? '').trim()
  return (project.shots || []).find((s) => (Number(s.episode) || 1) === ep && String(s.no ?? '').trim() === want)
}

const NO_PROJECT = '请先在顶栏选择项目'

/** 项目媒体地址清单；读失败按空清单处理，宁可拒绝也不写进打不开的地址 */
async function projectMediaUrls(deps: MaterialToolDeps): Promise<string[]> {
  const name = deps.projectName().trim()
  if (!name) return []
  try {
    if (deps.io?.mediaUrls) return await deps.io.mediaUrls(name)
    const bundle = await listMedia(name)
    return [...bundle.images, ...bundle.videos].map((m) => m.url)
  } catch {
    return []
  }
}

/** 角色图片类字段写回：立即落库 + 更新快照，不走防抖草稿 */
async function commitCharacterWrite(
  deps: MaterialToolDeps,
  project: ProjectData,
  next: CharacterSheet,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!deps.commitCharacters) {
    return { ok: false, error: '当前会话没有角色落库通道，已拒绝写入（否则刷新后图会丢）' }
  }
  const characters = characterRoster(project).map((c) => (c.id === next.id ? next : c))
  try {
    await deps.commitCharacters(characters)
  } catch (e) {
    return { ok: false, error: `角色落库失败：${(e as Error)?.message || String(e)}` }
  }
  deps.setSnapshot({ ...project, characters })
  deps.onChanged?.()
  return { ok: true }
}

/**
 * 连参考：只写目标镜的参考字段，边由字段派生。
 *
 * 增删而不是赋值：一次连三张素材不该把之前连的角色清掉。
 * 名字解析失败时返回错误与候选名单，绝不写入猜出来的 id。
 */
export function createLinkShotRefsTool(deps: MaterialToolDeps): ToolDef {
  return defineTool({
    name: 'link_shot_refs',
    description:
      '【平台内置】给某个镜头加/减参考连线。寻址一律用名字：角色传角色名，素材传素材卡标题，' +
      '不要传画布节点 id。add 是并集（重复调用不会连两次），remove 只移除目标项、其他参考保持不变。' +
      '名字找不到或同名歧义时报错并列出候选，不写入任何猜测的 id。本工具不新建镜头、不新建素材卡、不改参考以外的字段。',
    schema: z.object({
      no: z.string().min(1).describe('镜号，例如 S03'),
      kind: z.enum(['character', 'asset']).describe('参考类型：角色卡或素材卡'),
      names: z.array(z.string().min(1)).min(1).describe('角色名或素材卡标题；不要传节点 id'),
      action: z.enum(['add', 'remove']).optional().describe('默认 add；remove 只移除目标项'),
      episode: z.number().int().min(1).optional().describe('集号；省略用当前集'),
    }),
    run: async ({ no, kind, names, action, episode }) => {
      if (!deps.projectName().trim()) return { ok: false, error: NO_PROJECT }
      let project: ProjectData
      try {
        project = await deps.load()
      } catch (e) {
        return { ok: false, error: (e as Error)?.message || String(e) }
      }
      const ep = Number(episode) > 0 ? Math.floor(Number(episode)) : deps.epNo()
      const shot = findShot(project, ep, no)
      if (!shot) return { ok: false, error: `第 ${ep} 集找不到镜号 ${String(no).trim()}` }
      if (kind === 'asset' && !deps.getCanvasAssets) {
        return {
          ok: false,
          error:
            '当前会话没有画布上下文，无法按标题连素材卡；下一步：改用角色参考，或请用户在画布上手动拖线',
        }
      }
      const resolved = resolveRefTargets({
        kind,
        names,
        characters: characterRoster(project).map((c) => ({ id: c.id, name: c.name })),
        assets: (deps.getCanvasAssets?.() ?? []).map((a) => ({ id: a.id, name: a.title })),
      })
      if (!resolved.ok) return { ok: false, error: resolved.error }
      const mode = action ?? 'add'
      const refIds = applyRefTokens(shot.refIds, resolved.tokens, mode)
      const written = await deps.writeShot(project, { ...shot, refIds })
      if (!written.ok) return written
      return {
        ok: true,
        summary:
          mode === 'add'
            ? `镜 ${shot.no} 已连 ${resolved.labels.length} 个参考：${resolved.labels.join('、')}`
            : `镜 ${shot.no} 已移除 ${resolved.labels.length} 个参考：${resolved.labels.join('、')}`,
        no: shot.no,
        refIds,
        linked: resolved.labels,
      }
    },
  })
}

/**
 * 指定运镜参照：先把条目视频导进项目，再写三个绑定字段。
 *
 * 与界面的「选择运镜参照」同一套：写项目内地址是为了出片时真能取到文件。
 * 解绑写 null 而不是留空——服务端字段级合并会跳过 undefined，留空等于没解绑。
 * 本工具不发布素材卡：绑定是镜头参数，不是画布内容。
 */
export function createSetShotCameraLexiconTool(deps: MaterialToolDeps): ToolDef {
  return defineTool({
    name: 'set_shot_camera_lexicon',
    description:
      '【平台内置】给某个镜头绑定或解绑运镜参照（镜头语言库条目）。entry 传条目中文名或 key，' +
      '不要传视频地址。绑定时会先把该条目的视频导入当前项目，再把项目内地址写进镜头并打开「作为运镜参考」；' +
      'clear=true 清空三项绑定。名字匹配到多条时报错并列出候选。本工具不发布素材卡、不改景别与运镜文字。',
    schema: z.object({
      no: z.string().min(1).describe('镜号，例如 S03'),
      entry: z.string().optional().describe('条目中文名或 key，例如「推镜头」或 01_dolly_in'),
      clear: z.boolean().optional().describe('true 表示解绑并关闭运镜参考'),
      episode: z.number().int().min(1).optional().describe('集号；省略用当前集'),
    }),
    run: async ({ no, entry, clear, episode }) => {
      const name = deps.projectName().trim()
      if (!name) return { ok: false, error: NO_PROJECT }
      const wanted = String(entry ?? '').trim()
      if (!clear && !wanted) return { ok: false, error: '要么给 entry，要么设 clear=true' }
      let project: ProjectData
      try {
        project = await deps.load()
      } catch (e) {
        return { ok: false, error: (e as Error)?.message || String(e) }
      }
      const ep = Number(episode) > 0 ? Math.floor(Number(episode)) : deps.epNo()
      const shot = findShot(project, ep, no)
      if (!shot) return { ok: false, error: `第 ${ep} 集找不到镜号 ${String(no).trim()}` }

      if (clear) {
        const written = await deps.writeShot(project, {
          ...shot,
          lexicon_ref_key: null,
          lexicon_ref_url: null,
          motion_lexicon_as_ref: false,
        })
        if (!written.ok) return written
        return { ok: true, summary: `镜 ${shot.no} 已解绑运镜参照`, no: shot.no }
      }

      const hit = resolveCameraLexiconByName(wanted)
      if (!hit.entry) {
        if (hit.candidates?.length) {
          return {
            ok: false,
            error: `「${wanted}」匹配到多个运镜条目：${hit.candidates.map((c) => c.key).join('、')}；请改用 key 指定`,
            candidates: hit.candidates.map((c) => ({ key: c.key, cn: c.cn })),
          }
        }
        return {
          ok: false,
          error: `镜头语言库里没有「${wanted}」。下一步：用 list_camera_lexicon 查条目名或 key，再指定`,
        }
      }
      let url = ''
      try {
        const r = deps.io?.importLexicon
          ? await deps.io.importLexicon(name, hit.entry.key)
          : await importCameraLexiconPreset(name, hit.entry.key)
        url = r.url
      } catch (e) {
        return { ok: false, error: `运镜条目导入项目失败：${(e as Error)?.message || String(e)}` }
      }
      if (!url) return { ok: false, error: '运镜条目导入后没有返回项目内地址' }
      const written = await deps.writeShot(project, {
        ...shot,
        lexicon_ref_key: hit.entry.key,
        lexicon_ref_url: url,
        motion_lexicon_as_ref: true,
      })
      if (!written.ok) return written
      return {
        ok: true,
        summary: `镜 ${shot.no} 运镜参照已设为「${hit.entry.cn}」`,
        no: shot.no,
        key: hit.entry.key,
        url,
      }
    },
  })
}

/** 把素材卡标题或项目内地址解析成一个可访问的图片/视频地址 */
async function resolveVisualUrl(
  deps: MaterialToolDeps,
  args: { url?: string; assetTitle?: string },
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const title = String(args.assetTitle ?? '').trim()
  const direct = String(args.url ?? '').trim()
  if (title && direct) return { ok: false, error: 'url 与 assetTitle 只能给一个' }
  if (!title && !direct) return { ok: false, error: '要么给项目内地址 url，要么给素材卡标题 assetTitle' }

  let url = direct
  if (title) {
    const cards = deps.getCanvasAssets?.() ?? []
    if (!cards.length) {
      return { ok: false, error: '当前会话没有画布上下文，无法按标题找素材卡；下一步：改用 url' }
    }
    const hits = cards.filter((c) => c.title === title)
    if (!hits.length) {
      return {
        ok: false,
        error: `画布上没有标题为「${title}」的素材卡；可用标题：${cards
          .slice(0, 12)
          .map((c) => c.title)
          .join('、')}`,
      }
    }
    if (hits.length > 1) {
      return {
        ok: false,
        error: `标题「${title}」有 ${hits.length} 张卡（${hits.map((c) => c.id).join('、')}），无法确定用哪一张；请改用 url`,
      }
    }
    url = hits[0].url
    if (!url) return { ok: false, error: `素材卡「${title}」没有可用地址` }
  }

  const urls = await projectMediaUrls(deps)
  if (!isProjectMediaUrl(url, urls)) {
    const external = /^(data:|https?:\/\/)/.test(url)
    return {
      ok: false,
      error: external
        ? '只接受当前项目媒体里的地址：先把外部图片存进项目，或改用已生成的图'
        : `地址不在当前项目媒体里：${url}`,
    }
  }
  return { ok: true, url }
}

/**
 * 采纳已有媒体为角色外观。
 *
 * 采纳时把地址固化到角色上，不做引用：素材卡被删掉不该让角色外观跟着失效。
 * 表情总图的三件套（格位、指纹、四列两行）在这里全部由系统算，
 * 调用方只决定「用哪张图」。
 */
export function createSetCharacterVisualTool(deps: MaterialToolDeps): ToolDef {
  return defineTool({
    name: 'set_character_visual',
    description:
      '【平台内置】把一个已在项目里的图片采纳为某角色的三视图或表情总图（不花钱、不生成新图）。' +
      '来源用项目内地址 url 或画布素材卡标题 assetTitle 指定，二选一；项目外地址与查不到的标题一律拒绝。' +
      '采纳表情总图时格位与身份指纹由系统按固定四列两行计算，不接受外部传入；单格裁剪失败会保留总图并点名失败格。' +
      '写入立即落库。本工具不新建素材卡、不发布到画布。',
    schema: z.object({
      character: z.string().min(1).describe('角色名或角色 id'),
      target: z.enum(['image', 'expression_sheet']).describe('image=三视图，expression_sheet=表情总图'),
      url: z.string().optional().describe('项目内媒体地址；与 assetTitle 二选一'),
      assetTitle: z.string().optional().describe('画布素材卡标题；与 url 二选一'),
    }),
    run: async ({ character, target, url, assetTitle }) => {
      if (!deps.projectName().trim()) return { ok: false, error: NO_PROJECT }
      let project: ProjectData
      try {
        project = await deps.load()
      } catch (e) {
        return { ok: false, error: (e as Error)?.message || String(e) }
      }
      const c = findCharacter(project, character)
      if (!c) {
        const names = characterRoster(project).map((x) => x.name)
        return {
          ok: false,
          error: names.length
            ? `找不到角色「${String(character).trim()}」；当前项目角色：${names.slice(0, 12).join('、')}`
            : '当前项目还没有角色卡；下一步：先用 submit_characters 建角色',
        }
      }
      const picked = await resolveVisualUrl(deps, { url, assetTitle })
      if (!picked.ok) return picked

      if (target === 'image') {
        const candidates = [picked.url, ...(c.candidates || []).filter((u) => u && u !== picked.url)]
        const next: CharacterSheet = { ...c, image: picked.url, candidates, activeIdx: 0, state: 'idle', error: undefined }
        const written = await commitCharacterWrite(deps, project, next)
        if (!written.ok) return written
        return {
          ok: true,
          summary: `角色「${c.name}」三视图已采纳：${picked.url}`,
          character: c.name,
          image: picked.url,
          source: 'uploaded',
        }
      }

      const sheet: CharacterExpressionSheet = {
        image: picked.url,
        columns: EXPRESSION_SHEET_COLUMNS,
        rows: EXPRESSION_SHEET_ROWS,
        cells: buildExpressionSheetCells(),
        source: 'uploaded',
        fingerprint: identityFingerprint(c),
      }
      const cropper = deps.cropSheet ?? cropExpressionSheet
      let cropped: { sheet: CharacterExpressionSheet; errors: string[] }
      try {
        cropped = await cropper(sheet, deps.projectName())
      } catch (e) {
        return { ok: false, error: `表情总图裁剪失败：${(e as Error)?.message || String(e)}` }
      }
      const next: CharacterSheet = { ...c, expressionSheet: cropped.sheet }
      const written = await commitCharacterWrite(deps, project, next)
      if (!written.ok) return written
      return {
        ok: true,
        summary:
          `角色「${c.name}」表情总图已采纳，八格裁剪完成 ${cropped.sheet.cells.filter((x) => x.cropUrl).length} 格` +
          (cropped.errors.length ? `；失败格：${cropped.errors.join('；')}` : ''),
        character: c.name,
        image: picked.url,
        cropped: cropped.sheet.cells.filter((x) => x.cropUrl).length,
        ...(cropped.errors.length ? { cropErrors: cropped.errors } : {}),
      }
    },
  })
}

/** 成本确认：缺通道或不确认一律不发起生成 */
async function requireCost(
  deps: MaterialToolDeps,
  req: MaterialCostRequest,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!deps.askCost) {
    return { ok: false, error: `${req.title}需要成本确认，当前会话没有确认通道，已拒绝执行` }
  }
  try {
    return await deps.askCost(req)
  } catch (e) {
    return { ok: false, error: `成本确认失败：${(e as Error)?.message || String(e)}` }
  }
}

/**
 * 生成角色三视图。
 *
 * 只写 `image` / `candidates`，不碰 `expressionSheet`：
 * 表情总图的指纹只由外观锚点决定，重出三视图不该把它判失效。
 */
export function createGenerateCharacterViewsTool(deps: MaterialToolDeps): ToolDef {
  return defineTool({
    name: 'generate_character_views',
    description:
      '【平台内置，有成本】按角色的英文外观锚点生成三视图，成功后写入该角色当前图并放到候选首位。' +
      '必须先取得成本确认，未确认不发起请求。已存在的可用表情总图不会被标失效。' +
      '生成结果不会自动变成画布素材卡。',
    schema: z.object({
      character: z.string().min(1).describe('角色名或角色 id'),
      count: z.number().int().min(1).max(2).optional().describe('生成张数，默认 2'),
    }),
    run: async ({ character, count }) => {
      const name = deps.projectName().trim()
      if (!name) return { ok: false, error: NO_PROJECT }
      let project: ProjectData
      try {
        project = await deps.load()
      } catch (e) {
        return { ok: false, error: (e as Error)?.message || String(e) }
      }
      const c = findCharacter(project, character)
      if (!c) return { ok: false, error: `找不到角色「${String(character).trim()}」` }
      if (!String(c.lookEn ?? '').trim()) {
        return {
          ok: false,
          error: `角色「${c.name}」还没有英文外观锚点 lookEn；下一步：先用 submit_characters 补 look_en`,
        }
      }
      const n = count === 1 ? 1 : 2
      const gate = await requireCost(deps, {
        action: 'generate_character_views',
        title: '生成角色三视图',
        detail: `项目「${name}」角色「${c.name}」，${n} 张 16:9`,
        payload: { project: name, character: c.name, n },
      })
      if (!gate.ok) return gate
      let urls: string[] = []
      try {
        const refs = c.referenceImages ?? []
        const input = {
          prompt: `${c.lookEn}, ${TURNAROUND_SUFFIX}`,
          ratio: '16:9',
          n,
          cap: 'view' as const,
          project: name,
          ...(refs.length ? { refImages: refs } : {}),
        }
        const res = deps.io?.generateImage ? await deps.io.generateImage(input) : await generateImage(input)
        urls = (res.urls?.length ? res.urls : [res.url]).filter(Boolean)
      } catch (e) {
        return { ok: false, error: (e as Error)?.message || String(e) }
      }
      const primary = urls[0]
      if (!primary) return { ok: false, error: '生图渠道没有返回图片地址' }
      const candidates = [primary, ...urls.slice(1), ...(c.candidates || []).filter((u) => u && !urls.includes(u))]
      const written = await commitCharacterWrite(deps, project, {
        ...c,
        image: primary,
        candidates,
        activeIdx: 0,
        state: 'idle',
        error: undefined,
      })
      if (!written.ok) return written
      return {
        ok: true,
        summary: `角色「${c.name}」三视图已生成并写入当前图`,
        character: c.name,
        image: primary,
        candidates,
      }
    },
  })
}

/**
 * 生成角色表情总图。
 *
 * 八格与指纹由系统算：调用方传坐标或指纹只会让总图「写入成功但永远不可用」，
 * 而界面上看不出原因。单格裁剪失败不伪造结果，逐格回报。
 */
export function createGenerateExpressionSheetTool(deps: MaterialToolDeps): ToolDef {
  return defineTool({
    name: 'generate_expression_sheet',
    description:
      '【平台内置，有成本】生成角色 4 列 × 2 行八格表情总图并写回角色。' +
      '必须先取得成本确认。八格坐标、总图结构与身份指纹由系统按固定布局与当前外观锚点计算，' +
      '不接受调用方传入的坐标或指纹。八格裁剪逐格执行：单格失败会保留总图并在结果里点名失败格。' +
      '生成结果不会自动变成画布素材卡。',
    schema: z.object({
      character: z.string().min(1).describe('角色名或角色 id'),
    }),
    run: async ({ character }) => {
      const name = deps.projectName().trim()
      if (!name) return { ok: false, error: NO_PROJECT }
      let project: ProjectData
      try {
        project = await deps.load()
      } catch (e) {
        return { ok: false, error: (e as Error)?.message || String(e) }
      }
      const c = findCharacter(project, character)
      if (!c) return { ok: false, error: `找不到角色「${String(character).trim()}」` }
      if (!canGenerateExpressionSheet(c)) {
        return {
          ok: false,
          error: `角色「${c.name}」既没有英文外观锚点，也没有三视图或参考图；下一步：先补 look_en 或采纳一张三视图`,
        }
      }
      const gate = await requireCost(deps, {
        action: 'generate_expression_sheet',
        title: '生成角色表情总图',
        detail: `项目「${name}」角色「${c.name}」，1 张 16:9（内含 4×2 八格）`,
        payload: { project: name, character: c.name },
      })
      if (!gate.ok) return gate
      const refs = c.referenceImages ?? []
      const refOnly = !String(c.lookEn ?? '').trim()
      const refNote = refOnly
        ? '外观以参考图为准；只按格位变化表情，不要换成另一个人。'
        : refs.length
          ? '图 1 是当前三视图，其余是同一角色的其他参考；不要把它们当成不同人物。'
          : ''
      let url = ''
      try {
        const input = {
          prompt: `${expressionSheetPrompt(c.lookEn ?? '')}${refNote ? ` ${refNote}` : ''}`,
          ratio: '16:9',
          n: 1,
          cap: 'view' as const,
          project: name,
          ...(c.image ? { refImage: c.image } : {}),
          ...(refs.length ? { refImages: refs } : {}),
        }
        const res = deps.io?.generateImage ? await deps.io.generateImage(input) : await generateImage(input)
        url = (res.urls?.length ? res.urls[0] : res.url) || ''
      } catch (e) {
        return { ok: false, error: (e as Error)?.message || String(e) }
      }
      if (!url) return { ok: false, error: '生图渠道没有返回图片地址' }
      const sheet: CharacterExpressionSheet = {
        image: url,
        columns: EXPRESSION_SHEET_COLUMNS,
        rows: EXPRESSION_SHEET_ROWS,
        cells: buildExpressionSheetCells(),
        source: 'generated',
        fingerprint: identityFingerprint(c),
      }
      const cropper = deps.cropSheet ?? cropExpressionSheet
      let cropped: { sheet: CharacterExpressionSheet; errors: string[] }
      try {
        cropped = await cropper(sheet, name)
      } catch (e) {
        return { ok: false, error: `表情总图裁剪失败：${(e as Error)?.message || String(e)}` }
      }
      const written = await commitCharacterWrite(deps, project, { ...c, expressionSheet: cropped.sheet })
      if (!written.ok) return written
      const okCells = cropped.sheet.cells.filter((x) => x.cropUrl).length
      return {
        ok: true,
        summary:
          `角色「${c.name}」表情总图已生成，八格裁剪完成 ${okCells} 格` +
          (cropped.errors.length ? `；失败格：${cropped.errors.join('；')}` : ''),
        character: c.name,
        image: url,
        cropped: okCells,
        ...(cropped.errors.length ? { cropErrors: cropped.errors } : {}),
      }
    },
  })
}

export function createMaterialTools(deps: MaterialToolDeps): ToolDef[] {
  return [
    createLinkShotRefsTool(deps),
    createSetShotCameraLexiconTool(deps),
    createSetCharacterVisualTool(deps),
    createGenerateCharacterViewsTool(deps),
    createGenerateExpressionSheetTool(deps),
  ]
}
