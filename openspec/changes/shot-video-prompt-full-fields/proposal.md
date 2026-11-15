# Proposal

## Why

画布右侧 Inspector 里有一批用户可编辑、但出片时不会进入正文的字段：景别/运镜、台词、表演强度/动作/视线/本镜说话、逐行台词表演（语速/音量/重音）、原生音频声音段、参考图槽位映射与参考视频范围约束。用户把这些都填了，模型却收不到，导致「调了没用」。

同时，用户只能看到「本次出片提示词」，不确定最终发给 Seedance 的是不是这段文字、发给哪个模型、服务端有没有再改写。

## What Changes

- **自动正文补齐右侧字段**：语义层（`video_prompt` / `prompt`）和脚本拼装两条路径统一追加方向性指令块：`【运镜】`、`【台词】`、`【表演方向】`、`声音：`、参考图 `@图像N` / `[图N]` 槽位、参考视频 `@视频1` 范围约束、`【约束】`。已存在的块不重复追加。
- **手改正文保持逐字发送**：`video_prompt_override` 仍不追加任何自动段落。
- **提交目标可见**：出片面板显示「提交给 <模型> · 渠道 · 模式 · 秒数 · 分辨率 · 画幅」，正文下方声明逐字提交；服务端在任务记录里回报实际使用的 `prompt`，成功后写入 `video_meta.prompt`。
- **预览与请求继续逐字一致**：参考视频范围约束由前端拼进正文，服务端只在正文缺少 `@视频1` 时兜底追加（服务端不再改写前端已拼好的正文）。

不做：

- 不改 `video_prompt_rendered` 的优先级（仍不参与自动正文）。
- 不把手改正文改成「再追加自动段」。
- 不改参考图的收集规则与额度。

## Capabilities

### Modified Capabilities

- `shot-video-prompt`：自动正文覆盖右侧全部语义字段、提交目标可见、服务端回报实际正文。

## Impact

- **前端**：`src/performance.ts`、`src/videoPrompt.ts`、`src/promptRender.ts`、`src/Inspector.tsx`、`src/OutgoingVideoPromptPanel.tsx`、`src/api.ts`、`src/App.tsx`、`src/theme.css`。
- **服务端**：`server/app.ts`（视频任务记录与响应带 `prompt`，范围约束统一兜底）。
- **验收**：`verify-prompt-render.mjs`、`verify-video-prompt-preview.mjs`、`tests/performance-video-prompt.ts`。
