# Design

## Context

当前出图链路没有任何硬边界：

- `src/api.ts` 的 `generateImage` 直接 `fetch('/api/seedream')`，没有 `AbortSignal`、没有超时；
- `vite.config.ts` 的 `callArk` 没有超时，`/api/seedream` 用 `Promise.allSettled` 等全部候选；一个候选卡住，整单永远不返回；
- 生成图下载 `fetch(item.url)` 也没有超时；
- `generateOne` 没有请求控制器，重复触发可并发；
- `src/tasks.ts` 的任务只有 `retry`，没有 `cancel`；TaskCenter 只有失败后的重试；
- `genState: 'running'` 会随画布节点写进 localStorage，`readSavedKey` 不重置；刷新后卡片永久转圈；
- 批量出图在 `runOnSelected` 顺序 `await`，一个卡住会拖死整批。

相关要求见 `specs/image-generation-lifecycle/spec.md`；这里说明实现选择。

## Goals / Non-Goals

**Goals:**

- 每个出图请求在有限时间内结束，用户随时能取消单镜或整批。
- 服务端一个候选卡住不拖死其它候选，部分成功可用。
- 刷新、取消、旧响应、重复点击都不会留下永久运行态。
- 成功出图路径、候选数量、参考图注入、画布写回语义不变。

**Non-Goals:**

- 不改视频/配音的取消 UI；只复用底层 timeout/abort 能力。
- 不做自动重试/指数退避；失败后由用户或任务台账重试。
- 不做跨刷新恢复进行中的请求；刷新后统一标记中断。
- 不承诺供应商实际不扣费；取消/超时只影响本地任务状态与成功花费统计。
- 不新增设置页超时配置；只保留测试用的环境变量覆盖。

## Decisions

### 1. 客户端：AbortController + 客户端超时

`generateImage(opts, lifecycle?)` 增加可选：

```ts
type ImageLifecycle = {
  signal?: AbortSignal
  timeoutMs?: number
}
```

- 用一个本地 `AbortController` 合并“用户取消”和“超时”：
  - 监听外部 `signal`，外部 abort 时 abort 本地；
  - `setTimeout(timeoutMs)` 到点 abort 并标记 `timedOut`；
  - 请求结束/异常时清 timer、移除监听。
- 默认客户端超时 `VITE_IMAGE_TIMEOUT_MS` 或 200_000ms；服务端默认 180_000ms，客户端略长，先让服务端返回结构化超时。
- 超时抛 `TimeoutError`（`name='TimeoutError'`）；用户取消抛 `AbortError`。两类错误分开，不把取消当失败。
- 所有错误都带可读原因；取消不写 `genError`。

**替代方案：** 只用 `AbortSignal.timeout()`。它不能同时表达用户取消和超时，且部分浏览器/运行时不支持；用本地 controller 合并更稳。

### 2. 请求注册表：同一镜只允许一个在途请求

App 维护：

```ts
type ActiveImageRequest = {
  nodeId: string
  token: number
  controller: AbortController
  taskId: string
}
activeImageRequests: Map<string, ActiveImageRequest>
```

- `generateOne(id, opts?)` 开头检查 Map：已有请求直接返回/提示，不重复提交。
- 每次请求生成递增 token；响应回来、patch 前确认 Map 里的 token 仍是自己，否则丢弃迟到结果。
- 取消：从 Map 取 controller，abort；从 Map 删除；标记 task cancelled；节点状态复位。
- 成功/失败后清理自己的 Map 项；若已被新请求替换，不清理新项。
- 批量也走同一注册表，因此“批量 + 单镜”不会重复。

### 3. 取消/超时/异常的状态语义

| 结果 | 节点 genState | genError | 旧画面 | 任务台账 |
| --- | --- | --- | --- | --- |
| 成功 | idle | 清空 | 新候选 | done |
| 用户取消 | idle | 清空 | 保留 | cancelled |
| 超时 | error | “生成超时，可重试” | 保留 | error |
| 上游/网络错误 | error | 可读错误 | 保留 | error |
| 页面刷新中断 | error（有旧图）/ idle（无旧图） | “上次生成已中断，可重试” | 保留 | cancelled |

- 取消只在没有旧图时保持“未生成”；有旧图时保留旧图。
- 取消不写空 `candidates`，不把 `candidates` 置空。
- 超时/错误保留 `candidates`/`refImage`；用户可重试。

### 4. 任务台账增加 cancel 与 cancelled

`Task` 增加：

```ts
type TaskState = 'running' | 'done' | 'error' | 'cancelled'
type Task = {
  ...
  cancel?: () => void
}
```

- `startTask` 接受 `cancel`。
- `endTask` 扩展为 `endTask(id, error?, state?)` 或新增 `cancelTask(id)`；取消的任务 `state='cancelled'`，不参与 `totalCost`。
- `loadTasks` 把持久化的 running 改成 `cancelled`，错误文案“页面刷新已中断”，而不是继续显示运行中。
- TaskCenter：
  - running 且 `cancel` 存在 → “取消”；
  - 顶部“取消全部”只取消有 cancel 的任务；
  - cancelled 显示状态，不显示重试（或允许重新发起由节点按钮负责）。

### 5. 批量取消

`runOnSelected`：

- 新建本批 `AbortController`，传给每个 `generateOne(id, { signal, batchToken })`。
- 选择栏在 `selBusy` 时显示“取消出图”。
- 取消后本批 controller abort，当前请求停止，循环 `break`，`selBusy` 清空。
- 不从节点状态推断批量是否中止，用独立 batch signal，避免用户单镜取消被误当成整批取消。

### 6. 服务端：候选独立超时、部分成功

`/api/seedream` 路由：

- 创建 `routeAbort = new AbortController()`；`req.on('close')` 时若响应尚未结束则 abort。
- 每个候选走 `callArk(payload, signal)`，signal 合并：
  - routeAbort；
  - `AbortSignal.timeout(SEEDREAM_TIMEOUT_MS || 180_000)`。
- 用 `Promise.allSettled` 保留成功候选：
  - 至少一个成功：返回 `{ ok:true, urls, warning?, timedOut?, failed? }`；
  - 全部失败：返回 `{ ok:false, message, kind }`。
- 生成图下载也用同样的 signal + 60s 超时；下载失败只淘汰该候选。
- 服务端超时/失败不能返回 200 空列表；必须是结构化错误或带 warning 的部分成功。
- 客户端 `generateImage` 把 `warning` 返回给 App，toast 展示“部分候选超时，已使用成功结果”。

**为什么用 per-candidate timeout：** `n=4` 时任何一路卡住都不该让整单永久等待；用户要的是可用候选，不是“所有候选都完美”。

### 7. 刷新复位

`readSavedKey` 读取节点时：

```ts
if (data.genState === 'running') {
  if (data.refImage || data.candidates?.length) {
    data.genState = 'error'
    data.genError = '上次生成已中断，可重试'
  } else {
    data.genState = undefined
    data.genError = undefined
  }
}
```

- 只处理 `genState`；视频/配音的刷新复位不在本次范围。
- 不清空旧图/候选；不清空提示词。
- TaskCenter 的 running 持久任务同样标记 cancelled/中断。

### 8. UI 入口

- `ShotNode` 的运行遮罩增加“取消”按钮，点击 `ctx.cancelGenerate(id)`；按钮 `stopPropagation`。
- Inspector 运行中主按钮文案改为“取消生成”，点击取消；未运行仍“生成画面 ×N”。
- 选择栏 `selBusy` 时出现“取消出图”。
- TaskCenter 运行行提供“取消”；顶部“取消全部”。
- 取消成功 toast “已取消出图”；超时 toast/错误 “生成超时，可重试”；刷新中断显示卡片错误。

### 9. 时间与测试覆盖

默认值：

- 客户端请求 200s；
- 服务端单候选 180s；
- 图片下载 60s；
- 均可由环境变量覆盖，测试用短值。

测试策略：

- `verify-image-lifecycle.mjs`：
  - Playwright 拦截 `/api/seedream` 永不返回，点击取消 → 请求 abort、节点 idle、旧图保留、任务 cancelled；
  - 批量取消 → 第 2 个请求停止、后续不提交、selBusy 复位；
  - 双击生成 → 只发生一次请求；
  - 刷新前写 `genState:'running'` → 页面显示“上次生成已中断”，按钮可用。
- `verify-seedream-timeout.mjs`：
  - 本地 mock provider/接口：一路成功、一路挂起 → 服务端返回部分成功 + warning；
  - 全部挂起 → 结构化 timeout；
  - 客户端断开 → mock 请求被 abort（通过 mock server 记录 close）。
- 回归：正常 1/2/4 张候选、参考图、旧项目、视频/配音不受影响。

### 10. 适用范围

`generateImage` 的 timeout/abort 能力是通用的，角色板和素材设定板自动获得有界请求；本次只为画布单镜/批量接取消 UI。视频和配音仍使用各自轮询/进程超时，不在本次新增取消按钮。

## Risks / Trade-offs

- **[取消后上游仍可能计费] →** 客户端 abort + 服务端断开中止能减少请求，但无法保证供应商侧不产生费用；UI 只保证本地不把取消计入成功花费，文档说明。
- **[超时阈值太短误杀慢模型] →** 默认 180s，可用环境变量调整；部分候选成功时仍返回结果。
- **[取消状态与旧图混淆] →** 取消只复位运行态，不碰 candidates/refImage；用独立 `cancelled` 任务状态区分。
- **[批量取消误伤单镜] →** 使用独立 batch signal，不通过节点状态推断；单镜取消只 abort 自己的 controller。
- **[迟到响应覆盖新状态] →** 请求 token + active map 检查，旧结果直接丢弃。
- **[刷新复位影响旧运行态] →** 只处理 `genState`，保留旧图；视频/配音不动。

## Migration Plan

1. 先改客户端请求与任务模型，再改服务端 timeout；两者都兼容正常成功路径。
2. 加状态复位和请求注册表，最后接 UI 取消入口。
3. 新增 mock 回归；正常出图、候选数量、参考图和视频流程保持原回归。
4. 回滚：移除取消入口和 timeout 参数即可恢复旧路径；不涉及项目数据迁移。

## Open Questions

无。超时默认值和环境变量命名在实现中固定；若实际方舟生成经常超过 180s，再单独调整常量，不改变本规格。

## Verification

2026-10-22 实测：

- `verify-image-lifecycle.mjs`：单镜取消、旧图保留、双击只发一个请求、任务台账取消、批量取消、正常成功、刷新中断复位全部通过。
- `verify-seedream-timeout.mjs`（短超时实例）：一路成功一路超时返回成功 + warning；全部超时返回 504/timeout；下载超时返回 502/download；客户端断开后上游候选被中止。
- `verify-media-picker`、`verify-asset-board`、`verify-project-scope`、`verify-theme` 通过。
- 390px 日间/夜间：取消入口仍可操作，页面无横向溢出。证据：[cancel-390-day.png](evidence/cancel-390-day.png)、[cancel-390-night.png](evidence/cancel-390-night.png)。
- `verify-gen` 使用 5273 和真实 Seedream，本次未跑以免产生真实额度；正常成功路径由 lifecycle mock 和既有素材/选择器回归覆盖。视频/配音 UI 未改，未重跑真实 provider 冒烟。
