# Design

## Context

见 proposal.md 的 Why。角色聊天的已选附件存在 `SkillChat` 的 `attachments` 状态里，打开时是空数组；单张移除和清空已经接到 `onRemove` / `onClear`。条上看起来删不掉的图来自另一路：`CharacterBoard` 用 `listMedia` 取出最多 12 张项目图片，经 `attachments.available` 画成未选中的缩略图。`ChatAttachmentBar` 只对已选列表提供 × 和「清空」。

另外四个工作台的 `available` 已经是空函数，图片只从上传和素材选择进入。角色聊天自己持有 `MediaPicker`、上传前缀 `chat-ref` 和提示文案，不走 `projectImageAttachmentSource`。

## Goals / Non-Goals

**Goals:**

- 角色聊天打开时附件条里没有预填图。
- 用户用现有的上传和「从素材选」添加图片，用现有的 × 和「清空」删除。
- 验收脚本不再依赖「一点候选就加入」。

**Non-Goals:**

- 不改 `ChatAttachmentBar` 的清空条件，不改 `SkillChat` 的附件状态。
- 不把角色聊天改接到 `projectImageAttachmentSource`。
- 不改角色卡参考图、出图 `refImages`、其他工作台和 3D 聊天。

## Decisions

### 决策 1：只清空候选来源，不改已选附件的增删

删掉 `CharacterBoard` 里为快捷缩略图准备的 `quickPicks`、`listMedia` 请求，以及只为它服务的 import。`attachments.available` 改为返回空数组。上传、`pick`、上限、提示文案保持原样。

已选图片的移除和清空留在 `SkillChat`：`onRemove` 按 key 过滤，`onClear` 把列表置空。候选不再铺出来之后，条上剩下的就都是用户加的，这两条路径就是删除。

不改用 `projectImageAttachmentSource`。那个辅助函数服务另外四个工作台，提示文案和选择器挂载点都不同。角色聊天只是不该再预填，没有必要并进去。

### 决策 2：验收改为用文件输入添加图片

`verify-character-chat-attachments.mjs` 和 `verify-unified-composer.mjs` 现在靠点击 `[data-ca-pick]` 把项目图加入角色聊天。候选去掉之后，打开时这个选择器数量应为 0。需要加图的步骤改走聊天里已有的 `input[type=file]`（角色附件脚本后半段已经这样上传）。「从素材选」的取消路径继续走现有的 `MediaPicker` 断言，不新开一条添加通道。

达到上限的检查保持「未选项被禁用，或已经没有未选项」。没有候选时，未选项数量是 0，现有断言可以成立，不必为了测上限再造一批缩略图。

## Risks / Trade-offs

- [两个验收脚本都靠候选缩略图加图] → 同一处改成文件上传，并先断言打开时 `[data-ca-pick]` 为 0。
- [空的 `available` 仍会渲染附件条，因为上传和选素材按钮还在] → 这是要的。规格要求的是没有预填图，不是拆掉附件条。
- [主规格仍写着聊天图写回角色参考图，而当前代码已经不写回] → 本变更的 delta 覆盖整条「角色聊天可选择参考图」，避免归档时把写回行为捡回来。实现不新增写回。

## Migration Plan

无数据迁移。附件不是项目字段。回滚时恢复 `quickPicks` 与 `listMedia` 请求即可，已选附件的增删不受影响。

## Open Questions

无。
