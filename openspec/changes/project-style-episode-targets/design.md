# Design

## Context

见 `proposal.md`。当前实现：`ProjectData.style` / `aspect` 存在但画风常在 `ScriptBoard` 编辑；`ShotTable` 用本地 `target`（默认 60）与 `inputs()` 内 `|| '近未来科幻写实'`；`ScriptBoard` 用本地 `targetSeconds`（默认 75）且不随 `patchProject` 持久化；`ProjectEpisode` 无 `targetSeconds`。`mergeScriptDraft` 整集 `{ ...ep }` 替换会抹掉未出现在 incoming 上的字段。

## Goals / Non-Goals

**Goals:**

- 单一 resolver：`resolveProjectStyle(project)`、`resolveEpisodeTarget(episodes, epNo)`（缺失字段用内存默认 60，不写盘）。
- 项目制作参数 UI 写入 `style` / `aspect`；Agent 与各 Board 只读。
- `episodes[].targetSeconds` 持久化；剧本分集 UI + 镜头表顶栏双写同一字段；镜头表保存路径须能更新 `episodes`（不只 `shots`）。
- `mergeScriptDraft`：合并 incoming 集时保留 current 的 `targetSeconds` 若 incoming 未带。
- 更新 script / shotlist 技能与 golden tests；移除分散 fallback 常量。

**Non-Goals:**

- 分集级画风 override。
- 项目级 `targetSeconds` 默认（用户明确每集不同）。
- 自动根据已有镜头秒数之和 backfill 全项目（可选后续）。
- 修改 `shots-v1` 镜头 JSON 形状。

## Decisions

### D1. 制作参数 UI 放在项目管理对话框

在 `ProjectManagerDialog`（或编辑当前项目侧栏）增加「画风」「画幅」字段，调用 `patchProject`。理由：用户要求「项目设置」；设置页偏全局引擎，项目管理已绑定具体项目。备选：剧本顶栏保留画风 → 拒绝，违背唯一权威。

### D2. `productionContext.ts`

集中：

```text
resolveProjectStyle(project) → string | null（trim 后空为 null）
requireProjectStyle(project) → string 或 throw/Result 供 SkillChat 阻止发送
resolveEpisodeTarget(episodes, epNo) → number（ep.targetSeconds ?? DEFAULT_EPISODE_TARGET_SECONDS）
DEFAULT_EPISODE_TARGET_SECONDS = 60
```

所有 adapter 的 `inputs()` 调用此处，删除六处 `近未来科幻写实`。

### D3. 镜头表保存分集时长

`ShotTable` 改 target 时：`setEpisodes` 更新当前集 + `setDirty`；`save` 时除 `mergeProjectShots` 外 MUST `patchProject({ episodes })`（或扩展 merge API 一次提交）。备选：仅剧本页可改时长 → 拒绝，用户要求两处可改。

### D4. script 技能输入

- 保留 `targetSeconds` 输入键供 **拆集节奏参考**（可选：取当前选中集或各集均值）；任务文案改为强调输出 JSON 每集 `targetSeconds`。
- `script-v1` 的 episode passthrough 已允许未知键；SKILL 示例增加 `"targetSeconds": 60`。
- 内置「生成分集」宿主 inline 仍可传顶栏「参考时长」或去掉顶栏后传 DEFAULT / 用户对话——**移除顶栏后**改为技能任务内说明「按场次体量每集填写 targetSeconds」。

### D5. mergeScriptDraft 保留时长

```text
byNo.set(no, {
  ...currentEp,
  ...incomingEp,
  no,
  targetSeconds: incomingEp.targetSeconds ?? currentEp?.targetSeconds,
})
```

（incoming 显式 null 是否清除：不支持，仅 undefined 保留。）

### D6. 画风空值策略

SkillChat `run()` 在 `buildSkillPrompt` 前调用 `requireProjectStyle`；script 工作台若仅改分集、画风仍空，同样阻止。新建项目 MAY 在 `createProject` init 留空，首次 Agent 前必须填。

## Risks / Trade-offs

- **[Risk] 镜头表 save 双请求 shots + episodes** → 尽量单次 patch 或顺序提交，失败时 toast 明确哪一部分失败。
- **[Risk] script 顶栏去掉时长后拆集模型不填每集字段** → SKILL 示例 + 契约说明；合并保留手改值。
- **[Risk] 老 verify 硬编码画风** → 测试 fixture 写 `project.style`。
- **[Trade-off] DEFAULT 60 vs 历史 75** →  spec 定 60 为缺失占位，与当前镜头表默认一致。

## Migration Plan

1. 部署后老项目：无 `targetSeconds` → UI 显示 60，不自动写 JSON。
2. 用户打开项目制作参数补画风（若空则 Agent 不可用直到填写）。
3. 无回滚 schema 要求；若需 revert 代码，多余 JSON 字段可忽略。

## Open Questions

- 项目制作参数是否需要在「新建项目」对话框收集画风（减少首次 Agent 阻断）——实现时可加可选字段，不阻塞本 change。
