# Design

## Context

见 `proposal.md - Why`。实施前需要先看清三条现有约束，设计都绕不开它们：

1. **写入只有一个收口**：平台工具的 `submit_*` 与创意会话的工作台 adapter 都调用 `src/platform/projectDraft.ts` 的 `applyProjectDraft(contractId, payload, ctx)`，再经 `patchProject` / `mergeProjectShots` 落库。新增写能力只应加契约分支，不应另开写入通道。
2. **镜头合并有两套语义**：`mergeShotsDraft` 的 `replace` 模式（生成用，保持 AI 输出全集）与 `merge` 模式（导入用，按镜号只改出现的行、且只写白名单字段）。后者是当前「agent 改镜头丢字段」的直接原因。
3. **工具名有四处副本**：`src/skills/tools.ts` 的 `KNOWN_TOOL_IDS`、`src/agent/builtinPlatformTools.ts` 的 `builtinPlatformToolNames()`、`src/creative/expertToolGroups.ts` 的分组与默认白名单、以及各场景实际 `defineTool` 的注册点。四处没有一致性校验，`submit_prompt_renders` 已经漂移。

当前 agent 可写字段（`src/shotSync.ts:100-109`）只有 `no / seconds / size / move / desc / dialogue / keyframe_prompt / video_prompt / scene_no / scene_slug`。

## Goals / Non-Goals

**Goals**

- 让「文本类镜头字段」与「产线产物字段」有明确的写入归属：前者归 agent，后者只归生成工具与画布 UI。
- 让剧本与项目元信息成为可写资源，而不是只能生成文本让用户手工粘贴。
- 让工具清单与注册在装载期就一致，幽灵工具无法再出现。

**Non-Goals**

- 不做 `run_builtin` / `run_api` 这类通用桥；不模拟 UI 点击。
- 不提供设置页写工具（API Key、渠道、路由、音色）。
- 不恢复已下线的五个工作台聊天与改稿 Modal，也不清理它们的死代码。
- 不改画布布局：节点坐标本就不落库，由 `buildShotNodes` 自动排版。

## Decisions

### 1. 项目元信息挂在 `read_source` 上，不新增读工具

`scriptData()` 已经取了 `logline / style / aspect`，只是 `read_source` 没回。直接扩返回并把描述改成「原著与项目设定」。

- 理由：剧本与分镜技能本来就会调 `read_source`，扩返回等于零成本让它们拿到画风与画幅；新增 `read_project_meta` 会让每个技能多一次往返，还要同步四处工具名副本。
- 替代（否决）：新增独立读工具——语义更纯，但收益小于扩散成本。

### 2. `submit_episodes` 复用 `script-v1`，合并走 `mergeScriptDraft`

`src/skills/contracts.ts` 的 `script-v1` 已被剧本导入与 intake 使用，`src/agent/drafts.ts` 的 `mergeScriptDraft` 已实现「按集号新增/更新，保留未出现的集」。

- `applyProjectDraft` 新增 `script-v1` 分支：`mergeScriptDraft(current, incoming, 'merge')` → `patchProject({ episodes })`。
- 顶层 `logline` 一并写回（契约本来就有该字段）。
- 理由：两套剧本 schema 必然漂移；导入与 agent 用同一契约，校验与合并只有一份。
- 替代（否决）：新增 `episodes-v1`——与 `script-v1` 内容重复，`validate_contract` 会同时认识两个近义契约。

### 3. 项目创建与元信息写：两个工具 + 强制确认 + 不自行切项目

- `create_project({ name, title?, style?, aspect? })`：先按 `NAME_RE`（`/^[a-zA-Z0-9_-]{1,40}$/`）校验，再 `createProject`。同名已存在时 API 已失败，工具原样透出错误。
- `update_project_meta({ title?, logline?, style?, aspect? })`：新增 `project-meta-v1` 契约，走 `patchProject`。
- 服务端只做一处增量：`POST /api/project` 接受 `title` 并映射到库里的 `title` 列（既有列映射本来就是这个方向），不新增端点。`ProjectPatch` 相应增加可选 `title`。
- 画幅枚举收口到 `src/project/aspect.ts`，界面下拉、契约与工具共用一份，避免「Agent 能写一个界面选不到的画幅」。
- **工具不切换全局项目**：`create_project` 只返回 `{ name }`，切项目由宿主 `onProjectCreated` 回调完成。agent 不得替用户改变当前上下文。
- 确认：`BuiltinPlatformCtx` 新增可选 `confirm?(req)`。创意工作室实现为确认卡；未提供 `confirm` 时这两个工具 **fail-closed**（返回可读错误），不做静默通过。
- 替代（否决）：直接写——创建项目与改画风会改变后续所有生成的基准，必须有用户可见的一次确认。

### 4. `submit_shots` 按「写入场景」分策略，而不是无脑放开

这是本变更最关键的一条。给 `mergeShotsDraft` 增加 `fieldPolicy: 'import' | 'agent'`，默认 `'import'` 保持现有调用方行为不变。

```
                     可写字段
  +--------------------------+-----------------------------+
  | import（文件导入）       | 现有 10 个标量字段           |
  | agent（模型写回）        | 业务字段全集 - 产线产物字段  |
  +--------------------------+-----------------------------+

  agent 可写：cast / performance / dialogue_delivery /
             refIds / refExtras / transition_out / prod_kind /
             motion_note / video_prompt_override /
             video_prompt_rendered / handEdited

  agent 禁写（只能由生成工具或画布 UI 写）：
             keyframe / clip / audio_ref / voice_meta /
             lip_sync / video_meta / genState / candidates
```

- 手改保护不变：`old.handEdited` 列出的字段在合并后回填旧值。
- 理由：`import` 场景的文件不含媒体字段，放开会让导入抹掉已出图；`agent` 场景要能改选角、表演、参考连线，但绝不能让模型凭想象写 `keyframe` 路径。
- 替代（否决）：全字段放开——模型无法知道 `/project-assets/...` 真实路径，写进去就是坏数据。

### 5. `delete_shots` 独立工具，不与 `submit_shots` 混

参数 `nos: string[]`（当前集镜号），解析为 shot id 后调用既有的 `mergeProjectShots(name, shots, deleteShotIds)`。

- 理由：删除不可逆，必须单独命名、单独确认、单独计数回执；混进 `submit_shots` 会让"写回"意外删镜。
- 确认：与决策 3 共用 `confirm`，fail-closed。

### 6. 生成工具：静帧等待并写回，视频只提交不等待

- `generate_keyframe({ no, prompt? })`：复用 `generateImage`（带 `project` 参数，服务端直接落项目媒体目录，返回 `/project-assets/...`），成功后 `patchProject` 写 `keyframe`，并把候选放该镜候选首位。遵守 `prodKind === 'image'` 才开放。
- 候选字段说明：`ProjectShot` 原本没有 `candidates`（它只是画布态）。服务端 shots 表的 `extra` JSON 列本来就兜底未知字段，所以这里只把 `candidates` 补进类型并照常写回，重开项目不会丢。
- `generate_clip({ no, prompt? })`：复用 `startVideo` 提交任务，**立即返回** `{ jobId }`，不等待、不写 `clip`。结果由既有任务中心轮询落库（现状行为）。
- `generate_voice({ no, text? })`：复用 `generateVoice`，写 `audio_ref` / `voice_meta`。
- 三者都必须先过成本确认（图像/视频/配音分别确认），未确认不得发请求。
- 理由：`runStageAgent` 有 180s 总时长上限，视频生成经常超过它；让工具等待会把整个对话轮次拖死。静帧通常 10-30s，等待并写回才能让模型继续下一步。
- 替代（否决）：等待视频完成——超时后既没结果也没回执；复活 `src/creative/tools.ts` 的会话工具——那是"会话产物"语义，不写回项目，与本次目标不符。

### 7. 清单一致性在装载期断言，而不是靠人记

新增 `assertPlatformToolConsistency()`，在 `createBuiltinPlatformTools` 构造完成后校验：

```
  builtinPlatformToolNames()  必须每个都能在 byName 里找到
  DEFAULT_EXPERT_PLATFORM_TOOLS  必须 ⊆ builtinPlatformToolNames()
```

- 不一致直接抛错（不是 console.warn）：幽灵工具就是这么漏进来的。
- `KNOWN_TOOL_IDS` 仍是「技能可声明的全集」，包含 3D 与创意会话工具，**不参与**这条校验（它们由各自场景绑定）。
- 同步移除 `submit_prompt_renders` 在 `expertToolGroups.ts` 的两处出现（`WRITE` 分组与默认白名单）。改稿 Modal 已下线，注册它没有意义；将来恢复改稿入口时再随之加回。

### 8. 技能声明缺失工具时，装载期报警而不是静默跳过

`bindSkillTools` 现在对未实现的名字直接跳过（注释写「装载期已校验」）。改成：平台工具范围内声明了但不存在的名字，记入一个可读的装载警告，并在创意检查器的「读工具」列表里如实反映。

## Risks / Trade-offs

- [放开 agent 字段后模型覆盖人造内容] → `handEdited` 保护保留；产线产物字段仍禁写；只对 `agent` 策略放开。
- [生成工具变成无底洞花费] → 三个工具都强制成本确认；`generate_clip` 只提交不等待，避免重试放大。
- [创建项目后上下文错乱] → 工具不切项目，只由宿主回调切；`create_project` 回执明确写「未切换项目」。
- [两套 fieldPolicy 继续漂移] → 策略表集中在一处常量，`import` 与 `agent` 的差集用类型约束，测试断言「agent 策略不含任何产物字段」。
- [一致性断言在历史项目上报错] → 断言只对平台工具集，不碰场景工具集；先补测试再开启。

## Migration Plan

- 无数据迁移。`mergeShotsDraft` 新参数默认 `'import'`，`IntakeDialog` / `BundleDialog` 行为不变。
- `read_source` 增加返回字段是向后兼容的增量。
- 回滚：撤掉新增工具注册与两条新契约分支；`fieldPolicy` 保持默认值即可。

## Open Questions

- `generate_clip` 完成后的结果是否需要 agent 主动查询（`read_task` 类工具）？可等任务中心提供查询接口后再单独开一个变更，不影响本次的工具形状。
