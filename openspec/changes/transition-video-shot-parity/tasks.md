# Tasks

## 1. 双镜拼装

- [x] 1.1 实现双镜 `collectComposerRefs` / `collectVideoReferences` 合并与去重，输出与 `ShotVideoRequest` 同构的 preview（含边界首尾槽位），并通过 `verify-transitions.mjs` 新增合并/相邻镜用例
- [x] 1.2 删除 `submitStyle = false` 写死，按 morph+尾帧互斥计算 `submitted` 与 `refImages`，断言互斥与非互斥两路径
- [x] 1.3 更新 `transitionFingerprint` 纳入合并 refs 与边界，并在指纹变更用例中断言 stale 行为仍成立

## 2. 生成与服务端

- [x] 2.1 更新 `App.generateTransitionVideo` 使 `startVideo` body 与 preview 一致（prompt、refImages、视频参考字段），对照 preview 快照测试
- [x] 2.2 调整 `vite.config.ts` 转场分支：非互斥时处理 `refImages` 与参考视频，与分镜路径一致；添加或扩展服务端相关测试/手工用例说明
- [x] 2.3 确认 morph+2.5 互斥时请求仍不含 reference_image 且与面板 omitted 一致

## 3. 出片工作台 UI

- [x] 3.1 抽取 `VideoOutgoingWorkbench`（或等价组件），分镜视频 Tab 迁入且行为不变（对照现有 Inspector 手测清单）
- [x] 3.2 `TransitionPanel` 仅保留接缝三态 + effect + workbench；移除独立风格参考分区，统一参考列表与 `CapModelSelect`
- [x] 3.3 嵌入禁用态 `NativeAudioPanel` 与声音描述说明，验收文案与 spec「原生音频展示策略」

## 4. 转场级配置与验收

- [x] 4.1 保留 `excludeRefIds` / `refIds` / `inheritRefs=false` 语义并与新 merge 对齐，扩展 `verify-transitions.mjs` 排除与增补用例
- [x] 4.2 编写 `ACCEPTANCE.md`：预览=请求、参考列表与分镜对照、blocking 引导、底栏与手改 regression 检查项

## Workflow follow-up

- 评审通过后运行 `/opsx-apply` 实施。
- 完成后 `/opsx-archive` 合并主 spec。
