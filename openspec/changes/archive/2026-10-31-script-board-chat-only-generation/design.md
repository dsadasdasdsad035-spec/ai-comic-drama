# Design

## Context

`ScriptBoard.tsx` 当前为双栏：左栏编辑 `source`/`logline` 与「加一集」，右栏分集；`WorkbenchBar` 动作区含与聊天共用的 `generate()` 顶栏按钮。聊天已通过 `chatAdapter.builtins` 暴露「生成分集」，并通过 `submit_script` 支持改稿。详见 proposal.md。

## Goals / Non-Goals

**Goals:**

- 删除左栏 DOM 与顶栏拆集按钮，主区域全宽分集列表。
- 保留 state 加载/保存 `source`、`logline`、`style`、`episodes`；内置拆集仍读 `liveRef` 与顶栏集数/时长/模型。
- 统一文案：空态、builtin 禁用原因、WorkbenchInspector 保存提示。
- 更新 E2E/回归脚本，避免依赖已删 DOM。

**Non-Goals:**

- 新增 `write_source` 或让内置动作读取「刚在对话粘贴的全文」。
- 变更 `skills/script` 契约、merge 逻辑或 `submit_script` 工具语义。
- 归档或改写 `workbench-chat-builtin-actions` 变更目录（仅在 README/注释说明剧本例外）。

## Decisions

1. **整列移除 `sb-left`，不保留折叠**  
   - 理由：左栏三项全部删除，无剩余控件。  
   - 备选：折叠原著 — 与用户「不在页内编辑原著」冲突，不采用。

2. **顶栏只删 `generate` 按钮，保留 `runGenerateEpisodes` 供 builtin**  
   - 理由：零重复逻辑；`generate()` 包装可删或仅留 builtin 路径。  
   - 备选：删除 builtin — 与「聊天支持生成」冲突。

3. **Builtin 禁用文案**  
   - `source` 为空时：提示写入 `projects/<名>/source.md`、API 导入，或在对话中贴全文走 `submit_script`；不再提「左栏」。  
   - 仍要求 `source.trim()` 才启用内置「生成分集」（与现逻辑一致）。

4. **样式**  
   - 删除或保留未使用的 `.sb-left`、`.sb-source`、`.sb-logline`、`.sb-actions` — 实现时删除 dead CSS，减少混淆。

5. **测试策略**  
   - `verify-stage-models-ui.mjs`：API 写入 `source`，经聊天 builtin 或 mock 路径验证 `modelKey`（若该脚本目的仅为模型选择，可改为在剧本页只测选择器 + 在聊天触发一次 text 调用）。  
   - `verify-workbench-builtin-actions.mjs`：删除「顶栏按钮结果一致」断言；保留聊天 builtin 与保存。  
   - `verify-script-chat.mjs`：已不依赖左栏，应无需改或仅改空态断言。

## Risks / Trade-offs

- **[Risk] 用户习惯顶栏一键拆集** → 剧本 profile `emptyBody` 与空态明确指向 Agent 内置动作。  
- **[Risk] 内置拆集依赖 `project.source`，对话贴文不自动填入** → 禁用提示区分「内置拆集」与「对话贴全文」两条路径（explore 已对齐）。  
- **[Risk] 与 workbench-chat-actions「顶栏一一对应」文档不一致** → README 与 proposal 注明剧本例外。

## Migration Plan

- 单 PR 前端 + 测试 + 文案；无数据迁移。  
- 回滚：恢复 `ScriptBoard` 左栏与按钮即可，项目 JSON 无 schema 变更。

## Open Questions

- 无。logline 不在 UI 展示为既定范围；若以后要展示，另开 change。
