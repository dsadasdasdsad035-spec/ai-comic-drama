# Design

## Context

见 `proposal.md`。当前 3D 工作台以 `Shot3DContext` + `shot3dContextCatalog` 驱动左侧选择器、`prepareSceneCodeContext` / `contextManifest` 注入生成与聊天，并以 `contextFingerprint` 参与 `isSceneCodeFresh`。VGGT 挂在同一侧栏，视频源含 `context.videoUrls`，摄取经 `onAddReference` 写入 context。探索结论：移除整块 B，VGGT 仅调度片 + 面板摄取，不打开素材选择器，不向模型自动灌镜头表内容。

## Goals / Non-Goals

**Goals:**

- 删除镜头级 `shot_3d_context` 的读写与 UI；保存时剥离字段。
- 工作台布局：预览 + 聊天/代码为主；VGGT 为独立可折叠块（可窄屏堆叠）。
- `buildSceneCodeContext` / Agent 仅使用 `sceneCode`、镜号/时长/画幅标签与用户消息；可选会话级聊天附件（与技能面一致），不持久化到镜头。
- `isSceneCodeFresh` 不再比较 `selectionFingerprint`；`sceneCodeMeta` 新保存不写该字段。
- VGGT：`sources = schedule_video (+ 本会话摄取 URL)`；摄取落盘 assets 后仅进入 VGGT 下拉；移除 `onAddReference`、素材选择器入口。
- 保留 `POST /api/shot-3d/ingest-reference`（或薄包装），行为与创意 ingest 一致，不写镜头 JSON。

**Non-Goals:**

- 不改分镜画布出片参考（素材连线、`reference_video`）。
- 不删除 `/api/vggt/*` 与 Worker POC。
- 不把平台摄取合并进创意室 UI（仅语义解耦 context）。
- 不在此变更实现「从镜头表自动拼 prompt」的替代路径。

## Decisions

| 决策 | 选择 | 备选 |
|------|------|------|
| 旧 `shot_3d_context` | 加载忽略；`shotSync` 出站省略 | 保留只读展示（否决） |
| 代码生成输入 | 纯 code + 元数据 + 聊天 | 只读注入整镜 prompt（用户否决） |
| VGGT 源 | 调度片 + 摄取 | + 素材选择器（用户否决） |
| 摄取后去向 | 会话 state → VGGT pick | 写 `shot_3d_context`（否决） |
| 聊天附件 | 会话级 `ChatAttachment[]`（3D 与 Skill 同 sink） | 完全无图（弱） |
| 删除模块 | 移除 Picker、catalog、`contextManifest`（或缩为无 manifest 路径） | 保留 catalog 只给 VGGT（否决） |
| 指纹 | `sceneCodeFingerprint` 仅 code/assets/duration/aspect | 保留 selection（否决） |

**实现顺序（建议）**

1. 数据层：`shotSync`、types、`sceneCodeFreshness` 去 context。
2. 删除 Picker/侧栏；VGGT standalone props（`scheduleUrl`, `sessionIngestUrls`）。
3. 重写 `prepareSceneCodeContext` → 无 catalog 或删除调用链；`SceneAgentChat` 去 manifest 投影。
4. 样式与设置文案；verify 脚本分批改。
5. 归档时删除 `openspec/specs/shot-3d-context`、`shot-3d-reference-ingest`。

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| 旧项目依赖已选参考生成 code | 旧 context 忽略；用户需靠聊天/VGGT 摘要重做 |
| Agent 质量下降（无图 brief） | 用户主动粘贴 VGGT、会话上传图 |
| 大量 verify 失败 | 先改 `verify-schedule3d-workbench`，再 agent 类 |
| unified-chat-composer 文档漂移 | 同步 README / `docs/scene-agent-engine.md` |

## Migration Plan

1. 部署后首次保存镜头即剥离 `shot_3d_context`（批量保存可选脚本）。
2. 有过期镜因指纹规则变化：提示「参考选择已不再影响过期，仅代码/渲染」。
3. 回滚：恢复前端旧版会再次读写 context 字段（数据若已剥离需从备份恢复）。

## Open Questions

- 3D 聊天是否在本切片启用「会话级图片上传」还是纯文本 + VGGT 粘贴：**建议本切片启用与技能面一致的上传**，否则与原 unified composer 能力倒退。
