# Design

## Context

参见 `proposal.md` — Why。当前实现约束（均从代码读出）：

- 两套聊天栈能力不对等：`SceneAgentChat`（3D）有 `ContextManifest`、`ChatContextTray`、`ChatContextInspector`、每轮审计卡；`SkillChat`（剧本/角色/素材/镜头表/提示词五个工作台）只有 `adapter.inputs()` 返回的三段纯文本，没有任何图片通道。
- `adapter.inputs()` 在 `SkillChat.tsx:382`、`:449` 被**渲染期同步调用**。视觉理解是异步的，不能塞进这条路径。
- `ContextManifest` 的 `shot: { id?, no, duration, aspect }` 是必填字段，托盘与检查器直接读 `manifest.shot.no / .duration / .aspect` 显示（`ChatContextInspector.tsx:40`）。角色聊天没有镜头概念。
- `/api/vision` 只接受单张 `data:image/(png|jpeg|webp);base64`，上限 4MB（`vite.config.ts` 的 vision 路由）。多图必须自己拼板。
- `mediaBrief.buildSheet` 已有可复用的参考板做法：1600×1200、4×4 网格、jpeg 0.84、每格左上角写 `key — label`。
- agent 工具集只有 `read_source/episodes/script/characters/designs/shots/episode` 与 `submit_*`，**没有任何生图工具**。模型无法自己出图。
- 回执卡已有按钮机制：`stageToolUis.tsx` 用 `WorkbenchChatContextValue.onSave` 渲染「保存草稿」按钮；`WorkbenchChatContextValue` 目前只有 `surface/saveMode/onSave/onRetry/running/dirty`。
- `mergeCharacters`（`charExtract.ts:63`）的规则：同名角色若 `old.lookEn` 非空则**整条跳过**，连 role/age 都不补。
- 覆盖 `lookEn` 会让表情总图自动失效（`sheetStale` 由 `fingerprint !== identityFingerprint` 判定），界面已有提示。
- `characters-v1` 契约的 item 是 `passthrough`，未知字段会被保留；`pickExtracted` 也会展开保留。
- `chat-context-transparency`（16/16 完成、**未归档**）为 3D 侧定义了上下文清单与审计；本变更复用同一份 `contextManifest.ts`，不另造清单结构。

## Goals / Non-Goals

**Goals:**

- 角色聊天能给模型看图，并据此写出可用的外观锚点。
- 附件在发送前完全可见、可移除；没有视觉模型时说清「没看图」而不是假装看过。
- 出图这件事仍然由人按按钮触发，且价格可见。
- 附件托盘、检查器、审计卡只维护一份实现，服务多个工作台。

**Non-Goals:**

- 聊天里不经确认直接出图。
- 视频/音频附件进入角色聊天（角色不需要）。
- 表情总图在聊天里生成。
- 跨项目引用参考图。
- 给 agent 增加生图工具（这会打开「模型自主花钱」的口子）。

## Decisions

### 决策 1：`ContextManifest.shot` 泛化为 `scope`，不新增第二套清单

```ts
// 现在（3D 专用）
shot: { id?: string; no: string; duration: number; aspect: string }

// 之后（通用）
scope: {
  title: string        // 「E01 · 3.5s · 16:9」或「角色「陈默」」
  /** 供需要结构化的消费方（3D 生成）继续取用；其他工作台留空 */
  shot?: { id?: string; no: string; duration: number; aspect: string }
}
```

替代方案：给角色聊天另写一套 `CharacterChatManifest` + 第二份托盘/检查器。否决理由——托盘、检查器、审计卡三处都要写两遍，以后每接一个工作台再写一遍；而差异只有「头部显示什么」。

**代价**：3D 那条已验证链路要跟着改名。`buildManifest` 仍产出 `shot`，由调用方投影成 `scope`；这样 3D 的消费代码改动最小，回归由 `verify-chat-context-*` 与 3D 相关脚本兜住。

### 决策 2：附件状态放在 `SkillChat`，不放进 adapter

`adapter` 保持「读输入、读草稿、合并草稿」四件事不变；附件选择是纯 UI 状态，放在 `SkillChat` 内部的 `useState`。但「附件能选什么」必须由 adapter 声明，否则 `SkillChat` 要去了解每个工作台的数据形状：

```ts
type WorkbenchChatAdapter = {
  // 现有
  inputs: () => SkillInputs
  // 新增（可选）
  attachments?: {
    /** 可供选择的图片：角色聊天返回该角色的 referenceImages */
    available: () => { key: string; label: string; url: string }[]
    /** 上限；角色聊天为 4 */
    limit: number
    /** 选图后是否允许写回宿主数据（角色聊天：写入 referenceImages） */
    onAdd?: (url: string) => Promise<void>
  }
}
```

只有声明了 `attachments` 的工作台显示附件入口；其余四个工作台界面零变化。

### 决策 3：视觉理解走「预计算 + 缓存 + 同步读」

```
附件变化 (+ 切换角色/项目)
        |
        v
  useEffect 触发 prepareAttachments()
        |
        +-- 拼 contact sheet（复用 buildSheet 的做法）
        +-- askVision(...)  -> 结构化外观要点
        +-- 写入 preparedRef.current = { fingerprint, brief, warnings }
        |
        v
  渲染期 adapter.inputs() 只读 preparedRef（同步，零网络）
        |
        v
  buildSkillPrompt 把 brief 当一段文本输入
```

指纹 = 附件 URL 集合 + 视觉模型键。与 3D 的 `ensurePrepared`（`SceneCodeWorkbench.tsx:491`）同一模式，避免每次渲染重复计费。

**降级**：无视觉模型 / 拼板为空 / 调用失败 → `preparedRef` 写入 `usedVision: false` 与原因，`inputs()` 多给一段「（未看图：原因）」文本，附件栏显示徽标。消息照常可发。

### 决策 4：看图产出的中间产物是「外观要点」，不是直接写锚点

视觉模型的输出不进最终上下文给角色技能当唯一依据，而是结构化的要点：

```ts
type ReferenceDigest = {
  usedVision: boolean
  items: { key: string; label: string; features: string[] }[]  // 逐图的可辨识特征
  conflicts?: string[]                                        // 图与文字不一致处
  note?: string
}
```

角色技能拿到「剧本场次 + 分镜摘要 + 参考图要点」，自己决定怎么写 `look_cn/look_en`。这样「看图」与「写锚点」职责分开：视觉模型只描述，角色技能才创作，与既有 skill 分层一致。

替代方案：让视觉模型直接输出 `characters-v1` 契约。否决理由——视觉模型的输出稳定性远低于文本模型，直接产契约会频繁触发校验失败；而「描述特征」这种任务它有把握得多。

### 决策 5：覆盖语义用模型声明 `update`，不改契约

`characters-v1` 的 item 是 `passthrough`，未知字段保留，`pickExtracted` 也保留。所以：

```json
{ "characters": [ { "name": "陈默", "look_en": "...", "update": true } ] }
```

`mergeCharacters` 增加分支：`raw.update === true` 时覆盖锚点（而不是整条跳过），并把名字记进 `updated` 列表供回执展示。

替代方案 A：给 `CharacterSheet` 加 `handEdited`。否决理由——制造死角：用户手写过锚点、这次明确带图要求改，却被系统拦住说「已保留手改」。镜头的 handEdited 是防「模型重新生成覆盖」，而这里用户是显式要求改。

替代方案 B：聊天路径一律覆盖。否决理由——用户只想新建角色时，同名旧角色的锚点会被误伤。

**技能提示词必须写清**：只有用户明确要求修改某个已有角色时才带 `update`；新建或不确定时不带。

### 决策 6：出图按钮挂在回执卡，走 `WorkbenchChatContext`

```ts
type WorkbenchChatContextValue = {
  // 现有
  surface, saveMode, onSave?, onRetry?, running, dirty?
  // 新增
  onRenderTurnaround?: (charNames: string[]) => Promise<void>
  turnaroundCost?: number   // 用于按钮显示价格
}
```

回执卡（`stageToolUis.tsx`）在 `submit_characters` 且 `onRenderTurnaround` 存在时，渲染「用它生成三视图 · ¥0.44」；点击调用并显示进行中状态。`CharacterBoard` 传入的回调直接复用 `CharacterCard` 已有的 `generateTurnaround` 逻辑（`prompt = look_en + TURNAROUND_SUFFIX`、`cap:'view'`、`n:2`、`refImages = referenceImages`）。

**为什么不让 agent 调生图**：agent 工具集里没有、也不该有花钱操作。这条与 3D 那边「视频已生成，需人工验收」一致。

### 决策 6b：角色聊天按「当前角色」分会话（实现时发现的 spec 缺口）

原 spec 说「该角色的参考图」「用它生成三视图」，但角色板是**整板一个聊天**、没有当前角色概念（只有 `selectedShot`）。这决定了三件事的落点，必须补一条决策：

- 点角色卡即选中：`CharacterBoard` 增加 `selectedCharId`，卡片有选中态。
- `threadKey` 增加 `charId`：每个角色一条聊天记录，与「镜头表按集分会话」的既有模式一致。
- 附件来源 = 该角色的 `referenceImages`；出图目标 = 该角色。

替代方案 B（整板一个会话、靠消息点名）否决理由：附件无法确定归属（哪张图属于谁），出图目标还要模型从自然语言里解析角色名，失败无声。替代方案 C（附件取全板所有角色的图、出图按模型给的角色名）否决理由：同名角色有歧义，且图缺少归属标签时无法写出正确的 `referenceImages`。

**会话键怎么落（已与用户确认：复用 shot_id 槽位）**：

服务端 `chat_threads` 的主键是 `(project, surface, episode, shot_id)`，没有 `char_id` 列。给表加列在 SQLite 里要重建整表（改主键），风险是丢历史聊天记录。所以角色聊天的 `charId` **序列化到 `shot_id` 槽位**，写成 `char:<角色id>`：

```
角色「陈默」→ (project, 'characters', 0, 'char:陈默')
3D 场景    → (project, 'scene3d', 0, '<真实 shotId>')   ← 不受影响
```

理由：`shot_id` 在这张表里只是主键的字符串分量，没有任何代码假设它必须是镜头 id（`threadKey()` 只做 trim 与截断）；而 `episode` 列早已一列多用（角色聊天存集号、3D 存 0）。零迁移意味着不丢历史记录。

**代价**：一列两用，语义靠前缀 `char:` 区分。若将来需要「角色 + 镜头」二维会话，得重新设计这张表。已在 Risks 里记为已知限制。

**旧记录**：之前的角色聊天记录挂在 `shot_id=''` 上，按角色分会话后不再被读取。不做自动迁移（无法可靠推断一段对话属于哪个角色）；旧行留在表里不删。

### 决策 7：聊天上传的图写入 `referenceImages`（已与用户确认）

- 单一真相源：角色卡的参考图列表就是全部参考图，不区分来源。
- 第二段出图必须能拿到原图当 `refImages`；若只存临时附件，刷新后路线 C 的后半段就断了。
- 上限 4 张是既有约束；聊天上传走同一个 `mediaUpload.uploadImageFile`，超限时给明确拒绝。

**代价**：4 张额度会被聊天用掉。缓解：选择器里明确显示「已用 N/4」，并提供「替换」而非只有「追加」的路径（替换是既有能力，删除再传）。

## Risks / Trade-offs

- **改 `ContextManifest` 波及 3D 已验证链路** → 用「`buildManifest` 仍产出 `shot`，调用方投影成 `scope`」把改动收在边界；3D 相关脚本作为回归门。
- **视觉调用成本** → 预计算 + 指纹缓存，同一附件集合只调一次；面板显示「正在理解」避免重复触发。
- **参考板 4MB 上限** → 复用 `buildSheet` 的 1600×1200 jpeg 0.84，实测单张约 300-600KB，远低于上限；超限时降级为「不拼板，逐张」是不行的（接口只收单张），所以只能降级为「不看图」并说明。
- **模型不带 `update` 却用户想改** → 回执里显示「跳过已有角色：X」，用户看得到再补一句明确要求即可，不需要新机制。
- **模型误带 `update` 覆盖了不该改的角色** → 覆盖会在回执点名；表情总图自动标失效，界面可见。不做二次确认（用户已明确要求改时才该带）。
- **聊天与角色卡两处同时编辑** → 两者共享 `characters` 状态（`CharacterBoard` 的 `onReplace`），附件选择本身不写数据，只有上传才写，冲突面很小。
- **`chat-context-transparency` 未归档** → 本变更与它共用 `contextManifest.ts`。若先归档它、再实现本变更，`shot → scope` 的改名会落在它归档后的主规格上；已在本变更的 specs 增量里独立声明 `workbench-chat-context` 新能力，避免依赖未归档 delta。

## Migration Plan

无数据迁移。旧项目没有聊天附件记录（附件是会话内状态），不需要写项目字段。

行为变化对既有功能的影响：3D 场景聊天的上下文清单、检查器、审计卡内容不变，只是类型字段从 `shot` 改为 `scope`（显示文案由 `scope.title` 提供，构造时按原格式拼好）。

回滚：撤掉 `SkillChat` 的附件状态与角色 adapter 的 `attachments` 声明即可；`scope` 泛化可保留（向后兼容）。

## Open Questions

（无。三个关键决策已与用户确认：用户确认后出图、图写入 `referenceImages`、模型 `update:true` 才覆盖。）
