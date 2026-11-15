# Tasks

## 1. 拼装层

- [x] 1.1 `performance.ts` 抽出 `performanceDirectionText`，表演段同时输出强度、动作、视线、本镜说话与逐行台词表演
- [x] 1.2 `videoPrompt.ts` 引入方向性指令块（move / dialogue / performance / sound / reference / video / constraints），已存在则跳过
- [x] 1.3 `buildShotVideoRequest` 用统一拼装追加右侧字段，手改正文不经过该层
- [x] 1.4 `promptRender.ts` 脚本拼装同步使用表演方向、参考槽位、声音段，保证两路径信息一致

## 2. 提交可见

- [x] 2.1 `server/app.ts` 视频任务与响应带实际 `prompt`，方舟/APIMart 共用范围约束兜底
- [x] 2.2 `api.ts` 的 `startVideo` 返回 `prompt`
- [x] 2.3 `App.tsx` 用服务端回报的正文写 `video_meta.prompt`
- [x] 2.4 出片面板新增「提交给 <模型>」与逐字提交声明
- [x] 2.5 `theme.css` 补提交目标与声明样式

## 3. 验收

- [x] 3.1 扩展 `verify-prompt-render.mjs`：表演/运镜/台词/参考槽位/约束/原生音频/手改
- [x] 3.2 更新 `verify-video-prompt-preview.mjs`：面板提交目标、参考图槽位、逐字一致
- [x] 3.3 更新 `tests/performance-video-prompt.ts`
- [x] 3.4 `npx tsc --noEmit`、`verify-prompt-render`、`verify-transitions`、`verify-native-audio`、`verify-video-prompt-preview`
