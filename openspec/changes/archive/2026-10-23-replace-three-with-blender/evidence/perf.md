# Blender 渲染性能与资源观测

环境：macOS 26.7.1 / Apple Silicon，Blender 5.2.2 LTS，`--background --factory-startup`。

## 引擎实测（10 帧，含启动与编码）

| 引擎 | 320p | 540p | 1080p |
|---|---|---|---|
| Workbench | 101 ms/帧 | 121 ms/帧 | 181 ms/帧 |
| EEVEE | 383 ms/帧 | 221 ms/帧 | 442 ms/帧 |
| Cycles | 121 ms/帧 | 404 ms/帧 | 2547 ms/帧 |

原始数据：`evidence/blender-spike.json`。

## 整段渲染

| 场景 | 帧数 | 耗时 | 平均 |
|---|---|---|---|
| 6 秒 320p Workbench | 180 | 约 18 s | 约 100 ms/帧 |
| 4 秒 960×540 EEVEE（验收场景） | 120 | 25.6 s | 213 ms/帧（含 ffmpeg 编码与 4 张关键帧） |

## 帧精确性

- 6 秒 30fps：`ffprobe` 报 `nb_frames=180`、`duration=6.000000`。
- 2.4 秒抓帧与 MP4 第 2.4 秒帧的 SSIM：`0.998118`（JPEG 压缩差异）。
- 4 秒验收片：`nb_frames=120`、`duration=4.000000`。

## 并发与清理

- 并发上限 2：同时提交 3 个作业时，第 3 个为 `queued`，三个作业目录互不重叠。
- 取消：返回 `cancelled`，作业目录被删除，无新 mp4、无残留 Blender 进程。
- 崩溃（`build` 抛错）：作业状态 `error`，错误带 `[init]` 阶段，目录被清理。
- 渲染中 Blender RSS 约 **410 MB**（EEVEE 960×540）；并发 2 时约 820 MB，加 Node/浏览器仍在普通笔记本可接受范围。
- 所有测试结束后 `.blender-jobs/` 为空、`pgrep Blender` 为 0。

## 交互性

- 工作台打开时先渲代理片（15fps，3 秒镜头约 45 帧），期间显示逐帧进度；完成后时间轴可拖动。
- 已有生效视频直接当代理片，省掉一次整段渲染。
- 代理/试运行/定稿都走同一作业队列，界面在并发 2 作业时仍可操作（工作台回归期间同时存在代理与试运行作业）。
