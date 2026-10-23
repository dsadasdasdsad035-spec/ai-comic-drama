# Proposal

## Why

3D agent 的运行上限目前硬编码在 `DEFAULT_AGENT_LIMITS`：24 个图执行步骤、5 分钟总超时。真实模型遇到修复或多次抓帧时会直接报“agent 步骤达到上限”，用户无法像切换模型一样调整，只能改代码。

同时，总超时触发时走的是取消路径，聊天显示“已取消”而不是“超时”，用户无法判断该调大步骤、调大总时长，还是模型本身有问题。

## What Changes

- 设置页新增“Agent 运行上限”配置：最大执行步数（默认 24）和总运行时长秒数（默认 300 秒），保存到现有设置 SQLite，不新增表。
- 旧设置没有这两个字段时使用默认值；非法/越界输入按范围夹取，避免把 agent 配成永远跑不完。
- 运行 3D agent 时从设置解析上限；步骤上限仍使用当前图执行步数（约 3 步/模型工具轮），设置项和提示明确说明这一点。
- 达到步骤上限的错误显示当前配置值，并提示可在设置页调整；总超时单独显示“运行超时”，不再伪装成用户取消。
- 本次只开放 `maxSteps` 和 `totalSeconds`；代码修复 3 次、视觉验收 2 次、单工具 30 秒、5 帧上限保持不变。不做工作台按次覆盖，也不改 agent 计数语义。

## Capabilities

### New Capabilities

- `agent-run-settings`: 定义 3D agent 运行上限在设置页的配置项、默认值、范围校验和持久化行为。

### Modified Capabilities

- `scene-agent-runtime`: “修复与验收循环必须有上限”改为使用配置值，并区分步骤上限、总超时和用户取消。

## Impact

- 客户端设置：`src/api.ts` 的 `AppSettings`、`src/Settings.tsx` 的新配置区和保存逻辑。
- 服务端设置：`vite.config.ts` 的 `AppSettings`、`normalizeSettings` / `saveAppSettings`；仍存 settings 表的 `app` JSON，无数据库迁移。
- Agent 运行时：`src/agent/sceneAgentTypes.ts`、`sceneAgentGraph.ts`、`SceneAgentChat.tsx`；运行上限从设置解析，超时状态与取消分开。
- 测试与文档：设置页保存/重载、图测试的自定义上限与超时、README 上限说明。
- 不涉及模型渠道、API Key、沙箱 ABI 或项目数据结构。
