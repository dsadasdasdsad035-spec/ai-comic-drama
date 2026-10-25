# Proposal

## Why

发布台现在是纯表单：选成片、逐个勾平台、写主文案与覆写、按比例准备封面、看预检、再点发布。平台扩到 15 个之后，用户要在四段表单里反复跳转，却得不到一句「还差什么才能发」的完整回答。五个内容工作台都已经有聊天助手，发布台是唯一没有的——而它恰恰是流程最长、最容易漏步骤的一环。

同时，现有助手能力边界必须先说清：最终发布这一步只能由人在平台后台完成。助手的价值在于把「配置齐、预检过、账号连着、任务已排队」这段重复劳动做掉，而不是替代那一下点击。

## What Changes

- **发布台新增聊天助手**，复用现有聊天壳（`ChatThreadShell` / `useAgentMessages` / `runStageAgent` / 回执卡），宿主技能为新增的 `publish` 技能；线程按项目 + 集隔离并持久化。
- **右栏改为单一槽位**：助手关闭时显示发布检查，展开时被助手接管，不新增第四栏、不挤压表单宽度；窄屏改为覆盖式抽屉，断点对齐发布台自身的 1200px 纵向切换。
- **准备度条**：助手头部以五格（目标 / 文案 / 封面 / 账号 / 预检）显示离可提交还差什么，每格可点击跳转到对应区块；数据直接来自 `config + accounts + preflight`，不另算一套。
- **助手拥有配置写权限**：勾选平台、改主文案与分平台覆写、选封面帧/上传封面、改发布方式。每次写入产出结构化回执卡，并支持撤销本轮。
- **助手可以提交，但不能点击最终发布**：新增两阶段提交——模型调用 `stage_submit` / `stage_package` 只生成「待确认卡」（不发任何网络请求），由用户在卡上确认后才创建任务。卡片记录配置哈希，配置变化后转为过期并禁用确认。
- **权限阶梯写进规格**：助手 MUST NOT 调用适配器 `submitFinal`、MUST NOT 标记已发布、MUST NOT 绕过验证码或二次验证。
- **双入口共用一套提交意图**：底部主按钮与卡片确认走同一个 `submitIntent`（同一份配置快照、同一次预检、同一条幂等键），提交中双向禁用；底部主按钮仍是页面唯一主色 CTA。
- **环境降级**：`chromeAvailable` 为假时（容器部署现状）助手收起「能提交」的能力，只提供发布包准备，并在头部常驻说明，而不是让界面承诺做不到的事。
- **记录可审计**：任务台账对助手创建的任务标注来源，用户能分清哪些是自己点的、哪些是助手提交的。

## Capabilities

### New Capabilities

- `publish-assistant`: 发布台内的对话式助手——读当前成片/配置/账号/预检事实，写发布配置并给出可撤销回执，以两阶段方式暂存提交、等待人工确认，并硬性禁止最终发布与已发布标记；包含准备度、待确认卡、澄清机制、环境降级与审计标注。

### Modified Capabilities

- `publish-workbench`: 右栏从「只放发布检查」改为「检查器与助手共用的单一槽位」；新增助手入口与开合规则；发布记录页新增任务来源标注；明确底部主按钮仍是唯一主色提交入口。

## Impact

- 前端：`src/PublishBoard.tsx`（右栏槽位、助手入口、提交意图抽提、待确认卡挂载）、新增 `src/publish/PublishChat.tsx`、`src/publish/publishReceipts.tsx`、`src/publish/ReadinessBar.tsx`、`src/publish/publishChat.css`、`src/publish/api.ts`（提交意图与幂等复用）、`src/publish/types.ts`（任务来源、待确认卡状态）。
- 复用并按需扩展：`src/agent/threads.ts`（`ChatSurface` 增加 `publish`）、`src/agent/ChatThreadShell.tsx`、`src/agent/useAgentMessages.ts`、`src/agent/stageAgentGraph.ts`、`src/agent/WorkbenchChatAside.tsx`（断点与宽度记忆）、`src/chat-ui/*`、`src/agent/workbenchChat.ts`（助手身份文案表）。
- 技能：新增 `skills/publish/SKILL.md`，与现有 `skills/*/SKILL.md` 同构，走既有技能注册与覆盖机制。
- 服务端：`server/publish-preflight.mjs` 增加可复用的「按快照预检」入口；`server/publish-jobs.mjs` 记录提交来源（手动/助手）；`vite.config.ts` 的发布路由透传来源字段。不改队列并发模型、任务状态机、幂等键与适配器步骤表。
- 不改动：平台能力表、适配器步骤表与 `verified` 策略、账号与登录机制、发布包目录结构。助手不新增任何浏览器自动化能力，也不接入 ZCode 宿主的 `browser-use` 技能。
