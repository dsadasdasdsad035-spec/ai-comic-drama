# Design

## Context

动机与实测账本见 `proposal.md - Why`；行为契约见 `specs/creative-dsh-host/spec.md` 与 `specs/creative-experts/spec.md`。这里只记当前状态里会约束实现的部分与选型理由。

本机实测基线（macOS / Apple Silicon / Node 24.22.3，宿主已预热，端口 5273）：

| 测量项 | 实测 |
| --- | --- |
| `/studio/_host/status`（应用侧拦截，不触达宿主） | 0.5ms |
| `/studio/favicon.ico`（走代理，经过 `ensureStarted`） | 20–30ms |
| `writeExpertsPatch()` 单次 | 首次 34ms，稳定后约 18ms |
| 一次进入创意触发的 preset 重写次数 | 58 次 |
| 外壳 `load` | 368ms |
| 外壳并发启动的 8 个 `/studio/api/*` | 185–195ms/个（服务端单线程串行排队） |
| 宿主冷启动（同 profile + experts patch） | 1.33s |

两条结构性约束：

1. **服务端是单线程**。请求路径上的同步准备不是加一点延迟，而是把这批并发请求排成一队。
2. **宿主已 `ready` 时，`start()` 立刻返回**。此时前面的 `syncProfile` / `syncExperts` 对本次请求没有任何作用，只是纯开销。

## Goals / Non-Goals

**Goals:**

- 宿主已就绪时，`/studio/` 转发路径的额外开销降到与静态转发同量级（目标：不高于 5ms）。
- 专家 preset 与镜像在内容等价时零写盘、零变更日志。
- 预热不在操作员正面等待路径上缺失：启动中被占用后仍能补一次。
- 加载态能区分「等宿主」与「等外壳」，让慢有解释。

**Non-Goals:**

- 不改宿主前端的加载策略与插件树激活方式（属于宿主自身，不在本仓库控制范围内）。
- 不改常驻容器与主题桥（`creative-layout` 与 `theme-switching` 的既有契约不动）。
- 不做跨请求的长期缓存持久化（进程重启后允许一次写盘）。
- 不改账本、模型门面与工具执行语义。

## Decisions

### 决策 1：就绪短路放在 `startHostForRequest` 内，而不是改代理

`ensureStarted` 是代理与进程预热共用的唯一入口，短路放在这里，两条路径同时受益，也不会出现「预热走一条、请求走另一条」的分叉。

```ts
const startHostForRequest = async () => {
  const state = creativeHost.status().state
  if (state === 'ready') return true        // 新增：已就绪，本次请求无事可做
  syncProfile()
  await syncExperts({ restartIfRunning: false })
  if (state === 'failed') return false
  return await creativeHost.start()
}
```

注意先取 `status()` 再判断：`syncExperts` 自身可能触发重启，顺序反了会把刚就绪的状态又推进一次同步。

*备选：* 在代理里判断 `host.upstream()` 是否为空再决定是否调用 `ensureStarted`。否决——`upstream()` 为空也可能是 `starting`，那种情况仍必须等待同一次启动，判断条件分散会漏。

*备选：* 把 `syncProfile` / `syncExperts` 全改成定时轮询。否决——设置变更已有 `onSettingsChanged` 事件驱动，再加轮询只是多一条并行的同步来源。

### 决策 2：幂等判定放在磁盘内容比较，不用内存指纹

`writeExpertsPatch` 当前无条件写两个文件。改成先读旧内容再比较：

- preset 约 22KB、镜像约 0.6KB，读取 + 比较在 1ms 量级，相比 18–25ms 的生成与写盘仍有数量级收益；
- 内存指纹在进程重启后必然为空，会在每次启动后多写一轮；磁盘比较对「外部手工改动」也天然安全。

只有真正写入时才 `log()`，并让函数返回 `{ written, changed }` 供调用方判断。`syncExpertSkillRoot` 已是增量逻辑，只需把「无差异时也对每个条目 stat 一遍」的重复动作收敛为一次目录列举。

*备选：* 用 `fs.statSync` 的 mtime 判定。否决——mtime 只说明「别人改过」，不说明「我要写的内容是否等价」。

### 决策 3：工具声明缓存按「工具表身份」失效

`ensureLoaded` 已经用 bundle mtime 判断是否需要重新 import。`catalog()` 的 JSON Schema 转换在此之上增加一层缓存，失效条件与工具表重建完全同步（`this.tools` 被赋值时清空缓存）。

不引入 TTL 与额外依赖：工具表的生命周期已经由 mtime 与项目上下文界定，再加一个时间维度只会让「为什么工具声明是旧的」更难解释。

### 决策 4：预热状态机区分「尝试过」与「被占用」

现在 `fired` 在定时器到点时就置真，`warmUp()` 遇到 `state !== 'idle'` 直接返回 false，导致整个进程生命周期再无预热。改为三态：

| 状态 | 含义 | 是否允许再次预热 |
| --- | --- | --- |
| `pending` | 定时器已安排 | 是（不重复安排） |
| `deferred` | 触发时宿主 `starting` | 是，宿主就绪后补一次 |
| `spent` | 已真正发起，或已确认失败 | 否（失败由错误页接管） |

补触发的次数上限为 1 次，延迟 1 秒，且只看 `creativeHost.start()` 的返回；不引入无限重试。

*备选：* 监听宿主状态变化事件。否决——宿主管理器目前没有事件总线，为一次补触发引入订阅机制不划算。

### 决策 5：桌面端预热延迟取 0，浏览器端保持 2 秒

延迟的初衷是「别和首屏的 bundle 抢带宽」。桌面端外壳由本地回环提供、首屏被 splash 遮住，这个前提不成立；而且 `main.mjs` 会恢复上次路由，用户很可能直接落在创意页，此时 2 秒延迟恰好让请求抢在预热之前。

实现只改服务端取值：`setupStudio` 在 `SB_DESKTOP_PARENT_PID` 存在时传 `delayMs: 0`，浏览器形态不变。

*备选：* 由主进程在 `did-finish-load` 后调一个预热接口。否决——多一条仅桌面端存在的启动路径，违反「预热与首次进入共用同一入口」。

### 决策 6：加载态文案由宿主状态派生，不引入新的轮询

`StudioFrame` 已经在挂载时探测一次 `/studio/_host/status`。把探测结果与「iframe 是否已 load」组合成两个阶段：

- 宿主 `idle` / `starting` / 未知 → 「正在启动创意会话…」
- 宿主 `ready` 但 iframe 未 load → 「正在加载创意界面…」

不新增轮询：这两句的差异只需要一次探测，加载期不再重复请求。

## Risks / Trade-offs

- [就绪短路让「配置漂移」失去兜底] → 配置写入仍由 `onSettingsChanged` 与「未就绪时同步」两条路径覆盖；补一条测试断言「改设置 → 宿主重启 → 读到新值」，并在 design 复审时确认设置页所有保存路径都调用了通知钩子。
- [磁盘读比较引入 IO] → 单次约 1ms，且只在需要同步时发生；有「内容不变时 mtime 不变」的回归契约兜住。
- [桌面端 0 延迟与首屏争 CPU] → 宿主冷启动 1.33s 内确实占 CPU；但这段本来也在用户点击后才发生，前移只是把它挪到 splash 期。若实测首屏卡顿，可按机型回退到 500ms。
- [补触发预热可能与用户点击撞车] → 两者都走 `creativeHost.start()`，`starting` 状态下复用同一个 promise，不会拉起第二个进程。
- [阶段文案依赖 status 的单次探测] → 探测失败时退回「正在连接创意会话…」，不出现空白说明。

## Migration Plan

- 纯服务端与前端代码改动，无数据迁移；回滚即还原这几处判断。
- 灰度顺序：先合入决策 1、2、3（对用户无感知，只降开销），观察一天日志里 preset 生成记录是否归零；再合入决策 4、5、6（改变观感）。
- 排障开关沿用既有的 `SB_STUDIO_NO_PREWARM` / `SB_STUDIO_NO_PRELOAD` / `SB_STUDIO_NO_KEEPALIVE`，不新增开关。

## Open Questions

（无）
