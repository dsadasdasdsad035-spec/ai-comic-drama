# Design

## Context

参见 `proposal.md` — Why。

上一版（`character-chat-image-reference`，已归档）把聊天附件做成了「当前角色的参考图」：

- `CharacterBoard` 有 `selectedCharId` / `selectedChar`，点卡片即选中
- `threadKey` 带 `charId` → 序列化进 `chat_threads.shot_id` 的 `char:<角色>` 槽位
- `attachments` 只在 `selectedChar` 存在时提供，`available()` 返回该角色的 `referenceImages`
- 上传走 `uploadImageFile` 后 `patch(selectedCharId, { referenceImages: refs })`
- `scope()` 显示「角色「陈默」」/「本集 · 未选角色」
- `CharacterCard` 有 `selected` / `onSelect`，配套 `is-current` 样式

这次要把定位改成「图是生成过程的输入」，因此上述五处都要拆掉；而以下六个模块**不需要改**，因为它们的契约本来就是通用的：

| 模块 | 为什么不用改 |
|---|---|
| `src/agent/chatAttachments.ts` | 只接受 `ChatAttachment[]`（key/label/url），不知道角色 |
| `workbench-chat-context` 主规格 6 条 | 写的是「附件清单是唯一来源」「发送前可见」「先经视觉理解」「无模型降级」「预计算时序」「每轮审计」，与图属于谁无关 |
| `src/agent/workbenchChatContext.tsx` | 只有 `onRenderTurnaround` 回调，不知道目标怎么定 |
| `src/agent/stageToolUis.tsx` | 回执按钮读 `subjects`（角色名），不读当前角色 |
| `src/agent/stageTools.ts` | `subjects` 透传 |
| `CharacterBoard.renderTurnaround` | 按 `names` 匹配 `liveRef.current` 里的角色，不依赖 `selectedCharId` |

最后一条是关键：出图目标从前就是按名字解析的，所以「不再按角色分会话」不影响它。

## Goals / Non-Goals

**Goals:**

- 角色聊天随时能加图，不依赖任何前置选择。
- 图只活在当轮对话里：不写角色、不进后续出图请求。
- 撤销「按角色分会话」与「当前角色」这两层，代码回到上一版之前的简单形态。
- 已有的通用能力（视觉理解、降级、缓存、审计、回执出图）原样复用，不重写。

**Non-Goals:**

- 会话级媒体池、附件历史、跨会话保留。
- 视频/音频附件。
- 跨项目选图。
- 改动 `chat_threads` 表结构。

## Decisions

### 决策 1：附件来源改成「上传 + 从项目选」，用 `pick` 回调接 MediaPicker

`WorkbenchAttachmentSource` 增加一个可选字段：

```ts
export type WorkbenchAttachmentSource = {
  available: () => { key: string; label: string; url: string }[]
  limit: number
  upload?: (file: File) => Promise<{ key: string; label: string; url: string }>
  /** 新增：从项目里挑一张；返回 null 表示用户取消 */
  pick?: () => Promise<{ key: string; label: string; url: string } | null>
  hint?: string
}
```

`CharacterBoard` 实现 `pick`：打开 `MediaPicker`（`currentKind: 'image'`），在 `onConfirm` 里把 `PickItem` 映射成附件条目并 `resolve`；`onClose` 时 `resolve(null)`。这样 `MediaPicker` 的六个页签（项目素材/生成图片/视频/音频/在线素材/手填）都能用，但角色聊天只需要图片——由 `CharacterBoard` 侧过滤（只接受 `mediaType === 'image'`）。

替代方案：在 `ChatAttachmentBar` 里内联一套缩略图选择器。否决理由——`MediaPicker` 已经处理了预览、坏图、确认语义、键盘与窄屏，再造一份是重复。

**代价**：`pick` 返回 Promise、需要管理「弹窗打开中的 resolver」这个瞬态。用一个 `useRef<((v) => void) | null>` 保存 resolver，避免 setState 竞态。

### 决策 2：`available()` 改为「项目里可用的图片」，不再是角色参考图

它的作用是让附件栏显示缩略图条。改动后返回当前项目可选的图片集合。为保证首屏不空、也不过量：

- 取项目媒体目录里的图片（`/api/media` 已有的 `images` + `assets` 里 kind 为 image/scene/prop 的项），按最近修改倒序，截前 N 张（建议 12）。
- 这份清单只用于**展示可选项**，真正的「从项目选」走 `MediaPicker`（它有完整来源分类）。

**为什么两套**：`available` 是「一眼能点的常用图」，`pick` 是「找全库」。只留 `available` 会限死选择范围；只留 `pick` 则附件栏变成空壳加一个按钮。两者都留，成本是 `CharacterBoard` 多读一次 `/api/media`——这个接口本来就在用。

### 决策 3：撤销 `charId` 分会话，但保留类型字段

- `CharacterBoard` 的 `threadKey` 回到 `{ project, surface: 'characters' }`
- `threads.ts` 的 `ChatThreadKey.charId` **保留**（不删），因为 `queryOf` 已经支持它，删掉会让其他调用方难以回退；只是角色聊天不再传。
- `SkillChat` 里的 `sourceSig` 原来用 `charId` 判断「附件来源换了」；现在没有来源概念了，改为**不再清空**——附件属于会话，切项目才清（`key` 变化时已有的重置逻辑会处理）。

**旧记录**：上一版写进 `shot_id` 的是 `char:<角色>`，新代码传空串，读的是 `shot_id=''` 那一行。旧记录变成读不到但不删除。**首次进入时提示一次**：

```
检测方式：localStorage 记住「已提示过」（per project），
或更简单——在 /api/chat-thread 的 GET 里加不了判断，所以放前端：
无法直接查「是否存在 char:* 记录」（没有列举接口）。
```

这里有个现实约束：**没有列举线程的接口**，前端无法知道是否存在旧记录。三个选择：

- A. 不做检测，直接不提示（旧记录静默消失）
- B. 无条件提示一次（可能对从没用过上一版的用户误报）
- C. 给 `/api/chat-thread` 加一个 `?probe=legacy` 查询（要改服务端）

选 **A**，但把这件事写进 README 的变更说明：上一版按角色分会话的记录不再显示。理由：这个版本只在本地开发过、尚未对外使用，为它加探测接口不划算；而 B 会对所有人报警，比不说更差。

**这条与 spec 里「必须提示一次」冲突** —— spec 写的是 `MUST 在首次进入角色聊天时提示一次`。按流程要么改 spec 实现，要么改 spec 文本。我选择**改 spec 文本**（在 tasks 里显式记录这个偏离并同步修正 delta），因为加探测接口超出本变更范围。

> 修正后的处理：spec 里那条场景改为「旧记录不再被读取，系统不静默加载其他角色的会话」——「不静默加载」是能保证的（代码不读那些键），「提示一次」去掉。

### 决策 4：移除「当前角色」UI，但保留 `renderTurnaround` 的名字解析

- `CharacterCard` 去 `selected` / `onSelect` 与 `is-current` 类名；`theme.css` 删两条规则。
- `renderTurnaround(names)` 不动：它按 `names.includes(c.name) || names.includes(c.id)` 找目标，回执的 `subjects` 由 `applyDraft` 给出（新增 + 覆盖的角色名），与选中无关。

**为什么不在卡片上留一个「当前」高亮**：附件已与角色无关，高亮会暗示「模型只看这个角色」，而这正是要消除的误解。

### 决策 5：出图 `refImages` 只取角色卡自己的参考图

`renderTurnaround` 现有实现就是 `const refs = c.referenceImages ?? []`，**已经是这个行为**，无需改动。要在验收里显式断言：聊天带过图时，出图请求的 `refImages` 不含那几张。

**为什么不做「一次性透传」**：用户确认「图是过程产物」，透传会把过程和资产混起来；刷新后用户的预期也会错（以为图还在）。

### 决策 6：`REFERENCE_LIMIT` 拆成两个常量

- `characters.ts` 的 `REFERENCE_LIMIT = 4`：**角色参考图**的上限（角色卡用）
- 聊天附件用独立常量（建议 `CHAT_ATTACHMENT_LIMIT = 4`，放在 `chatAttachments.ts`）

两者数值如今相同，但语义不同：一个是资产容量，一个是单轮上下文容量；将来任一方要调不受另一方牵制。

## Risks / Trade-offs

- **旧的分角色聊天记录静默消失** → 决策 3 选择不做探测；在 README 与变更说明里写清。风险是用户以为是 bug。
- **`pick` 的 Promise + 弹窗关闭竞态** → 用 ref 存 resolver，`onClose` 与 `onConfirm` 都只在存在时调用并清空；加验收断言「取消后附件不变、弹窗可再次打开」。
- **`available()` 与 `pick` 两套来源可能不一致** → `available` 只是快捷入口，最终以 `pick` 为准；在 hint 里写清「更多图片用从项目选」。
- **撤销选中态后，用户不知道回执出图给谁** → 回执的 `subjects` 已经点名（「新增 甲 / 覆盖 乙」），按钮旁边显示目标角色名，不依赖卡片高亮。
- **`charId` 字段留着但不用** → `threads.ts` 的注释要更新，避免读者以为它仍在用。

## Migration Plan

无数据迁移、无表结构变更。

行为变化：
- 角色聊天的会话键从 `char:<角色>` 回到空串 → 旧记录不可见（不删除）。
- 角色卡片不再有「当前角色」标记。
- 聊天附件不再写角色参考图。

回滚：`charId` 字段与 `queryOf` 的支持都还在，把 `threadKey` 改回带 `charId` 即可恢复按角色分会话；`referenceImages` 字段未被破坏。
