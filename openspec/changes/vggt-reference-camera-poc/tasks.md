# Tasks

## 1. 契约与桩

- [x] 1.1 在 `openspec/changes/vggt-reference-camera-poc/` 旁新增 `workers/vggt/report.schema.json`（version 1 字段）并通过 `node` 或 ajv 校验示例报告
- [x] 1.2 编写 `workers/vggt/README.md` 记录 Linux VGGT smoke 步骤（conda、权重、单文件夹推理），不纳入 `npm install`
- [x] 1.3 实现可选 mock Worker 脚本（返回固定 `report.json`），供本地无 GPU 时 `curl` 验证通过

## 2. 服务端作业

- [x] 2.1 新增 `server/vggt.mjs`：`createJob`、`runJob`、状态机、`probe`+抽帧调用 `video-analyze.mjs` 能力
- [x] 2.2 在 `vite.config.ts` 注册 `POST /api/vggt/analyze`、`GET /api/vggt/jobs/:id`、`POST /api/vggt/jobs/:id/cancel`；未配置 Worker 时返回 503 与中文说明
- [x] 2.3 将 `.vggt-jobs/` 加入 `.gitignore` 并实现 TTL 清理（启动时或定时）删除超期目录
- [x] 2.4 编写 `verify-vggt-poc.mjs`：mock Worker + 断言 job 完成、报告 schema、`project.json` 中镜头 3D 字段不变

## 3. Worker 集成（Linux GPU）

- [x] 3.1 在 GPU 机部署 Worker `POST /v1/infer`，读取帧目录输出 `report.json`（相对位姿 + `motionSummaryZh` 可由规则或 LLM 生成）
- [x] 3.2 配置开发机 `VGGT_WORKER_URL`/`VGGT_WORKER_TOKEN`，对一条实拍 mp4 跑通端到端并归档样本 `report.json` 到 `openspec/changes/vggt-reference-camera-poc/evidence/`（可选）
- [x] 3.3 验收：同一视频连续两次分析，关键帧位姿趋势人工判定一致（Gate checklist）

## 4. 3D 工作台 UI

- [x] 4.1 在 `SceneCodeWorkbench.tsx` 增加「参考片几何建议（实验）」面板：选源、提交、轮询、展示 `motionSummaryZh`/置信度/warnings
- [x] 4.2 实现「复制到聊天」纯文本注入，不触发保存；`confidence: low` 时二次确认
- [x] 4.3 区分「参考片」与「当前调度片」文案；分析进行中禁用渲染采纳相关误操作提示

## 5. 文档与回归

- [x] 5.1 在 `README.md` 增加简短「VGGT 实验」节：环境变量、非调度真相、Worker 要求
- [x] 5.2 将 `verify-vggt-poc.mjs` 纳入合适 verify 分组或文档注明手动运行命令
- [x] 5.3 运行 `openspec validate vggt-reference-camera-poc --strict` 并通过

## Workflow follow-up

- Gate 通过后另开 change 实现 Blender `pose(t)` 草稿与 `buildSceneCodeContext` opt-in。
- 归档本 change 前确认 `reference-video-geometry` 与 `scene-blocking-3d` delta 已 review。
