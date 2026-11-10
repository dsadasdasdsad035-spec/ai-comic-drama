# Tasks

## 1. 能力位与模式推导

- [x] 1.1 `src/api.ts` 的 `ModelFeatureSet` 增加 `textToVideo?: boolean`；`vite.config.ts` 预设中为支持文生视频的模型标注（Seedance 2.5、Kling v3、Seedance 2.0/2.5 方舟条目）；验证：`npx tsc --noEmit` 无新增错误
- [x] 1.2 `src/transitionGen.ts` 新增 `resolveTransitionInputMode({ boundary, refs, video, features })` 返回 `boundary | first-frame | reference | video-reference | text | none`；验证：`node verify-transitions.mjs` 断言五种输入各自得出正确模式

## 2. 前端解锁

- [x] 2.1 `buildTransitionVideoPreview` 删除「缺边界」blocking，改为按模式：`none` 时报 `transition-no-input`；验证：缺帧但有参考图时不出现 blocking
- [x] 2.2 `transitionRequestSeconds` 第三参数语义改为 `submitsLastFrame`，调用方（`App.tsx`、`TransitionPanel.tsx`）传 `mode === 'boundary'`；验证：只有首帧时返回 `trimTo`
- [x] 2.3 `transitionRefSubmitAllowed` / `styleRefOmitReason` 入参改为 `submitsLastFrame`；验证：未提交尾帧时参考图标记为将提交
- [x] 2.4 `src/App.tsx` 删除 `generateTransitionVideo` 里缺边界的 throw，改由 `preBundle.blocking` 统一处理；验证：`node verify-transitions.mjs` 断言生成路径无此 throw
- [x] 2.5 `TransitionPanel` 摘要与 `vp-refs` 显示当前输入模式；验证：五种模式文案正确

## 3. 服务端对齐

- [x] 3.1 `vite.config.ts` 把 `transitionMode` 拆为 boundary / firstFrame / ref / text 四种，按同一顺序推导；删除 `rawTransition && !transitionMode` 的 400；验证：`dryRun` 请求四种模式各自 200
- [x] 3.2 `vite.config.ts` 仅在「无任何图片输入且模型未声明 textToVideo」时报错，文案说明补参考或换模型；验证：`dryRun` 断言该错误只在此时出现
- [x] 3.3 `server/video.mjs` 的 `buildVideoPayload` 允许无首帧/无参考（纯文本 content），由调用方门禁；验证：`node verify-video-api.mjs` 通过
- [x] 3.4 APIMart 三族 payload 在无图时允许提交（generic 已有，确认 seedance-2.5 与 kling-v3 的必填校验放宽到由模式决定）；验证：`node verify-apimart-video-payload.mjs` 通过

## 4. 验收与文档

- [x] 4.1 扩展 `verify-transitions.mjs`：五种模式判定、缺帧不 blocking、裁剪规则、参考互斥、纯文本门禁；验证：`node verify-transitions.mjs` 退出码 0
- [x] 4.2 `README.md` 转场章节改为「首尾帧可选，按输入自动降级，纯文本需模型支持」；验证：README 不再写「两帧都就绪才能生成」
- [x] 4.3 编写 `ACCEPTANCE.md`：五种模式、裁剪、参考互斥、纯文本门禁、旧数据；验证：覆盖 spec 每个场景
- [x] 4.4 `openspec validate transition-optional-boundary --strict` 通过；验证：命令退出码 0

## Workflow follow-up

- 完成后归档 `transition-optional-boundary`，合并 delta 至 `openspec/specs/shot-transition-video-prompt/spec.md`。
- 归档前确认 `transition-boundary-extract-only` 已归档，否则两条 MODIFIED 会争同一 requirement。
