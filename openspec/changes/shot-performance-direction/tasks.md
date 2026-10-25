# Tasks

## 1. 表演数据与往返

- [x] 1.1 在 `src/types.ts` 与 `src/api.ts` 增加 `PerformanceEmotion`、`PerformanceEntry`、`DialogueDelivery` 和镜头口型/配音元数据类型，并给 `ShotData` / `ProjectShot` 增加可选 `performance`、`dialogue_delivery`、`lip_sync`、`voice_meta`；验证：`npm run build` 通过，旧镜头不需补字段即可编译。
- [x] 1.2 在 `src/prompts.ts` 增加保留/回填台词表演的辅助函数：文本行未变时按 `speaker+text` 精确匹配，文本改动时按行下标兜底，找不到的旧表演丢弃并返回提示；验证：`verify-performance.mjs` 覆盖未改、改字、增行、删行四种情况，且标签不进入 `dialogue` 文本。
- [x] 1.3 在 `src/shotSync.ts` 的 `bizSignature` / `nodeToShot` / `shotToData` 接入 `performance`、`dialogueDelivery`、`lipSync`、`voiceMeta`；验证：纯函数用例保存两个角色、逐行表演、口型状态后重读完全一致；旧镜头读为空表演且不报错。
- [x] 1.4 在 `mergeGenerated` 中确认 `handEdited` 的 `performance` / `dialogue_delivery` 能保留旧值，并补一个“恢复模型建议”时清除对应手改标记的入口；验证：手改一个角色后重新拆镜，该镜表演保留；未手改的镜头使用新结果；清除标记后使用模型值。
- [x] 1.5 增加项目隔离与旧数据用例：项目 A/B 各自表演不串、旧项目读空、没有项目时不写入；验证：`verify-performance.mjs` 覆盖 A/B 切换、legacy fixture 和未选项目三种情况。

## 2. 技能与契约

- [x] 2.1 在 `src/skills/contracts.ts` 的 `shotsV1` 增加可选 `performance` 与 dialogue 行表演字段，保持旧输出可通过；验证：`verify-performance-skills.mjs` 用旧输出、新输出、缺说话人表演三种样例断言契约行为。
- [x] 2.2 在 `src/agent/shotDraft.ts` 映射 `performance` 与 `dialogue_delivery`，并保持 `cast`、场次回退和旧字段行为；验证：纯函数用例断言新字段完整、旧输出为空、场次回退计数不变。
- [x] 2.3 更新 `skills/shotlist/SKILL.md`：输出表演数组、每个说话角色必须有条目、多人分别写可见反应、空镜允许为空；验证：`buildBoardSkillPrompt('shotlist', ...)` 生成的 system/task 包含这些规则，旧技能输出仍能写入。
- [x] 2.4 更新 `skills/prompt/SKILL.md`：`briefJson` 带 `cast`/`performance`/dialogue delivery，首帧写表情与说话状态，视频写说话中的嘴部动作，嘴部不可见时不得声称口型同步；验证：`PromptTable` 的 mock 请求体含表演，生成的提示词文本包含对应规则。
- [x] 2.5 增加宿主校验：模型返回了 `performance` 数组但某个有台词的角色没有条目时，返回可读错误并拒绝写入；完全没有 `performance` 的旧输出仍接受；验证：`verify-performance-skills.mjs` 覆盖“新输出缺条目”和“旧输出无表演”两种情况。
- [x] 2.6 更新 `skills/character/SKILL.md`：身份锚点只写稳定外观，瞬时表情交给表演/表情参考；旧 `lookEn` 不自动改写；验证：技能正文包含该约束，拆角色流程不自动触发表情生成。
- [x] 2.7 更新 `README.md` 的工作台/技能说明：表演字段、旧项目空表演、技能版本变化和恢复默认；验证：按文档步骤能在镜头表看到并保存表演，文档中的命令/路径与实际一致。

## 3. 工作台表演编辑

- [x] 3.1 新增 `src/PerformanceEditor.tsx`：按角色编辑情绪、强度、动作、视线、是否说话，按台词行编辑情绪、语速、音量、重音；验证：`verify-performance-ui.mjs` 能渲染两个角色和有台词镜头，修改后回传完整结构。
- [x] 3.2 在 `src/ShotTable.tsx` 增加表演摘要列/编辑入口，保存时写入 `performance` 或 `dialogue_delivery` 并标记手改；验证：UI 用例改一个角色、保存、重载后仍在；重新拆镜后手改值保留。
- [x] 3.3 在 `src/Inspector.tsx` 增加表演区，直接 patch 当前镜头；验证：画布改表演后 `bizSignature` 触发写回，重新打开项目仍一致。
- [x] 3.4 在 `src/PromptTable.tsx` 的 `briefJson` 增加 `cast`、`performance` 和带 delivery 的 dialogue；验证：mock `/api/text` 捕获的 prompt 包含这些字段，旧项目没有表演时仍能生成。
- [x] 3.5 校验聊天草稿与一次性生成共用同一份表演合并：聊天动作和顶部按钮都不能绕过手改保护；验证：`verify-workbench-builtin-actions.mjs` 与 `verify-performance-ui.mjs` 都通过，且不新增重复回执。
- [x] 3.6 更新 README 的镜头表/Inspector 操作说明并补一张截图；验证：按文档能编辑表演、保存、重新拆镜并保留手改。

## 4. 配音表演

- [x] 4.1 在 `src/api.ts` 扩展 `VoiceLine` 的表演字段与 `VoiceResult` 的 `applied` / `unsupported` / `engine`；验证：`npm run build` 通过，旧调用不传新字段仍可编译。
- [x] 4.2 在 `src/App.tsx` 的 `generateVoiceOne` 按 `dialogue_delivery` 构造每行参数，缺失时回退角色 `performance`，再缺失用默认值；验证：纯函数/单测覆盖多说话人、逐行不同情绪、无表演旧镜头。
- [x] 4.3 让 `/api/voice` 接受并透传表演参数，`synthesize` 增加 performance 入参；验证：`verify-voice-performance.mjs` 用 mock provider 捕获请求，确认单行和多行都带参数。
- [x] 4.4 在 MiniMax 适配器写入 `voice_setting.emotion` / `speed` / `vol`，neutral 不硬塞不支持的值，whisper 不传给 2.8；验证：`dryRun` 断言请求体，非法/不支持值被忽略并返回 `unsupported`。
- [x] 4.5 在火山 TTS 适配器写入 emotion、emotion_scale、speech_rate、loudness_rate；验证：`dryRun` 断言 body，未支持字段不发送。
- [x] 4.6 在 ElevenLabs 使用音频标签或 style，在 OpenAI/APIMart 使用 `instructions`；验证：标签只出现在发送文本/参数里，项目台词与字幕仍是原句；不支持时降级并显示提示。
- [x] 4.7 记录 `voiceMeta` 指纹并在台词/表演变化时标记配音需要重生成，旧音频保留；验证：改一个字或改一句情绪后界面出现 stale，重新合成后清除。
- [x] 4.8 更新 README/配音说明：各引擎支持哪些表演参数、默认 MiniMax、macOS say 不支持；验证：文档中的 dryRun/操作步骤与实际行为一致。

## 5. 角色表情参考

- [x] 5.1 在 `src/characters.ts` / `src/charMap.ts` 增加 `expressions` 类型与 `EXPRESSION_SUFFIX`，保持 `lookEn`/`lookCn` 不变；验证：`verify-expression-ui.mjs` 的 round-trip 用例保存/重载表情、候选和 activeIdx。
- [x] 5.2 在 `src/CharacterBoard.tsx` 增加逐表情生成、2 张候选、选择、上传和失效提示；验证：mock 图像路由捕获 `lookEn + 表情约束`，生成不自动触发，候选切换持久化。
- [x] 5.3 在 `src/shotReferences.ts` 增加 `source: 'expression'`，按“说话/主动作角色表情 → 其他入画角色表情 → 身份图 → 相邻 → 素材 → 手工”排序；验证：纯函数用例断言顺序、去重、失效图跳过、超限 `omitted` 报告。
- [x] 5.4 在 `src/App.tsx` 首帧生成时按镜头表演取表情参考，保留身份锚点和场景/道具；没有有效表情时退回文字表演；验证：mock 请求体包含表情 URL 和 `lookEn` 提示词，缺图时不报错。
- [x] 5.5 身份锚点变化时把已有表情标 stale、保留图片，镜头选择失效表情时回退文字；验证：改 `lookEn` 后 UI 出现“需要重生成”，首帧请求不发送旧表情。
- [x] 5.6 更新 README 与 `evidence/`：说明表情不是身份、如何生成/选择、参考上限与成本；验证：按文档能生成一张表情并用于一镜首帧。

## 6. 口型模式与验收

- [x] 6.1 新增 `src/lipSync.ts`（或等价模块）：模式归一化、单说话人资格、源视频/音频/指纹、stale 判定；验证：`verify-lipsync.mjs` 覆盖 off/prompt/provider、缺视频、缺音频、多人禁用、源变化。
- [x] 6.2 在设置页增加独立的口型 provider 配置（默认关闭）与服务端 Key 解析，Key 不进入项目；验证：`verify-lipsync.mjs` 断言未配置时 provider 禁用、配置后可用、项目 JSON 无 Key。
- [x] 6.3 新增 `server/lipsync.mjs` 的 Sync Labs adapter：Assets 上传、`/v2/generate` 提交、轮询、下载到项目媒体目录；验证：mock HTTP 用例断言上传/提交/轮询/失败路径，测试不调用真实服务。
- [x] 6.4 新增 `/api/lipsync` 路由与任务状态；错误（401/403/额度/参数/超时）可读且不自动 fallback；验证：API mock 用例覆盖成功、鉴权失败、超时和缺 Key。
- [x] 6.5 在 `Inspector`/`ShotTable` 增加模式选择、单镜“生成口型”确认、成本/时长预览、状态、采用/切回原版；验证：`verify-lipsync-ui.mjs` 覆盖未确认不提交、成功待采用、失败保留原视频、批量任务不提交。
- [x] 6.6 新增 `server/lipsyncQa.mjs`：ffmpeg `silencedetect` 找静音段、按静音/发声中点抽帧，输出 manifest；验证：用带静音和说话的 fixture 断言时间点与帧文件存在。
- [x] 6.7 QA UI 展示联系表/帧、advisory 判定和 override 理由；默认不自动采用，失败或未判定时不能直接采用；验证：UI 用例覆盖静音张嘴、发声闭嘴、无音频、人工忽略。
- [x] 6.8 `Preview.buildPlaylist`、时间线和导出按 `lipSync.adopted` 选择口型视频或原视频，音频仍用 `voiceUrl`；验证：`verify-export.mjs` 的 ffprobe 用例和 UI 播放列表断言；切回原版恢复。
- [x] 6.9 多说话人镜头在 provider 模式禁用并说明原因，prompt 模式仍可用；验证：`verify-lipsync.mjs` 双说话人 fixture 断言禁用原因和任务数为 0。
- [x] 6.10 更新 README/DEPLOY-CHECKLIST/evidence：provider 配置、成本、手动确认、单说话人限制、QA 是 advisory；验证：按文档能完成一次 mock 口型任务并看到验收帧。

## 7. 集成验收与回归

- [x] 7.1 新增/补齐 `verify-performance.mjs`、`verify-performance-skills.mjs`、`verify-performance-ui.mjs`，纳入 `verify-all.mjs` 自动发现；验证：每脚本退出码 0，`node verify-all.mjs performance` 通过。
- [x] 7.2 新增 `verify-voice-performance.mjs`、`verify-expression-ui.mjs`、`verify-lipsync.mjs`、`verify-lipsync-ui.mjs`；验证：全部通过，mock 断言不产生真实付费任务。
- [x] 7.3 做一次端到端 mock：旧项目无表演 → 行为不变；新项目有表演 → 提示词包含表情/说话；配音请求带情绪；表情参考进入首帧；口型 off/prompt/provider 三种状态可切换；验证：脚本与截图记录在 `evidence/`。
- [x] 7.4 跑回归：`npm run build`、`node verify-workbench-chats.mjs`、`node verify-workbench-builtin-actions.mjs`、`node verify-export.mjs`、`node verify-all.mjs`；验证：全部通过，无旧的表演/配音/导出回退。
- [x] 7.5 更新 README、DEPLOY-CHECKLIST 和 `evidence/README.md`：外部 MIT 技能来源与许可证、表演字段、TTS 引擎能力、口型 provider 限制、人工确认规则；验证：文档链接可打开，命令与路径可照做。
- [x] 7.6 写 evidence 限制说明：口型 QA 是 advisory、多人 provider 未支持、真实 Seedance 2.0+ 与外部口型调用需人工确认；验证：evidence 明确列出未验收项，不把 mock 写成真实通过。

## Workflow follow-up

- 实现完成后运行 `openspec validate shot-performance-direction --strict`，同步四个新能力到主 specs 后再归档。
- 真实 Seedance 2.0+、Sync Labs/Kling 口型调用需要用户明确确认；自动化测试只使用 mock、dryRun 和本地 ffmpeg。
- 归档时附上 mock 截图、请求体证据、口型验收帧和未验收项说明。
