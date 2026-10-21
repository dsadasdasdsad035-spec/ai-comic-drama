# Proposal

## Why

画布出片目前通过 `execFile` 启动项目目录外的 Python CLI（`~/.workbuddy/skills/seedance-video-generation/seedance.py`）来完成。这使能力绑定在开发机环境上、无法随项目部署，同时只能靠解析 stdout 判断结果，任务状态和错误信息都不可靠。该 CLI 本身只是方舟视频任务 API 的薄封装，因此可以直接改为 HTTP 调用，去掉这层进程依赖。

## What Changes

- `/api/seedance` 提交路径改为直接调用方舟 `contents/generations/tasks`，不再启动 Python 或其他子进程。
- 服务端保存返回的任务 id，后台定时轮询状态；成功后下载视频到 `public/videos`、尾帧到 `public/generated`，失败、过期或超时则以可读错误结束任务。
- 首帧、尾帧与参考图由服务端统一转为 data URL 提交；保留参考图 1~4 张上限、`last_frame` 与 `reference_image` 互斥的既有规则。
- 提交前按所选模型的档位校验时长与分辨率；不支持的值返回明确提示，而不是把服务商原始 400 直接透给画布。
- `/api/health` 的 `videoReady` 改为表示"有可用的视频渠道 Key"，设置页与部署清单删除 CLI 相关表述。
- 前端 `/api/seedance` POST/GET 契约、画布出片按钮、任务卡片与计价逻辑保持不变。
- **BREAKING**（仅内部调试契约）：`dryRun` 的响应从 CLI `args` 改为实际将提交的 API `request`，依赖该字段的验证脚本同步调整。
- 不包含：更换视频服务商、修改出片交互、调整计价规则、任务跨 dev server 重启恢复。

## Capabilities

### New Capabilities

- `video-generation`: 画布镜头通过视频服务商 HTTP API 提交出片任务、轮询状态，并把视频与尾帧落到本地可访问路径的行为。

### Modified Capabilities

无。

## Impact

- 代码：`vite.config.ts` 的 `/api/seedance` 路由与 `/api/health`，删除 `SEEDANCE_CLI`、`runSeedance` 及相关参数拼接；`src/Settings.tsx` 的视频渠道提示。
- 验证：`verify-providers.mjs`、`verify-videoref-multi.mjs` 中针对 CLI `args` 的 `dryRun` 断言；`DEPLOY-CHECKLIST.md` 的第 3 项硬阻塞与自检清单。
- 运行时：不再依赖 Python 与项目目录外的脚本；继续使用 Node 内置 `fetch`。
- 外部服务：方舟视频任务 API；成功响应中的视频与尾帧是限时 URL，必须在任务完成时立即下载。
- 数据：产物仍写入 `public/videos` 与 `public/generated`，项目数据与 SQLite 结构不变。
