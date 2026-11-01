# Tasks

## 1. 清单泛化（先做，它是后面所有 UI 的地基）

- [x] 1.1 把 `src/contextManifest.ts` 的 `ContextManifest.shot` 泛化为 `scope: { title: string; shot?: {...原四个字段} }`，`buildManifest` 继续产出原 `shot` 结构并由调用方投影；同步改 `manifestSummary` / `manifestText` / `manifestCounts`。运行 `npx tsc --noEmit`，确认 3D 侧调用点全部收口。
- [x] 1.2 改 `src/chat-ui/ChatContextInspector.tsx`（`:40`）与 `ChatContextTray.tsx`，头部改读 `scope.title`；3D 侧构造时按原格式拼 `「E01 · 3.5s · 16:9」`，显示结果与改动前一致。运行 `node verify-chat-context-inspector.mjs`（若不存在则运行 3D 聊天相关脚本）确认无回归。
- [x] 1.3 确认 `chat-context-transparency` 未归档期间两边不冲突：`grep -rn "manifest.shot" src/` 应无残留直接读取。

## 2. 附件状态与视觉理解

- [x] 2.1 新建 `src/agent/chatAttachments.ts`：附件集合（`key/label/url`）、指纹（URL 集合 + 视觉模型键）、contact sheet 合成（复用 `mediaBrief.buildSheet` 的做法：1600×1200 / 4×4 / jpeg 0.84 / 每格写 `key — label`）、`askVision` 调用与 `ReferenceDigest` 归一化。新建 `verify-chat-attachments.mjs`，用 mock `askVision` 覆盖：单图、三图拼板只调一次、指纹相同命中缓存、空图降级、调用失败降级并带原因。
- [x] 2.2 在 `chatAttachments.ts` 加降级路径：无视觉模型 / 拼板为空 / 调用抛错三种情况都返回 `usedVision:false` + 原因，并产出可直接拼进提示词的「（未看图：原因）」文本。在 `verify-chat-attachments.mjs` 断言三种情况都不抛错、都能给出可读原因。
- [x] 2.3 在 `src/agent/SkillChat.tsx` 加附件状态与预计算：附件变化时触发 `prepareAttachments`，结果写 `preparedRef`；渲染期只读缓存，MUST NOT 在渲染中发起视觉请求。在 `verify-chat-attachments.mjs` 增加「同一附件多次渲染只调用一次视觉模型」的断言（可用调用计数）。

## 3. adapter 声明与角色接入

- [x] 3.1 在 `src/agent/workbenchChat.ts` 给 `WorkbenchChatAdapter` 加可选 `attachments?: { available; limit; onAdd? }`；未声明时 `SkillChat` 不渲染附件入口。运行 `npx tsc --noEmit`，确认其余四个工作台（剧本/素材/镜头表/提示词）界面无变化（`verify-workbench-chats.mjs`）。
- [x] 3.2 在 `src/CharacterBoard.tsx` 的 adapter 声明附件来源为该角色的 `referenceImages`（上限 4）、`onAdd` 走 `mediaUpload.uploadImageFile` 后写入 `referenceImages`；切换角色/项目时清空已选附件。在 `verify-workbench-chats.mjs` 或新增 `verify-character-chat-attachments.mjs` 断言：切角色不串图、满 4 张时拒绝并说明、上传后角色卡能看到该图。
- [x] 3.3 在 `inputs()` 里把 `ReferenceDigest` 作为一段文本输入（新增 input 键，如 `referenceDigest`），并在 `skills/character/SKILL.md` 写清「图片是外观主要依据、文字只补图上判断不出的部分、图与文字冲突以图为准」。在 `verify-skills-unit.mjs` 加断言：技能声明了新 input 且模板里用到它（否则会触发「输入未在模板中使用」的解析错误）。

## 4. 锚点写入与覆盖语义

- [x] 4.1 改 `src/charExtract.ts` 的 `mergeCharacters`：读 `raw.update === true` 时覆盖锚点（`lookCn/lookEn/palette/keywords`），其余情况维持「已有 lookEn 就跳过」；返回值增加 `updated: string[]` 区分「覆盖」与「补空」。在 `verify-charextract.mjs` 或新建段断言四种情况：新建、无 update 跳过、有 update 覆盖、覆盖后 `identityFingerprint` 变化。
- [x] 4.2 在 `skills/character/SKILL.md` 写清 `update` 规则：只有用户明确要求修改某个已有角色时才带 `"update": true`，新建或不确定时不带。在 `verify-skills-unit.mjs` 断言技能文本包含该字段说明。
- [x] 4.3 让 `CharacterBoard` 的 `applyDraft` 回执区分「新增 / 补空 / 覆盖 / 跳过」四类数量，覆盖时点名角色。在 UI 测试里断言回执文本包含被覆盖的角色名。

## 5. 出图确认入口

- [x] 5.1 在 `src/agent/workbenchChatContext.tsx` 加 `onRenderTurnaround?: (charNames: string[]) => Promise<void>` 与 `turnaroundCost?: number`；`SkillChat` 把这些从 props 透传给 Provider。运行 `npx tsc --noEmit`。
- [x] 5.2 在 `src/agent/stageToolUis.tsx` 的 `submit_characters` 回执里渲染「用它生成三视图 · ¥0.44」按钮（无 `onRenderTurnaround` 时不显示，无锚点时禁用并说明），点击后显示进行中与结果。在 `verify-character-chat-attachments.mjs` 断言：按钮出现、价格可见、点击前无生图请求。
- [x] 5.3 在 `src/CharacterBoard.tsx` 实现回调：复用 `CharacterCard` 的 `generateTurnaround` 逻辑（`look_en + TURNAROUND_SUFFIX`、`cap:'view'`、`n:2`、`refImages = referenceImages`），完成后写回 `image/candidates` 并 `onPersist`。在 `verify-character-chat-attachments.mjs` 用 mock `/api/seedream` 断言请求体：`cap:'view'`、`n:2`、`refImages` 等于该角色参考图、不夹带其他角色的图。

## 6. 集成与回归

- [x] 6.1 运行 `npx tsc --noEmit` 与 `npm run build`，修复类型问题。
- [x] 6.2 运行 `node verify-workbench-chats.mjs`、`node verify-chat-attachments.mjs`、`node verify-character-chat-attachments.mjs`、`node verify-character-reference.mjs`、`node verify-charextract.mjs`、`node verify-skills-unit.mjs`，确认全绿；3D 聊天相关脚本（`verify-chat-first-3d.mjs` 等）不因 `scope` 改名回归。
- [x] 6.3 端到端手工验证一条完整链路：给角色上传两张参考图 → 在角色聊天里选中 → 看到「正在理解」→ 发送 → 回执显示看图要点与新锚点 → 点「用它生成三视图」→ 请求带 `cap:'view'` 与两张参考图 → 候选写回。
- [x] 6.4 验证降级：清空视觉模型配置后重试 6.3 的第一段，确认消息可发、界面写明「未配置视觉模型，图片未参与理解」、出图入口仍可用。
- [x] 6.5 在 `README.md` 补一段「角色聊天看图写锚点」：图片从角色参考图来、上限 4 张、没配视觉模型时的行为、出图需手动确认与价格。
