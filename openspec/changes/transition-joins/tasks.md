# Tasks

## 1. 接缝数据与持久化

- [x] 1.1 在 `src/types.ts` 增加 `TransitionOut` / `TransitionEffect` / `TransitionGenerated`，并给 `ShotData` 增加 `transitionOut`；在 `src/api.ts` 的 `ProjectShot` 增加 `transition_out`；验证：`npm run build` 通过，字段可被类型系统检查。
- [x] 1.2 在 `src/shotSync.ts` 的 `bizSignature` / `nodeToShot` / `shotToData` 接入 `transition_out`，手工编辑时写 `handEdited: ['transition_out']`；验证：保存后重读，转场配置、关键帧与视频字段完整往返。
- [x] 1.3 新增 `src/transition.ts`：缺省接缝归一化（`relation === 'transition'` 且无数据 → 叠化 0.5s）、效果与生成配置共存、时长夹紧、非转场边强制硬切；验证：纯函数用例覆盖缺省、往返、非转场、短镜头夹紧。
- [x] 1.4 画布加载时按 `transition_out.to` 解析目标镜头并修复/重建转场边；删除转场边时清除源镜头的 `transition_out`，已有生成产物时先确认；验证：清空 localStorage 边后重载，转场与边都能恢复；删除后不再出现。

## 2. 统一剪辑序列

- [x] 2.1 新增 `src/editList.ts` 的 `buildEditList(nodes, edges)`：按播放顺序产出镜头条目、转场片段、接缝类型与起点，支持默认叠化、时长夹紧与 `inactive` 列表；验证：用例断言 3s+3s 叠化 0.5s → 5.5s、3s+1.2s+3s 两端 0.2s → 6.8s、0.4s 短镜夹紧。
- [x] 2.2 `src/Timeline.tsx` 的画面轨改读 edit list，把效果转场画成重叠带、生成转场画成片段，总长直接取 `total`；验证：时间线显示总长与 edit list 一致，拖动换序后接缝位置正确。
- [x] 2.3 `src/Preview.tsx` 的 `buildPlaylist`、`total` 与播放推进改读 edit list，生成转场作为独立条目播放，叠化用两层媒体叠加；验证：同一 fixture 的预览总长与 `buildEditList` 的总长误差 ≤ 0.1s。

## 3. 成片合成

- [x] 3.1 `/api/assemble` 接受可选 `joins`；`buildAnimatic` 按接缝折叠（cut → concat，effect → xfade），`joins` 缺失时保持现有纯 concat 行为；验证：`verify-export.mjs` 新用例用 ffprobe 断言 5.5s，旧请求仍通过。
- [x] 3.2 配音与字幕基准改由折叠后的镜头起点计算，重叠后第二镜配音与字幕同步前移；验证：0.5s 叠化用例中第二镜配音起点前移 0.5s，SRT cue 时间正确。
- [x] 3.3 生成转场作为插入片段参与合成，丢弃片段自带音频，两端各 0.2s 叠化；验证：1.2s 转场用例 ffprobe 总长 6.8s，音轨只来自镜头配音。
- [x] 3.4 更新 `README.md` 与 `DEPLOY-CHECKLIST.md`：说明接缝模式、`/api/assemble` 新增 `joins` 字段、ffmpeg 必须带 `xfade`；验证：文档里的 ffmpeg 检查命令与导出步骤可照做。

## 4. 画布交互与转场面板

- [x] 4.1 `src/ShotEdge.tsx` 的 chip 显示接缝摘要（`叠化 0.5s` / `擦除→ 0.8s` / `生成 1.2s`）与状态点；点击仍循环关系，首次落到转场立即写入默认叠化；验证：`verify-transitions-ui.mjs` 断言 chip 文案与关系切换。
- [x] 4.2 新增转场面板：模式分段控件、叠化/擦除/推移网格、方向、时长、净时长变化（`-0.5s` / `+0.8s`）；切换模式后两套配置都保留；验证：切到生成再切回效果，效果参数不丢；反之亦然。
- [x] 4.3 面板生成区：A 尾/B 首缩略图、参考选择器（默认继承两镜 `refIds`）、提示词、关键帧候选、视频状态、估算成本、失效提示；没有关键帧时视频按钮禁用并说明原因；验证：UI 用例覆盖继承、增删参考、禁用态。
- [x] 4.4 新增「全片统一叠化 0.5s」批量动作，只改效果模式的边并跳过生成转场；非相邻转场在 chip 与面板显示「未参与成片」；验证：批量后生成转场产物与模式不变；换序后标记出现。
- [x] 4.5 在 `README.md` 补充画布转场操作说明（如何标记、如何切生成、成本与等待）；验证：按文档步骤能从硬切走到一条生成转场。

## 5. 生成转场流程

- [x] 5.1 新增 `src/transitionGen.ts`：A 有视频取尾帧、否则取当前画面；B 有视频取首帧、否则取当前画面；复用 `/api/frames` 的 `times`；验证：有视频/只有静帧两种 fixture 都返回两张边界帧。
- [x] 5.2 参考解析：合并 A、B 两镜的 `collectShotReferences` 结果与边上补充，去重后按结构参考 → 角色 → 素材排序，最多 10 张；关键帧生成复用 `generateImage`，支持候选切换；验证：两镜同一角色只出现一次；候选切换后 `activeIdx` 正确持久化。
- [x] 5.3 视频请求按模型能力分流：关键帧永远作首帧；首尾帧模型（Seedance 2.5 / Kling v3）再把 B 首帧作尾帧、不送参考图（上游禁止尾帧与 reference_image 混用）；Seedance 2.5 首尾帧必须用 `adaptive` 比例；验证：`dryRun` 断言三种请求体。
- [x] 5.4 生成时长规则：目标默认 1.2s；仅首帧模型生成后裁尾到目标，首尾帧模型保留整段并提示模型下限；产物落盘后静音；验证：ffprobe 断言时长与无片段音频。
- [x] 5.5 生成必须逐条手动触发，面板显示估算成本与实际等待；批量动作与标记转场都不得提交任务；验证：标记转场后任务数为 0，批量叠化后生成边任务数仍为 0。

## 6. 失效、兼容与降级

- [x] 6.1 用 `shortHash` 生成转场指纹（A/B 的图片与视频路径、关键帧、提示词、目标时长、模型键），变化时置 `stale` 并保留产物；验证：修改 A 的 `videoUrl` 后 `stale === true`，关键帧与视频仍在。
- [x] 6.2 导出结果报告失效转场数量，用户仍可继续导出；验证：包含 1 条失效转场的导出返回 `staleTransitions: 1`。
- [x] 6.3 兼容与隔离：旧存档的转场边按默认叠化解释且不回写；切换项目不显示也不写入上一项目转场；无 `shotId` 的镜头给出无法持久化提示；验证：旧 fixture、项目切换、无 shotId 三种用例。
- [x] 6.4 降级路径：短镜头夹紧后退硬切、边界帧缺失、参考图失效、所选视频模型不支持所需能力时都有明确提示且不提交任务；验证：每种情况断言提示文案与任务数。

## 7. 集成验证与回归

- [x] 7.1 新增 `verify-transitions.mjs`，覆盖规格中的默认叠化、往返还原、夹紧、时长公式、非相邻、失效与持久化；验证：`node verify-transitions.mjs` 退出码 0。
- [x] 7.2 新增 `verify-transitions-ui.mjs`，覆盖 chip、面板、模式切换、批量、未参与成片与生成区禁用态；验证：脚本通过并产出截图。
- [x] 7.3 扩展 `verify-export.mjs` 与 `verify-all.mjs` 纳入新脚本；验证：`node verify-export.mjs` 与整体回归通过。
- [x] 7.4 真实素材验收：两镜出片 → 标记叠化 → 导出 → 再改成生成转场 → 关键帧 → 视频 → 导出；验证：两条成片总长分别符合 5.5s / 6.8s 公式，画面能看到叠化与生成过渡，记录写入 `evidence/`。
- [x] 7.5 回归无转场项目：同一项目在改动前后导出，分辨率与总长一致，音轨与字幕位置不变；验证：ffprobe 对比记录。

## Workflow follow-up

- 实现前先确认 `shot-neighbor-references` 与 `project-media-persistence` 已归档或与本变更的参考解析、项目媒体路径不冲突。
- 归档前运行 `openspec validate transition-joins --strict`，同步 `shot-transitions` 主 spec 后再归档。
- 归档时在变更说明里附上真实素材验收的成片与截图路径。
