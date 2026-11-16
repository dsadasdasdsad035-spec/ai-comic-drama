# Tasks

## 1. 删除转场正文与模板渲染的字符切片

- [x] 1.1 删除 `src/transitionGen.ts` 的 `cutPromptSnippet` 与两处调用：`transitionContinuityBlock` 的 `aAct`/`bAct` 与 `defaultTransitionPrompt` 的 `cut`，改为直接使用完整 `videoPrompt || prompt`；验证：在 `codegraph_explore` 或 `rg "cutPromptSnippet"` 中不再命中该符号，且 `npm run build` 通过
- [x] 1.2 删除 `src/promptRender.ts` 单镜 bundle 的字符切片：`scene.castStates` 去掉 `.slice(0, 120)`、`scene.environment` 去掉 `.slice(0, 200)`；验证：新增单测断言输入 400 字 `prompt` 时 bundle 两个字段与输入完全相等
- [x] 1.3 删除 `src/promptRender.ts` 转场 bundle 的 `scene.environment` 的 `.slice(0, 300)`；验证：单测断言两镜各 400 字时 `environment` 长度等于两段拼接长度加分隔符
- [x] 1.4 为 1.1–1.3 补单测，覆盖「90 字符以上邻镜正文」「300 字符以上环境描述」两个边界；验证：`npm test` 全绿且新增用例在 CI 中执行

## 2. 空正文改为显式状态并注入衔接块

- [x] 2.1 修改 `src/transitionGen.ts` 的 `semanticTransitionVideoPrompt`：`generated.prompt` 为空时返回空串，MUST NOT 再调用 `defaultTransitionPrompt`；验证：单测断言空正文时返回 `''`，非空时逐字返回原正文
- [x] 2.2 在 `buildTransitionVideoPreview` 中为空正文新增 `blocking` 条目 `transition-prompt-empty`，文案说明「正文未填写」并给出补写或改用手改正文的下一步；验证：单测断言 `blocking` 含该 code，且不含正文时 `preview.blocking.length > 0`
- [x] 2.3 在 `src/transitionGen.ts` 的 `finalizeTransitionPromptText` 里，于 `source === 'auto'` 分支追加 `transitionContinuityBlock(source, target)` 输出（在结构锚点之前），保持 `source === 'override'` 直接返回；验证：单测断言自动路径正文包含衔接段，手改路径正文与 `override.text` 逐字相同
- [x] 2.4 在 `src/TransitionPanel.tsx` 为「正文未填写」增加可见状态与「用上下镜正文预填」按钮，点击时把 `defaultTransitionPrompt` 的结果写入 `generated.prompt`；验证：手工打开一条空正文接缝，看到状态文案与按钮，点击后 textarea 被填入且不再是空正文 blocking
- [x] 2.5 更新 `verify-transitions-ui.mjs` 覆盖空正文路径；验证：该脚本运行通过，控制台输出包含空正文检查项

## 3. 删除 Agent 读取路径的字符折叠

- [x] 3.1 `src/agent/stageTools.ts` 的 `read_prompt_render_bundle` 去掉 `boundJson(bundle)`，改为整份返回；验证：单测断言 bundle 序列化长度超 8000 时返回值不含 `truncated`/`preview` 键且与输入深相等
- [x] 3.2 `read_shot_video_prompt` 增加 `templateRendered` 全文（保留 `templateRenderedChars` 便于快速判断），来源为 `shot.video_prompt_rendered`；验证：单测断言有模板渲染的镜返回全文且长度等于 `video_prompt_rendered.length`
- [x] 3.3 `src/agent/stageTools.ts` 的 `list_installed_skills` 去掉 `description` 的 `.slice(0, 240)`；验证：单测断言 300 字描述原样返回
- [x] 3.4 `src/agent/sceneAgentEvents.ts` 的 JSON 折叠改为按条装填或显式标记（保留 `truncated`/`chars`，去掉 `json.slice`）；验证：单测断言超限输入不再返回被切断的 JSON 字符串
- [x] 3.5 `src/agent/agentReview.ts` 去掉 `reason` 的 200 与 `summary` 的 500 切片；验证：单测断言长 reason/summary 原样返回
- [x] 3.6 `src/agent/builtinPlatformTools.ts` 去掉配音回执 `detail` 的 60 字符切片与 `…`；验证：单测断言长台词原样出现在 `detail`
- [x] 3.7 在 `src/agent/threads.ts` 的 `shrinkResult` 与 code>2000 折叠处补注释，说明这是历史消息持久化折叠、不作用于模型可见结果，并保持行为不变；验证：注释存在且 `npm test` 中历史消息相关用例不回归

## 4. 删除抽取与视觉解析的字符切片

- [x] 4.1 `src/charExtract.ts` 去掉台词 `.slice(0, 90)` 与画面 `.slice(0, 70)`；验证：单测断言 200 字台词与画面完整进入抽取上下文
- [x] 4.2 `src/designExtract.ts` 去掉台词 `.slice(0, 90)` 与画面 `.slice(0, 140)`；验证：单测断言长文本完整保留
- [x] 4.3 `src/visualBrief.ts` 去掉字段内字符切片（`name`/`occludedBy` 30、`description` 120、`shotSize` 30、`angle` 80、`notes` 160、`composition` 200），保留 `subjects` 8 条与 `visible` 12 条的条数上限；验证：单测断言长字段原样保留且条数上限仍生效
- [x] 4.4 在 `docs/` 或对应 spec 的 README 段落里记录「提示词与抽取上下文不再有字段级字符上限」；验证：文档段落存在且描述的阈值与实际代码一致（无阈值）

## 5. 集成验证

- [x] 5.1 跑 `npm run build` 与 `npm test`，确认无类型错误与用例失败；验证：两条命令退出码为 0
- [x] 5.2 用已存在的项目数据回归：打开一条曾出现 `…` 的接缝（项目 `a` 第 1 集），确认面板正文无省略号；验证：面板与 `/api/seedance` 请求体 `prompt` 逐字一致（可用「查看将发送」核对）
- [x] 5.3 跑 `verify-transitions-ui.mjs`、`verify-pi-agent.mjs`、`verify-workbench-builtin-actions.mjs`；验证：三个脚本均通过
- [x] 5.4 跑 `openspec validate remove-prompt-truncation`；验证：输出 `is valid`

## Workflow follow-up

- 归档前需确认用户对 `shot-transition-continuity` 与 `shot-transition-video-prompt` 的 delta 内容已复核。
- 归档后重跑一次项目 `a` 的出片预览，确认长正文未触发渠道 `length` 错误。
