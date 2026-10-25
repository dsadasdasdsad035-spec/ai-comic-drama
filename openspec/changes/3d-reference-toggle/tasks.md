# Tasks

## 1. Inspector 参考开关

- [x] 1.1 视频参考复选框改为“已开启必可取消”：新增 `videoToggleAvailable` / `videoToggleEnabled`，`disabled={!videoToggleEnabled}`，label 的 `dim` class 跟随 `videoToggleEnabled`。验证：调度视频已过期但参考已勾选时，复选框可点击取消；未勾选且过期/模型不支持时仍禁用。
- [x] 1.2 视频参考 note 按“未生成 / 已开启可取消 / 模型不支持 / 先重渲 / 正常”分支显示；`title` 补充“已开启可随时取消”。验证：过期且已勾选时提示“取消不需要重渲”，不再是灰掉的“先重新渲染”。
- [x] 1.3 关键帧参考复选框同样改为“已开启必可取消”：`framesToggleEnabled = !videoRefOn && (useScheduleFrames || scheduleReady)`；保留 `videoRefOn` 时禁用/互斥。验证：过期且已勾选时可取消；视频参考开启时仍禁用。
- [x] 1.4 确认取消只走现有 `set`/patch 持久化，不修改 `scheduleVideo`、`scheduleMeta`、`scheduleFrames` 或视频文件；取消后项目里的 `use_schedule_video_ref` / `use_schedule_frames` 为 false。验证：点击后读 `/api/project`，两个标记为 false，视频 URL 不变。

## 2. 验收

- [x] 2.1 新增 `verify-reference-toggle.mjs`：覆盖过期视频已勾选可取消、过期关键帧已勾选可取消、模型不支持 `videoRef` 已勾选可取消、未勾选且不可用时禁用、新鲜视频 + 2.0 模型仍可正常勾选。验证：脚本通过。
- [x] 2.2 回归 `verify-video-ref-ui.mjs` 和 `verify-schedule3d.mjs`，确认参考开关、抽帧互斥和出片请求结构没有回归。验证：两个脚本通过。
- [x] 2.3 运行 `openspec validate 3d-reference-toggle` 和 `npm run build`。验证：命令返回 valid，构建通过。
- [x] 2.4 视觉检查 Inspector：已开启的开关不再呈灰色禁用状态，note/title 可读，窄屏无溢出；保存截图作为证据。验证：截图目视确认。

## Workflow follow-up

- Archive the change after the project's review requirements are satisfied.
- Verify the archived `scene-blocking-3d` spec contains the new reference-toggle requirement.
