# Tasks

## 1. 冒烟声明期望结果

- [x] 1.1 把 `verify-creative-builtin-tools.mjs` 的 `staticArgs` 从「参数表」升级为「参数 + 期望 + 理由」：预期成功写 `expect: 'ok'`，预期 fail-closed 写 `expect: 'fail'` 并带匹配语义关键词的 `reason` 正则；缺 `expect` 时直接判失败并点名工具；验证：故意删掉某个工具的 `expect` 字段，脚本报「缺少期望声明」且不通过
- [x] 1.2 调用结果与期望比对：`expect:'ok'` 而实际 `ok:false` 判失败并输出实际 `error`；`expect:'fail'` 而实际 `ok:true` 判失败并提示「可能已落库或产生费用」；`expect:'fail'` 但 `error` 不匹配 `reason` 判失败；验证：临时把一个预期失败的工具改成 `expect:'ok'`，脚本变红且提示文案符合预期
- [x] 1.3 把当前 12 个业务 `ok:false` 逐个认定为「预期失败（缺确认通道 / 缺成本确认通道 / 工位不支持 / 目标不存在 / 地址不在项目内）」并补齐 `reason`；`set_shot_camera_lexicon` 的 `HTTP 404` 不属预期失败，按真实缺陷处理（修代理调用或记录为已知问题并让脚本显式红）；验证：脚本汇总里预期失败数与实际一致，且没有任何未声明失败
- [x] 1.4 汇总行改为分列「通过 / 预期失败 / 意外失败 / 跳过」，任一「意外失败」使进程退出码非零；验证：人为制造一个未声明失败，退出码为 1 且汇总把它计入意外失败

## 2. 补内容级断言

- [x] 2.1 `list_camera_lexicon` 与 `get_camera_lexicon`：断言条目非空、每项含 key 与中文名、按 key 取到的条目与列表里同名项一致、`limit` 生效；验证：在 `verify-creative-builtin-tools.mjs` 内联断言，改坏 limit 处理后脚本变红
- [x] 2.2 `list_experts` 与 `list_installed_skills`：断言返回数组非空、每项含 id 与可读名称、专家里至少有一个默认专家；验证：内联断言通过，且删掉 mock 数据后断言失败
- [x] 2.3 `read_skill_text`：断言取到技能正文（长度大于阈值且含技能标识），技能 id 不存在时返回可读失败而不是空正文；验证：内联断言通过，负例返回 `ok:false` 且错误点名 id
- [x] 2.4 `submit_assets` 成功写回：临时库里放一张合法项目内图片，提交后重新 `GET /api/project` 断言 `assets` 增加且 url 一致；验证：断言通过；再把 url 改成项目外地址，断言 `ok:false` 且 `assets` 未变
- [x] 2.5 `submit_prompts` 成功写回：提交带 `keyframe_prompt` / `video_prompt` 的镜头，断言重读后对应镜头的提示词字段被写入；验证：断言通过；提交不存在的镜号时断言 `counts.missing === 1`、`counts.patched === 0` 且项目镜头未被改动（原任务写的 `ok:false` 与 `mergePromptDraft` 既有语义不符，按工具现有契约改为断言 missing 计数）
- [x] 2.6 `submit_joins` 成功写回：提交一条硬切与一条生成转场，断言重读后前一镜 `transition_out` 被清、后一镜写入 `mode: 'generated'`；验证：断言通过，且与 `verify-joins.mjs` 的底层断言不冲突

## 3. 处理过期脚本

- [x] 3.1 判定 `set_scene_code` 是否仍提供旧草稿流的等价能力（分段追加、行号读取、片段替换、准入提交）；验证：对照 `src/agent/sceneAgentTools.ts` 与 `openspec/specs/scene-code-runtime/spec.md`，写出判定结论（保留 / 取代）
- [x] 3.2 按 3.1 结论处理 `verify-agent-scene-draft.mjs`：保留等价能力则按 `set_scene_code` 重写并跑通；否则删除脚本，并确认 `scene-code-runtime` 已有验收接管该流程；验证：`node verify-agent-scene-draft.mjs` 要么全绿，要么文件不存在且接管脚本全绿；`rg begin_scene_draft` 无命中（结论：部分取代 → 重写；旧工具名只保留在「历史压缩夹具」与「暴露面黑名单」两处，不再作为 invoke 目标）

## 4. 统一验收启动契约

- [x] 4.1 需要现成服务的脚本统一从 `APP_URL` 解析地址并去掉各自硬编码默认端口的隐式行为；服务不可达时输出可读「服务未启动」并失败；验证：不启服务直接跑 `verify-agent-stream.mjs`，得到可读提示而非连接栈
- [x] 4.2 `verify-all.mjs` 注入 `APP_URL`（或在运行前检查并自起一个 server，结束时清理）；验证：`node verify-all.mjs agent` 不再出现 0 秒退出的一整片失败
- [x] 4.3 脚本头部注释写明跑法（是否需要服务、地址来源）；验证：随机抽三个脚本，头部注释与 `APP_URL` 实际行为一致

## 5. 外部依赖断言的跳过语义

- [x] 5.1 `verify-agent-stream.mjs` 里依赖真实代理的用例（非流式结构、取消）在缺凭据时记为跳过并说明缺什么；有凭据但结构异常时仍判失败；验证：无凭据跑一遍得到「跳过 2」，配置凭据后跑一遍得到真实结论
- [x] 5.2 汇总输出单列跳过数；`verify-all.mjs` 把「某脚本全部断言跳过」视为异常并提示；验证：构造一个全跳过的脚本，批量入口给出提示

## 6. 回归与收尾

- [ ] 6.1 跑 `verify-agent-tool-coverage.mjs`、`verify-creative-builtin-tools.mjs`、`verify-material-tools.mjs`、`verify-tool-contracts.mjs`、`verify-joins.mjs`、`verify-native-tool-protocol.mjs`、`verify-apimart-tool-schemas.mjs`、`verify-agent-project-cache.mjs`、`verify-creative-experts.mjs`；验证：全部通过，且新的期望声明没有把真实缺陷一起放行
- [ ] 6.2 跑 `node verify-all.mjs agent` 与 `node verify-all.mjs tool`；验证：两组均无「连不上」类失败，剩余失败只有环境依赖项且已被标记为跳过或说明原因

## Workflow follow-up

- 归档前确认本次新增的 `platform-tool-verification` 能力与 `creative-asset-tools`、`creative-experts` 的边界：后者描述工具业务行为，前者只描述验证契约，不要在两处重复同一要求。
