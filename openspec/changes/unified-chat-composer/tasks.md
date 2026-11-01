# Tasks

## 1. 统一附件类型与输入区外壳

- [x] 1.1 把 `src/agent/chatAttachments.ts` 的 `ChatAttachment` 扩成带 `kind` 的联合类型（`image | video | doc | text`，新增可选 `text` / `bytes` / `manifestKey`），并让 `attachmentFingerprint` 按 kind 分组后再拼指纹；跑 `node verify-chat-attachments.mjs` 应全绿（该脚本断言"顺序无关""少一张就变""换视觉模型就变"，需同步给测试构造加 `kind`）
- [x] 1.2 让 `buildReferenceSheet` 先按 `kind === 'image'` 过滤，非图片附件不进拼板；在 `verify-chat-attachments.mjs` 补一条"视频附件不参与拼板"的断言并通过
- [x] 1.3 在 `src/agent/ChatThreadShell.tsx` 的 `ChatThreadBody` 上新增可选 `attachments` 槽位（items / kinds / onFiles / onPick / onRemove / onClear / busy / note / extra），把附件条渲染在 `ChatComposer` 内部、textarea 之前；不传该参数时渲染结果与改动前完全一致（用现有 `verify-workbench-chats.mjs` 跑通作为回归证据）
- [x] 1.4 把 `src/agent/ChatAttachmentBar.tsx` 改造成输入区内的条带：按 `kind` 渲染（图片缩略图 / 视频类型标记 / 文档文件名），保留 `data-ca-count`、`data-ca-pick`、`data-ca-upload`、`data-ca-clear` 等既有属性名，并提供 `extra` 槽位供 3D 的 `brief` 开关使用；用 `node verify-character-chat-attachments.mjs` 验证附件栏出现/加入/移除/清空四条断言仍通过
- [x] 1.5 把上传与素材入口搬到输入区工具栏（`+` 位置），两个按钮只在面声明对应入口时出现；在 `src/theme.css` 把 `.ca-*` 样式改到输入区条带并自测日/夜主题下不溢出

## 2. 工作台技能聊天：附件合并进用户消息 + 修两个行为缺陷

- [x] 2.1 在 `src/agent/SkillChat.tsx` 新增「本轮附件」文本块生成（图片走既有视觉摘要，text 项取正文），把它并入 `userForModel` 而不是技能模板输入；`referenceDigest` 保持原样。验证：`node verify-character-chat-attachments.mjs` 里"发送后技能输入里带参考图要点"那条仍通过，且非角色技能收到附件时 prompt 里出现该块
- [x] 2.2 拆开输入框与发送按钮的禁用条件：textarea 只看 `!loaded || !hostSkill || busy`，发送按钮额外看 `digestBusy`；理解中发送给出明确提示而非无反应。验证：在 `verify-character-chat-attachments.mjs` 增加一条"理解进行中 textarea 未禁用"的断言
- [x] 2.3 让 `onNew` 支持仅附件发送：无文字且有附件时补一句占位说明后照常发起本轮，无文字也无附件时保持不可发送。验证：新增/扩展脚本断言"只加图不输文字点发送会新增一条用户消息"
- [x] 2.4 统一附件文案与语义：把"本轮"改为"本次对话"，确认切项目/切集时仍清空（沿用现有 `sessionSig` effect）。验证：切集后附件条为空

## 3. 五个工作台适配器：声明类型与入口

- [x] 3.1 扩展 `src/agent/workbenchChat.ts` 的 `WorkbenchAttachmentSource`：增加 `kinds` 与可选 `persist` 说明；五个工作台适配器都声明 `kinds: ['image']` 且同时提供 `upload` 与 `pick`。验证：`node verify-workbench-chats.mjs` 通过
- [x] 3.2 去掉 `src/CharacterBoard.tsx` 素材选择回调里"选完才拒绝视频/音频"的分支——改为在选择器层只提供图片。验证：`node verify-character-chat-attachments.mjs` 通过，且手工从素材入口确认视频条目不可选
- [x] 3.3 `src/ScriptBoard.tsx`、`src/AssetBoard.tsx`、`src/ShotTable.tsx`、`src/PromptTable.tsx` 各自接上上传与素材入口，复用 `src/mediaUpload.ts` 的 `uploadImageFile` 与既有 `MediaPicker`；逐个打开该工作台聊天，确认输入区出现两个入口且上传后图出现在附件条

## 4. 3D 调度：同一外壳，内部持久语义不变

- [x] 4.1 把 `src/agent/SceneAgentChat.tsx` 的 `ChatContextTray` 并入 `ChatThreadBody` 的附件槽位，`manifest` 投影成 `ChatAttachment[]`（含 `manifestKey`），保留「查看将发送」与 `brief` 排除开关（走 `extra` 槽位）。验证：`node verify-shot-3d-chat.mjs` 与 `node verify-agent-chat-ui.mjs` 通过
- [x] 4.2 在 `src/SceneCodeWorkbench.tsx` 新增上传回调，严格按「`uploadImageFile` 落盘 → `listMedia` 刷新 media → `setContextSafe` 写 `imageUrls`」三步执行，三步不可拆。验证：上传一张图后立刻触发 `prepareAgent`，`prepared.assets` 里包含该图
- [x] 4.3 给 3D 面接上「从素材选」：用既有 `MediaPicker` 取图或视频，图片写 `imageUrls`、视频写 `videoUrls`。验证：选一个项目视频后 `context.videoUrls` 含它，且 `node verify-shot-3d-chat.mjs` 通过
- [x] 4.4 把 `removeAttachment` / `toggleBrief` / `clearAttachments` 接到新槽位的 `onRemove` / `extra` / `onClear`，确认移除与清空都会清掉 `preparedRef` 与 `preparedInfo`。验证：`node verify-3d-context.mjs` 与 `node verify-3d-freshness.mjs` 通过
- [x] 4.5 验证 3D 附件跨镜头隔离与刷新恢复：镜头 A 加图后切到镜头 B，B 不含该图；保存后重新打开 A，图仍在。验证：手工走一遍并在 `verify-3d-context.mjs` 补相应用例

## 5. 创意与发布接入

- [x] 5.1 把 `src/creative/CreativeComposerBar.tsx` 的上传与 URL 入口并入统一输入区工具栏，位置从输入框下方移到输入区；不新增「从素材选」（服务端 `assertPublicUrl` 会拒绝本地 URL）。验证：`node verify-creative-ui.mjs` 通过，且上传视频后会话出现源视频
- [x] 5.2 `src/publish/PublishChatPanel.tsx` 接入同一输入区外壳但不声明附件来源，确认不出现空附件条。验证：`node verify-publish-ui.mjs` 与 `node verify-publish-assistant.mjs` 通过

## 6. 验收脚本与文档同步

- [x] 6.1 更新依赖 `data-ca-*` 的验收脚本（`verify-chat-attachments.mjs`、`verify-character-chat-attachments.mjs`、`verify-workbench-chats.mjs`、`verify-agent-chat-ui.mjs`、`verify-shot-3d-chat.mjs`）中关于"附件栏位置"的断言，其余选择器保持可用。验证：这五个脚本逐个跑通
- [x] 6.2 新增 `verify-unified-composer.mjs`：自起临时库 + mock 模型，断言四个面输入区结构一致、仅附件可发送、切集清空、附件上限共享计数。验证：脚本自身退出码为 0
- [x] 6.3 更新 `docs/scene-agent-engine.md` 里 3D 聊天的附件说明，写明上传与素材选择写入 `shot_3d_context`。验证：文档中不再出现"聊天里没有上传入口"一类过时描述
- [x] 6.4 跑 `npm run build`（含 `tsc --noEmit`）确认类型收敛无残留，再跑 `node verify-all.mjs` 确认无回归

## Workflow follow-up

- 归档前先按项目习惯 `openspec sync specs`，再 archive 本变更。
- 切片 2（文档）与切片 3（视频上传、`/api/frames` 路径修复）另立变更，不在本变更内推进。
