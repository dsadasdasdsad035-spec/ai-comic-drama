/**
 * 创意视图的挂载决策。
 *
 * 为什么单独成模块：这三条规则错一条就退化成「每次切回都重建宿主前端」，
 * 而症状只在体感层面可见（转圈几秒），很难靠人眼发现回归。
 * 抽成纯函数后可以像契约一样断言：
 *
 * 1. 首次进入前不挂载——应用启动就挂等于让宿主产物和首屏抢带宽；
 * 2. 进入过之后常驻——切走只隐藏，`display: none` 不会销毁 iframe 的
 *    浏览上下文，会话列表、滚动位置、草稿与 WebSocket 都还在；
 * 3. 服务端关掉常驻时退回条件渲染——低配机器与排障用。
 */

/** `none`：什么都不渲染；`inline`：条件渲染（老行为）；`keepalive`：常驻容器 */
export type StudioMountMode = 'none' | 'inline' | 'keepalive'

export interface StudioMountInput {
  /** 创意入口是否启用（设置里的开关） */
  enabled: boolean
  /** 服务端是否允许常驻（`SB_STUDIO_NO_KEEPALIVE` 可关） */
  keepAlive: boolean
  /** 是否曾经进入过创意视图：只增不减，由调用方一次性置位 */
  mounted: boolean
  /** 当前是否停在创意视图 */
  active: boolean
}

export interface StudioMountPlan {
  mode: StudioMountMode
  /** 常驻容器当前是否可见；`inline` 与 `none` 恒为 false */
  visible: boolean
}

export function resolveStudioMount({ enabled, keepAlive, mounted, active }: StudioMountInput): StudioMountPlan {
  // 入口关掉就不该存在任何宿主前端：否则关开关只是藏了入口，宿主文档还在后台活着
  if (!enabled) return { mode: 'none', visible: false }
  if (!keepAlive) return { mode: active ? 'inline' : 'none', visible: false }
  // 没进入过就不挂载（首屏优先）；进入过一次以后永远常驻
  if (!mounted) return { mode: 'none', visible: false }
  return { mode: 'keepalive', visible: active }
}

/**
 * 创意外壳是否该在后台预热。
 *
 * `off`：不预热；`wait`：条件已满足，但宿主未就绪或主线程不空闲；`mount`：现在挂。
 *
 * 和 `resolveStudioMount` 放在一起，是因为两者共享同一组输入（入口开关、常驻开关、
 * 是否已挂载、是否正在创意）。拆成两个文件的结果一定是「开关改了、另一个文件忘了跟」。
 *
 * 触发信号取「确定会用到」而不是「页面加载完成」：
 * - 进过一次创意（`visited`）——第二次一定还会用；
 * - 指针悬停或焦点落到入口上（`intent`）——约一次点击之后就会进。
 *
 * 首访且无意图时不预热：外壳是 2.6MB gzip，和主包共享同一条链路，
 * 无条件预热等于用首访用户的带宽换回访用户的速度。
 */
export type StudioWarmupVerdict = 'off' | 'wait' | 'mount'

export interface StudioWarmupInput {
  /** 创意入口是否启用 */
  enabled: boolean
  /** 是否允许常驻：没有常驻容器，预热无处可挂 */
  keepAlive: boolean
  /** 服务端是否允许预热（`SB_STUDIO_NO_PRELOAD` 可关） */
  preload: boolean
  /** 外壳是否已经挂载（含正式进入过） */
  mounted: boolean
  /** 当前是否停在创意视图 */
  active: boolean
  /** 此前进入过创意视图（`sb.studioVisited`） */
  visited: boolean
  /** 指针悬停或聚焦过创意入口 */
  intent: boolean
  /** 浏览器处于省流量模式 */
  saveData: boolean
  /** `navigator.connection.effectiveType`；拿不到时传空串 */
  effectiveType: string
  /** `navigator.deviceMemory`（GB）；拿不到或不支持时传 0 */
  deviceMemory: number
  /** 宿主进程是否已就绪 */
  hostReady: boolean
  /** 主线程是否已经空闲 */
  idle: boolean
}

export function resolveStudioWarmup({
  enabled,
  keepAlive,
  preload,
  mounted,
  active,
  visited,
  intent,
  saveData,
  effectiveType,
  deviceMemory,
  hostReady,
  idle,
}: StudioWarmupInput): StudioWarmupVerdict {
  // 入口或常驻关掉：预热等于给一份不会显示的文档付 2.6MB
  if (!enabled || !keepAlive) return 'off'
  // 服务端关掉预热：排障与弱机型用
  if (!preload) return 'off'
  // 已经在创意里、或已经挂载过：没有可预热的对象
  if (active || mounted) return 'off'
  // 省流量与弱网：宁可点击时慢，也不要偷偷花掉用户的流量
  if (saveData) return 'off'
  // 只拦 2G 与 3G；4G/未知（Safari 没有 connection API）都放行
  if (/^(slow-)?2g$/.test(effectiveType) || effectiveType === '3g') return 'off'
  // 低内存机型：常驻 60MB 换 300ms 不划算；0 表示浏览器不报（按允许处理）
  if (deviceMemory > 0 && deviceMemory <= 2) return 'off'
  // 首访且无意图：不预热，首屏预算优先
  if (!visited && !intent) return 'off'
  // 条件都满足，但要等宿主就绪且主线程空闲，不能在首屏阶段抢资源
  if (!hostReady || !idle) return 'wait'
  return 'mount'
}
/**
 * 揭示时是否该静默重启一次宿主。
 *
 * 预热的壳子是在后台加载的，失败也没有人看得见；用户点进来才第一次看到它。
 * 这时先补一次重启，比直接把一页错误交出去更接近「点开即用」的预期。
 *
 * 只补一次：同一挂载周期内 `retried` 置位后不再自动重试——宿主确实坏了时，
 * 重试多少次都一样，第二次揭示应该老实显示错误页与「重试」按钮。
 *
 * 抽成纯函数是为了能断言「只在这一下、只补一次」，这条件写错的表现是
 * 「错误页一闪而过」或「无限重启」，两者都不容易靠肉眼发现。
 */
export interface RevealRetryInput {
  /** 上一帧是否可见 */
  wasActive: boolean
  /** 这一帧是否可见 */
  active: boolean
  /** 外壳当前的宿主状态 */
  state: 'loading' | 'ready' | 'error'
  /** 本挂载周期内是否已经自动重试过 */
  retried: boolean
}

export function shouldRetryOnReveal({ wasActive, active, state, retried }: RevealRetryInput): boolean {
  // 只有「由隐藏变可见」这一下才补；一直可见时错误页本来就该马上给
  if (wasActive || !active) return false
  // 只在确认失败时补；加载中与已就绪都不该重启
  if (state !== 'error') return false
  // 只补一次
  if (retried) return false
  return true
}
