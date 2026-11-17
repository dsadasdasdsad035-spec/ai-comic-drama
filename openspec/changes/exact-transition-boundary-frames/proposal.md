# Proposal: exact-transition-boundary-frames

## Why

转场生成的结构锚点是「上一镜成片尾帧 + 下一镜成片首帧」，只有落在**真正的末帧与首帧**上才具备连续性参考价值。实测当前实现并非如此：`/api/frames` 对负时间走 `ffmpeg -sseof -0.1 -i <video> -frames:v 1`，语义是「跳到片尾前 100ms 再解第一帧」，落到的是倒数第 1~3 帧。用帧序号编码的合成片实测：

| 源片 | 当前命令取到的帧 | 真末帧 |
|---|---|---|
| 30fps / 60 帧 / GOP=250 | 第 57 帧 | 59 |
| 24fps / 29 帧 / GOP=250 | 第 27 帧 | 28 |

首帧侧（`-ss 0`）实测就是第 0 帧，本身准确。也就是说偏差只在尾侧，但偏差幅度随帧率与关键帧间隔漂移，无法用「调小 `-0.1`」修掉（实测 `-sseof -0.03` 在 24fps/1.2s 片上会直接越界失败，抽帧整帧丢失）。

另一个反向问题：如果上一镜以淡出黑场收尾，真末帧本身就是纯黑——它是「真帧」但对转场毫无参考价值，而当前链路对此零反馈，用户只会拿到一张黑图当首锚点。

## What Changes

- 尾帧抽取改为「解码到片尾、逐帧覆盖写同一文件」，取到的必然是解码器输出的最后一帧；不再依赖 `-sseof` 窗口大小与关键帧分布。首帧抽取保持现状。
- `/api/frames` 在返回 `urls` 之外返回每帧的亮度统计（`YAVG`），抽帧失败的帧不参与统计。
- 「抽取两镜成片帧」在拿到首/尾帧后判定近黑（亮度低于阈值），以**非阻断**方式提示该侧接近黑场、连续性参考可能失效；帧本身照常写入槽位（真帧优先，不静默替换、不静默回退）。
- 修正 `ensureTransitionBoundary` 中「首帧/尾帧」写反的两条 missing-video 文案。

非 **BREAKING**：`/api/frames` 只新增返回字段，`extractFrames` 签名不变；边界帧的来源类别、可选语义、输入模式降级链、生成时不重抽边界等既有行为全部不变。不做 B 档（边界帧与 `videoUrl` 版本绑定/强制重抽）与 C 档（出片后自动重抽），重出片后的过期边界仍只由既有 stale 指纹提示覆盖。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `shot-transition-video-prompt`：收紧「结构锚点可见且可校正」与「抽取两镜成片帧」——尾帧 MUST 是解码输出的最后一帧（MUST NOT 是接近片尾的任意一帧），首帧 MUST 是第 0 帧；新增「边界帧近黑提示」要求（真帧照用、只提示不拦截）。

## Impact

- `server/app.ts`：`/api/frames` 负时间分支去掉 `-frames:v 1`、改 `-update 1`，正时间分支不变；新增逐帧亮度探测（`ffProbe` + `signalstats`）并随响应返回。
- `src/api.ts`：`extractFrames` 返回结构补亮度字段（可选，缺省不影响既有调用方）。
- `src/transitionGen.ts`：`videoFrames` 透传亮度；`ensureTransitionBoundary` 增加近黑判定与提示文案，修正两条写反的 warning；`TAIL_FRAME_SSEOF_SEC` 语义改为「解码窗口起点」并更新注释。
- `src/TransitionPanel.tsx`：`extractError` 之外新增非阻断提示通道，抽取成功但边界近黑时仍展示提示。
- 测试：新增静态/接口验收脚本（真末帧帧号、24fps 与 30fps 两种帧率、近黑提示、无成片文案），复用 `verify-lib.mjs` 约定。
