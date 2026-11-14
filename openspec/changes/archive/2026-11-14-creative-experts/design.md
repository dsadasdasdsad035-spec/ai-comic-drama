# Design

## 产品规则（已锁定）

| 项 | 结论 |
|---|---|
| 有专家时 system | 仅 `soul`（`{{projectName}}` 等占位符），不拼接 `buildCreativePiSystemAutonomous` |
| 技能 | 仅专家 `skillIds`；`read_skill*` 包一层白名单 |
| 工具 | 专家 `toolIds` + 勾选 MCP + 系统固定 `list_experts` |
| 偏好技能 | 有专家时隐藏顶栏「偏好」 |
| `list_installed_skills` | 非强制；仅专家工具白名单勾选时可用 |

## 存储

- **内置**：`experts/<id>/manifest.json` + `soul.md`
- **自定义**：`settings.creativeExperts`（SQLite）
- **会话**：`creative_sessions.expert_id`；顶栏切换写会话；项目 `localStorage` 作无绑定时默认

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/experts` | 列表 |
| GET | `/api/experts/:id` | 单条 |
| PUT | `/api/experts` | 全量保存自定义数组 |
| POST | `/api/experts/import-zip` | 合并导入 |
| GET | `/api/experts/:id/export-zip` | 下载 zip |

## 参考

- UX：`docs/creative-experts-ux.md`
- 验收：`verify-creative-experts.mjs`