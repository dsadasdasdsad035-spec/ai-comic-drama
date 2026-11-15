# Proposal

## Why

画布上的参考连线（角色卡 / 素材卡 / 相邻镜）只在**画布按钮生成**时生效：`App.tsx` 走 `collectShotReferences` 与 `buildShotVideoRequest` 把连线解析成参考图、参考视频与提示词正文。但 Pi Agent 的生成工具是另一条路——`generate_keyframe` 只发 `prompt`，`generate_clip` 只发 `image`。

于是出现断裂：用户让 Agent 先 `link_shot_refs` 连上角色，画布上连线也显示出来了，Agent 再 `generate_keyframe` 出图时参考线**完全没有送出去**，首帧全是凭空生成的；出片更是只吃一张首帧，相邻镜、素材、表情参考全部丢失。用户看到的是「线连上了，图还是不像」。

## What Changes

- **画布上下文只读通道**：`BuiltinPlatformCtx` / `MaterialToolDeps` 新增 `getCanvasContext`，由宿主注入当前画布节点、角色表与坏链集合；另有 `getSelectedVideoModel` / `getVideoResolution` 让 Agent 出片沿用画布当前选中的模型与分辨率。
- **首帧出图复用共享解析器**：`generate_keyframe` 改为 `collectShotReferences` + `limitReferences(10)`，把角色外观、素材图、表情参考作为 `refImages` 送出，并在 prompt 追加「参考图说明」；与画布 `refMode=false` 时的行为一致。
- **出片复用统一拼装**：`generate_clip` 改为 `buildShotVideoRequest` + `effectiveVideoPrompt`，按 `mode`（native / video / ref / 首帧）映射 `refImages`、`refVideos`、`audioRef`、`cameraFixed`、`resolution`，正文优先级与画布一致。
- **参考解析失败 fail-loud**：`collectShotReferences` 增 `strict` 选项。strict 下显式 `char-` / `char-miss-` / `asset-` token 解析不出来（角色无三视图、角色已不在库、素材卡不在画布、素材非图片）记入 `missing`；生成工具据此**在花钱之前**直接报错并给出下一步。画布不传 strict，行为不变。
- **无画布时降级**：创意工作室未挂载画布时，用 `buildShotNodes([], project.shots)` + 项目快照角色还原节点；`asset-` token 因画布节点只在运行时存在，strict 下会明确报「素材卡不在画布上」而不是静默丢弃。
- **测试**：`tests/platform-generate-tools.ts` 断言参考图真的进了请求体、strict 缺失在成本确认后不发请求。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `shot-still-image`：新增「Agent 出首帧与画布共用参考解析」。
- `shot-video-prompt`：新增「Agent 出片与画布共用统一拼装」。

## Impact

- **前端**：`src/agent/builtinPlatformTools.ts`、`src/shotReferences.ts`、`src/creative/CreativeStudio.tsx`、`src/App.tsx`。
- **不变**：`shot.refIds` 持久化格式、画布 `refMode` 交互、生成工具仍不创建素材卡、仍不改连线。
- **不做**：Agent 出首帧不启用 `refMode`（用旧首帧当构图参考）；`refMode` 目前是画布全局开关，Agent 侧暂不暴露。
