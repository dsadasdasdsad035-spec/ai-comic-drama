# Design

## Context

见 proposal.md。自动转场正文由 `autoTransitionVideoPrompt` 拼出：用户短提示或默认句，再加 morph/keyframe 尾句和声音段。镜头上已有 `size`、`move`，表演侧可能有 `shotSize` / `cameraHint`。手改走 `videoPromptOverride`，`effectiveTransitionVideoPrompt` 已优先返回手改。

## Goals / Non-Goals

**Goals:**

- 在自动正文里插入一段只使用已有字段的衔接句。
- 缺字段就跳过，不调用模型补写。

**Non-Goals:**

- 不运行 Video Shotcraft 或 video-editing 技能。
- 不改首尾帧附件、秒数、取消生成、效果转场导出。
- 不把 3D 调度相机坐标翻译成电影机位术语。

## Decisions

1. **规则写在拼装函数里，不接外部技能。** 衔接句是确定性模板。替代方案是运行时调用技能生成整段提示词，会和手改、预览逐字一致冲突。
2. **字段优先级。** 景别用表演 `shotSize`，否则用镜头 `size`。运镜用镜头 `move`；`cameraHint` 仅在有 height/angle 时附一句机位高度或角度。动作落点用两镜已有视频提示词或画面提示词的截断摘要，沿用现有约 90 字截断，不新增摘要模型。
3. **插入位置。** 放在基础句之后、morph/keyframe 尾句之前，这样尾句仍声明「这是过渡片段」。手改分支不调用这段拼装。
4. **不写入指纹新字段。** 衔接句由镜头字段推导；这些字段若已进入转场指纹则过期提示沿用现逻辑。实现时核对 `transitionFingerprint`，缺了再把 `size`/`move`/`shotSize` 补进指纹。这是核对项，不是新产品行为。

## Risks / Trade-offs

- [提示词变长，模型忽略尾部约束] → 衔接段保持三句以内，放在尾句之前而不是文末。
- [旧项目空景别被当成「未知」写进正文] → 空字符串视为缺失并省略。

## Migration Plan

纯客户端拼装。回滚即恢复原 `autoTransitionVideoPrompt` 文案。已保存的手改正文不变。

## Open Questions

无。
