# Tasks

## 1. 工具清单与注册一致性（先做，避免后续新工具继续漏同步）

- [x] 1.1 在 `src/agent/builtinPlatformTools.ts` 实现 `assertPlatformToolConsistency()`：`builtinPlatformToolNames()` 的每个名字必须在 `createBuiltinPlatformTools()` 的 `byName` 里存在，`DEFAULT_EXPERT_PLATFORM_TOOLS` 必须是名字清单的子集，不满足时抛错并在消息里列出差异。验证：新增纯函数测试，构造一个故意少一个工具的工具集，断言抛错并包含缺失名字。
- [x] 1.2 从 `src/creative/expertToolGroups.ts` 的 `WRITE` 分组与 `DEFAULT_EXPERT_PLATFORM_TOOLS` 移除 `submit_prompt_renders`（改稿 Modal 已下线，平台工具集从不注册它）。验证：`assertPlatformToolConsistency()` 通过；专家设置页不再出现该名字（手动确认或 DOM 断言）。
- [x] 1.3 `src/agent/stageTools.ts` 的 `bindSkillTools` 在跳过平台范围内未注册的名字时记录一条可读缺失提示（不是 `console.warn`），并让创意检查器的读工具列表只显示实际绑定的工具。验证：测试构造声明了未注册工具的假技能，断言返回缺失提示且绑定结果不含该名字。

## 2. 项目元信息可读

- [x] 2.1 `src/agent/stageTools.ts` 的 `read_source` 返回 `title`、`logline`、`style`、`aspect`，并把描述改为「原著与项目设定」。未选项目时沿用现有可读错误。验证：`tests/` 加断言，构造带 style/aspect 的项目快照，断言四项都在返回里；画风为空时返回空值而不是默认画风。
- [x] 2.2 同步 `read_source` 的返回形状到 `tests/shot-read.ts` 等既有读工具断言，确认没有依赖旧返回的测试被破坏。验证：`npx tsc --noEmit` 通过，读工具相关测试全绿。

## 3. 剧本写回

- [x] 3.1 在 `src/platform/projectDraft.ts` 增加 `script-v1` 分支：`mergeScriptDraft(current, incoming, 'merge')` 合并分集，顶层 `logline` 有值时一并写好，然后 `patchProject({ episodes })`，成功后回写快照并返回新增/更新集数。失败时不回写乐观快照。验证：新增纯函数测试，覆盖「只改第 2 集」「首次两集」「服务端拒绝返回失败」三种情况。
- [x] 3.2 在 `PLATFORM_WRITE_TOOLS` 注册 `submit_episodes`（契约 `script-v1`，label「分集剧本」），并把名字加入 `builtinPlatformToolNames()`、`KNOWN_TOOL_IDS`、专家分组（写草稿）与默认白名单。验证：`assertPlatformToolConsistency()` 通过；`builtinPlatformToolNames()` 包含 `submit_episodes`；在创意会话里实际调用一次，分集落库后重开项目仍在。

## 4. 项目生命周期工具

- [x] 4.1 `BuiltinPlatformCtx` 增加可选 `confirm?(req)`；无 `confirm` 时 `create_project`、`update_project_meta`、`delete_shots` 一律返回可读失败（fail-closed）。验证：测试在不注入 `confirm` 的 ctx 上调用三个工具，断言都失败且未落库。
- [x] 4.2 实现 `create_project`：目录名按 `/^[a-zA-Z0-9_-]{1,40}$/` 校验，调 `createProject`，只返回 `{ name }`，不切换当前项目。验证：测试覆盖合法创建、非法目录名、同名已存在三种情况；断言同名时不覆盖既有项目数据。
- [x] 4.3 在 `src/skills/contracts.ts` 新增 `project-meta-v1`（`title` / `logline` / `style` / `aspect`，`aspect` 限定在项目支持的画幅集合内）并实现 `update_project_meta`，只写传入字段。验证：测试断言只改画风时梗概与画幅不变；非法画幅被拒绝且原值保留。
- [x] 4.4 `src/creative/CreativeStudio.tsx` 注入 `confirm` 实现（复用既有确认卡交互样式），并把创建成功后的切项目动作交给宿主回调，不由工具内部切换。验证：手动在创意会话里让 agent 新建项目，确认卡出现、取消不创建、确认后项目出现在顶栏且当前选中项不变。

## 5. 镜头写回字段与删除

- [x] 5.1 给 `src/shotSync.ts` 的 `mergeShotsDraft` 增加 `fieldPolicy: 'import' | 'agent'`，默认 `'import'` 保持现有行为；`'agent'` 使用业务字段全集减去产线产物字段。策略表集中成常量并导出。验证：新增测试断言默认策略下写回仍只改原 10 个字段；`agent` 策略可写 `cast`、`performance`、`refIds`、`refExtras`、`transition_out`、`prod_kind`、`motion_note`。
- [x] 5.2 测试断言 `agent` 策略禁写集合（`keyframe`、`clip`、`audio_ref`、`voice_meta`、`lip_sync`、`video_meta`、生成态、候选）在任何输入下都不被改写，且不会清空本次未提交的字段。验证：构造带成片路径的载荷，断言原值保留。
- [x] 5.3 `src/platform/projectDraft.ts` 的 `shots-v1` 分支改用 `'agent'` 策略；`IntakeDialog` 与 `BundleDialog` 的调用保持默认 `'import'`。验证：既有导入测试全绿；agent 写回选角/表演后重开项目仍在。
- [x] 5.4 确认 `handEdited` 保护在新策略下仍生效（人改字段回填旧值），并补一条断言。验证：标记某镜时长为手改后写回新时长，断言时长保持人改值。
- [x] 5.5 实现 `delete_shots(nos: string[])`：按当前集解析 shot id，调 `mergeProjectShots(name, shots, deleteShotIds)`，回执报告实际删除数与不存在的镜号。验证：测试覆盖删两镜、混入不存在镜号、未确认三种情况；删除后画布重开不再出现这些镜头。
- [x] 5.6 把 `delete_shots` 加入 `builtinPlatformToolNames()`、`KNOWN_TOOL_IDS`、专家分组与默认白名单。验证：`assertPlatformToolConsistency()` 通过。

## 6. 生成工具

- [x] 6.1 实现 `generate_keyframe({ no, prompt? })`：校验该镜 `prodKind === 'image'`，过成本确认后调 `generateImage` + `saveImageDataUrl`，把站内地址写入该镜 `keyframe` 并追加候选。验证：测试覆盖出图镜成功、出片镜被拒、用户取消三种情况；断言不创建素材卡、不改 `refIds`。
- [x] 6.2 实现 `generate_clip({ no, prompt? })`：过成本确认后调 `startVideo`，立即返回 `{ jobId }` 且不写 `clip`；提交失败返回可读失败。验证：测试断言工具在任务受理后立即返回、未等待成片、镜头未写入成片引用。
- [x] 6.3 实现 `generate_voice({ no, text? })`：过成本确认后调 `generateVoice`，成功后写 `audio_ref` 与 `voice_meta`；失败不清空原引用。验证：测试覆盖成功与渠道失败两种情况。
- [x] 6.4 把三个生成工具加入名字清单、`KNOWN_TOOL_IDS`、专家分组（新分组或归入写草稿）与默认白名单，并在 `src/creative/CreativeStudio.tsx` 注入生成实现与成本确认。验证：`assertPlatformToolConsistency()` 通过；在创意会话手动走通「出图 → 写回镜头 → 重开可见」一次。

## 7. 回归验收

- [x] 7.1 `npx tsc --noEmit` 通过。验证：命令退出码为 0。
- [x] 7.2 既有 verify 脚本保持全绿：`verify-skills-unit.mjs`、`verify-creative-builtin-tools.mjs`、`verify-workbench-builtin-actions.mjs`。验证：逐个运行退出码为 0。
- [x] 7.3 新增一套针对本变更的纯函数验收，覆盖清单一致性、字段策略、剧本合并、破坏性工具 fail-closed 四类断言。验证：脚本退出码为 0，且故意打乱清单时能报错。
