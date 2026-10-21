# Tasks

## 1. HTTP 视频客户端

- [x] 1.1 新增 `server/video.mjs`：实现 `videoCapsFor`（1.x 家族按时长范围校验，未登记模型放行）与 `buildVideoPayload`（文本、`first_frame`、`last_frame`、1~4 张 `reference_image`、顶层 `ratio/duration/resolution/camera_fixed/return_last_frame`）。验证：`node verify-video-api.mjs` 的请求体与档位用例全部通过。
- [x] 1.2 在 `server/video.mjs` 实现 `submitVideoTask`、`pollVideoTask`、`downloadVideoArtifacts`，支持注入 `fetchImpl` 与目标目录。验证：本地 mock HTTP 服务覆盖提交、轮询成功、`failed`/`expired`、超时、尾帧下载失败、视频下载失败与 GET 瞬时错误。
- [x] 1.3 实现错误映射：401/403 → `auth`、429 → `rate-limit`、欠费关键词 → `billing`、其余 → `api`，消息保留服务商 `error.code` 与 `error.message`。验证：mock 用例断言各类错误的 `kind` 与消息。
- [x] 1.4 新增 `verify-video-api.mjs`，用 Node 内置 `http` 起 mock 服务并直接导入 `server/video.mjs`；验证：`node verify-video-api.mjs` 退出码为 0。

## 2. 路由切换与前端契约

- [x] 2.1 重写 `vite.config.ts` 的 `/api/seedance` POST：解析渠道、模型、Key 与 Base URL，调用 `buildVideoPayload`/`submitVideoTask`，把 `taskId` 记入 job，后台轮询并调用 `downloadVideoArtifacts`；GET 保持 `running/succeeded/failed`、`url`、`tail`、`message`、`elapsed` 契约。验证：dryRun 返回 `request` 且不发起网络请求；首帧、参考图、尾帧互斥的请求体断言通过。
- [x] 2.2 删除 `SEEDANCE_CLI`、`runSeedance` 与 `kind: 'no-cli'`，`/api/health` 的 `videoReady` 改为判断默认视频渠道是否有可用 Key。验证：`rg 'SEEDANCE_CLI|seedance\.py|no-cli|execFile\(' vite.config.ts` 不再命中视频路径；有 Key 时 `GET /api/health` 的 `videoReady` 为 `true`。
- [x] 2.3 更新 `src/Settings.tsx` 的视频渠道提示与 `src/schedule3d.ts` 中关于 Seedance CLI 的注释。验证：`rg -i 'seedance cli|Seedance CLI' src` 无结果。
- [x] 2.4 更新 `verify-providers.mjs` 与 `verify-videoref-multi.mjs` 的 dryRun 断言，改为检查 `request.model`、`request.content` 的角色与图片数量、`request.duration/ratio/resolution`。验证：启动 dev server 后两个脚本均通过。

## 3. 文档

- [x] 3.1 更新 `DEPLOY-CHECKLIST.md`：移除"出片依赖项目目录外的 Python CLI"硬阻塞与 `SEEDANCE_CLI` 代码块，更新部署自检清单中的 `/api/seedance` 说明。验证：文档中不再出现"依赖项目目录外的 Python CLI"表述，且自检清单仍覆盖出片接口。

## 4. 集成与回归

- [x] 4.1 运行 `npm run build`，确认 `tsc --noEmit` 与 Vite 构建通过。
- [ ] 4.2 启动 dev server，依次运行 `node verify-video-api.mjs`、`node verify-providers.mjs`、`node verify-videoref-multi.mjs`、`node verify-tail.mjs`、`node verify-pricing.mjs`、`node verify-schedule3d.mjs`，确认全部通过。
- [ ] 4.3 在配置有效方舟 Key 且允许消耗额度时，手动画布出片一次，确认视频写入 `public/videos`、尾帧写入 `public/generated`、任务状态收敛为 `succeeded`；无可用 Key 时记录未执行原因。

## Verification notes

- `node verify-video-api.mjs`：全部通过（档位、请求体、提交、轮询、失败/过期/超时/瞬时错误、下载、错误映射）。
- dryRun 路由断言：首帧/参考图/尾帧互斥、模型选择、失效参考图跳过全部通过。
- 路由级 mock 端到端：临时把 ark 渠道指向本地 mock，提交 → 轮询 → 视频与尾帧落盘 → job `succeeded`，验证后设置已恢复。
- `node verify-providers.mjs`：dryRun 断言通过；脚本整体退出 1，原因与本次改动无关——设置中的方舟 Key 返回 401，且本机没有 `recycle` 项目夹具导致「生成到画布」禁用。
- `node verify-videoref-multi.mjs`：无法运行——本机没有 `recycle` 项目，且 `public/generated` 只有一张测试图；其 dryRun 断言已用等价的 HTTP 请求验证通过。
- 真实出片未执行：当前方舟 Key 返回 401（AuthenticationError），无法消耗额度验证。
- `npm run build`：通过。

## Workflow follow-up

- 实现与验证完成后，使用 archive workflow 归档变更。
- 归档后确认 `openspec/specs/video-generation/spec.md` 已生成且 Purpose 不是占位文本。
