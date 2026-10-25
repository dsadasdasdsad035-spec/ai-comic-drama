# Tasks

## 1. 提示词工作台承载 3D 调度

- [x] 1.1 给 `PromptTable` 增加 `canvasNodes`、`characters`、`assets`、`sceneLayouts`、`projectAspect`、`onEditorDirtyChange` 入参，并在 `App.tsx` 传入现有数据；验证：`npm run build` 通过，提示词工作台正常加载。
- [x] 1.2 在 `PromptTable` 增加 `editorShotId` 和 lazy 加载的 `SceneCodeWorkbench` overlay；用 `shotToData(shot, base)` 合成 `ShotNodeType`，把画布节点与本集项目镜头按 `shotId` 去重合并；验证：已在画布和未上画布的镜头都能打开编辑器，画布上已连线的素材仍能在 3D 参考选择器中看到。
- [x] 1.3 在提示词表新增「3D」列：用 `resolveShotSchedule` 显示 `未渲染 / 生效 / 仅审阅 / 已过期`，提供「打开」按钮；有 `scheduleVideo` 时提供「查看」链接；验证：三种状态 fixture 显示正确，查看链接能打开 MP4，且不自动触发生成。
- [x] 1.4 新增 3D-only 写回适配器：把 `CodeEditorSave` / `CodeEditorRendered` 映射成只含 `scene_code`、`shot_3d_context`、`scene_code_meta`、`schedule_video`、`schedule_meta`、`motion_note`、`schedule_frames` 的 `Partial<ProjectShot>`；先读当前项目，把补丁合进完整镜头列表再 `mergeProjectShots`，避免把其他镜头标 orphan，并同步本地 `shots`；验证：先改提示词不保存，再保存 3D，重新读取项目时提示词、描述、表演保持原值，3D 字段已更新。
- [x] 1.5 接入离开保护：`PromptTable` 把编辑器 dirty 状态通过 `onEditorDirtyChange` 交给 `App`，`changeView` 在 `view === 'prompts'` 且编辑器 dirty 时 confirm；验证：改了 3D 代码未保存时切到画布会弹确认，取消后留在提示词页。
- [x] 1.6 更新 `README.md` 的提示词工作台说明：3D 入口、状态含义、保存只写 3D 字段；验证：按文档路径能从提示词页打开、保存、重开 3D。
- [x] 1.7 新增 `verify-prompt-3d-workbench.mjs`，覆盖入口、未上画布镜头、状态 chip、3D-only 保存不覆盖提示词草稿、离开保护；验证：`node verify-prompt-3d-workbench.mjs` 退出码 0。

## 2. 删除画布与 Inspector 的 3D 调用

- [x] 2.1 删除 `App.tsx` 右击菜单的 `scheduleEdit` / `schedule3d` / `schedref` 三个动作，以及只服务它们的 `genSceneCodeVideo` / `genScheduleVideo` / `openScheduleEditor`；验证：画布右击镜头不再出现 3D 动作，TypeScript 无未使用符号。
- [x] 2.2 删除 `App.tsx` 的 `editorNodeId` / `editorDirty` / `editorNode` / `saveEditor` / `applyEditorRender` 和全局 `SceneCodeWorkbench` overlay，移除传给 Inspector 的 `onOpenSchedule`；验证：画布加载、选中、出图、出片、连播等现有路径正常。
- [x] 2.3 删除 `Inspector.tsx` 的「3D 调度」区块、调度视频预览、`useScheduleVideoRef` / `useScheduleFrames` 开关、`motion-hint` 和「更多」里的「打开 3D 调度」，清理不再使用的 `resolveShotSchedule` / `videoRefOn` / `framesToggleEnabled` 等变量与导入；验证：Inspector 四个页签正常，视频页仍显示提示词面板和视频素材参考。
- [x] 2.4 删除 `SceneCodeWorkbench` 的「渲染后抽帧」复选框和 `useFrames` 状态；渲染结果仍可返回 `frames` 供 3D 面板使用，但不再写 `use_schedule_frames`；验证：编辑器渲染成功，项目里不再因编辑器新增 `use_schedule_frames: true`。
- [x] 2.5 更新 `scheduleStatus.ts` 里「画布出片、Inspector 状态和 3D 参考开关共用」的注释和调用点，明确它只服务提示词侧状态与 `motionNote` 推导；验证：`grep -rn "3D 参考开关" src/` 不再出现过期说明（历史数据字段除外）。
- [x] 2.6 更新仍断言画布/Inspector 3D 入口的验证脚本（至少 `verify-schedule3d.mjs`、`verify-video-ref-ui.mjs`、`verify-videoref*.mjs`、`verify-shot-inspector.mjs`），改为断言入口不存在；验证：相关脚本全部退出码 0。

## 3. 连线视频素材作为出片参考

- [x] 3.1 在 `shotReferences.ts` 新增 `collectVideoReferences`：按 `refIds` 顺序解析 `asset-` 视频节点，返回 URL、标签和缺失原因，按 URL 去重；`collectShotReferences` 继续跳过视频素材，图片 4 张额度不变；验证：单视频、多视频、节点删除、文件缺失四类用例。
- [x] 3.2 重构 `buildShotVideoRequest`：删除 `useVideoRef` / 调度帧注入 / `schedule-stale` 阻塞 / `video-ref-missing`；用第一条连线视频生成 `video` 附件，新增 `omittedVideos`；新增 `video-asset-missing` 阻塞；保留 `video-ref-unsupported` 警告；原生音频与视频素材冲突时阻塞并给出可操作文案；验证：四种出片模式（首帧/多图/视频/原生音频）的附件与阻塞原因正确。
- [x] 3.3 调整视频提示词拼装：有视频素材时追加「只参考运动、机位与节奏，外观以参考图和文字为准」的限定，删除 3D 白模专属文案；手改正文时附件不变；验证：自动拼装与手改两种情况的正文和附件清单。
- [x] 3.4 调整 `fingerprintOf`：参考视频改用 `videoRefs`，移除 `scheduleVideo` / `useScheduleVideoRef` / `useScheduleFrames`；保留 `motionNote`；验证：新增/移除/更换视频素材会让旧手改快照标为过期，旧 3D 开关变化不再影响指纹。
- [x] 3.5 更新 `VideoPromptPanel` / `ShotVideoRequest` 类型：显示视频素材标题、`视频1` 槽位和 `omittedVideos`；面板摘要不再声称会使用 3D 调度；验证：连线视频后 Inspector 显示「视频1=素材标题」，多条视频显示被忽略项及原因。
- [x] 3.6 更新 `App.tsx` 的出片请求和 toast：`refVideos` 仍只送 `request.video` 一条，图片省略和视频省略分别提示，不能再用「参考图最多 4 张」描述视频省略；验证：mock `/api/seedance` 请求体包含 `reference_video`，且没有 `scheduleVideo`。
- [x] 3.7 更新 `README.md` 的出片参考说明：视频参考来自素材连线，图片与视频额度分离，首期只使用第一条视频；验证：文档步骤与 UI 文案一致。
- [x] 3.8 新增 `verify-video-asset-ref.mjs`，覆盖单视频、多视频只取第一条、图片额度不变、缺失视频阻塞、模型不支持警告、旧 3D 开关不生效；验证：脚本退出码 0。

## 4. 渲染 MP4 进入素材选择器

- [x] 4.1 核对 `renderSceneCode` / Blender 最终渲染的落盘路径和 `/api/media` 的 `videos` 扫描目录；若项目级路径未覆盖，扩展扫描但保持现有 `public/videos` 行为；验证：渲染后在 `listMedia` 的 `videos` 里能拿到该 URL。
- [x] 4.2 验证素材选择器「视频」分类能显示该 MP4、播放/暂停预览、显示时长，确认后素材类型变为 `video`；取消或 Esc 不写回；文件缺失时禁用确认；验证：扩展 `verify-media-picker` 或新增用例覆盖四类场景。
- [x] 4.3 在提示词 3D 状态列/编辑器成功提示里提供「查看视频」或「复制地址」入口，方便用户去素材卡选择；验证：渲染完成后能从提示词侧打开该 MP4，也能在素材选择器选中。
- [x] 4.4 更新 `README.md` / `DEPLOY-CHECKLIST.md`：说明「提示词工作台渲染 3D → 素材卡选择该视频 → 连线分镜 → 出片」的完整路径，以及 `/videos` 目录和 Blender 依赖；验证：按文档从零完成一次渲染到选素材。

## 5. 兼容、回归与集成验收

- [x] 5.1 旧项目兼容：加载带 `use_schedule_video_ref` / `use_schedule_frames` 的镜头，确认字段保留、界面无开关、出片不自动带 `reference_video`、保存后数据不丢；验证：旧 fixture 读写出入一致。
- [x] 5.2 旧项目回归：没有 3D 开关、没有视频素材连线的项目，出片提示词、图片参考、音色参考与改动前逐字一致；验证：更新 `verify-video-prompt-preview.mjs` 并对比改动前后请求体。
- [x] 5.3 真实集成：在提示词工作台打开某镜 3D → 渲染 MP4 → 素材卡选择该视频 → 连线到分镜 → 出片；验证：`/api/seedance` 收到 `reference_video`，视频文件来自 `/videos`，把截图/日志写入 `evidence/`。
- [x] 5.4 运行完整回归：`npm run build`、`node verify-prompt-3d-workbench.mjs`、`node verify-video-asset-ref.mjs`、素材选择器验证、3D/出片相关旧脚本全部通过；验证：命令退出码 0，记录结果。
- [x] 5.5 运行 `openspec validate move-3d-schedule-to-prompt-workbench --strict`，并按项目要求同步 `scene-blocking-3d`、`shot-video-prompt`、`asset-media-picker` 主规格；验证：validate 通过，主规格包含新行为。

## Workflow follow-up

- 归档前确认 `shot-neighbor-references`、`transition-joins` 等已归档变更没有改动 `shotReferences.ts` / `buildShotVideoRequest` 的同一段逻辑，避免合并冲突。
- 归档时在变更说明里附上真实集成的截图、请求体日志和素材选择器截图。
