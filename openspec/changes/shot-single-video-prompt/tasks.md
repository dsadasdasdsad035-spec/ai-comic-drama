# Tasks

## 1. 正文求值收敛（数据层）

- [x] 1.1 改 `src/videoPrompt.ts` 的 `effectiveVideoPrompt`：override 非空时返回 `{ text: override.text, source: 'legacy-override', stale: false }`，否则返回 `{ text: request.prompt, source: 'video_prompt', stale: false }`；同步把 `EffectiveVideoPrompt['source']` 收敛为 `'video_prompt' | 'legacy-override'`，`autoKind` 一并移除。验证：`npx tsc --noEmit` 通过，且 `rg "autoKind|'semantic'|'template'" src/OutgoingVideoPromptPanel.tsx src/Inspector.tsx` 不再有引用残留。
- [x] 1.2 在 `src/videoPrompt.ts` 增加 `isVideoPromptHandEdited(data: ShotData): boolean`（判断 `handEdited` 是否含 `'video_prompt'`），供面板与 Inspector 复用。验证：`tests/` 下新增单测覆盖含/不含标记两种输入。
- [x] 1.3 检查 `src/shotSync.ts`：确认 `handEdited` 为空数组时不写入、`video_prompt` 仍在 `SHOT_IMPORT_FIELDS` 且不在 `SHOT_FIELD_POLICY.agent`。验证：`tests/shot-field-policy.ts` 全部通过，且新增断言「agent 策略不含 `video_prompt`」。

## 2. 出片面板改造（唯一正文入口）

- [x] 2.1 改 `src/OutgoingVideoPromptPanel.tsx`：`save()` 回调改为写 `video_prompt` + `handEdited`，删除 `effective.stale`、`renderStale`、`templateStale` 三个分支与 `onRebuildOverride`、`onSaveOverride`、`onClearOverride` 的旧语义参数。验证：`verify-video-prompt-preview.mjs` 中「手改正文不回填自动段落」与新增「保存后 `video_prompt` 为编辑全文」两条断言通过。
- [x] 2.2 调整徽章映射为「已手改 / 正文 / 旧版本正文」三态，删除 `badgeClass` 里的 `semantic` / `template` 分支与 `renderStaleMessage` / `templateStaleMessage` 属性。验证：`verify-shot-inspector.mjs` 的徽章断言改为新文案后通过。
- [x] 2.3 在面板正文区下方增加「交由模型重写」动作：清除 `video_prompt` 的 `handEdited` 标记（保留正文），并说明下一次重新提交提示词时才会被覆盖。验证：手动点一次确认标记消失且正文不变；`verify-video-prompt-preview.mjs` 新增该断言。
- [x] 2.5 让解锁真正落库：服务端 `handEdited` 是并集（只增不减），普通保存去标记会被吞掉。新增一次性解锁信号 `handEditedUnlocked`（`src/api.ts` 类型、`src/shotSync.ts` 的 `nodeToShot` 可选参数、`server/db.mjs` 合并分支、`src/App.tsx` 的 `unlockHandEdit` 立即写回），并把 Inspector 保存正文时清 `video_prompt_override` 锁也走同一通道。验证：`node server/verify-db.mjs` 新增 5 条解锁断言全绿；真实点「交由模型重写」后落库 `handEdited` 为空、正文保留、无残留信号字段。
- [x] 2.4 面板在 `legacy-override` 生效时显示「旧版本保存的正文：保存一次即迁移到镜头正文」提示。验证：用含 `video_prompt_override` 的 fixture 起页面，断言提示出现且正文等于快照全文。

## 3. Inspector 与调用侧对齐

- [x] 3.1 改 `src/Inspector.tsx`：`ShotVideoPromptPanel` 的 `onPatch` 回调改为写 `video_prompt` + `handEdited`；删除 `onClearOverride` / 旧 override 写入与 `.vp-field-note`「运动提示词字段不会影响出片」提示。验证：`verify-shot-inspector.mjs` 中 `.vp-field-note` 计数断言改为 0。
- [x] 3.2 删除 `motionPrompt` 折叠区内的正文 `textarea`（`placeholder="只写动作与运镜"`）及 `d.videoPrompt` 绑定；区块标题改为「镜头参数」，`id` 仍为 `motionPrompt`，其余字段与 `ShotLexiconRefBlock` 保留。验证：`rg "只写动作与运镜" src` 无结果；`verify-shot-inspector.mjs` 的「运动提示词可展开」断言改为「镜头参数可展开」。
- [x] 3.3 修正 `Inspector.tsx:601` 的 `sourceLabel`：按 `effective.source` 判「人工编辑正文 / 镜头正文 / 旧版本正文」，不再用 `request.prompt.trim()`。验证：override 生效场景下面板摘要不再出现「正文来自运动提示词」。
- [x] 3.4 清理四处「不会自动并入出片正文…写进运动提示词」的说明文案（景别、表演、台词、原生音频），改为指向出片面板正文区。验证：`rg "写进运动提示词" src` 无结果；四条说明在页面可见且指向正确位置。

## 4. Agent 工具与契约对齐

- [x] 4.1 改 `src/agent/shotVideoHarnessTools.ts` 的 `set_shot_video_override`：`text` 非空时写 `video_prompt` + `handEdited`，忽略 `fingerprint` 校验；`clear` 时移除 `video_prompt` 的 `handEdited` 并清空存量 `video_prompt_override`；更新工具描述说明它现在写的是镜头正文。验证：`tests/shot-read.ts` 对应断言改写后通过，且手动调一次确认落库字段为 `video_prompt`。
- [x] 4.2 改 `src/agent/stageTools.ts` 的 `resolveShotVideoPrompt`：来源枚举从 `override` / `video_prompt` / `blocked` 调整为 `legacy-override` / `video_prompt` / `blocked`，`read_shot_detail` 与 `read_shot_video_prompt` 描述文案同步。验证：`tests/shot-read.ts` 全部通过。
- [x] 4.3 改 `src/agent/builtinPlatformTools.ts` 的 `generate_clip` 描述与正文优先级说明（当前写「手改 override → 参数 prompt → video_prompt」）为「存量快照 → 参数 prompt → video_prompt」，并同步 `src/creative/expertToolGroups.ts` 中的工具分组说明（如涉及）。验证：`rg "override → 本次参数" src` 无结果；`npx tsc --noEmit` 通过。

## 5. 测试改写

- [x] 5.1 重写 `verify-video-prompt-preview.mjs` 的手改链路断言：删「旧快照」「重新拼装」「运动提示词字段提示不生效」，新增「保存写回 `video_prompt`」「`video_prompt_override` 保持空」「`handEdited` 含 `video_prompt`」「参考变化后正文不变且无警告」。验证：`node verify-video-prompt-preview.mjs` 全部通过。
- [x] 5.2 改 `verify-shot-inspector.mjs`：`motionPrompt` 相关断言改为「镜头参数」区块，删除 `.vp-field-note` 断言。验证：`node verify-shot-inspector.mjs` 通过。
- [x] 5.3 改 `tests/shot-read.ts`、`tests/shot-field-policy.ts`：override 断言改为存量只读兼容语义，新增「agent 策略不含 `video_prompt`」「`handEdited` 回填 `video_prompt`」。验证：项目测试命令全绿。
- [x] 5.4 改 `verify-creative-export.mjs`、`verify-prompt-cases.mjs`、`verify-video-prompt.mjs`、`verify-prompt-render.mjs` 中的 override / 运动提示词断言。验证：四个脚本各自通过。
- [x] 5.5 补一条端到端存量兼容用例：项目含 `video_prompt_override`，出片请求正文等于快照全文，面板显示「旧版本正文」。验证：新增断言在 `verify-video-prompt-preview.mjs` 中通过。

## 6. 文档更新

- [x] 6.1 更新 `README.md` 中描述两处正文入口与「运镜与语义」的段落（第 223、236、270 行附近），改为单一正文入口与「镜头参数」区块。验证：`rg "运动提示词" README.md` 仅剩导出/案例语境的历史说明或已改写。
- [x] 6.2 更新 `src/types.ts` 中 `videoPrompt` 与 `videoPromptOverride` 的注释：前者标注为「出片正文主体，人工编辑后记入 `handEdited`」，后者标注「退役，仅存量读取」。验证：`npx tsc --noEmit` 通过。

## 7. 集成验证

- [x] 7.1 端到端跑一次真实项目：选中出片镜 → 在面板改正文并保存 → 刷新 → 确认正文保留、徽章为「已手改」→ 生成视频 → 确认 `video_meta.prompt` 等于保存的全文。验证：观察请求体与 `video_meta` 记录一致。
- [x] 7.2 回归参考与附件：改正文后新增/删除参考连线，确认附件清单变化而正文不变、无过期警告。验证：面板截图与请求体对照。
- [x] 7.3 跑 `openspec validate shot-single-video-prompt --strict` 与全量测试脚本，确认无回归。验证：命令通过。

## Workflow follow-up

- 项目评审通过后归档该变更，归档前先 `openspec sync specs`。
- 归档后核对 `openspec/specs/shot-video-prompt/spec.md` 与 `shot-inspector-layout/spec.md` 是否已反映单一正文模型。
