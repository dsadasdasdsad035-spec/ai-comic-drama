# Proposal

## Why

效果转场仅有叠化/擦除/推移三种 FFmpeg 映射，无法满足「黑场、径向、闪白」等常见节奏型衔接；生成转场虽有字段级衔接句，但缺少基于镜头跨度与用户意图的 **策略选择** 和 **可命名的动效语言**（如电影食谱库中的 Transitions/Camera 卡片）。用户希望 **C：同一迭代** 扩展 xfade 预设，并让 Agent 在选中的两镜连线上给出更丰富的效果或生成方案（可选引用外部 shot 食谱 id），经确认后写入 `transitionOut`。

## What Changes

- 扩展 `TransitionEffect`：在保留 `dissolve|wipe|slide` 的前提下，增加 **预设 id**（映射到 FFmpeg `xfade` 的 `transition` 名），面板分组展示约 15 个常用预设；导出与预览沿用现有接缝折叠。
- 可选 **轻量食谱索引**（首期可内置 JSON，结构兼容 [video-shotcraft](https://github.com/Vincentwei1021/video-shotcraft) 卡片 id/摘要；不 bundled Remotion 运行时）。
- **转场 Agent 建议**：在转场面板（或等价画布上下文）提供「智能建议」：读 source/target 两镜与当前 `transitionOut`，输出推荐 `mode`、效果预设或生成 prompt/sound/食谱引用；用户 **确认应用** 后才 patch，不自动提交 Seedance。
- **不** 在本变更内实现 Remotion 渲染短片、不安装完整 shotcraft 仓库为运行时依赖。

## Capabilities

### New Capabilities

- `shot-transition-effect-presets`: 效果转场预设目录、UI、xfade 映射与持久化兼容。
- `shot-transition-agent`: 两镜连线上的 Agent 转场建议与应用契约。

### Modified Capabilities

- `shot-transition-continuity`: Agent 应用建议时 MUST 不覆盖用户已存在的 `videoPromptOverride`；自动衔接段与 Agent 写入的生成 prompt 分工在 design 中定义。

## Impact

- `src/types.ts`、`src/transition.ts`（`xfadeName` / `normalizeEffect`）
- `src/TransitionPanel.tsx`、`src/theme.css`
- 导出：`vite.config.ts` xfade 折叠（验证新 transition 名）
- 新增：`src/transitionPresets.ts`（或同类）、`src/transitionAgent.ts`、可选 `public/transition-recipes/` 索引
- Agent：`src/agent/` 新工具或转场面板直连 `/api/...` 建议接口
- 测试：扩展 `verify-transitions.mjs`；可选 `verify-transitions-ui.mjs`
