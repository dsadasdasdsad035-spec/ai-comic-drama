# Proposal

## Why

镜头表与 Inspector 的「表演」已与 `performance` / `dialogue_delivery` 持久化，并用于配音、表情参考图与提示词技能生成的 `video_prompt`，但画布出片的自动拼装（`buildShotVideoRequest`）**不会**把表演写进最终 Seedance 正文。用户容易误以为「参考视频 / 出片」会带上表演；实际上 `reference_video` 只承载运动，表演应在**提示词正文**里可见且与请求一致。

## What Changes

- 在视频出片自动拼装中增加 **【表演方向】** 段落：由当前镜头的 `performance` 与说话相关的 `dialogue_delivery` 生成，与 Inspector / 镜头表同源。
- 出片提示词面板摘要标明表演是否已并入自动正文；手改快照指纹纳入表演变化，表演改动后标记「旧快照」。
- **不**改变 `reference_video` 来源与语义（仍仅为连线视频素材）；**不**把表演编码进 MP4。
- 当镜头 **没有任何表演条目** 时，无手改情况下的请求正文与附件与改动前保持逐字一致（兼容旧回归）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `shot-video-prompt`：自动拼装正文须包含表演段落（有数据时）；指纹与面板摘要；兼容条款限定为「空表演」镜头。

## Impact

- `src/videoPrompt.ts`（拼装与指纹）、`src/performance.ts` 或邻近纯函数（表演→视频文案）
- `src/Inspector.tsx`（VideoPromptPanel 摘要）
- 测试：`verify-video-prompt-preview.mjs`、`tests/` 单元测试；更新含 performance 的 fixture 期望
