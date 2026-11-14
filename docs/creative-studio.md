# 创意工作室

创意会话是 **Pi 纯聊天**：多会话列表保留，消息写入 `creative_threads`。

- **默认（无专家）**：Pi 用 **`list_installed_skills`** 发现 Agent 包，再用 **`read_skill_text`** 读 SKILL；顶栏「偏好」可指定默认包。
- **专家模式**（顶栏「专家」下拉）：system **仅**专家 `soul`（支持 `{{projectName}}` 等占位符），工具/技能受专家白名单约束；系统始终注入 **`list_experts`**。专家定义在 **设置 → 创意专家**（内置 + 自定义，可 JSON/zip 导入导出）。会话可绑定 `expert_id`，列表侧栏显示专家名。

模型在 **默认路由 · 创意（对话助手）**。勾选「创意聊天」的 **HTTP MCP** 经 `/api/mcp` 进入专家工具白名单（stdio 暂不支持）。

## 入口与边界

- 顶栏「创意」视图；不绑定项目集号（无集选择器）。
- 会话存储：`creatives/<sessionId>/` 与 SQLite `creative_*` 表；列表按顶栏当前 **`project` 过滤**，新建会话自动写入该项目。`project` 为空的旧会话不会出现在项目创意视图中。
- 技能：设置 → SkillHub 安装 Agent 包；创意顶栏偏好可选，留空即 **自动（技能目录）**。

## 使用方式

1. 设置 → **默认路由** →「创意（对话助手）」绑定文本模型。
2. （可选）SkillHub 安装 Agent 包；顶栏偏好留空或指定默认 id。
3. （可选）设置 → **MCP**：安装 HTTP 服务并勾选「创意聊天」。
4. 发送消息 → `runStageAgent`（Pi Agent）→ **历史走 Pi `messages` + `transformContext` 长期记忆**，本轮 user 仅正文；模型按 system 先 **`list_installed_skills`**（按需）再 **`read_skill_text`**；**平台内置** `read_*` / `submit_*` / `validate_contract` 始终可用（写回需顶栏已选项目），另可调 HTTP MCP。

## 检查器

「查看将发送」展示下一轮 system / 合成 user / 技能声明的工具列表（含 manifest 中尚未实现的名称，供你对照）。

## 服务端创意 API

摄取、反推、产物等 **HTTP API 仍留在仓库**，供脚本与后续技能扩展；当前 UI 不挂载这些能力。若要恢复，需在 `stageTools` 或独立模块重新注册并在创意页绑定。

## 验收

```bash
node verify-creative-ui.mjs
node verify-creative-builtin-tools.mjs   # 逐项 invoke 创意内置工具
node verify-creative-experts.mjs         # 专家载荷、zip、白名单
```