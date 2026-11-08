# Proposal

## Why

画布「生成图片」与 Inspector「生成视频」在心智上应是两条产线，但出图结果落在分镜 `refImage` 后会被视频拼装器无开关地当作「图1 当前画面」提交，与「连线即参考」的素材模型冲突，也容易把静帧构图与视频参考绑死。用户希望出图产物进入项目媒体库，由人工建素材卡并连线后再参与出片。

## What Changes

- 画布/Inspector **生成图片**成功后，图片 MUST 落入当前项目媒体目录，并出现在素材选择器的「生成图片」类目中；**MUST NOT** 自动创建画布素材卡或写入 `refIds`（用户选定方案 2）。
- 分镜 MAY 继续保留 `refImage` / 候选作**镜上预览与出图迭代**（构图、标注、多参考出图），但该字段 **MUST NOT** 自动进入视频 `reference_image` 或首帧兜底。
- 视频出片附件清单 **ONLY** 来自：`refIds` 解析（角色、场景/道具/图片素材、相邻镜 token、手工附加）+ 可选表情 + 视频素材连线 + 原生音色；blocking 文案改为「连线不足」而非「先出画面」。
- **BREAKING**：无连线时，仅凭已有 `refImage` 不能再满足出片条件；旧项目出片请求体与附件清单会与改动前不同（除非用户已连线等价素材）。
- 相邻镜参考仍通过显式 token 取邻镜静帧 URL，但不因本镜 `refImage` 自动占视频 slot。
- 文档与验收：更新 README 优先级叙述；补充/调整 `verify-video-ref*` 与 Inspector 面板断言。

## Capabilities

### New Capabilities

- `shot-still-image`：分镜静帧生成（画布/Inspector 出图）的落盘、媒体索引与预览字段语义，与视频参考解耦。

### Modified Capabilities

- `shot-video-prompt`：出片附件来源、模式判定、blocking 与面板文案；移除隐式「当前画面」默认项。
- `character-appearance`：分镜出图参考集合说明与出片附件清单中「当前画面」的表述，与静帧预览/连线参考对齐。

## Impact

- 前端：`src/videoPrompt.ts`、`src/shotReferences.ts`、`src/App.tsx`（`generateOne`）、`src/Inspector.tsx`、README。
- 数据：不新增 DB 字段；`refImage` 语义收窄为预览/出图输入。
- 兼容：`shot-video-prompt` 中「无手改时保持现有请求兼容」场景需修订或增加显式 BREAKING 说明。
- 验收：`verify-video-ref-api.mjs`、`verify-shot-inspector.mjs`、相关 neighbor/ref 脚本。
