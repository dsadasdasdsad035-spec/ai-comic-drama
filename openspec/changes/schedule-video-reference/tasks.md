# Tasks

## 1. 模型能力与设置

- [x] 1.1 给 `ModelEntry` 增加 `supportsVideoRef?: boolean` 与 `videoRefTaskType?: 'reference'`，并在 `AppSettings` 的读写类型里保留这两个字段；用 `npx tsc --noEmit` 验证类型通过。
- [x] 1.2 新增 Seedance 2.0 / 2.5 预置模型（`ark-video-2-0`、`ark-video-2-5`），把 `CURRENT_PRESETS_VERSION` 升到 3，并在 `mergePresets` 增加 V3 合并路径；用设置归一化测试验证旧设置会补上新模型、`defaults.video` 仍是 1.0。
- [x] 1.3 设置页对 `video` / `videoRef` 条目增加「支持视频参考」勾选与「任务类型」下拉（仅 2.5 需要）；用 Playwright 验证保存后重新加载仍保留勾选与任务类型。
- [x] 1.4 更新设置页 `videoRef` 的标签与提示（从「多参考图」扩为「多参考图 / 视频参考」）；用 Playwright 断言新提示可见。

## 2. 方舟 Files API 客户端

- [x] 2.1 新增 `server/files.mjs`，实现 `uploadFile`（multipart、`purpose=user_data`）、`getFile`、`waitFileActive` 与 `FileError`；用本地 mock HTTP server 验证上传返回 processing → active、`download_url` 可取。
- [x] 2.2 增加按「绝对路径 + size + mtime」的内存缓存：复用 fileId、每次出片用 GET 刷新 `download_url`、404/过期时重新上传；用 mock 计数验证第二次不重复上传、只刷新地址。
- [x] 2.3 上传前校验视频：只接受 mp4/mov，webm 先用现有 ffmpeg 转 mp4，校验时长 2~15 秒（2.0）/ 2~30 秒（2.5）与 ≤200MB；用 3 秒样例与一个超长样例验证通过与明确报错。
- [x] 2.4 确认失败路径不回显 `download_url`、不写日志；用 mock 错误响应验证错误信息只包含阶段与文件名。

## 3. 请求体与路由

- [x] 3.1 给 `buildVideoPayload` 增加 `referenceVideos`：非空时走全模态参考模式，生成 `video_url` + `role: reference_video`，不发 `first_frame` / `last_frame` / `camera_fixed`；在 `verify-video-api.mjs` 或新脚本里断言完整 `content` 结构。
- [x] 3.2 2.5 模型按条目上的 `videoRefTaskType` 追加 `omni_reference_task_type: "reference"`，2.0 不传；用同一组 payload 测试验证两种模型的分支。
- [x] 3.3 实现 `pickVideoModel(keyOverride, { needVideoRef })`：显式键在 `video` / `videoRef` 两族精确命中，找不到返回 `model-key-not-found`，需要视频参考但条目无能力返回 `video-ref-unsupported`；用 dryRun 覆盖三种情况。
- [x] 3.4 改 `/api/seedance`：接受 `refVideos`，本地路径经 Files API 换取 `download_url` 后提交；上传/轮询失败让任务失败并带阶段信息；用 mock Files API + mock 视频任务验证完整提交链路，不产生真实 2.0 调用。
- [x] 3.5 路由预检：1.0/1.5 模型带 `refVideos` → 400；没有 `scheduleVideo` → 400；非方舟渠道 → 400；用 dryRun 验证三种错误与文案。

## 4. 数据、UI 与提示词

- [x] 4.1 增加 `ShotData.useScheduleVideoRef`、`ProjectShot.use_schedule_video_ref`，并同步 `bizSignature` / `nodeToShot` / `shotToData`；用保存后重新读取的项目验证字段落盘与恢复，旧项目缺字段按 false。
- [x] 4.2 `src/api.ts` 的 `VideoOpts` 增加 `refVideos?: string[]` 并由 `startVideo` 原样转发；用 Playwright 拦截 POST，断言 App 发出的请求带 `refVideos` 且不带 `image` / `lastFrame`。
- [x] 4.3 Inspector 增加「用 3D 调度视频作参考（Seedance 2.0+）」开关：没有调度视频或模型未声明能力时禁用；开启后禁用「带调度关键帧作参考」与「以下一镜画面作尾帧约束」，并显示原因；用 Playwright 验证三种状态。
- [x] 4.4 `generateVideoOne` 增加视频参考分支：`refVideos = [scheduleVideo]`，`refImage` / 连线图作为 `reference_image`，不传首帧/尾帧/`cameraFixed`，`return_last_frame` 保留；用拦截请求验证模式与字段。
- [x] 4.5 视频参考模式的提示词使用 `@视频1` 与 `@图像N`，加入「只参考机位运动、人物走位与相对位置；不要白模、网格、几何体材质、文字标签」的范围约束；用 dryRun 断言提示词包含这些片段。
- [x] 4.6 更新 `README.md`、`DEPLOY-CHECKLIST.md` 与 `src/schedule3d.ts` 顶部注释：说明视频参考走 Files API、需要 Seedance 2.0/2.5、默认关闭；用 grep 确认不再出现“Seedance 只吃图片”的过时表述。

## 5. 集成验证

- [x] 5.1 跑现有 1.0 回归（`verify-all.mjs` 及相关脚本），确认首帧 / 多图 / 尾帧 / 抽帧行为没有回归。
- [x] 5.2 跑新增的 mock + dryRun 用例，确认全程没有真实 Seedance 2.0 调用，且 `video_url` / `@视频1` / 无首尾帧断言全部通过。
- [ ] 5.3 手动做一次真实 2.0 冒烟：用一条现有 3 秒调度视频、480p、合法最短输出时长，记录运镜/走位是否跟随、白模是否污染画风；结果写进变更说明或项目笔记。
- [ ] 5.4 若 2.0 冒烟发现 `download_url` 被拒收或明显白模污染，记录具体错误/截图，并判断是走 TOS 兜底还是另开 POV/干净渲染变更；不在本次直接扩大范围。

## Workflow follow-up

- 评审通过后归档本变更；归档前确认 5.3 的冒烟结果已经记录。
- 若 5.3 显示审片视角导致模型学错运镜，另开变更做按 `move` 驱动的 POV 参考片，不回头改本次实现。

## Verification

- `npx tsc --noEmit`：通过。
- `node verify-video-api.mjs`：通过（1.0/1.5 请求体与任务链路无回归）。
- `node verify-video-ref-api.mjs`：通过（参考视频 payload、Files API mock、缓存/过期/失败、视频校验）。
- `APP_URL=http://127.0.0.1:5280 node verify-video-ref-ui.mjs`：通过（设置页、Inspector、出片请求、Files API mock、webm 转码、1.0 首帧/多图/抽帧回归）。
- `openspec validate --strict`：通过。
- 未跑完整 `verify-all.mjs`：当前本地项目库没有 `recycle` 项目，`verify-videoref-multi.mjs` / `verify-schedule3d.mjs` 依赖它；等价的 1.0 首帧/多图/抽帧路径已在新 UI 测试里覆盖。
- 5.3 真实 2.0 冒烟：2026-10-21 第一次尝试被鉴权拦住。`~/.canghe-skills/.env` 与设置里的 3 个 Key 都是 `ark-` 前缀的 Agent Plan Key：标准 `/api/v3/files` 与 `/api/v3/contents/generations/tasks` 均返回 401 `AuthenticationError`；Agent Plan 基座 `/api/plan/v3` 没有 Files API（404），`doubao-seedance-2-0-260128` 返回 `UnsupportedModel`。请求没有进入视频生成，未消耗 2.0 额度。需要换成标准 Ark Key（具备 Seedance 2.0 + Files API 权限）后重跑。
- 冒烟用的真实 3D 调度视频已生成：`public/videos/schedule-1792591517891-2d036e.mp4`（3.03s / 960×540 / 30fps），可直接复用。
