# Proposal

## Why

创意会话选中专家后，用户期望模型**只看见、只读该专家挂载的技能与工具**。当前 DSH 路径上工具已由 preset 闸门收窄，但应用侧 `list_installed_skills` / `read_skill*` 仍按**全库**列举与读取；`skillIds: ["*"]` 时宿主侧甚至不注册技能 pre-execute 闸门，与 OpenSpec「专家白名单」及 DSH 专家技能根（`includeDefaultRoots: false`）不一致，形成「先推荐全局技能、后被拒或读到库外内容」的割裂。

## What Changes

- **工具执行携带专家上下文**：创意宿主在调用 `/api/studio/tools/execute` 时传递当前 agent 的专家标识（由 preset / 插件配置解析），应用侧按该专家的 `toolIds` / `skillIds` 做防御性校验（与 DSH `restrict` 双保险）。
- **技能列表与读取对齐白名单**：专家会话下 `list_installed_skills` 仅返回该专家允许的技能 id（含 `*` 时返回与专家技能根一致的已安装集合，而非无条件全库）。
- **通配 `*` 语义收紧为「专家技能根内全部」**：DSH `dsh-plugin-creative-expert` 对 `*` 仍执行「允许根内任意 id、拒绝根外 id」的闸门（与「不注册闸门、可读任意 id」脱钩）。
- **无专家会话行为不变**：未绑定专家 preset 的会话继续使用全量平台工具与宿主技能发现规则（与既有无专家 / 标准 preset 一致）。
- **文档与验收**：补充创意宿主文档中「专家模式下列表=可读」条款；单测覆盖桥接传参与列表过滤。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `creative-experts`：专家模式下技能**列举**与**读取** MUST 与白名单一致；`*` 表示专家技能根内全部已挂载技能，而非绕过闸门；工具可见集与执行校验与 `toolIds` 一致（`list_experts` 例外不变）。

## Impact

- `server/dsh-plugins/creative-tools`：execute 请求体增加专家上下文字段；启动配置可带默认项目/集号不变。
- `server/studio-tool-bridge.mjs` / `src/agent/stageTools.ts`：`list_installed_skills` 与 `read_skill*` / `read_skill_file` 在收到专家上下文时过滤或拒绝。
- `server/dsh-plugins/creative-expert` / `server/dsh-experts.mjs`：`*` 编译进闸门的白名单解析；preset 始终带可执行的 skill 约束语义。
- `tests/creative-expert-plugin.mjs`、`tests/studio-host-experts.mjs`、`tests/creative-tools-plugin.mjs`：新增专家上下文与列表过滤用例。
- `docs/creative-host.md`：专家模式技能/工具边界说明与排障条目。