# Tasks

## 1. 角色聊天打开时不预填图片

- [x] 1.1 在 `src/CharacterBoard.tsx` 删掉 `quickPicks`、为它发起的 `listMedia` 请求，以及因此不再使用的 import；`attachments.available` 改为返回空数组。上传、`pick`、`hint`、`limit` 保持不动。核对：该文件不再出现 `quickPicks` 或 `listMedia`，附件来源仍声明上传和从素材选择。
- [x] 1.2 改 `src/agent/projectAttachments.ts` 顶部说明：角色聊天同样不预填项目图片，选择器仍由角色板自己挂载，所以不并入 `projectImageAttachmentSource`。核对：注释里不再把「快捷缩略图来自项目图片清单」写成角色聊天的现状。
- [x] 1.3 改 `verify-character-chat-attachments.mjs`：打开角色聊天时 `[data-ca-pick]` 为 0，且项目里已有图、角色卡已有参考图时这些图不出现在附件条；加图改走聊天内的 `input[type=file]`，覆盖单张移除、全部清空、清空后再发送时请求不含该图；打开「从素材选」后取消，附件计数不变；点另一张角色卡不替换已添加的图。文件头注释改成同一语义。核对：`node verify-character-chat-attachments.mjs` 退出码为 0。

## 2. 统一输入区脚本改为用户添加

- [x] 2.1 改 `verify-unified-composer.mjs` 的角色聊天段：去掉「有可点候选」以及靠点击 `[data-ca-pick]` 加图、填满上限的步骤，改为用文件输入添加后再测只带附件发送、跨轮保留和清空。没有未选缩略图时，上限断言仍按「未选项数量为 0」通过。核对：`node verify-unified-composer.mjs` 退出码为 0。
