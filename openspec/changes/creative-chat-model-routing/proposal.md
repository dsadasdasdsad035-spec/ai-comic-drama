# Proposal

## Why

设置页「生成环节默认」里的「创意（对话助手）」绑定与「创意输出上限」目前都是死配置：服务端 `Stage` 联合类型不含 `creative`，用户在设置页选的值在保存前的 `normalizeStageModels` 就被丢弃；创意会话的默认模型取模型表第一条，且每次模型集变化都会覆写宿主里用户自己选的模型。结果是创意会话实际使用的模型与用户配置无关，违背 `creative-chat` 已声明的解析顺序（宿主显式选择 > `stageModels.creative` > 「文本 · 常规」默认）。

实测证据（开发模式桌面版）：设置页 `defaults.text = ark-plan-text-deepseek-flash`，但生成的 `cordis.patch.yml` 里 `agent-default-model` 是 `sb/ark-text-lite`。

## What Changes

- 服务端 `Stage` 联合类型与 `STAGES` 收编 `creative`，使 `stageModels.creative` 能通过保存校验并落库（此前在写入阶段被静默丢弃）。
- 新增创意默认模型解析：`stageModels.creative` → `defaults.text` → 首个可用文本模型，解析结果写入宿主的 `agent-default-model`。
- 宿主侧显式选择不再被覆盖：应用记录自己上次写入的默认值，仅当 patch 里的值仍是自己写的值时更新；值已被宿主改写则保留。
- `syncProfile` 的变更签名纳入默认模型 id，否则只改绑定不会触发 patch 重写。
- 创意网关把 `stageMaxTokens.creative` 作为 `maxTokens` 转给 `/api/text`，使设置页的输出上限真正生效。
- 三层解析都拿不到可用文本模型时，不再写入不存在的 `sb/default`，改为留空并在宿主侧给出可读的未配置说明。

## Capabilities

### New Capabilities

<!-- 无新增能力 -->

### Modified Capabilities

- `creative-chat`: 在原「创意会话模型由宿主设置解析」之外补齐两点行为——应用写回默认模型时 MUST NOT 覆盖宿主已保存的显式选择；并新增「创意会话输出上限来自设置页创意环节」的要求（该值此前没有任何规范，也不生效）。

## Impact

- `server/app.ts`：`Stage` / `STAGES` / `BUDGET_STAGES` / `normalizeStageModels`，新增创意默认模型解析导出。
- `server/studio-profile.mjs`：`agent-default-model` 从无条件覆盖改为按来源判定更新。
- `server/index.mjs`：`syncProfile` 使用解析结果，变更签名纳入默认模型 id。
- `server/openai-gateway.mjs`：转发时附带创意环节的 `maxTokens`。
- 新增应用侧状态：记录上次写入宿主的默认模型，落在 `DSH_HOME` 下（不写进 patch 文件，避免与宿主的严格配置 schema 冲突）。
- 测试：`tests/openai-gateway.mjs` 增加 `maxTokens` 透传；新增创意默认模型解析与「保留宿主选择」的用例。
- 用户可感知的变化：已有桌面实例的创意默认模型会从 `sb/ark-text-lite` 变为当前 `defaults.text` 指向的模型；此前保存过的 `stageModels.creative` 已被丢弃，需要用户重设一次。
