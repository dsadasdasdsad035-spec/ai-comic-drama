# Proposal

## Why

3D 调度的机位与走位目前主要靠分镜文案、`videoBrief` 语义理解和 Agent 手写 `pose(t)`；当用户已在 `Shot3DContext` 里挂了实拍或稳定参考片时，缺少一条**只读、可验证**的几何轨（相对相机运动与尺度提示），Agent 容易在推拉摇移方向上多轮试错。VGGT 可在 GPU 上对参考视频抽帧后秒内给出相机与深度摘要，适合作为**实验性旁路**，且 POC 阶段必须不触碰 `sceneCode` / `schedule_video` 调度真相，与现有「失败不覆盖有效调度」一致。

## What Changes

- 新增 **参考片几何分析**（POC）：从镜头已选参考视频（`Shot3DContext.videoUrls` 或工作台显式挑选的本地 mp4）抽帧 → 可选远程 Linux GPU Worker 跑 VGGT → 返回 `report.json`（关键帧相对位姿、中文运动摘要、置信度与警告）。
- 新增服务端作业目录 `.vggt-jobs/<id>/`（TTL 清理），API：`POST /api/vggt/analyze`、`GET /api/vggt/jobs/:id`；未配置 Worker 时返回明确 503，不阻塞 3D 主路径。
- 3D 工作台增加 **「参考片几何建议（实验）」** 只读面板：展示摘要、置信度、复制到聊天；**不**写入 `project.json`、SQLite 或镜头 3D 字段。
- POC **不**新增 Agent 工具、**不**自动拼接 `buildSceneCodeContext`、**不**生成 `pose(t)` 草稿或触发 `run_render`（留作 Gate 通过后的 Phase 2）。
- 抽帧与探测复用现有 `server/video-analyze.mjs` / `ffmpeg-host` 约束（宽度上限、时长探测），避免与创意室切分逻辑分叉。

## Capabilities

### New Capabilities

- `reference-video-geometry`：参考视频的几何分析作业、报告契约、Worker 代理、作业存储与错误语义（含未配置 Worker、低置信、风格化输入警告）。

### Modified Capabilities

- `scene-blocking-3d`：补充「参考片几何分析」与调度真相的边界——分析成功/失败/取消均不得写入或覆盖 `sceneCode`、`schedule_video`、`scheduleMeta`；分析产物不得单独构成 Seedance 参考或抽帧参考。

## Impact

- 代码（预计）：`server/vggt.mjs`（或同级模块）、`vite.config.ts` 路由注册、`SceneCodeWorkbench.tsx` 实验面板、`.gitignore` 增加 `.vggt-jobs/`；可选 `workers/vggt/` 文档与示例脚本（不进 dev 热路径）。
- 运行：开发机 macOS 可无 GPU；生产化需 `VGGT_WORKER_URL` + token 指向 Linux CUDA 主机；权重与 conda 环境仅在 Worker 侧，不进入 `npm install`。
- 许可：VGGT（Meta）与依赖在 W0 阅读 LICENSE；POC 默认标注「实验 / 非调度真相」，商用路径单独评审。
- 测试：新增 `verify-vggt-poc.mjs`（mock Worker 或 dryRun 报告 schema）；回归确保分析失败时镜头 3D 字段不变。
- 文档：`docs/vggt-poc.md`（可选，implement 阶段）记录 Gate 验收与 Phase 2 门禁。
