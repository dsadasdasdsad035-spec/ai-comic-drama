# Proposal

## Why

画布出图目前没有取消、没有超时：前端 `fetch('/api/seedream')` 和方舟请求都没有超时；服务端用 `Promise.allSettled` 等全部候选，一个候选卡住整单就永远不返回；任务台账只有“失败后重试”，没有取消。更糟的是 `genState: 'running'` 会写进画布 localStorage，刷新后卡片仍然转圈、按钮仍然禁用。用户只能等浏览器/系统网络超时，期间无法重新生成或继续批量操作。

## What Changes

- 新增单镜出图请求生命周期：每个请求持有 `AbortController`，用户可取消；取消不报错、不清空已有画面，只回到可重试状态。
- 前端增加有界超时：请求超过上限自动中止并显示“生成超时，可重试”；成功/失败/取消/超时都有明确状态。
- 服务端 `/api/seedream` 对每个候选独立设置超时；一个候选超时不拖死整单，成功的候选先返回并带超时警告；全部失败才返回错误。
- 服务端上游请求和生成图下载增加超时；客户端断开连接时中止未完成的上游请求。
- TaskCenter 支持取消运行中的出图任务、取消全部可取消任务；任务状态增加 `cancelled`，取消不计入成功花费。
- 批量出图支持取消：取消当前请求并停止后续循环，不会继续给剩余镜头提交。
- 加防重入和请求 token：同一镜头已有出图请求时忽略重复触发；取消/新请求后，旧响应不得覆盖新状态。
- 读取画布时把持久化的 `genState: 'running'` 复位为“上次生成已中断，可重试”，不再出现刷新后永久转圈。
- 角色板/素材设定板共用底层 `generateImage` 的超时与 abort 能力；本次只给画布加取消 UI，不扩大视频/配音的取消范围。
- 不包含：自动重试/退避、跨刷新恢复进行中的请求、取消后退款/实际账单校准、视频/配音取消按钮、服务端持久任务队列。

## Capabilities

### New Capabilities

- `image-generation-lifecycle`: 画布出图请求的取消、超时、任务台账状态、批量取消、防重入和中断状态复位。

### Modified Capabilities

无。

## Impact

- 代码：`src/api.ts`（`generateImage` 接收 signal/timeout、超时错误）、`src/App.tsx`（`generateOne` 请求注册表、批量取消、取消入口、旧状态复位）、`src/tasks.ts`（TaskState/cancel）、`src/TaskCenter.tsx`（取消按钮）、`src/ShotNode.tsx` / `src/Inspector.tsx`（运行中取消 UI）、`src/ctx.ts`（卡片取消回调）、`vite.config.ts`（候选/下载超时、断开中止、部分成功）。
- 数据：不新增项目字段；`TaskState` 增加 `cancelled`，只影响浏览器任务台账。画布节点 `genState` 仍是瞬态，读取时归一化；旧项目无需迁移。
- 配置：超时使用默认常量，并允许测试用环境变量覆盖；不新增设置页选项。
- 验证：mock 永不返回/部分超时/全部超时/取消/批量取消/刷新中断/防重入，以及既有出图成功、候选数量、多参考图回归。
- 文档：README 补充出图取消、超时和任务台账语义。
