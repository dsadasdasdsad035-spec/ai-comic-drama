# Tasks

## 1. 撤销按角色分会话与当前角色

- [x] 1.1 在 `src/CharacterBoard.tsx` 去掉 `selectedCharId` / `selectedChar` 状态；`threadKey` 回到 `{ project: projectName, surface: 'characters' }`；`scope()` 回到 `'本集'`。运行 `npx tsc --noEmit`，确认无残留引用。
- [x] 1.2 在 `src/CharacterCard.tsx` 去掉 `selected` / `onSelect` props、`data-current` 与 `is-current` 类名；在 `CharacterBoard` 的卡片渲染里去掉这两个 prop。运行 `node verify-character-card-ui.mjs`，确认 8 格表情、主操作映射等既有断言不受影响（该脚本里有针对参考图区的断言，保留）。
- [x] 1.3 在 `src/theme.css` 删 `.char-card.is-current` 两条规则（含 `::after` 徽标）。运行 `node audit-ui.mjs`（若可用）或 `npm run build`，确认无遗留样式引用。
- [x] 1.4 更新 `src/agent/threads.ts` 中 `charId` 字段的注释：说明字段保留但角色聊天已不再使用，避免读者误解。运行 `npx tsc --noEmit`。

## 2. 附件来源改为「上传 + 从项目选」

- [x] 2.1 在 `src/agent/workbenchChat.ts` 的 `WorkbenchAttachmentSource` 增加可选 `pick?: () => Promise<{ key: string; label: string; url: string } | null>`，并更新 `hint` 的语义说明（不再指「某个角色的参考图」）。运行 `npx tsc --noEmit`。
- [x] 2.2 在 `src/agent/ChatAttachmentBar.tsx` 增加「从项目选」按钮（仅当 `onPick` 存在时显示），点击调用父级传入的 `onPick`；保留上传与清空。在 `verify-character-chat-attachments.mjs` 增加断言：未选角色时附件栏仍可见、含上传与「从项目选」两个入口。
- [x] 2.3 在 `src/CharacterBoard.tsx` 用 `MediaPicker` 实现 `pick`：用 `useRef` 保存 resolver，`onConfirm` 映射 `PickItem` 为附件条目（只接受 `mediaType === 'image'`，其他类型提示不支持），`onClose` 时 `resolve(null)`。在 `verify-character-chat-attachments.mjs` 断言：选中图片后进入附件栏；取消后附件不变且能再次打开。
- [x] 2.4 在 `src/CharacterBoard.tsx` 把 `attachments.available()` 改为当前项目可用的图片（项目媒体图片 + 素材库里 image/scene/prop 的项，按修改时间倒序，截前 12 张），并始终提供 `attachments`（不再以 `selectedChar` 为条件）。在 `verify-character-chat-attachments.mjs` 断言：无角色选中时 `available()` 仍返回条目。
- [x] 2.5 移除上传写回角色参考图的逻辑：`attachments.upload` 只调 `uploadImageFile` 并返回条目，不再 `patch(...referenceImages...)`。在 `verify-character-chat-attachments.mjs` 断言：聊天上传后该角色的 `reference_images` 未变化。

## 3. 常量拆分与来源文案

- [x] 3.1 在 `src/agent/chatAttachments.ts` 增加 `CHAT_ATTACHMENT_LIMIT = 4`；`CharacterBoard` 的 `attachments.limit` 改用它，不再复用 `characters.REFERENCE_LIMIT`。在 `verify-chat-attachments.mjs` 断言该常量存在且为 4。
- [x] 3.2 在 `src/agent/SkillChat.tsx` 去掉用 `threadKey.charId` 判断「附件来源变化」的逻辑（附件属于会话，切角色不再清空）；确认切项目仍会重置（既有 `key` 变化路径）。在 `verify-character-chat-attachments.mjs` 断言：切换选中角色后附件保持。

## 4. 出图不吃聊天附件

- [x] 4.1 确认 `CharacterBoard.renderTurnaround` 的 `refImages` 只取 `c.referenceImages`（不改代码，只加断言）：在 `verify-character-chat-attachments.mjs` 里，聊天带两张图产出角色后点出图，断言请求 `refImages` **不包含**聊天用过的图。
- [x] 4.2 补充断言：角色卡本身有参考图时，出图使用它们；角色卡无参考图时，即使聊天带过图也传空/不传 `refImages`。

## 5. 集成与回归

- [x] 5.1 运行 `npx tsc --noEmit` 与 `npm run build`，修复类型问题。
- [x] 5.2 运行 `node verify-character-chat-attachments.mjs`（按本变更重写后的断言）、`node verify-chat-attachments.mjs`、`node verify-character-reference.mjs`、`node verify-workbench-chats.mjs`、`node verify-character-card-ui.mjs`，确认全绿。
- [x] 5.3 端到端手工验证：不选任何角色打开聊天 → 上传一张图 → 看到「已理解 1 张」→ 发送 → 回执给出角色与「用它生成三视图」→ 点出图，请求里 `refImages` 不含刚上传的图；再验证「从项目选」能挑到项目里的图、取消不改变附件。
- [x] 5.4 在 `README.md` 的「角色聊天看图写锚点」一节改写：图是过程输入（不写入角色、不进后续出图）、来源是上传或从项目选、不需要先选角色；并说明上一版按角色分会话的聊天记录不再显示。

## 6. 规格一致性（本变更含一处对 spec 的自我修正）

- [x] 6.1 已在本变更的 delta 里修正「旧的分角色会话不再出现」：去掉「提示一次」，因为当前没有列举聊天线程的接口，前端无法判断旧记录是否存在。实现时确认代码行为与该表述一致（不读取 `char:*` 键），不要额外加探测接口。
