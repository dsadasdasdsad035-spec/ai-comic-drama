# Proposal

## Why

3D 调度视频参考和关键帧参考一旦勾上，在两种情况下会变成“关不掉”：调度视频已过期，或当前出片模型不支持 `videoRef`。用户只是想不再把这条 3D 视频当参考，却被要求先重新渲染、先换模型，或者根本没有入口。参考开关应该随时能关，因为关闭只是撤回本次出片的参考意图，不需要修改视频本身。

## What Changes

- 已开启的「用 3D 调度视频作参考」复选框始终可以取消，不受调度视频是否过期、当前模型是否支持 `videoRef` 影响；取消后立即保存到当前镜头，不需要重新渲染。
- 已开启的「带调度关键帧作参考」复选框同样始终可以取消，不受调度视频过期影响。
- 未开启时保持现有可用性判断：视频缺失、过期或模型不支持时仍禁用并显示原因，避免勾上一个不会被使用的参考。
- 取消参考只改 `useScheduleVideoRef` / `useScheduleFrames` 两个标记，保留 `scheduleVideo`、`scheduleMeta`、`scheduleFrames` 和视频文件；状态仍显示“已过期”，但不再阻止出片。
- 不改变参考请求结构、模型能力判定、过期规则或视频文件生命周期。

## Capabilities

### New Capabilities

无。本次只补充已有 3D 调度能力的参考开关行为。

### Modified Capabilities

- `scene-blocking-3d`: 新增“已开启的参考开关必须能随时取消”的要求；关闭参考不要求重渲，也不删除视频。

## Impact

- `src/Inspector.tsx`：两个参考复选框的 `disabled` 条件、勾选状态和提示文案。
- 现有 `verify-video-ref-ui.mjs` / `verify-schedule3d.mjs` 的参考开关覆盖；新增过期视频和模型不支持场景的验收。
- 不改 `generateVideoOne` 的请求拼装、`scheduleVideo` 数据字段或 `/api/save-video`。
