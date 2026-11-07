# Design

## Context

见 `proposal.md`。现 `set_scene_code` 在存在 `draftScope` 时仍调用 `/api/scene-draft` 分片；6 个 draft 工具与 `Draft*` UI、`compactPiHistory` 的 DRAFT_OPS 绑在一起。`adopt_scene_from_job` 尚未实现。

## Goals / Non-Goals

**Goals:**

- 默认 full_host；模型主路径为 job 内写文件 + shell 探索。
- 单工具 `adopt_scene_from_job` 替代 draft 提交链与（full_host 下）分片 scene-draft 暴露。
- restricted 仍可无 shell，用 `set_scene_code` 提交短代码。

**Non-Goals:**

- 不删除 `/api/scene-draft` 服务端（可保留供 `set_scene_code` 内部分片或日后清理）。
- bash 成功不自动更新 `sceneCode`/调度视频（与 full_host 归档一致）。
- 不要求模型继续使用 `begin_scene_draft`。

## Decisions

1. **默认 full_host**  
   `AppSettings` 缺省与新建项目默认 `full_host`；设置页文案标明 restricted 为收紧模式。迁移：旧设置显式 `restricted` 不变。

2. **工具表（full_host）**  
   `get_shot_context`, `run_bash`, `read_file`, `write_file`, `list_dir`, `adopt_scene_from_job`, `set_scene_code`（可选保留给短补丁）, `run_render`, `capture_frames`, `review_frames`, `finish`。  
   **restricted**：无 host 四件套与 adopt；保留 `set_scene_code`。

3. **adopt_scene_from_job**  
   - 参数：`path` 相对 job 根，禁止 `..` 与绝对路径。  
   - 实现：`agentReadFile(jobId, path)` → `checkSceneCode` → `applyCode`（与现 session 逻辑一致）。  
   - 不调用 `onDraftCode` 直到 `run_render` 成功。  
   备选 `set_scene_code` 在 full_host SKILL 中降级为「极短片段修正」。

4. **移除 draft 工具**  
   从 `createSceneAgentTools` 数组删除六项；`SceneAgentChat` 去掉 `Draft*` tool UI；`compact.ts` 删除或空化 DRAFT 折叠；SKILL `tools:` 列表同步。

5. **set_scene_code 内部**  
   full_host 路径优先 adopt；`set_scene_code` 可改为纯 `applyCode`（无 scene-draft），restricted 仍可内部分片。减少双轨复杂度：full_host 下 `set_scene_code` 仅 `applyCode`；restricted 保留现有 begin/append 内部实现但**不注册** draft 工具名。

6. **验收**  
   `verify-pi-agent.mjs`：无 draft 工具名；full_host 含 adopt；`verify-agent-draft.mjs` 删除或标 deprecated 并改新脚本 `verify-scene3d-adopt.mjs`。

## Risks / Trade-offs

- [默认 full_host 扩大攻击面] → 设置说明 + 可切 restricted。  
- [模型忘记 adopt] → SKILL 强制顺序；`run_render` 错误提示指向 adopt。  
- [超长单文件 adopt] → 仍受读文件大小上限（与 agent read 截断一致）。

## Migration Plan

单版本发布：旧聊天轨迹中的 draft 工具卡片只读展示即可；新运行不再注册。用户 previously restricted 不受影响。

## Open Questions

- 是否在首版同时移除 `set_scene_code`（full_host）— 默认 **保留** 作短代码捷径。
