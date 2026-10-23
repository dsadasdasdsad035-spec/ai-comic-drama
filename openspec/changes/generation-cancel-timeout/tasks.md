# Tasks

## 1. 客户端请求生命周期

- [x] 1.1 给 `src/api.ts` 的 `generateImage` 增加可选 `signal`/`timeoutMs`，用本地 AbortController 合并用户取消和服务端超时；超时抛 `TimeoutError`，取消抛 `AbortError`；验证：mock fetch 永不返回，200ms 后为 TimeoutError，外部 abort 为 AbortError。
- [x] 1.2 在 `src/App.tsx` 增加出图请求注册表（nodeId -> token/controller/taskId），`generateOne` 防重入、响应写回前校验 token；验证：双击/批量与单镜并发只产生一个请求，迟到响应不覆盖新图。
- [x] 1.3 取消单镜：controller.abort、清理注册表、任务 cancelled、节点 idle/保留旧图；验证：取消后旧 `refImage`/`candidates` 不变，按钮恢复。
- [x] 1.4 批量出图接入独立 AbortController；`runOnSelected` 取消后停止后续镜头并清空 `selBusy`；验证：取消第 2 镜时第 3 镜没有请求。
- [x] 1.5 读取画布时把持久化 `genState: 'running'` 归一化：有旧图 -> error + “上次生成已中断”，无旧图 -> idle；验证：刷新后卡片不再转圈，按钮可用。

## 2. 任务台账

- [x] 2.1 `src/tasks.ts` 增加 `cancelled` 状态、`Task.cancel`、`cancelTask`/扩展 `endTask`；取消任务不计入成功花费；加载时遗留 running 标 cancelled；验证：纯函数断言 cancelled 不在 totalCost，刷新恢复为 interrupted。
- [x] 2.2 `src/TaskCenter.tsx` 给运行中且可取消的任务加“取消”，顶部加“取消全部”；cancelled 不再显示为运行中；验证：点击取消调用回调，任务状态更新。

## 3. 画布取消 UI

- [x] 3.1 `src/ctx.ts` 暴露 `cancelGenerate(id)`；`src/ShotNode.tsx` 运行遮罩增加取消按钮，按钮阻止冒泡；验证：卡片运行中可点取消，不触发选中/新建。
- [x] 3.2 `src/Inspector.tsx` 运行中主按钮改为“取消生成”，未运行仍为生成；验证：点击取消后按钮恢复为生成画面。
- [x] 3.3 选择栏在批量运行中显示“取消出图”，调用批量 controller；验证：批量取消后进度消失，不再发起后续请求。
- [x] 3.4 统一取消/超时/中断 toast 与错误文案；取消不写 `genError`，超时可重试；验证：三种结果在卡片/Inspector 可区分。

## 4. 服务端超时与部分成功

- [x] 4.1 `/api/seedream` 为每个候选 `callArk` 增加独立超时；路由收到 `req.close` 时 abort 未完成候选；验证：mock 一个挂起/一个成功，服务端在短超时后返回成功 + warning。
- [x] 4.2 生成图下载增加 60s 超时；下载失败只淘汰该候选；验证：mock 图片 URL 挂起，其他候选仍返回。
- [x] 4.3 全部候选超时/失败返回结构化错误，不得 200 空数组；至少一个成功返回 `{ok:true, urls, warning, timedOut}`；验证：三种 mock 场景。
- [x] 4.4 超时值支持环境变量覆盖（测试用短值），客户端默认略长于服务端；验证：设置短 env 后能快速触发超时，不依赖真实 3 分钟等待。
- [x] 4.5 前端 `generateImage` 把服务端 `warning/timedOut` 传给 App，App toast“部分候选超时，已使用成功结果”；验证：部分成功时显示警告但仍展示候选。

## 5. 测试与文档

- [x] 5.1 新增 `verify-image-lifecycle.mjs`：单镜取消、旧图保留、双击防重入、批量取消、刷新中断复位、任务台账取消；验证：脚本全部通过。
- [x] 5.2 新增 `verify-seedream-timeout.mjs`：mock provider/接口覆盖一路超时一路成功、全部超时、客户端断开；验证：服务端响应/警告/错误正确，无真实方舟调用。
- [x] 5.3 回归正常出图：1/2/4 张候选、参考图、项目画布写回、角色/素材板共用底层不回归；验证：`verify-gen`、`verify-media-picker`、`verify-asset-board` 等现有脚本通过。
  - 注：`verify-gen` 依赖 5273 + 真实 Seedream，未跑；用 lifecycle mock 的正常成功路径及 `verify-media-picker` / `verify-asset-board` 覆盖。
- [x] 5.4 更新 `README.md`：说明出图取消、超时、批量取消、任务台账 cancelled、刷新中断和成功花费口径；验证：文档步骤与实际按钮一致。
- [x] 5.5 回归视频/配音/项目/主题：确认本次改动没有把视频/配音任务误标取消，也没有破坏项目隔离；验证：相关 `verify-*` 通过。
  - 注：本次未改视频/配音 UI，也未重跑需要真实 provider 的 smoke；`verify-project-scope`、`verify-theme` 通过。

## 6. 集成验证

- [x] 6.1 运行 `npm run build`、`verify-image-lifecycle`、`verify-seedream-timeout`，确认类型与新链路通过。
- [x] 6.2 运行 `verify-gen`、`verify-media-picker`、`verify-asset-board`、`verify-project-scope`、`verify-theme` 及视频/配音回归，确认无回归。
- [x] 6.3 人工检查：正常出图、取消、超时、刷新中断、批量取消、任务台账取消六种状态在日间/夜间和 390px 下可读可操作。

## Workflow follow-up

- 全部任务和人工检查通过后归档本变更。
- 如果真实上游在取消后仍有计费，记录为供应商侧行为，不在本地做退款逻辑。
