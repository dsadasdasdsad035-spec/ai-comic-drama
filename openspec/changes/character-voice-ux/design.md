# Design

## Context

见 `proposal.md`。`CharacterCard` 当前 `char-voice-pane` 为纵向 `gap:8px`：配音模型 `CapModelSelect`、音色 select、样本区 mini 按钮 + 原生 `<audio>`，警告与 `gen-error` 穿插。`voiceProviderMismatch` 禁用生成但换模型时会覆盖 `voiceProvider` 导致偶发「可点但 API 失败」。Explore 结论：用户心智分 **引擎 / 音色 / 试音** 与 **镜头配音（Inspector）** 两层。

## Goals / Non-Goals

**Goals:**

- 一块屏内完成「配好这个角色的声线 + 出试音」；阻塞原因与下一步动作 ≤1 条主信息。
- 换引擎后的默认路径：重选音色；与 spec 渠道校验一致。
- 视觉与 Inspector `voice-box` 同族，降低学习成本。
- 窄卡片（角色 grid）可折叠 status strip，不撑高整板。

**Non-Goals:**

- 角色页台词 TTS、上传 mp3 替代试音（可后续 change）。
- 重做设置页音色库 UI。
- 改 `/api/voice` 或样本时长规则。

## Decisions

### 1. 组件结构

```text
char-voice-pane
  char-voice-status     (strip: chip + optional action button)
  char-voice-block[data-block=engine]
  char-voice-block[data-block=voice]
  char-voice-block[data-block=sample]  (gen-box 同族)
  char-voice-footnote  (画布 Inspector 分工)
```

新增纯函数 `resolveVoiceUiState(character, settings, projectName, voices, sampleMeta) -> { kind, message, primaryAction? }`，供 strip 与 disabled 逻辑共用，避免 JSX 里重复条件。

**替代方案**：多个独立 warn div — 维持现状；放弃。

### 2. Status strip 优先级（高到低）

1. 无项目  
2. 引擎无音色列表（voices.length===0）  
3. `voiceProviderMismatch`  
4. 未选 voiceId（含「跟随镜头」对试音视为未选）  
5. 样本 stale  
6. 样本已生成但不可用（时长）  
7. 就绪（无样本 / 样本可用）

Strip 上 **最多一个** primary action（如「重选音色」「生成试音」「打开设置」）。

### 3. 换配音模型（`setAudioModel` 行为调整）

- 拉取新目录后，若当前 `voiceId` 不在新 `voices` 列表（且非用户显式保留的旧值路径）：  
  - 默认：`voiceId` 清空，`voiceSample` 标 stale（若有）。  
  - 弹出 inline 确认条（非 modal 优先）：「引擎已切换，请重新选择音色」+ 聚焦音色 select。  
- **不再**在渠道变化时仅改 `voiceProvider` 而保留跨渠道 `voiceId` 且不禁用生成。

保留「未知/保留原值」option 给高级用户，但 strip 显示警告且生成前二次确认。

### 4. Tab 与 summary

- Tab 标签：`声音`（`data-char-tab=voice` 不变）。  
- `char-summary` 一行：`声音：{engineShort} · {voiceLabel} · 试音 {status}`。  
- Tab 按钮可选 `data-voice-ready=ok|warn|none` 用于 CSS 圆点。

### 5. 试音稿

- C 区显示 `sampleText` 前两行 truncate + 「编辑」→ 现有 drawer 字段。  
- Primary：`生成试音`（原「生成音色样本」文案统一）。

### 6. 样式

- 复用 `--warn` / `--ok` token；`.char-voice-block` 带 `legend` 式小标题。  
- 播放器放在 C 区卡片内顶部，按钮在下方，错误贴 C 区底部。

## Risks / Trade-offs

- **[Risk] 换模型清空音色惊扰老用户** → inline 说明 + 撤销需重选（不自动 undo 写盘）。  
- **[Risk] strip 逻辑集中后需单测** → `resolveVoiceUiState` 纯函数 + 小 ts 测试或扩 verify 脚本。  
- **[Risk] Tab 改名「声音」与旧文档「音色」** → README 一句别名说明。

## Migration Plan

纯 UI/交互；项目数据无迁移。发布后直接可用；旧 stale 样本仍按现有 fingerprint 规则。

## Open Questions

- 是否在 C 区展示试音估算费用（若 `audioCost` 可得）— **首版不做**，与三视图 primary 计价策略一致再议。
