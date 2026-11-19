# Design

## Context

动机与数字见 `proposal.md`。这里只列决定方案的现状与约束。

**宿主进程已预热，外壳文档没有。** `server/index.mjs` 在监听成功后 2 秒拉起宿主，实测 `t≈6s` 进入 `ready`。但外壳文档的创建点在渲染树里：`src/App.tsx:4602` 的常驻容器只在 `studioMounted` 为真时渲染 `<StudioFrame />`，而 `studioMounted` 只在 `view === 'creative'` 时被置位（`src/App.tsx:522`、`539-543`）。

**挂载决策已经是纯函数。** `src/creative/keepalive.ts` 的 `resolveStudioMount({ enabled, keepAlive, mounted, active })` 返回 `mode: 'none' | 'inline' | 'keepalive'` 与 `visible`，由 `tests/studio-view-keepalive.mjs` 表驱动断言。本 change 只改"谁把 `mounted` 置为真"，不改这四条规则。

**隐藏用的是 `display: none`。** `src/theme.css:18236` 的 `.view-keepalive { display: none; flex: 1 1 auto; }`，激活态 `[data-active='true'] { display: flex; }`。容器是 `src/shell/AppShell.tsx:90` 的 `.app-main`（`display: flex; flex-direction: column`，无定位）的直接子节点。

**实测：`display: none` 的隐藏不等于"渲染好了"。** 用同一份已 `ready`、资源已缓存的外壳做受控对照（独立挂载、视口 1360×860，避免与其它视图共享高度）：

| 隐藏方式 | 隐藏期 iframe 视口 | 隐藏期 `_panelRow` 计数 | 揭示到两帧 |
|---|---|---|---|
| `display: none`（从未展示过） | 0 × 0 | 0 | 45ms |
| `position: absolute; left: -20000px; visibility: hidden` | 1360 × 860 | 3 | 2ms |

读者容易把"iframe 已加载"当成"内容已渲染"。零视口下宿主的列表容器算不出高度，虚拟化列表也就没有可渲染的行；揭示时才发现要补一次布局与列表构建，这 45ms 正好出现在用户最在意的时刻。

**要区分两种隐藏。** 已经展示过、再被隐藏的常驻容器，会话行仍在 DOM 里（在真实应用里实测隐藏后 `_panelRow` 仍为 3，揭示到两帧约 16ms），所以常驻往返本来就不慢。**预热走的是"从未展示过"这条路径**——外壳从创建起就在零视口里，一行都渲染不出来。这也是为什么本 change 必须同时改隐藏方式：只改挂载时机，省掉的是网络与插件激活，省不掉揭示时的列表构建。

**外壳文档加载时长（宿主已 ready、资源已缓存）：202–329ms**。这段是 DCL 加两段长任务，与网络无关，所以预热的收益是"把这 300ms 挪到后台"，不是"让加载变快"。

**`/studio/_host/status` 已存在**（`server/index.mjs:595`），返回 `{ ok, state, port, error, ... }`，`Cache-Control: no-store`，需要既有鉴权。它只读、不触发启动——正好可以做"等宿主就绪"的探针。

**首屏预算的既有约束。** 主应用 bundle 1.8MB（index 1.5MB + css 293KB），FCP 68ms（本地）/ 144ms（4Mbps 限速）。仓库里 20+ 个 `verify-*.mjs` 用 `waitUntil: 'networkidle'` 等待页面；如果预热对所有访客无条件发生，这些用例会多等、甚至断言到意外的 `/studio/` 请求。

**不可动摇的约束**：宿主只监听 `127.0.0.1`；`/studio/` 必须与应用同源；外壳故障不能拖住其它视图；外壳的加载骨架与错误页由应用自己承担。

## Goals / Non-Goals

**Goals:**

- 回访与有意图的路径上，点击「创意」到首行可见 ≤ 50ms。
- 首访（无历史、无意图）的首屏字节、FCP 与 `/studio/` 请求数与现在完全一致。
- 隐藏期宿主以最终视口渲染完成，揭示不触发重排与补渲染。
- 预热可整体关闭，关闭后退化为点击时加载，不留下后台请求。
- 预热失败不产生用户可见的错误、不阻断进入。

**Non-Goals:**

- 不优化外壳自身的产物体积、插件数量与激活审计耗时。
- 不改宿主进程的预热时机与启动路径（`server/studio-prewarm.mjs` 不动）。
- 不改鉴权、反代、WebSocket 透传、`DSH_HOME` 布局。
- 不做首访无条件预加载（与首屏预算和目标用户体感都不划算）。
- 不引入 Speculation Rules：规则在子 frame 内不生效，且它只预取文档、不预取子资源。

## Decisions

### D1：预热裁决与挂载裁决同址，都是纯函数

新增 `resolveStudioWarmup` 放在 `src/creative/keepalive.ts`，与 `resolveStudioMount` 并列：

```ts
export type StudioWarmupVerdict = 'off' | 'wait' | 'mount'

export interface StudioWarmupInput {
  enabled: boolean       // 创意入口开关
  keepAlive: boolean     // 没有常驻容器时预热无处可挂
  preload: boolean       // 服务端 SB_STUDIO_NO_PRELOAD
  mounted: boolean       // 已经挂载（含正式进入过）
  active: boolean        // 当前就在创意视图
  visited: boolean       // sb.studioVisited
  intent: boolean        // 指针悬停或聚焦过「创意」入口
  saveData: boolean
  effectiveType: string
  deviceMemory: number
  hostReady: boolean
  idle: boolean
}
```

短路顺序：入口关闭 / 无常驻 / 服务端关闭 → `off`；已在或已挂载 → `off`（无事可做）；省流量、弱网、低内存 → `off`；没有 `visited` 也没有 `intent` → `off`；`hostReady && idle` → `mount`；其余 → `wait`。

**为什么和挂载裁决放一起**：这两件事共享同一组输入（`enabled`/`keepAlive`/`mounted`/`active`）。分两个文件的结果一定是"开关改了、另一个文件忘了跟"。

**为什么是纯函数**：预热错一条的表现是"点击还是转圈"，没有报错、没有日志，只能靠体感发现。抽成纯函数后可以像 `tests/studio-view-keepalive.mjs` 那样按表断言。

### D2：触发信号取"确定会用到"，不取"页面加载完成"

| 信号 | 对应业界做法 | 在本应用里的含义 |
|---|---|---|
| `sb.studioVisited` | Prismatic 的 preload iframe、Cal.com 的 `?preload=true` | 进过一次创意，第二次一定还会用 |
| 指针悬停 / 焦点 | facade 预热的 hover/focus 配方 | 首访用户已经把手放在入口上，约 200ms 后就会点 |
| 宿主已就绪 + 主线程空闲 | quicklink 的 `requestIdleCallback` | 不与首屏抢 CPU 与带宽 |

**为什么首访无条件加载要否决**：一是首屏预算（1.8MB 主包 + 2.6MB 外壳在同一 4Mbps 链路上重叠，FCP 从 144ms 起会明显变差）；二是仓库里 20+ 个 `waitUntil: 'networkidle'` 的验证脚本用全新上下文运行，没有 `localStorage`，因此**用例零改动**——这是工程收益，不是妥协。

**为什么不选"应用 load 之后无条件预热"**：它看起来更简单，但等于用首访用户的带宽换回访用户的速度，与目标用户分布不符。

### D3：门槛照 quicklink 的最小集，只判一次

```ts
if (saveData) return 'off'
if (/^(slow-)?2g$|^3g$/.test(effectiveType)) return 'off'
if (deviceMemory > 0 && deviceMemory <= 2) return 'off'
```

`navigator.connection` 与 `navigator.deviceMemory` 不存在时按"允许"处理（Safari/Firefox 没有前者），与 quicklink 的容错一致。判定只在预备热时做一次，不监听变化——链路中途变差时正在下载的 2.6MB 已经无法撤回，再判一次只会让行为不可预测。

### D4：隐藏方式改为"离屏但保留布局"

```css
.app-main { position: relative; }            /* 新增：给容器一个精确的定位上下文 */

.view-keepalive {
  position: absolute;
  inset: 0;
  visibility: hidden;
  pointer-events: none;
  min-height: 0;
  width: 100%;
}
.view-keepalive[data-active='true'] {
  position: relative;
  inset: auto;
  visibility: visible;
  pointer-events: auto;
}
```

**为什么不是 `display: none`**：见 Context 的对照表。零视口下宿主不渲染会话列表，揭示要补 45ms 的布局与列表构建，正好落在用户等待的那一帧。

**为什么用 `inset: 0` 而不是固定像素离屏**：`.app-main` 就是内容区，`inset: 0` 让隐藏期的视口等于揭示后的视口，**换算尺寸这一步根本不存在**——不需要 `ResizeObserver` 测量，也不存在测量滞后导致的二次 resize。

**为什么不保持 `display: flex` + `visibility: hidden`**：那会让隐藏容器参与 `.app-main` 的纵向排版，把同一父级下的视图挤走。绝对定位是唯一既保留真实尺寸又不影响兄弟节点的写法。

**为什么激活态要回到 `position: relative`**：`.view-keepalive` 的 `flex: 1 1 auto` 只有在常规流里才有意义，绝对定位时 `flex` 属性会被忽略；激活态回到常规流才能让 `.studio-frame` 的 `height: 100%` 拿到参照。

**代价**：隐藏期 iframe 仍然占布局与 JS 内存（与既有常驻同量级，已记基线约 60MB），并且 `visibility: hidden` 只是不绘制，不暂停脚本——宿主的心跳与连接继续跑。这与"切走不重建"本来就是一件事，不是新增成本。

**为什么在文档里写死这张对照表**：后人看到 `position: absolute; inset: 0; visibility: hidden` 会觉得绕，很容易"简化"回 `display: none`。简化回去，45ms 与补渲染会静默回来，且没有任何功能用例会红——所以 D8 加了一条 CSS 契约断言，把"被简化回去"变成一次测试失败。

### D5：等宿主 ready 用已有状态接口，不主动拉起

轮询 `/studio/_host/status`，800ms 间隔，最多 12 次（约 10 秒）。`state === 'ready'` → 进 `idle` 分支；`state === 'failed'` → 本轮放弃；连续 3 次请求异常（接口不可用、鉴权失败）→ 视为探测不可靠，本轮放弃。

**为什么不直接挂 iframe 让反代 `ensureStarted`**：那等于让预热绕过进程预热的时序，把"进程冷启动"塞回用户的点击路径前半段；而且反代在未就绪时可能返回 503，外壳会先渲染出错误页，再由探测把状态拉回来——闪一次错误的代价比不预热更大。

**为什么上限是 12 次**：宿主预热是 2 秒延迟 + 约 4 秒启动，正常情况下 8 秒内必然 ready；超过 10 秒说明宿主真的有问题，此时继续轮询没有意义，交给操作员点击时的错误页。

### D6：`requestIdleCallback` 加 `timeout`，后台标签不阻塞

```ts
const ric = window.requestIdleCallback ?? ((cb) => setTimeout(() => cb({ didTimeout: true, timeRemaining: () => 0 }), 1))
const id = ric(run, { timeout: 3000 })
```

**为什么加 `timeout`**：规范允许 agent 在没有空闲期时无限推迟回调；加 `timeout` 才能保证"页面不忙但仍被判定为不空闲"时也能落地。这也是 quicklink 默认 `timeout: 2000` 的同一取法。

**为什么后台标签能接受延迟**：后台标签的定时器会被节流到分钟级，预热可能推迟到用户切回来才发生。可接受——用户不在看这个页面时，提前与否都不影响体感；切回来时预热仍会在空闲期完成，而点击通常发生在切回之后。

### D7：意图信号由 `SideNav` 上报，不改导航结构

`SideNav` 增加可选回调 `onIntent?: (view: ViewId) => void`，在导航按钮的 `onPointerEnter` 与 `onFocus` 上调用；`AppShell` 透传，`App` 只在 `view === 'creative'` 时把它喂给预热 hook。

**为什么不监听 `document` 上的 `pointerover`**：那需要从事件目标反推"是不是创意按钮"，等于用 DOM 结构当契约；给按钮加一个回调是显式契约，按钮改版时编译期就能发现。

**为什么同时接 `onFocus`**：键盘用户不会触发 `pointerenter`，没有 `onFocus` 就等于把无障碍用户排除在预热之外。

**为什么不接 `onPointerDown`**：太晚。按下与点击之间只隔一次抬起，扣掉这段时间预热只会做一半工作，还可能和点击后的加载抢主线程。

### D8：失败与重入

- **预热期 iframe 进 `error`**：不主动重试，也不打断；操作员首次揭示时若仍是 `error`，静默重试一次（复用现有 `nonce` 机制），避免"点开就是错误页"。只重试一次，避免宿主真坏时形成重试环。
- **预热与点击竞争**：预热只是把容器切可见，`StudioFrame` 已在，加载骨架直接呈现；不会重复请求 `/studio/`。
- **入口在预热后关闭**：`resolveStudioMount` 已经保证 `enabled === false` 时不渲染，容器随 React 卸载，无需额外处理。
- **隐藏方式的回归锁**：`tests/studio-view-keepalive.mjs` 增加一条纯文本契约——`src/theme.css` 里 `.view-keepalive` 非激活规则必须含 `visibility: hidden` 且不得含 `display: none`。行数本身要在浏览器里测（见 tasks 3.2），但"被简化回去"这件事必须由 Node 用例先红，否则只是一个静默的性能回归。

### D9：开关三层，缺字段按开启处理

| 层 | 开关 | 语义 |
|---|---|---|
| 服务端 | `SB_STUDIO_NO_PRELOAD=1` | 不下发预热许可 |
| 服务端 | `SB_STUDIO_NO_KEEPALIVE=1` | 没有常驻容器，预热自然失效 |
| 前端 | `enabled && keepAlive && preload` | 三者同时为真才预热 |

`/api/studio/enabled` 的 `preload` 字段缺失时前端按 `true` 处理，与 `keepAlive` 现有的兼容方式一致——老前端配新后端、新前端配老后端都不报错。

**为什么不做成前端构建时常量**：与 `keepAlive` 同理，部署后改环境变量重启即可生效，不必重新构建前端。

### D10：验收口径用五个可测数字

| 指标 | 采集方式 | 目标 |
|---|---|---|
| 点击 → 首行可见（回访/意图路径） | CDP trace 打点：点击时刻 → `_panelRow` 首次可见 | ≤ 50ms |
| 首访首屏 | FCP、`/studio/` 的 document 请求数 | 不变（±5ms / 0 次） |
| 隐藏期已渲染行数 | 隐藏容器内 `_panelRow` 计数 | ≥ 1 |
| 揭示到两帧 | `requestAnimationFrame` × 2 的耗时 | ≤ 16ms |
| 回访额外流量 | `transferSize` 汇总 | 约 2.6MB gzip，仅良好网络 |

**为什么不用"看起来快了"**：观感无法回归测试，这五个数字可以。

## Risks / Trade-offs

- **回访用户的额外流量**：2.6MB gzip，只在良好网络与已访问过的前提下发生。低配/弱网/省流量全部被 D3 拦掉。
- **隐藏容器的内存与 CPU**：`visibility: hidden` 不绘制但保留布局与脚本执行，量与既有常驻同量级（基线约 60MB 渲染进程内存）。给 `SB_STUDIO_NO_PRELOAD` 与 `SB_STUDIO_NO_KEEPALIVE` 两条退路。
- **与 `studio-host-prewarm-keepalive` 的规格冲突**：它新增的 `creative-layout` 要求写了"启动阶段不预先加载宿主外壳产物"。本 change 修订该条为"首访且无意图时不预先加载"。**归档顺序必须先它后本**，否则修订会落空。
- **`.app-main` 新增 `position: relative` 的连带影响**：已实测。在分镜画布（1005 个节点、343 个 HTML 绝对定位元素）中筛出"有实际尺寸、且 `offsetParent` 为 `body`、且位于 `.app-main` 内"的元素——**0 个**。容器内的绝对定位元素都挂在 `.canvas`/`stage-wrap`/`.react-flow` 这些已有定位祖先之下。剩余 32 个零尺寸元素的 `offsetParent` 为 `null`，是"无布局盒"而非"以 body 为参照"，不受影响。落地后仍需在镜头表与素材板各点一次，确认没有浮层位移。
- **宿主类名漂移**：浏览器侧的"隐藏期已渲染行数"依赖 `_panelRow` 子串，上游改名时会误判为"未渲染"。这是可接受的失败方向（宁可误红，也不要静默退化成没渲染）；若上游改名，按 `studio-visual-alignment` 的约定与该 change 的注入样式一起改。
- **探测请求本身的开销**：最多 12 次本地 GET，`no-store`。相对 2.6MB 可以忽略，但要在 `off` 分支里短路掉，不要先发请求再判定。
- **预热后用户一直不进创意**：2.6MB 与 60MB 内存属于沉没成本。这正是把触发条件收紧到"回访或意图"的原因。

## Migration Plan

分三步落地，每步可独立回滚：

1. **裁决与服务端开关**：`keepalive.ts` + `server/studio-flag.mjs` + 决策表用例。回滚 = `SB_STUDIO_NO_PRELOAD=1`。
2. **前端接线**：`useStudioWarmup` + `App.tsx` + `SideNav`/`AppShell` 意图回调。回滚 = 移除投喂源（`resolveStudioWarmup` 恒返回 `off`）。
3. **隐藏方式**：`theme.css` 两处。回滚 = 恢复 `display: none`（代价是 45ms 与揭示补渲染，见 D4 对照表）。

三步都不改变磁盘状态、服务端接口语义与数据格式。

## Open Questions

无。首访不预热的边界已经在 D2 定死；低配与弱网由 D3 覆盖；预热失败由 D8 覆盖。
