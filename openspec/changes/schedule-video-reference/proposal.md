# Proposal

## Why

画布上的 3D 调度视频目前只用于人工审片：出片时要么把调度坐标翻译成 `motionNote`，要么从视频里抽 3 张关键帧当参考图。抽帧会把白模、网格、文字标签带进模型，默认还不敢开；而 Seedance 2.0/2.5 已支持 `reference_video`，可以直接把整段调度视频作为运镜与走位的参考。

本地 3D 视频无法直接提交给方舟：`video_url` 只接受公网 URL 或 `asset://`，视频不支持 Base64。方舟 Files API 支持二进制上传并返回预签名 `download_url`，正好补上这段。

## What Changes

- 新增「3D 视频参考」出片模式：镜头 Inspector 里可把本镜的 `scheduleVideo` 作为 Seedance 参考视频，默认关闭，只有支持视频参考的模型（Seedance 2.0/2.5）可勾选。
- 服务端新增 Files API 客户端：把本地调度 mp4 以 `purpose=user_data` 上传，轮询到 `active`，取 `download_url` 作为 `video_url.url`；按文件路径 + 大小 + mtime 缓存，避免重复上传。
- `buildVideoPayload` 支持参考视频：有视频参考时走全模态参考模式，`content` 为 text + `reference_image` + `reference_video`；不再发送 `first_frame` / `last_frame` / `camera_fixed`，保留 `return_last_frame`。
- 模型解析改为显式键在 `video` / `videoRef` 两族精确命中；模型条目新增视频参考能力标记，不支持时返回明确错误，不静默换模型。
- 提示词增加 `@视频1` 指代与范围约束：只参考机位运动、人物走位与相对位置，不照搬白模、网格、几何体材质与文字标签。
- UI 明示模式互斥：开启视频参考时禁用「以下一镜画面作尾帧约束」，并说明本镜不能再用首帧/尾帧硬锁。
- 保留现有 1.0 首帧 / 多图参考 / 抽帧通路不变；1.0 继续用于日常出片与自动化回归，视频参考的真实生成只做一次 2.0 人工冒烟。
- 不包含：镜头视角 POV 参考片的渲染、TOS/S3 上传、素材库 `CreateAsset` / `asset://`、参考音频、真人素材、自动切换模型。

## Capabilities

### New Capabilities

- `schedule-video-reference`: 把画布生成的 3D 调度视频上传到方舟并以 `reference_video` 形式用于出片，包含模式开关、模型能力校验、请求体组装、失败与缓存语义。

### Modified Capabilities

无。

## Impact

- 代码：`server/video.mjs`（payload 组装）、新增 Files API 客户端模块、`vite.config.ts`（`/api/seedance` 路由、模型解析、模型预设）、`src/api.ts`（`refVideos` 与 Files API 类型）、`src/types.ts` / `src/shotSync.ts`（`useScheduleVideoRef` 持久化）、`src/App.tsx`（出片分支与提示词）、`src/Inspector.tsx`（模式开关与互斥提示）。
- 数据：`project.json` 新增 `use_schedule_video_ref` 布尔字段，默认 false；旧项目无需迁移。设置里的模型条目新增能力标记。
- 外部依赖：方舟 Files API（`POST /api/v3/files`、`GET /api/v3/files/{id}`）与 Seedance 2.0/2.5 视频参考 API；均走现有 Bearer Key，不新增对象存储凭据。
- 验证：新增 mock Files API + dryRun 的请求体断言；现有 1.0 回归脚本保持不变；真实 2.0 冒烟手动执行，不进入 `verify-all.mjs`。
- 文档：`README.md` / `DEPLOY-CHECKLIST.md` 补充视频参考模式与 Files API 说明。
