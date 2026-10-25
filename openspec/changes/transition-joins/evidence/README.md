# 转场验收证据

日期：2026-10-24 · 环境：macOS · ffmpeg 9.0.2（带 `xfade` / libass）· dev server `127.0.0.1:5273`

## 效果转场（真实导出）

两个 3 秒镜头，标记转场后默认叠化 0.5 秒：

- 时间线 / 预览：`2 镜 · 5.5s`
- 成片：`real-export-dissolve-5.5s.mp4`（ffprobe `5.5s`）
- 截图：`transition-02-dissolve.png`

## 生成转场（真实关键帧 + 真实视频）

1. **关键帧**：`POST /api/seedream`，参考为两镜当前画面，耗时约 88s，产物 `real-keyframe.jpg`。
2. **转场视频**：`POST /api/seedance`，`mode: transition`，APIMart Seedance 2.5，请求 4 秒，耗时约 188s，产物 `real-transition-seedance25.mp4`（ffprobe `4.04s`）。
   - 请求形态：`first_frame = 关键帧`、`last_frame = 下一镜首帧`、不送参考图、`size = adaptive`。
3. **成片**：`3 + 4.04 + 3 − 0.4 = 9.6s`，产物 `real-export-generated-9.6s.mp4`（ffprobe `9.6s`）。
   - 片段自带音频不参与混音；成片只有视频流。
- UI 截图：`transition-03-panel.png`（面板）、`transition-04-generated.png`（生成后 chip 与时间线）。
- 失效截图：`transition-05b-stale.png`；导出提示 `1 条生成转场已失效`。
- 非相邻截图：`transition-07-inactive.png`（chip 标 inactive，时间线提示「1 条转场未参与」，总长保持 9.0s）。

## 真实生成发现并修掉的问题

1. **Seedance 2.5 首尾帧必须 `ratio=adaptive`**：显式 16:9 会被上游拒绝。已在 `server/apimart.mjs` 里对首/尾帧任务强制 `adaptive`，输出跟随首帧画幅。
2. **尾帧不能与 `reference_image` 混用**：上游明确拒绝 `last_frame + reference_image`。转场分支改为「关键帧作首帧 + 下一镜首帧作尾帧、不送参考图」，三家渠道统一；关键帧仍然承担角色/素材一致性。
3. **缺省 `trim` 被误当成 0.4 秒**：`buildAnimatic` 对没有 `trim` 的转场视频会裁到 0.4s，导致 9.6s 变成 6.0s。已改为「只有显式 trim 才裁」，并在 `verify-export.mjs` 加了无 trim 保留 4s 的回归断言。

## 环境限制

当前环境的方舟标准视频 Key 无效（`AuthenticationError - The API key doesn't exist`），所以真实视频走 APIMart Seedance 2.5。方舟转场请求体由 `verify-transitions-ui.mjs` 的 `dryRun` 覆盖：`first_frame = 关键帧`、无 `reference_image`。

## 复跑

```bash
node verify-transitions.mjs      # 纯函数 + 真实抽帧
node verify-transitions-ui.mjs   # UI + mock 关键帧/视频 + 三种 dryRun 请求体
node verify-export.mjs           # 6.0 / 5.5 / 9.6s 导出回归
```
