# Design

## Context

`onConnect` 仅处理 source=char|asset；target=shot|image asset。反向边不存在。

## Goals / Non-Goals

**Goals:** `sourceShotIds: string[]` 在 asset.data + `extra`；连接 UI：分镜为 source、字幕/音频卡为 target，或 Inspector 多选镜号（二选一，实现选 **target 卡存 ids**）。

**Non-Goals:** 改 shot.refIds 结构；图片 refIds。

## Decisions

1. **持久化**：挂在 **素材卡** `data.sourceShotIds`（镜头 canvas node id），与 `refIds` 正交。
2. **连线**：`onConnect` 当 `src=shot`、`tgt=asset` 且 `kind in (audio, subtitle)` → append `sourceShotIds` on target。
3. **派生边**：`refEdges` 增加 `ref-shot-*` 样式，区别于 `ref-` 参考图。
4. **音频 merge**：`buildAssetAudioPrompt({ prompt, shots, field })` 纯函数。
5. **字幕**：`resolveSubtitleSourceShots(nodes, card)` 读本集 shown shots。

## Risks / Trade-offs

- **[跨集 shot id]** → 仅允许连当前画布可见分镜节点。

## Migration Plan

旧卡 `sourceShotIds` 缺省为空数组。

## Open Questions

无。