# Proposal

## Why

上一版把角色聊天的图定位成「角色的资产」：必须先选角色，附件来源限定为该角色的参考图，上传还要写回 `character.referenceImages`。但图在角色聊天里真正的作用是**生成过程的输入**——你看几张照片，让模型照着写出外观锚点，角色留下的是文字，图本身用完就该丢。定位错了，就生出了三个本不该存在的门槛：必须先选角色、只能选该角色已挂的图、上传会污染角色资产。

## What Changes

- 角色聊天附件改为**过程输入**：任意时刻可加图，MUST NOT 要求先选中角色。
- 附件来源有两个入口：**上传本地图片**、**从项目里已有的图片中选**（项目素材 / 生成图片）。
- 聊天里的附件 MUST NOT 写入角色的 `referenceImages`；角色参考图仍是角色卡上的独立能力，两者互不影响。
- **BREAKING**（相对上一版）：撤销「按角色分会话」。`threadKey` 不再传 `charId`，角色聊天回到整板一个会话；不传 `scope` 的角色名，回到「本集」。
- **BREAKING**（相对上一版）：移除「点角色卡设为当前角色」的选择语义。卡片不再有 `is-current` 高亮，聊天与卡片选择无关。
- 生成三视图的出图入口保留，但 `refImages` **只取角色卡自己的参考图**（通常为空，即纯文字锚点出图）。当轮聊天用过的图 MUST NOT 被带进出图请求。
- 旧数据：上一版按角色分出来的聊天记录（挂在 `char:<角色>` 键上）不再被读取；MUST 在首次进入角色聊天时提示一次，不静默假装记录还在。
- 不做：会话级媒体池、附件长期保存、跨项目选图、视频/音频附件。

## Capabilities

### New Capabilities

（无。附件清单、发送前可见、视觉理解、降级、预计算时序、审计这六条通用契约已由 `workbench-chat-context` 覆盖，本变更不修改它们。）

### Modified Capabilities

- `character-appearance`: 改写「角色聊天可选择参考图」——附件属于本轮对话而不是某个角色，来源包含上传与项目内选图，不要求先选角色，且 MUST NOT 写入角色参考图列表；同时撤销「切换角色不串图」这条（不再有当前角色）。

## Impact

- 前端：`src/CharacterBoard.tsx`（去 `selectedCharId`/`selectedChar`、`threadKey` 去 `charId`、`scope` 回「本集」、附件来源改为通用、上传不再写回角色）、`src/CharacterCard.tsx`（去 `selected`/`onSelect` 与 `is-current`）、`src/theme.css`（删两条 `is-current` 规则）、`src/agent/SkillChat.tsx`（来源签名改用别的方式、来源文案）、`src/agent/ChatAttachmentBar.tsx`（加「从项目选」入口）、`src/agent/workbenchChat.ts`（`WorkbenchAttachmentSource` 加可选 `pick`）。
- 复用：`src/MediaPicker.tsx` 作为「从项目选」的弹窗；`src/mediaUpload.ts` 负责上传落盘。
- 不变：`src/agent/chatAttachments.ts`（视觉理解/缓存/降级）、`src/agent/workbenchChatContext.tsx`、`src/agent/stageToolUis.tsx`（回执按钮）、`src/agent/stageTools.ts`（`subjects` 透传）、`CharacterBoard.renderTurnaround`（本来就按名字定位，不依赖选中角色）。
- 数据：不新增字段；`chat_threads` 表结构不动（`charId` 字段留在类型里向后兼容，只是角色聊天不再传）。角色 `referenceImages` 字段继续由角色卡维护。
- 规格：仅 `character-appearance` 的 MODIFIED 增量；`workbench-chat-context` 无需改动。
