# Design

## Context

见 proposal.md。`characters-v1` 为 `z.union([{ characters }, array])` 以兼容模型省略外壳；`toolParameters` 用 `z.toJSONSchema(..., { io: 'input' })` 原样导出。APIMart `/responses` 拒绝 `tools[n].parameters` 非 object。`toApimartResponseTools` 仅扁平 `name`，不修复 parameters。

## Goals / Non-Goals

**Goals:**

- 角色 Agent 在 APIMart + `gpt-*-sol`（Responses 路由）上能完成 `submit_characters` 工具声明与调用。
- 所有聊天/worker 发往渠道的 tools 列表通过「顶层 object」静态验收。
- 模型若仍返回裸数组，提交路径与 today 一样通过契约并合并草稿。

**Non-Goals:**

- 重写全部 zod 契约或去掉 union 校验语义。
- 实现 `/responses` 流式；继续整段 JSON 回包。
- 同步修改主规格里「能力表必须声明原生工具」（与已移除守卫的代码分歧，另开变更）。

## Decisions

### D1. 模型 schema 与校验 schema 分离

- **工具声明**：为 `submit_characters` 使用 **仅 object 外壳** 的 JSON Schema（与 `characterItem` 字段一致，`characters` 数组必填或按契约允许空数组）。
- **校验**：`validateContract('characters-v1', payload)` 仍用现有 `charactersV1` union；在 `submit.run` 入口增加 `normalizeCharactersDraft(payload)`，将裸数组转为 `{ characters: arr }`。
- **理由**：最小 diff，不破坏注释中的「两种形状都合法」；只收紧 **发给模型** 的那一份 schema。
- **备选**：全局改 `charactersV1` 去掉 union → 破坏仅数组的 JSON 校验路径，需更多调用方改动。

### D2. 渠道出口归一化（防御性）

- 新增 `assertProviderToolParameters(tools, { strictObject: kind === 'apimart' })` 或在 `normalizeToolSchemas` 之后、`buildApimartResponsesBody` / fetch 之前调用。
- 对已知契约工具（至少 `submit_characters`）可注册 **declaration schema override**；generic 规则：若 parameters 无 `type: 'object'`，开发/测试环境 `console.warn`，生产对 apimart **抛可读错误**（避免 silent 400）。
- **理由**：防止下一个 union 契约在 APIMart 上再次 400。
- **备选**：仅修 characters → 快但不防回归。

### D3. 验收

- `verify-apimart-tool-schemas.mjs`：bundle `stageTools` + 各 `submit_*` contract 的 `toolParameters`，断言每个 function.parameters.type === 'object'。
- 角色附件验收或 mock APIMart：带 `anyOf` 的旧 schema 不应出现在 outbound body（可测 `toApimartResponseTools` 输入已是合规 chat tools）。

## Risks / Trade-offs

- **[Risk] 模型只认 object 后不再返回裸数组** → Mitigation：归一化仍保留；prompt/契约 locked block 可一句说明「请用 characters 字段包裹」。
- **[Risk] 空数组 vs 缺字段** → Mitigation：与现有 `characters-v1` 校验一致，单测覆盖 `[]`。
- **[Risk] 其它渠道 object-only schema 更严** → Mitigation：静态验收覆盖全部 submit_*。

## Migration Plan

- 纯服务端/前端逻辑，无数据迁移。部署后用户重启 dev 即可；无需改设置。

## Open Questions

- 是否在 `getContractSchema` 增加第二参数 `forToolDeclaration`（默认 false）统一所有契约，本变更先只对 `characters-v1` / `submit_characters` 落地，其它 submit 仅验收。
