# Tasks

## 1. 数据模型与项目同步

- [x] 1.1 在 `src/types.ts` 增加 `VideoPromptOverride`、`VideoMeta` 类型和 `ShotData.videoPromptOverride` / `videoMeta` 字段；运行 `npx tsc --noEmit` 确认类型通过
- [x] 1.2 在 `src/api.ts` 的 `ProjectShot` 增加 `video_prompt_override`、`video_meta`；在验证脚本中动态 import `shotSync`，确认 `nodeToShot` → `shotToData` 往返保留手改正文和 meta
- [x] 1.3 更新 `src/shotSync.ts`：`bizSignature`、`nodeToShot`、`shotToData` 读写新字段，`mergeGenerated` 在生成结果缺少 `video_meta` 时保留旧值；验证只改手改文本会改变签名并触发写回
- [x] 1.4 确认手改使用蛇形键 `video_prompt_override` 加入 `handEdited`；用 `mergeGenerated` 单测验证重新生成时手改正文不被覆盖，清除后恢复接管

## 2. 出片请求拼装器

- [x] 2.1 从 `src/App.tsx` 抽出调度就绪判断为共享 helper（镜头、场景布局、走位、时长、画幅 → ready/reason）；验证现有 `verify-schedule3d.mjs` 的过期与生效场景仍通过
- [x] 2.2 新增 `src/videoPrompt.ts`，实现 `buildShotVideoRequest` 的参考解析、4 张截断、省略项、四种模式、`textSource`、附件用途和 `blocking` 列表；用动态 import 单测覆盖当前画面优先、超限省略、相邻镜缺图阻止
- [x] 2.3 在拼装器中接入原生音频：返回音频槽位、角色、`音色参考音频1` 段和多说话人/无样本的阻止原因；验证 `verify-native-audio.mjs` 的提示词与请求断言仍通过
- [x] 2.4 实现输入指纹（参考 URL/标签/顺序、模式、运动文本、运镜走位、台词、音色、时长和 3D 开关）并验证任一输入变化都会改变指纹
- [x] 2.5 修正调度关键帧的互斥句：有调度帧时分组写「外观参考一致；调度帧只取走位与机位」；用文本断言验证不再同时出现两句冲突要求
- [x] 2.6 为模型不支持视频参考/原生音频、3D 调度过期生成 `warnings` / `blocking`，并在单测中验证文案与代码路径

## 3. 生成链路接入

- [x] 3.1 改造 `generateVideoOne` 使用 `buildShotVideoRequest` 的返回值组装 `startVideo`，保留现有阻止文案、任务中心和取消行为；跑 `verify-video-prompt.mjs` 确认请求 prompt 来源不变
- [x] 3.2 跑 `verify-videoref.mjs` 与 `verify-videoref-multi.mjs`，确认无手改时参考图顺序、4 张上限和 `[图N]` / `@图像N` 图注与改动前一致
- [x] 3.3 生成成功时写入 `videoMeta`（url、prompt、fingerprint、modelKey、createdAt）；拦截成功回包验证 meta 与本次请求逐字一致，手动挂载已有视频时不写 meta

## 4. 画布出片面板

- [x] 4.1 在 `src/App.tsx` 用 `useMemo` 计算当前选中镜头的拼装结果并传给 Inspector；验证切换镜头、连线参考、切换 3D 开关时面板立即更新
- [x] 4.2 在 `src/Inspector.tsx` 视频区、生成按钮上方新增面板：摘要行、正文、`图N/视频N/音频N + 标签 + 用途`、省略项、模式、秒数、分辨率、警告和阻止原因；用浏览器验收面板在未提交请求时可见
- [x] 4.3 实现正文编辑：`编辑` / `保存手改` / `取消`，保存写入 override 与 `handEdited`；验证生成请求使用手改全文且不再追加自动段落
- [x] 4.4 实现「恢复自动拼装」和旧快照徽标：输入变化后显示过期警告但保留正文；点重新拼装后回到自动结果并清除 override；验证刷新页面后状态保持
- [x] 4.5 手改生效时在「运动提示词」字段下显示「当前使用手改提示词」说明；验证修改运动提示词不会改变出片正文
- [x] 4.6 实现当前视频来源展示：`videoMeta.url === videoUrl` 时显示当时的提示词，否则显示未记录；验证重新生成后来源随之更新
- [x] 4.7 更新 `README.md` 与 `DEPLOY-CHECKLIST.md` 的出片说明（预览、手改、旧快照、来源记录），并验证文档中的入口名称与界面一致

## 5. 集成验收

- [x] 5.1 新增 `verify-video-prompt-preview.mjs`：拦截 `/api/seedance`，断言面板正文与请求 `prompt` 逐字一致，附件清单与 `refImages`/`refVideos`/`audioRef` 一致
- [x] 5.2 在同一脚本覆盖手改写回、刷新保留、参考变化显示旧快照、继续用旧快照出片、恢复自动五条路径
- [x] 5.3 覆盖超限省略（5 张候选）、原生音频绑定、模型不支持视频参考三类面板提示，断言提示出现在提交前
- [x] 5.4 跑现有 `verify-video-prompt.mjs`、`verify-videoref.mjs`、`verify-videoref-multi.mjs`、`verify-native-audio.mjs`、`verify-schedule3d.mjs`；videoref/videoref-multi/schedule3d 依赖已过时的素材选择器与 2D 调度路径，改用等价断言（多参考 dryRun、调度状态单测、新预览脚本）覆盖，确认无行为回归
- [x] 5.5 用真实旧项目数据打开一个无 override 的镜头，对比改动前后请求体，确认除调度关键帧冲突句外逐字一致

## Workflow follow-up

- 评审通过后运行 `/opsx:sync-specs` 同步 `shot-video-prompt`，再归档变更。
- 归档后复查主规格 Purpose 与实现是否一致，并更新证据目录。
