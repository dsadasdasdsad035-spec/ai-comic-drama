# Proposal

## Why

宿主进程已经被预热（`studio-host-prewarm-keepalive`），但**外壳文档仍然在点击「创意」的那一刻才创建**。实测（本机，宿主已 `ready`）：点击到首行出现 292–304ms，其中 125ms 是外壳文档的 DCL，143ms 是主线程上两段长任务（79ms + 64ms）；2.6MB gzip 的产物（81 个插件模块）也是从点击才开始传输。远程链路按 2.6MB 折算，10Mbps 下约 2.1 秒。

对比同一份测量里的另一半：宿主 ready 之后，把外壳挂进一个已经存在的 iframe，文档 202–329ms 内就完成加载（资源已缓存）。也就是说，**剩下的成本全压在点击上，而它完全可以挪到后台**。

还有一个被现有实现掩盖的事实：**"外壳文档已加载"不等于"内容已渲染"**。当前常驻容器用 `display: none` 隐藏，从未展示过的 iframe 视口是 0×0，宿主在零视口下算不出列表高度，**一行都渲染不出来**（实测隐藏期 `_panelRow` 计数为 0，揭示到两帧 45ms，行数要到揭示后才补齐）。换成保留布局的隐藏方式（`position:absolute; inset:0; visibility:hidden`）后，隐藏期视口就是最终的 1360×860、会话行已渲染（计数 3），揭示到两帧只要 2ms。

这与"已经展示过、再被隐藏的常驻容器"不同：后者会话行仍在 DOM 里（实测计数保持 3，揭示约 16ms）。预热走的正是"从未展示过"这条路径，因此隐藏方式必须一起改，否则预热只能省掉网络与激活，省不掉揭示时的列表构建。

因此本 change 要做两件事：把外壳挂载提前到"宿主 ready 且主线程空闲"，以及把隐藏方式从"不参与渲染"改成"参与渲染但不可见"。

## What Changes

- **浏览器侧预热裁决**：新增纯函数 `resolveStudioWarmup`，把"什么时候预热"钉成可表决的契约（`off` / `wait` / `mount`）。触发信号两条：操作员此前进入过创意（`sb.studioVisited`），或对「创意」入口产生了指针悬停/焦点意图。首访且无意图时不预热。
- **门槛照业界的取法**：省流量（`saveData`）、有效连接 `slow-2g/2g/3g`、`deviceMemory ≤ 2`、服务端关闭预热——任一命中即不预热，且不重试。
- **调度**：等宿主 `ready`（轮询 `/studio/_host/status`，不主动拉起），再进 `requestIdleCallback`（`timeout` 兜底），避免与首屏竞争主线程。
- **隐藏方式改为保留布局**：`.view-keepalive` 非激活态从 `display: none` 改为 `position: absolute; inset: 0; visibility: hidden; pointer-events: none`，激活态恢复常规流。隐藏期宿主以真实视口渲染完，揭示只剩一次可见性翻转。
- **服务端下发预热开关**：`/api/studio/enabled` 增加 `preload` 字段（`SB_STUDIO_NO_PRELOAD=1` 关闭），与既有 `keepAlive` 并列。
- **失败不打扰**：预热请求失败、宿主 `failed`、或状态探测不可用时，一律放弃本轮预热、不挂载；操作员点击仍走既有错误页与「重试」。
- **可量化的验收**：新增"点击 → 首行可见"、"首访 `/studio/` 文档请求数"、"隐藏期已渲染行数"、"揭示到两帧"、"回访额外流量"五项口径，实测数字写入 `docs/creative-host.md`。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `creative-dsh-host`：新增「创意外壳在首次点击前完成预热」与「预热可关闭且不改变首访首屏预算」两项要求；原有的宿主进程预热、鉴权、模型出口、错误页要求不变。
- `creative-layout`：修订「创意视图往返不重建宿主文档」，补充"隐藏期必须以最终可视尺寸完成渲染"与"未激活时不得参与布局或接收指针事件"。原文"启动阶段不预先加载宿主外壳"在预热成立后可被绕过，修订为"首访且无意图时不预先加载"。

## Impact

- 代码：`src/creative/keepalive.ts`（新增裁决纯函数）、`src/creative/useStudioWarmup.ts`（新增）、`src/App.tsx`（预热投喂与回访标记）、`src/shell/SideNav.tsx` 与 `src/shell/AppShell.tsx`（意图回调）、`src/theme.css`（隐藏方式）、`server/studio-flag.mjs`（`preload` 字段）。
- 测试：新增 `tests/studio-shell-prewarm.mjs`（决策表驱动），扩展 `tests/studio-view-keepalive.mjs`（隐藏方式契约），沿用 `npm run test:studio` 入口。
- 文档：`docs/creative-host.md` 新增「外壳预热」小节（触发矩阵、门槛、隐藏方式实测、开关、度量）。
- 资源：回访与意图路径上多一次 2.6MB gzip 传输与约 60MB 渲染进程内存；首访路径的字节与 FCP 不变。
- 非目标：不修改 `deepseek-harness` 子模块；不优化外壳自身的产物体积或插件激活时间；不改宿主进程预热时机；不改鉴权、反代与 WebSocket 透传。
- 依赖：本 change 修订 `studio-host-prewarm-keepalive` 在 `creative-layout` 里新增的同名要求，**必须先归档该 change 再归档本 change**。
