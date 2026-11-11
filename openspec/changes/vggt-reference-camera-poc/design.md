# Design

## Context

见 `proposal.md`。当前 3D 路径：`Shot3DContext` 选参考 → Agent / 手写 Blender 代码 → `server/blender.mjs` 渲染 `schedule_video`。视频取证已在 `server/video-analyze.mjs`；Agent 上下文在 `buildSceneCodeContext` 中与 `videoBrief` 分块。本 POC 在 Mac 开发机上旁路调用 Linux GPU 上的 [VGGT](https://github.com/facebookresearch/vggt)，不嵌入 `npm run dev` 进程。

## Goals / Non-Goals

**Goals:**

- 最小闭环：提交 → 抽帧 → Worker 推理 → `report.json` → 工作台只读展示与「复制到聊天」。
- 报告坐标：首帧相机为原点，四元数 `wxyz`，FOV 与项目画幅/有效秒数说明写入 `mappingNote`。
- 失败零写入镜头 3D 字段；作业目录 `.vggt-jobs/` 与 `.blender-jobs` 同级。

**Non-Goals:**

- Phase 2：`pose(t)` 草稿、`buildSceneCodeContext` 自动注入、新 Agent 工具。
- 点云/GLB 下载、viser 内嵌、OVOW 级 mesh 重建。
- 替换 `videoBrief` 或创意室切分主路径。
- 在本仓库内安装 PyTorch / VGGT 权重（仅在 Worker 仓或文档中）。

## Decisions

### D1：Mac API + 远程 Worker（默认）

**选择**：Vite 中间层 `server/vggt.mjs` 负责鉴权、抽帧、投递 Worker、写 job 状态；Worker 为独立 HTTP 服务（FastAPI/Flask 薄壳 + VGGT 推理脚本）。

**备选**：本机 subprocess 调 conda —— 与 macOS 无 CUDA 冲突，POC 不采用。

**环境变量**：`VGGT_WORKER_URL`、`VGGT_WORKER_TOKEN`（可选）、`VGGT_JOB_TTL_DAYS`（默认 7）。

### D2：抽帧复用 `video-analyze.mjs`

**选择**：导出或调用 `probeMedia` 与现有帧导出 helper，统一 `MAX_FRAME_WIDTH=1280`、`MAX_FRAMES_PER_REQUEST=48`。

**备选**：Worker 内 ffmpeg —— 重复逻辑，不利于 Mac 侧路径校验。

### D3：报告存储不经过 SQLite

**选择**：`/.vggt-jobs/<id>/status.json` + `report.json`；前端轮询只读。

**备选**：写入镜头 JSON 字段 —— 违反 POC 边界，拒绝。

### D4：UI 挂在 `SceneCodeWorkbench`

**选择**：参考内容区下折叠「实验 · 参考片几何」；按钮禁用条件：无 `videoUrls`、作业进行中、Worker 503。

**备选**：独立视图 —— 过重，POC 不采用。

### D5：POC Worker 接口

```http
POST /v1/infer  { "framesDir": "...", "probe": {...}, "projectAspect": "9:16", "effectiveSeconds": 6 }
→ 200 { "report": { ... } }
```

Mac 侧可先实现 **mock Worker**（固定 `report.json`）供 `verify-vggt-poc.mjs` 与 UI 开发；真实 VGGT 在 `workers/vggt/README.md` 记录 conda 步骤。

### D6：坐标与 Blender 对齐（文档级）

POC 只保证相对轨一致；FOV→焦距换算在 `mappingNote` 写「传感器 36mm 假定」，不在 POC 自动写 bpy。

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| AI/动漫参考片置信低 | `confidence: low` + UI 禁用「复制给 Agent」或二次确认 |
| Worker 延迟 30s+ | 异步 job + 取消；不占用 Blender 并发槽 |
| VGGT 许可 | POC 标注实验；商用前法律评审 |
| 用户混淆参考片与调度片 | spec 要求 UI 双标签（见 `scene-blocking-3d` delta） |
| 大视频磁盘 | job 结束删帧目录，仅留 report；TTL 清理 |

## Migration Plan

1. 合并后默认 Worker 未配置 → 功能隐藏或灰显「需配置 VGGT Worker」。
2. 无项目数据迁移。
3. 回滚：删除路由与 UI 块；遗留 `.vggt-jobs/` 可手动删。

## Open Questions

- Gate 通过后 Phase 2 是否把摘要 **opt-in** 写入 `buildSceneCodeContext`（需新 change）。
- Worker 单租户部署形态：同机 Docker vs 专用 GPU 机（运维决定，不影响 POC 契约）。
