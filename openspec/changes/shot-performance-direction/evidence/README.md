# shot-performance-direction evidence

## 已实现

- 镜头级 `performance`（逐角色情绪/强度/动作/视线/说话）与 `dialogue_delivery`（逐行情绪/语速/音量/重音）。
- `ShotData` / `ProjectShot` 往返、`bizSignature`、手改保护与“恢复模型建议”。
- 拆镜技能输出 `performance`；提示词技能消费 `cast`/`performance`/delivery；说话角色缺表演时宿主拒绝写入。
- 镜头表「表演」列 + 展开编辑；Inspector 表演区；旧项目空表演。
- 角色表情参考：`expressions`、生成/候选/上传/删除、身份指纹失效、参考排序（表情 → 身份 → 场景/道具）与上限报告。
- TTS 逐行表演：MiniMax/火山/ElevenLabs/OpenAI 兼容映射、`applied`/`unsupported`、`voice_meta` 指纹过期提示。
- 口型 `off`/`prompt`/`provider`：Sync Labs adapter（Assets 上传 + 生成 + 轮询 + 下载）、设置页配置、逐镜确认、独立结果与采用/切回、本地 ffmpeg 静音/发声抽帧、视觉 advisory + 人工确认。
- 预览/时间线/导出优先使用已采用的口型版；音频仍用原配音。
- README / DEPLOY 更新。

## 自动化验证

```bash
npm run build
node verify-performance.mjs
node verify-performance-skills.mjs
node verify-performance-ui.mjs
node verify-voice-performance.mjs
node verify-expression.mjs
node verify-expression-ui.mjs
node verify-lipsync.mjs
node verify-lipsync-ui.mjs
node verify-all.mjs performance
node verify-all.mjs lipsync
node verify-all.mjs expression
```

全部通过。`verify-lipsync.mjs` 使用 mock HTTP 跑 Sync Labs 上传/提交/轮询/下载和 401 错误；用本地 ffmpeg 生成 1s 说话 + 1s 静音 fixture，断言静音/发声帧文件存在。`verify-performance-ui.mjs` 用临时 dev server + mock project 验证表演摘要、编辑/保存/重载、Inspector 表演区和口型面板模式；不调用外部口型或 TTS。

另外回归了 `node verify-workbench-builtin-actions.mjs` 与 `node verify-export.mjs`；完整 126 个 `verify-*.mjs` 未全量跑（时间/外部依赖），本次跑的是表演、配音、表情、口型相关组和受影响的聊天/导出。

UI 截图：`performance-ui.png`（镜头表/Inspector/口型面板）、`expression-ui.png`（角色表情生成/候选/stale）、`lipsync-ui.png`（口型三档模式）。

## 外部规则来源

只做规则适配，不在运行时加载或复制外部脚本：

- [zenstory-ai/drama-skills](https://github.com/zenstory-ai/drama-skills)（MIT）：表演弧、可见行为、声音身份与表演分离、对白/口型预算。
- [calesthio/generative-media-skills](https://github.com/calesthio/generative-media-skills)（MIT）：performance-direction、Sync Labs/Kling provider 事实。
- [domco685/ai-cartoon-studio-skill](https://github.com/domco685/ai-cartoon-studio-skill)（MIT）：静音/发声抽帧 QA 思路。

## 未验收 / 限制

- 没有调用真实 Sync Labs：没有 Key，自动化只跑 mock；provider 成功/失败的真实网络路径待人工确认。
- 没有调用真实 Seedance 2.0+；所有视频相关测试使用现有素材或 mock。
- provider 口型首期只支持单说话人；多说话人镜头禁用并提示拆镜。
- 口型 QA 的视觉判定是 advisory；采用口型版/忽略告警仍需人工操作。
- 表情参考生成没有做真实模型审美验收；只验证了请求、候选、往返、失效和参考排序。
- 旧项目 `lookEn` 中已有的瞬时表情不会自动清理；提示词阶段用本镜表演显式覆盖。
