# Design

## Context

见 `proposal.md`。创意 `CreativeStudio` 已调用 `buildPiAgentSystem` + `runStageAgent`，但仍有 `MODE_SKILL` effect 覆盖手选、system extras 含模式与会话 id，且无 `WorkbenchInspector`。工作台 `SkillChat` 已实现 Pi 版「查看将发送」（`task` 为空、system 即 Pi 引导）。

## Goals / Non-Goals

**Goals:**

- 单一 `buildCreativeTurnPayload()`（命名可微调）输出 system / userForModel / toolNames，供 `run()` 与检查器共用。
- `CreativeHeader` 增加 inspect 开关；检查器展示 system、合成 user（含 composer 草稿 ref）、tools；可复制片段。
- 解耦 `mode` 与 `hostSkillId`：引入 `skillLockedByUser` 或比较「当前 id 是否仍等于上次模式默认」决定是否跟随 Tab。
- `buildCreativePiSystem(host)` 极简版：等价于 `buildPiAgentSystem(host, [], [])` 或抽 `CREATIVE_PI_EXTRAS = []` 常量，禁止再传 mode/session。

**Non-Goals:**

- 不把 SKILL 正文预灌进 system 或检查器 task 区。
- 不把历史从 `threadTranscript` 改为 Pi 原生多轮 message 数组（后续若 token 不够另开变更）。
- 不改创意工具实现、媒体摄取、成本确认对话框。
- 不恢复五个工作台 SkillChat。

## Decisions

### D1. 复用 WorkbenchInspector 形状，扩展 creative user 预览

**决定**：定义 `CreativeTaskView`（或在 `WorkbenchTaskView` 上复用 `task` 字段存合成 user 预览），`profile` 用静态 `CREATIVE_PROFILE`（title=创意工作室，saveMode 可标 `immediate` 或省略保存语义）。

**备选**：全新 `CreativeInspector` 组件 — 否决，重复 tabs/复制逻辑。

### D2. 草稿来源

**决定**：检查器订阅 `CreativeComposerBar` 受控 value（提升 state 到 `CreativeStudio` 或 ref `draftTextRef`），预览时 `userForModel = assembleUser(draft, messages)`。

**备选**：仅预览已发送轮次 — 不满足「发送前看见本轮将发什么」。

### D3. 模式与技能解耦

**决定**：

- 删除 unconditional `useEffect(() => setHostSkillId(MODE_SKILL[mode]), [mode])`。
- 新建会话：`hostSkillId = MODE_SKILL[mode]`。
- `changeMode`：仅当 `!skillFollowsMode` 时跳过改 skill；`skillFollowsMode` 默认 true，用户改下拉时置 false；下拉旁可选「跟随模式」checkbox 恢复 true。

**备选**：完全去掉 MODE_SKILL — 否决，新用户仍需要模式默认。

### D4. System 极简

**决定**：创意专用 `buildCreativePiSystem(host: Skill): string` 调用 `buildPiAgentSystem(host, [], [])`；只读技能不传入 readonlySkills 参数（工具绑定仍在 `bindCreativeTools`）。

**备选**：只读名单留在 system — 与「切换技能不要塞别的」冲突。

## Risks / Trade-offs

- **[Risk] 历史摘要丢工具参数** → 检查器标注「历史为摘要，非完整 tool JSON」；与 `threadTranscript` 行为一致。
- **[Risk] 换技能后助手口吻混杂** → 规范层接受；UI 可在换技能时 toast 提示，不进 system。
- **[Risk] 预览/真发分叉** → 单元测试或 verify 脚本对同一 fixture 断言字节级一致。

## Migration Plan

纯前端发布；无数据迁移。上线后旧会话 thread 仍兼容。若用户习惯「切 Tab 即换技能」，需在 UI 提供「跟随模式」说明。

## Open Questions

- 是否在检查器增加「预估 token」仅基于字符数（与工作台一致）— 实现阶段默认可做。
- `followMode` 是否持久化到 session 行 — 默认可选会话级 state，不持久化。
