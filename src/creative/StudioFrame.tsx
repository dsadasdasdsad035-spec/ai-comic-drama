/**
 * 创意视图容器：把 `/studio/` 作为同源 iframe 嵌入，其余一概不管。
 *
 * 为什么是 iframe 而不是把宿主前端重新实现一遍：创意会话的会话列表、消息流、
 * 工具卡片、审批与设置页都由 dsh 自己维护，复刻即等于把运行时成本又搬回项目里。
 *
 * 这一层负责四件事：
 * 1. **主题桥**：同源 iframe 可直接改它的文档，把应用语义 token 映射成宿主使用的
 *    `--dsw-*` 变量并同步明暗标记，首帧就对齐，不出现闪错主题。
 * 2. **明暗所有权**：宿主的主题呈现器会改写 `body` 上的标记与变量，这里用观察者在
 *    被改回后重新贴，保证应用是明暗的唯一决定者。
 * 3. **尺度与降噪**：注入一份样式把宿主圆角压到应用体系，并隐去宿主品牌与
 *    外观设置行（后者只是个会撒谎的开关）。
 * 4. **不可用错误态**：宿主还没起来/启动失败时给中文说明与「重试」，
 *    不把白屏或堆栈丢给用户。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTheme } from '../theme'
import type { ThemeMode } from '../theme'
import { shouldRetryOnReveal } from './keepalive'

export type StudioFrameProps = {
  /** 失败后重试：宿主进程由服务端重新拉起 */
  onRetry?: () => void
  /**
   * 顶栏当前项目：推给服务端当工具执行的默认上下文。
   *
   * 宿主是一个进程服务所有创意会话，拿不到浏览器里选了什么；不推的话
   * 32 个依赖项目的平台工具在会话里只会报「请先在顶栏选择项目」。
   * 空串表示没有项目（离开/未选），服务端据此清除默认值。
   */
  projectName?: string
  /**
   * 所属常驻容器当前是否可见。
   *
   * 只有一个用途：后台预热的壳子若在隐藏期已经失败，用户揭示时不该先看到
   * 一页错误——先静默重启一次宿主，失败才把错误页交出去。
   * 不传按「始终可见」处理，即保持旧行为（不自动重试）。
   */
  active?: boolean
}

type HostState = 'loading' | 'ready' | 'error'

/**
 * 宿主阶段：由 `/studio/_host/status` 轮询得出。
 * `unknown` 表示探针还没答复（网络慢或反代未通），此时沿用旧文案。
 */
export type HostPhase = 'unknown' | 'idle' | 'starting' | 'ready' | 'failed'

/** 探针轮询间隔：宿主启动期用它把「启动中」推进到「加载界面」 */
export const HOST_POLL_INTERVAL_MS = 400

export const CAPTION_CONNECTING = '正在连接创意会话…'
export const CAPTION_STARTING_HOST = '正在启动创意会话…'
export const CAPTION_LOADING_UI = '正在加载创意界面…'

/**
 * 加载期文案：说清「卡在哪一段」。
 *
 * 两段耗时差别很大却长得完全一样：宿主冷启动是一到十几秒（`starting`），
 * 外壳文档载入与插件树激活是几百毫秒（宿主已 `ready`）。只说「正在连接」，
 * 用户无法判断该继续等还是该点重试。
 */
export function loadingCaption(phase: HostPhase): string {
  if (phase === 'ready') return CAPTION_LOADING_UI
  if (phase === 'idle' || phase === 'starting') return CAPTION_STARTING_HOST
  return CAPTION_CONNECTING
}

/** 应用产品名：创意视图的标签页标题用它，宿主产品名不出现在外壳上 */
export const APP_TITLE = '分镜画布 · Storyboard Canvas'

/**
 * 应用语义 token → 宿主 `--dsw-*` 变量。
 *
 * 取值直接取应用 `src/theme.css` 的字面量，而不是运行时读计算样式：测试要在
 * 没有浏览器的假文档上断言具体色值，读计算样式会把断言绑到真实 DOM。
 *
 * 只映射 alias 层（组件实际消费的层），不动 `--dsw-static-*`：static 只是 alias
 * 的来源，改它等于污染宿主的面板定义。
 */
export const LIGHT_TOKENS: Record<string, string> = {
  // 表面
  '--dsw-alias-bg-base': '#f4f1ea',
  '--dsw-alias-bg-layer-1': '#fffdf8',
  '--dsw-alias-bg-layer-2': '#f8f4ec',
  '--dsw-alias-bg-layer-3': '#ece7dd',
  '--dsw-alias-bg-layer-4': '#fffefb',
  '--dsw-alias-bg-overlay': '#fffdf8',
  // 描边
  '--dsw-alias-border-l1': '#d8d0c3',
  '--dsw-alias-border-l2': '#ded5c7',
  '--dsw-alias-border-l3': '#c3b8a8',
  '--dsw-alias-border-l4': '#c3b8a8',
  // 文字三层：宿主这三层合计一千多处引用，漏掉就等于没接上文字
  '--dsw-alias-label-primary': '#1d2733',
  '--dsw-alias-label-secondary': '#465666',
  '--dsw-alias-label-tertiary': '#586673',
  '--dsw-alias-label-caption': '#586673',
  // 主色与交互态
  '--dsw-alias-brand-primary': '#0e7490',
  '--dsw-alias-interactive-bg-hover': '#ece7dd',
  '--dsw-alias-interactive-bg-active': '#f8f4ec',
  // 状态色
  '--dsw-alias-state-business-primary': '#0e7490',
  '--dsw-alias-state-error-primary': '#b91c1c',
  '--dsw-alias-state-warn-primary': '#b45309',
  '--dsw-alias-state-success-primary': '#15803d',
  // 区域专用
  '--dsw-specific-sidebar-fill': '#ece7dd',
  '--dsw-specific-sidebar-nav-item-active': '#fffdf8',
  '--dsw-specific-bubble': '#fffdf8',
  '--dsw-specific-tip': '#f8f4ec',
  // 滚动条
  '--dsw-alias-scrollbar-bg-l2': '#d8d0c3',
  '--dsw-alias-scrollbar-hover-l2': '#c3b8a8',
}

export const DARK_TOKENS: Record<string, string> = {
  // 表面
  '--dsw-alias-bg-base': '#070b11',
  '--dsw-alias-bg-layer-1': '#0e1620',
  '--dsw-alias-bg-layer-2': '#111c28',
  '--dsw-alias-bg-layer-3': '#0c131c',
  '--dsw-alias-bg-layer-4': '#101b27',
  '--dsw-alias-bg-overlay': '#0e1620',
  // 描边
  '--dsw-alias-border-l1': '#1d2b3a',
  '--dsw-alias-border-l2': '#22334a',
  '--dsw-alias-border-l3': '#2a3d52',
  '--dsw-alias-border-l4': '#2a3d52',
  // 文字三层
  '--dsw-alias-label-primary': '#dbe7f3',
  '--dsw-alias-label-secondary': '#b6c8da',
  '--dsw-alias-label-tertiary': '#7d93ab',
  '--dsw-alias-label-caption': '#7d93ab',
  // 主色与交互态
  '--dsw-alias-brand-primary': '#38bdf8',
  '--dsw-alias-interactive-bg-hover': '#111c28',
  '--dsw-alias-interactive-bg-active': '#0e1620',
  // 状态色
  '--dsw-alias-state-business-primary': '#38bdf8',
  '--dsw-alias-state-error-primary': '#f87171',
  '--dsw-alias-state-warn-primary': '#fbbf24',
  '--dsw-alias-state-success-primary': '#4ade80',
  // 区域专用
  '--dsw-specific-sidebar-fill': '#0b1220',
  '--dsw-specific-sidebar-nav-item-active': '#111c28',
  '--dsw-specific-bubble': '#0e1620',
  '--dsw-specific-tip': '#111c28',
  // 滚动条
  '--dsw-alias-scrollbar-bg-l2': '#1d2b3a',
  '--dsw-alias-scrollbar-hover-l2': '#2a3d52',
}

/** 宿主圆角轴 → 应用的 5/7/10 体系；与主题无关，两套主题同一取值 */
export const STUDIO_RADIUS: Record<string, string> = {
  '--dsw-radius-xs': '4px',
  '--dsw-radius-sm': '5px',
  '--dsw-radius-md': '7px',
  '--dsw-radius-lg': '10px',
  // xl 与 panel 同值是有意的：压到应用尺度后，宿主靠这两档区分的「大卡片/容器」
  // 本来就该同值，层级改由描边与阴影承担
  '--dsw-radius-xl': '10px',
  '--dsw-radius-panel': '10px',
}

/** 注入样式表的元素 id：重复安装时复用它，不在宿主文档里堆多份 */
export const STUDIO_STYLE_ID = 'studio-theme-bridge'

/**
 * 宿主启动页的根节点标记（`BootPage` 构造时写入）。
 *
 * 用属性而不是类名：宿主的 CSS Modules 类名带哈希，版本一变就失效；
 * 这个属性是它自己的稳定契约。
 */
export const HOST_BOOT_ATTR = 'data-dsh-boot'
/** 藏启动页的样式元素 id */
export const BOOT_HIDE_STYLE_ID = 'studio-boot-hide'
/** 首帧前轮询宿主文档的间隔 */
export const BOOT_POLL_INTERVAL_MS = 100

/**
 * 什么时候该藏掉宿主的启动页。
 *
 * 只在加载期：那时宿主画的是自己的 `HARNESS / Loading plugins…`，
 * 和应用的视觉语言完全对不上；错误态必须放行，因为用户需要看到
 * 真实失败原因，藏起来等于把唯一线索抹掉。
 */
export function shouldSuppressHostBoot(state: 'loading' | 'ready' | 'error'): boolean {
  return state === 'loading'
}

/** 藏启动页的样式文本：只收掉启动页，不动其它任何节点 */
export function bootHideStyleText(): string {
  return `[${HOST_BOOT_ATTR}]{display:none !important}`
}

/**
 * 往宿主文档里装一条「隐藏启动页」样式，返回是否成功。
 *
 * 跨源时 `contentDocument` 为 `null`，只读文档上写 `head` 会抛错——
 * 都按失败处理并静默退化：宁可让用户看一眼宿主启动页，也不能让加载流程中断。
 */
export function installBootHideStyle(doc: Document | null | undefined): boolean {
  if (!doc) return false
  try {
    const existing = doc.getElementById?.(BOOT_HIDE_STYLE_ID) ?? null
    if (existing) return true
    const target = doc.head || doc.documentElement
    if (!target) return false
    const style = doc.createElement('style')
    style.id = BOOT_HIDE_STYLE_ID
    style.textContent = bootHideStyleText()
    target.appendChild(style)
    return true
  } catch {
    return false
  }
}

/**
 * 失败摘要：取宿主日志/错误的尾部若干行。
 *
 * 全量日志动辄几十行，全塞进错误页会把它变成终端；截尾已足够定位
 * 「缺包 / 端口被占 / patch 解析失败」这类启动期问题。
 */
export function hostFailureDetail(body: unknown, maxLines = 12): string {
  const record = body as { log?: unknown; error?: unknown } | null
  const raw = String(record?.log || record?.error || '').trim()
  if (!raw) return ''
  const lines = raw.split('\n').filter((line) => line.trim() !== '')
  return lines.slice(-maxLines).join('\n')
}

/** 撤掉隐藏样式：错误态要把宿主的真实报告放出来 */
export function removeHostBootStyle(doc: Document | null | undefined): boolean {
  if (!doc) return false
  try {
    const existing = doc.getElementById?.(BOOT_HIDE_STYLE_ID) ?? null
    if (!existing) return false
    existing.remove()
    return true
  } catch {
    return false
  }
}

/** 外观设置行的标题文案（宿主 locale 里的实际取值，中/英/日三份） */
export const APPEARANCE_LABELS = ['外观', 'Appearance', '外観']

/** 设置面板容器：隐藏只在面板内生效，避免误伤会话列表 */
const SETTINGS_SCOPE = '[role="dialog"], [class*="panel"], [class*="Panel"]'

/** 隐藏标记：由隐藏函数打在命中行上，样式表按标记收掉 */
const HIDDEN_ATTR = 'data-studio-hidden'

/**
 * 注入样式表的纯文本：圆角尺度 + 品牌降噪 + 隐藏标记规则。
 *
 * 圆角写在 `body` 而不是 `:root`：宿主把 `--dsw-radius-*` 声明在 `:root` 上，
 * 声明在 `body` 上就一定能盖住继承值，不用赌两份样式表的插入顺序。
 *
 * 品牌降噪覆盖六类目标，且只做减法（不引入背景图、不写替代文案）：
 * 版本徽标、本地构建身份、产品名、首页标题旁的「预览版」标签、
 * 侧栏品牌标记与折叠轨道的品牌图标、空白首页的行内鲸鱼与像素鲸水印。
 *
 * 两处交互补偿是必要的：品牌标记同时是「新会话」入口，只藏图形会留一个
 * 不可见但可点的热区，所以要停掉它的指针事件；折叠轨道的标记是展开按钮
 * 的静止形态，藏掉后必须让面板图标常驻，否则触屏端只剩一个无图形的按钮。
 */
export function studioStyleText(): string {
  const radius = Object.entries(STUDIO_RADIUS)
    .map(([name, value]) => `${name}: ${value};`)
    .join(' ')
  return [
    '/* 创意视图尺度：把宿主圆角轴压到应用的 5/7/10 体系，两套主题共用 */',
    `body { ${radius} }`,
    // 子串一律不带尾部下划线：构建产物是 <hash>_logoRow，开发态才是 _logoRow_<hash>_<n>
    '/* 侧栏顶部带：品牌标记已被降噪收掉，这一行只承载 28px 的折叠按钮，60px 会留一段空带 */',
    '[class*="_sidebarCol"] [class*="_logoRow"] { height: 44px !important; }',
    '/* 折叠轨道维持 36px：这里的顶部带是展开控件的落点，压小会让控件下沉 */',
    '[class*="_sidebarCol"] [class*="_collapsed"] [class*="_logoRow"] { height: 36px !important; }',
    // 留白走宿主自己的变量：它在 3px paint inset 之上再减一次，最终文字左缘与应用导航对齐
    '/* 导航行按应用左栏的密度收：留白走宿主变量，min-height 与行高一起把行压到约 30px */',
    '[class*="_sidebarCol"] [class*="_panelRow"] { --dsh-sidebar-row-padding: 9px; min-height: 30px !important; line-height: 18px !important; }',
    // 宿主把字号内联写在 body 上：普通声明压不过内联，只有 !important 能盖住
    '/* 字号：宿主把正文字号内联在 body 上，只有 !important 能压过；外观设置行已隐藏，应用是尺度的唯一决定者 */',
    'body { --dsh-content-font-size: 13px !important; }',
    '/* 侧栏根节点写死 14px，不跟 body 继承，必须单独点名 */',
    '[class*="_sidebarCol"] [class*="_root"] { font-size: 13px !important; }',
    '/* 会话列表标题、搜索标题与重命名输入同样写死 14px/20px，不跟根节点走 */',
    '[class*="_sidebarCol"] [class*="_title"], [class*="_sidebarCol"] [class*="_searchResultTitle"], [class*="_sidebarCol"] [class*="_renameInput"] { font-size: 13px !important; line-height: 18px !important; }',
    '/* 品牌降噪：宿主的版本徽标、产品名与首页吉祥物不作为本产品的身份出现 */',
    '[class*="_buildVersion"], [class*="_localBuildBrand"], [class*="_brandName"] { display: none !important; }',
    '[class*="_fish"] { display: none !important; }',
    '/* 首页标题旁的「预览版」标签同样收掉：产品的阶段标记由发布渠道说明，不挂在创意视图上 */',
    '[class*="_previewBadge"] { display: none !important; }',
    '/* 侧栏品牌标记与折叠轨道的品牌图标：产品身份同样不出现 */',
    '[class*="_brandMark"], [class*="_railMark"], [data-home-whale] { display: none !important; }',
    '/* 品牌标记失去图形后不再保留不可见的新会话点击区；功能由下方的新会话按钮承担 */',
    '[class*="_brand"][class*="_wide"] { pointer-events: none !important; }',
    '/* 折叠轨道的静止标记被收掉后，展开按钮的面板图标改为常驻，避免出现无图形的按钮 */',
    '[class*="_toggle"] [class*="_panelIcon"] { display: inline !important; }',
    '/* 外观设置行由 hideHostAppearanceRow 命中后打标记，这里只负责收掉 */',
    `[${HIDDEN_ATTR}] { display: none !important; }`,
  ].join('\n')
}

/** 写变量的最小接口：真实 `CSSStyleDeclaration` 与测试假文档都满足 */
export type TokenTarget = {
  getPropertyValue(name: string): string
  setProperty(name: string, value: string): void
}

/**
 * 把一组 token 幂等写进目标样式表，返回真正写入的条数。
 *
 * 幂等是观察者不自激的前提：值已相同就不写，否则「观察→重写→再观察」
 * 会形成稳定的空转。空值与非字符串直接跳过，让不完整的映射表退化成少写几条，
 * 而不是抛错中断整套配色。
 */
export function applyStudioTokens(style: TokenTarget, tokens: Record<string, string>): number {
  let written = 0
  for (const [name, value] of Object.entries(tokens)) {
    if (typeof value !== 'string' || value === '') continue
    if (style.getPropertyValue(name) === value) continue
    style.setProperty(name, value)
    written += 1
  }
  return written
}

/**
 * 把主题写到宿主文档上。
 *
 * 落点必须是 `body`：宿主把两套调色板直接声明在 `body` 与
 * `body[data-ds-dark-theme]` 上，而自定义属性「自身声明永远胜过继承」——
 * 写在 `documentElement` 上的变量对宿主组件完全无效（这正是旧实现的空转原因）。
 */
export function applyStudioTheme(doc: Document, mode: 'day' | 'night') {
  const body = doc.body
  if (!body) return
  applyStudioTokens(body.style, mode === 'day' ? LIGHT_TOKENS : DARK_TOKENS)

  const scheme = mode === 'day' ? 'light' : 'dark'
  if (body.style.colorScheme !== scheme) body.style.colorScheme = scheme
  // 原生控件（滚动条、表单）跟 HTML 根节点走，所以根节点只设 color-scheme，
  // 不设任何 `--dsw-*` 变量
  const root = doc.documentElement
  if (root?.style && root.style.colorScheme !== scheme) root.style.colorScheme = scheme

  const dark = mode === 'night'
  const has = body.hasAttribute('data-ds-dark-theme')
  if (dark && !has) body.setAttribute('data-ds-dark-theme', '')
  else if (!dark && has) body.removeAttribute('data-ds-dark-theme')
}

/** 把注入样式装进宿主文档；已存在就复用，不重复插入 */
export function installStudioStyle(doc: Document, styleText: string = studioStyleText()): void {
  const root = doc.documentElement
  if (!root) return
  const existing = doc.getElementById?.(STUDIO_STYLE_ID) ?? null
  if (existing) {
    if (existing.textContent !== styleText) existing.textContent = styleText
    return
  }
  const style = doc.createElement('style')
  style.id = STUDIO_STYLE_ID
  style.textContent = styleText
  // 挂到 head 之后的最末：宿主自己的样式表先加载，后插入的规则赢得同权重竞争
  ;(doc.head || root).appendChild(style)
}

/**
 * 隐去宿主的「外观」设置行。
 *
 * 落选方案是直接禁用宿主的主题插件行，但 `ui-layout`、`ui-sidebar-terminal`、
 * `ui-settings-account` 都注入 `ctx.theme`，禁用会让这三个客户端插件激活失败。
 *
 * 命中方式是「设置面板内、含三枚 `aria-pressed` 按钮、且标题文案属于外观行」。
 * 文案或结构漂移时这里必须静默退化：只留下一个点了不改变配色的无效开关，
 * 绝不能抛错或改动设置页其余行。
 */
export function hideHostAppearanceRow(doc: Document): boolean {
  let hidden = false
  try {
    const scopes = doc.querySelectorAll(SETTINGS_SCOPE)
    for (const scope of Array.from(scopes)) {
      const cubes = Array.from(scope.querySelectorAll('button[aria-pressed]'))
      if (cubes.length < 3) continue
      // 三枚按钮的共同祖父母即外观行容器（标题 + 按钮行）
      const container = cubes[0]?.parentElement?.parentElement ?? null
      if (!container) continue
      const text = container.textContent || ''
      if (!APPEARANCE_LABELS.some((label) => text.includes(label))) continue
      if (container.getAttribute?.(HIDDEN_ATTR) === null || container.getAttribute?.(HIDDEN_ATTR) === undefined) {
        container.setAttribute(HIDDEN_ATTR, '')
      }
      hidden = true
    }
  } catch {
    // 宿主文案/结构漂移：退化成多一个无效开关，配色与设置页其余行都不受影响
  }
  return hidden
}

/** 标签页标题改成应用名；宿主改回后由观察者再调用一次 */
export function applyStudioTitle(doc: Document): void {
  try {
    if (doc.title !== APP_TITLE) doc.title = APP_TITLE
  } catch {
    // 跨源或只读文档：标题交给上层，不阻断主题同步
  }
}

export default function StudioFrame({ onRetry, projectName, active = true }: StudioFrameProps) {
  const { theme: mode } = useTheme()
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const observerRef = useRef<MutationObserver | null>(null)
  /**
   * 当前主题的引用副本。
   *
   * 观察者挂在 iframe 的文档上，回调闭包活在挂载那一刻；如果它直接读 `mode`
   * 就会永远拿着旧值，把我们自己刚写入的新主题再翻回去。引用让回调总能读到最新值。
   */
  const modeRef = useRef<ThemeMode>(mode)
  const [state, setState] = useState<HostState>('loading')
  const [message, setMessage] = useState('')
  /** 失败摘要：宿主自己的日志尾部，错误页里折叠展示，不额外暴露内部细节 */
  const [detail, setDetail] = useState('')
  const [nonce, setNonce] = useState(0)
  /** 宿主阶段：只用来选加载文案，不参与渲染分支（分支仍看 `state`） */
  const [hostPhase, setHostPhase] = useState<HostPhase>('unknown')

  /** 首帧与后续主题变化都走这里：iframe 同源，直接改它的文档 */
  const syncTheme = useCallback(() => {
    const doc = frameRef.current?.contentDocument
    if (!doc) return
    try {
      applyStudioTheme(doc, modeRef.current)
    } catch {
      // 跨源时无从下手：那就交给宿主自己的主题，至少内容可读
    }
  }, [])

  /**
   * 一次把桥装齐：配色、尺度与降噪样式、标题，再接上回写守卫。
   * 观察者只盯属性（`data-ds-dark-theme` 与内联样式），不盯文本；写入是幂等的，
   * 所以「观察→重写→再观察」会收敛，不会自激。
   */
  const attachBridge = useCallback(() => {
    const doc = frameRef.current?.contentDocument
    if (!doc) return
    syncTheme()
    try {
      installStudioStyle(doc)
      hideHostAppearanceRow(doc)
      applyStudioTitle(doc)
    } catch {
      // 降噪与尺度是锦上添花：失败不影响配色
    }

    observerRef.current?.disconnect()
    observerRef.current = null
    if (typeof MutationObserver === 'undefined' || !doc.body) return
    const observer = new MutationObserver(() => {
      syncTheme()
      try {
        hideHostAppearanceRow(doc)
        applyStudioTitle(doc)
      } catch {
        // 同上
      }
    })
    observer.observe(doc.body, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'style'] })
    observer.observe(doc.documentElement, { attributes: true, attributeFilter: ['style', 'class'] })
    // 宿主启动时会自己写一次 `document.title`：观察 title 的文本变化，改回后重新贴。
    // 属性观察盯不到 title，只能盯 head 子树。
    if (doc.head) observer.observe(doc.head, { subtree: true, childList: true, characterData: true })
    observerRef.current = observer
  }, [syncTheme])

  useEffect(() => {
    // 先更新引用再同步：观察者回调读的正是这个引用
    modeRef.current = mode
    syncTheme()
  }, [mode, syncTheme])

  /**
   * 把顶栏项目推给服务端，作为宿主工具执行的默认上下文。
   *
   * 只在值真正变化时推：`lastPushedRef` 挡住重复请求（含挂载与切项目各一次）。
   * 推送失败只降级为「工具按未选项目报错」，不能影响主题桥与渲染。
   */
  const lastPushedRef = useRef<string | null>(null)
  useEffect(() => {
    const name = (projectName || '').trim()
    if (lastPushedRef.current === name) return
    lastPushedRef.current = name
    void fetch('/api/studio/project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ name }),
    })
      .then((res) => {
        // 非法项目名（已被删除）留待下一次变化重推，不在这里反复重试
        if (!res.ok && lastPushedRef.current === name) lastPushedRef.current = null
      })
      .catch(() => {
        if (lastPushedRef.current === name) lastPushedRef.current = null
      })
  }, [projectName])

  /**
   * 卸载（回大厅、关掉入口）时清除项目上下文。
   *
   * 不这么做的话，服务端单槽位会一直留着上一个项目：新会话在「没有项目」的
   * 界面上调工具，读到的却是旧项目。`keepalive` 让请求在卸载后仍能发出去。
   */
  useEffect(
    () => () => {
      void fetch('/api/studio/project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        keepalive: true,
        body: JSON.stringify({ name: '' }),
      }).catch(() => {
        // 卸载期的网络失败无处可报：下一次推送会覆盖
      })
    },
    [],
  )

  /** 组件卸载时断开观察者，避免持有已销毁的 iframe 文档 */
  useEffect(() => () => observerRef.current?.disconnect(), [])

  /**
   * 提前藏掉宿主的启动页。
   *
   * 不能等 `onLoad`：那时 boot 已经结束，宿主自己的 `HARNESS / Loading plugins…`
   * 早就完整地闪现过一遍，正是「不像本应用」的来源。
   * 所以从挂载起就轮询同源 iframe 的文档，`head` 一可写就插入隐藏样式。
   */
  useEffect(() => {
    if (!shouldSuppressHostBoot(state)) return
    let alive = true
    let timer = 0
    const tick = () => {
      if (!alive) return
      const frame = frameRef.current
      if (frame) {
        try {
          const doc = frame.contentDocument
          if (doc) {
            installBootHideStyle(doc)
            // 文档已就绪就不必再轮询：后续由 onLoad 收尾
            if (doc.readyState === 'complete') return
          }
        } catch {
          // 跨源或文档不可访问：维持宿主自己的启动页，不阻断加载
          return
        }
      }
      timer = window.setTimeout(tick, BOOT_POLL_INTERVAL_MS)
    }
    tick()
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [state, nonce])

  /** 失败时把宿主的报告放出来：错误页之外不该再藏任何线索 */
  useEffect(() => {
    if (state !== 'error') return
    removeHostBootStyle(frameRef.current?.contentDocument)
  }, [state])

  /** 宿主状态：错误态要给原因，而不是无限转圈；加载期顺带把阶段文案推进 */
  useEffect(() => {
    let alive = true
    let timer = 0
    const probe = async () => {
      try {
        const res = await fetch('/studio/_host/status', { credentials: 'include' })
        const body = await res.json().catch(() => ({}))
        if (!alive) return
        if (!res.ok) {
          setState('error')
          setMessage(body?.message || '创意会话宿主未通过认证或不可用')
          setDetail(hostFailureDetail(body))
          return
        }
        if (body.state === 'failed') {
          setState('error')
          setMessage(body.error || '创意会话宿主启动失败')
          setDetail(hostFailureDetail(body))
          return
        }
        if (body.state === 'ready') {
          // 到这里宿主已热：剩下的等待是外壳文档与插件树，文案切到「加载界面」
          setHostPhase('ready')
          return
        }
        setHostPhase(body.state === 'starting' ? 'starting' : 'idle')
        // 还在启动：继续轮询。ready 时由 iframe 的 onLoad 收尾，避免状态先绿后白
        timer = window.setTimeout(() => void probe(), HOST_POLL_INTERVAL_MS)
      } catch (e) {
        if (!alive) return
        setState('error')
        setMessage(`连不上创意会话宿主：${(e as Error)?.message || String(e)}`)
      }
    }
    void probe()
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [nonce])

  const retry = useCallback(async () => {
    setState('loading')
    setHostPhase('unknown')
    setMessage('')
    setDetail('')
    try {
      const res = await fetch('/studio/_host/restart', { method: 'POST', credentials: 'include' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || body.ok === false) {
        setState('error')
        setMessage(body?.message || '重试失败：宿主未能启动')
        return
      }
      onRetry?.()
      setNonce((n) => n + 1)
    } catch (e) {
      setState('error')
      setMessage(`重试失败：${(e as Error)?.message || String(e)}`)
    }
  }, [onRetry])

  /**
   * 揭示时的静默重试：藏在后台的壳子可能早就失败了，但用户没看到任何提示。
   *
   * 只在 `active` 由假变真、且当前正是错误态时补一次重启——正好一次：
   * `autoRetriedRef` 保证同一个挂载周期内不再自动重试，第二次揭示仍旧失败时
   * 就把现有的错误页与「重试」按钮交出去（宿主确实坏了，重试多少次都一样）。
   */
  const prevActiveRef = useRef(active)
  const autoRetriedRef = useRef(false)
  useEffect(() => {
    const wasActive = prevActiveRef.current
    prevActiveRef.current = active
    // 条件抽在 keepalive.ts 里：写错的表现是「错误页一闪而过」或「无限重启」
    if (!shouldRetryOnReveal({ wasActive, active, state, retried: autoRetriedRef.current })) return
    autoRetriedRef.current = true
    void retry()
  }, [active, state, retry])

  return (
    <div className="studio-frame" data-state={state}>
      {state === 'error' ? (
        <div className="studio-frame-error" role="alert">
          <h2>创意会话暂时不可用</h2>
          <p>{message}</p>
          {detail ? (
            <details className="studio-frame-error-detail">
              <summary>查看宿主日志</summary>
              <pre>{detail}</pre>
            </details>
          ) : null}
          <button type="button" className="btn" onClick={() => void retry()}>
            重试
          </button>
        </div>
      ) : null}
      {state === 'loading' ? (
        <div className="studio-frame-loading" aria-busy="true">
          {/* 骨架按会话外壳的真实版式铺：侧栏条 + 消息气泡 + 输入区 */}
          <div className="studio-skeleton studio-skeleton-pulse" aria-hidden="true">
            <div className="studio-skeleton-rail">
              <span />
              <span />
              <span />
            </div>
            <div className="studio-skeleton-main">
              <div className="studio-skeleton-bubble" />
              <div className="studio-skeleton-bubble is-narrow" />
              <div className="studio-skeleton-composer" />
            </div>
          </div>
          <p className="studio-skeleton-caption">{loadingCaption(hostPhase)}</p>
        </div>
      ) : null}
      <iframe
        // key 变化才会真正重挂：重试时要求宿主重新拉起并给新地址
        key={nonce}
        ref={frameRef}
        title="创意会话"
        src="/studio/"
        className="studio-frame-iframe"
        onLoad={() => {
          // 桥必须在揭开遮罩之前跑完，否则会先按宿主默认主题绘出一帧
          attachBridge()
          setState((prev) => (prev === 'error' ? prev : 'ready'))
        }}
        onError={() => {
          setState('error')
          setMessage('创意会话页面加载失败')
        }}
      />
    </div>
  )
}
