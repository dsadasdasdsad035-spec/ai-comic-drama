# Tasks

## 1. 数据与 API

- [x] 1.1 `server/experts.mjs`：内置目录 + `creativeExperts` 设置；`listAllExperts` / `getExpert` / `saveCustomExperts` / `mergeCustomExperts`
- [x] 1.2 `vite.config.ts`：`GET/PUT /api/experts`、`GET /api/experts/:id`、zip 导入导出
- [x] 1.3 `creative_sessions.expert_id` 列与 `PATCH` 会话 `expertId`（`verify-creative-session.mjs`）

## 2. Pi 工具与载荷

- [x] 2.1 `list_experts` 工具（`stageTools` / 白名单 / UI 标签）
- [x] 2.2 `expertTools.ts`：平台 + MCP 过滤；`read_skill*` 技能白名单
- [x] 2.3 `creativeTurnPayload`：`buildExpertSystem` / `interpolateExpertSoul` / `expertToolNames`；检查器与真发一致
- [x] 2.4 `verify-creative-builtin-tools.mjs` 含 `list_experts` 与 `/api/experts`

## 3. 创意工作室 UI

- [x] 3.1 顶栏专家下拉、隐藏偏好技能、`list_experts` 提示
- [x] 3.2 `CreativeStudio`：`buildCreativeExpertTools` 接线；会话/项目 expert 恢复；失效告警
- [x] 3.3 会话列表展示绑定专家名；`expertNameById`

## 4. 设置 · 创意专家

- [x] 4.1 `SettingsPage` 分组 `experts` + `ExpertSettingsPanel`
- [x] 4.2 Tab：概览 / Soul / 技能多选 / 工具分组 / 高级；`skillDetailShell`
- [x] 4.3 MCP 创意工具勾选；Soul↔工具弱提示（`expertSoulHints.ts`）
- [x] 4.4 JSON + zip 导入导出；内置「以此为模板新建」；未保存 confirm + `beforeunload`
- [x] 4.5 保存触发 `creative-experts-changed` 刷新工作室列表

## 5. 内置模板

- [x] 5.1 `expert-free-chat`、`expert-storyboard`、`expert-character`（`experts/`）

## 6. 验收与文档

- [x] 6.1 `verify-creative-experts.mjs`（载荷、白名单、zip 多包、soul 弱提示）
- [x] 6.2 `docs/creative-studio.md` 专家模式；`docs/creative-experts-ux.md` 设计稿
- [x] 6.3 `npm run build` 通过

## Workflow follow-up

- [x] 运行 `openspec validate creative-experts --strict`
- [x] 运行 `openspec archive creative-experts -y` 合并主 spec