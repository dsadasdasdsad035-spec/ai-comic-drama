# Proposal

## Why

创意工作室此前只有「自动技能目录 + 可选偏好技能」一种 Pi 约束方式，难以复用固定角色（分镜教练、角色设定等）并限制工具/技能面，易与通用创意壳、`list_installed_skills` 扫全库混在一起。需要 **专家（Expert）**：可配置的 soul、技能白名单、工具白名单，并在顶栏与会话层可选。

## What Changes

- 内置 `experts/<id>/`（manifest + soul）与 SQLite `creativeExperts` 自定义项；`/api/experts` CRUD、zip/json 导入导出。
- 创意顶栏 **专家** 下拉；选中后 system **仅** soul（占位符），隐藏偏好技能；`buildCreativeExpertTools` 约束平台/MCP；`list_experts` **始终注入**。
- 设置 → **创意专家**：Tab 编辑、技能多选、工具分组 + MCP、Soul 弱提示、未保存拦截。
- 会话 `creative_sessions.expert_id` 绑定；侧栏展示专家名。
- 验收：`verify-creative-experts.mjs`、扩展 builtin-tools / session 脚本。

## Capabilities

### New Capabilities

- `creative-experts`：专家数据模型、API、设置 UI、创意运行时约束、`list_experts` 工具。

### Modified Capabilities

- `creative-chat`：增加专家模式与无专家自动模式的并列行为说明。

## Impact

- **后端**：`server/experts.mjs`、`server/expertZip.mjs`、`server/db.mjs`、`server/creative.mjs`、`vite.config.ts`。
- **前端**：`CreativeStudio`、`CreativeHeader`、`ExpertSettingsPanel`、`expertTools.ts`、`creativeTurnPayload.ts`。
- **文档**：`docs/creative-experts-ux.md`、`docs/creative-studio.md`。