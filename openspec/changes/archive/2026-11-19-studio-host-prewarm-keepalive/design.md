# Design

## Context

动机见 `proposal.md`。这里只列决定方案的现状与约束。

**宿主是懒启动的。** `setupStudio()` 只创建管理器与反代，从不调用 `start()`：

```js
// server/index.mjs
function setupStudio(actualPort) {
  if (!isStudioEnabled() || creativeHost) return
  ...
  creativeHost = createCreativeHost({ ... })
  studioProxy  = createStudioProxy({ ... })
}
```

真正的拉起发生在反代的 `ensureStarted`：**只有通过鉴权、命中 `/studio/` 的请求才会触达宿主**。`ensureStarted` 每次都先 `syncProfile()` 与 `syncExperts({ restartIfRunning: false })` 再 `start()`。

**就绪判定有一段落差。** 宿主启动后打印 `dsh web: http://127.0.0.1:PORT/?token=...`；`creative-host.mjs` 从这行取令牌，再以 250ms 间隔探测、60 秒超时。冷启动期间用户看到的是应用侧的「正在连接创意会话…」。

**创意视图是条件渲染。** `src/App.tsx` 里 `view === 'creative' ? <StudioFrame /> : ...`；卸载 `StudioFrame` 即销毁 iframe 的 browsing context，宿主前端所有内存态（会话投影、滚动、草稿、WebSocket）随之丢失。

**宿主前端的加载过程在应用控制之外。** index 注入 `window.__DSH_BOOT__` 与 `__ModuleLoader__`，`AppWebEntry.run()` 先画 `BootPage`（framework-free，显示 `HARNESS` 与 `Loading plugins…`，带 `data-dsh-boot` 标记），等 Cordis 条目激活、激活审计通过后才 `renderSlot('root')` 挂载应用。

**StudioFrame 现有桥只在 `onLoad` 时运行**，注入主题变量、降噪样式与 `MutationObserver`。`onLoad` 在 boot 完成之后触发，因此它对隐藏启动页来不及。

**不可动摇的约束**：宿主只监听 `127.0.0.1`；引导令牌只留在服务端内存；`/studio/` 必须与应用同源；主题首帧对齐不能退化。

## Goals / Non-Goals

**Goals:**

- 用户第一次点「创意」时不再承担宿主冷启动。
- 创意与其他视图往返时不重建宿主前端文档，恢复时状态与连接都在。
- 加载期呈现与应用一致的加载态，不再出现宿主品牌启动页。
- 失败仍由应用自己的中文错误页承担，不依赖宿主报告。
- 预热与常驻都可单独关闭，便于排障与低配环境。

**Non-Goals:**

- 不修改 `deepseek-harness` 子模块（启动页不做源码级替换）。
- 不做蓝绿换进程、不改宿主重启策略。
- 不改鉴权、反代、WebSocket 透传、`DSH_HOME` 布局。
- 不优化宿主前端自身的产物体积或激活时间。

## Decisions

### D1：预热放在应用监听成功之后，延迟 2 秒，单次触发

在 `setupStudio()` 末尾挂一个 `unref` 定时器，2 秒后从 `idle` 拉起宿主。

**为什么延迟**：应用首屏要加载自己的 bundle 与静态资源。立即预热会让宿主与 22 MB 前端产物和应用首屏抢带宽，把「创意快」换成「首屏慢」。2 秒足以让首屏落地，又不至于让用户等到点进创意时还没开始。

**为什么单次触发**：宿主崩溃后的反复拉起只会烧 CPU 且用户看不到原因——这个约束已经由 `creative-host` 的重启上限承担，预热不应绕过它。预热失败只记日志，错误页的「重试」仍是唯一显式入口。

**备选与否决**：启动时立即预热（与首屏抢带宽）；轮询 `/studio/_host/status` 直到 ready 再触发（多一层无收益的判据）。

### D2：预热复用 `ensureStarted` 的语义，而不是直接 `start()`

预热必须与「用户首次进入」走同一条路径：先 `syncProfile()`、再 `syncExperts({ restartIfRunning: false })`、最后 `start()`。否则宿主可能读到上一次运行留下的 profile patch，表现为模型列表或专家列表过期。

实现上把 `ensureStarted` 的主体抽成一个具名函数（例如 `startHostForRequest()`），预热与反代共用，避免两处逻辑漂移。

**备选与否决**：预热直接 `creativeHost.start()`——省一次配置同步，但会让"预热后配置仍旧"成为一类难查的问题。

### D3：常驻用「首次进入才挂载 + `display: none` 隐藏」

`StudioFrame` 只在用户第一次进入创意视图时挂载；之后用一个包裹容器控制 `display`，`view` 离开创意时置为 `none`。

**为什么 `display: none` 够用**：它不销毁 browsing context——iframe 的文档、Cordis 上下文、WebSocket 全部存活，只是不参与布局与绘制。这正是"切回丝滑"的本质。

**为什么必须保留"首次才挂载"**：如果应用启动就挂载，等于在首屏阶段多拉 22 MB 宿主前端，把 D1 省下的时间又赔进去。

**为什么不引入 keep-alive 库**：React 侧没有官方的视图缓存原语，第三方库会引入依赖且最终仍要落到隐藏容器；直接用一个 `data-active` 属性控制 `display` 已经够表达意图。

**不做的细节**：隐藏时不切换 `state`，也不重新触发探针——`StudioFrame` 的探针只依赖 `nonce`，常驻后不会重复轮询。

### D4：隐藏宿主启动页在「文档可用时」注入，不等 `onLoad`

`onLoad` 触发时宿主已经完成 boot，启动页早已展示完毕，来不及隐藏。改为在设置 `src` 之后以 100ms 间隔轮询 `iframe.contentDocument`，一旦 `head` 可访问就插入：

```css
[data-dsh-boot] { display: none !important; }
```

`data-dsh-boot` 是宿主启动页根节点的稳定标记（`BootPage` 构造时写入），比 CSS Modules 的哈希类名稳定。`readyState === 'complete'` 时停止轮询。

**为什么不改宿主 `BootPage`**：那是子模块改动，会把每次上游升级变成一次 rebase。应用侧注入一行样式就能达到同样效果。

**跨源保护**：访问 `contentDocument` 在跨源时返回 `null` 或抛错，全部包在 `try/catch` 里；跨源时维持现状（显示宿主启动页），不报错。

### D5：加载骨架由应用提供，失败态由应用承担

隐藏宿主启动页之后，加载期必须由应用自己给出视觉。把 `.studio-frame-loading` 从一句文案换成三栏骨架（侧栏条、消息气泡轮廓、输入框轮廓），保持 `data-state="loading"`。

`state === 'error'` 时移除隐藏样式并显示应用自己的错误页——错误页本来就有中文说明与「重试」，不依赖宿主启动页的失败报告。

**权衡**：宿主自己的启动失败详情（哪个插件失败）会被隐藏。作为补偿，`/studio/_host/status` 已经返回 `error` 与 `log`，错误页可展示其中一段；这条在 tasks 里显式列出。

### D6：验收用三个可测数字

| 指标 | 采集方式 | 目标 |
|---|---|---|
| 就绪提前量 | 应用日志 `listening` 时刻 与 宿主 `已就绪` 时刻之差 | 首次点创意时宿主已 `ready` |
| 文档重建次数 | 切页往返时 `/studio/` 的 document 请求数 | 1 次（仅首次） |
| 常驻内存 | 进程 RSS 与 iframe 渲染进程 | 记录基线，写入文档 |

**为什么不用"看起来快"**：观感无法回归测试，这三个数字可以。

### D7：两个环境变量控制开关

- `SB_STUDIO_NO_PREWARM=1`：不预热。
- `SB_STUDIO_NO_KEEPALIVE=1`：退回条件渲染。

两者默认关闭（即默认启用预热与常驻）。测试环境默认设 `SB_STUDIO_NO_PREWARM=1`，避免 `npm run test:studio` 拉起真实宿主拖慢用例。

## Risks / Trade-offs

- **预热与用户首次进入竞争**：预热尚未 ready 时用户点进来，`ensureStarted` 会发现 `state === 'starting'` 并等待同一个 promise（`createCreativeHost.start` 已有 `readyWaiters`），不会起第二个进程 → 无需额外处理，但要写进测试。
- **常驻内存上升**：宿主进程 + 宿主前端文档常驻 → 文档写明基线并提供 `SB_STUDIO_NO_KEEPALIVE`；低配环境可关。
- **隐藏后恢复闪一帧**：iframe 从 `display: none` 恢复需要一次布局 → 隐藏时保留 `ready` 态、不重画 loading 遮罩；恢复后不再触发 `onLoad`，主题桥不会重跑（主题由 `MutationObserver` 保证，仍生效）。
- **提前注入样式扰动宿主启动**：只在 `head` 可访问时插入 `<style>`，不修改 DOM 结构 → 若注入失败则退化为显示宿主启动页，不影响功能。
- **测试环境被预热污染**：`SB_STUDIO_NO_PREWARM=1` + 关闭常驻；新增用例显式设置。
- **`onLoad` 与常驻的交互**：常驻后 `onLoad` 只发生一次，`attachBridge()` 也只跑一次；`MutationObserver` 承担后续主题同步。这条与现状一致，不引入新行为。

## Migration Plan

分两步落地，每步可独立回滚：

1. **预热**：只有 `server/index.mjs` 一处改动。回滚 = 设 `SB_STUDIO_NO_PREWARM=1`。
2. **常驻 + 加载态**：`src/App.tsx`、`src/theme.css`、`src/creative/StudioFrame.tsx`。回滚 = 设 `SB_STUDIO_NO_KEEPALIVE=1`（恢复条件渲染）。

两步都不改变磁盘状态与服务端接口，不涉及数据迁移。

## Open Questions

无。创意入口开关关闭时的行为沿用既有语义（入口不可进入、宿主停止），常驻容器在开关关闭后不再渲染，不需要额外设计。
