# Acceptance：转场首尾帧可选

## 输入模式

- [ ] 两帧齐全且模型支持尾帧 → 模式「首尾帧」，请求带 `first_frame` + `last_frame`，不裁剪
- [ ] 只有首帧 → 模式「仅首帧」，请求只带 `first_frame`，`trimTo` 等于目标时长
- [ ] 无帧但有连线参考图 → 模式「参考图」，请求带 `reference_image`，参考图不被标记为省略
- [ ] 无帧但有参考视频 → 模式「参考视频」
- [ ] 无帧无参考且模型声明 `textToVideo` → 模式「纯文本」，请求只带 prompt/duration/resolution/ratio
- [ ] 无帧无参考且模型未声明 `textToVideo` → 出现 `transition-no-input` blocking，生成按钮禁用

## 面板

- [ ] 高级区摘要显示「首帧已选/未选 · 尾帧已选/未选 · 本次 <模式>」
- [ ] 出片提示词面板摘要首段显示当前输入模式，而不是固定「首尾直变」
- [ ] 缺帧不再出现「缺边界」blocking；只有真的没有任何输入时才阻止

## 服务端

- [ ] 转场请求缺首尾帧不再被 400 拒绝（旧文案已移除）
- [ ] 首尾帧齐全但模型不支持尾帧时仍 400，文案提示可只保留首帧或改纯文本
- [ ] 纯文本模式对未声明 `textToVideo` 的模型返回 400，文案要求补输入或换模型
- [ ] `dryRun` 回显的 `mode` 为 `text` / `transition` / `ref` / `video` 之一，与输入一致

## 模型能力

- [ ] `ModelFeatureSet` 含 `textToVideo`；APIMart Seedance 2.5 与方舟视频条目声明为 true
- [ ] 设置库从 v10 升到 v11 时，已有条目按 key 补上 `textToVideo`，其它条目不被动改
- [ ] Kling v3 未声明 `textToVideo`，纯文本时被阻止

## 旧数据

- [ ] 已存首尾帧的旧转场继续走首尾帧模式，行为不变
- [ ] 旧版关键帧（`bridging: keyframe`）仍按关键帧首帧出片

## 自动化

```bash
node verify-transitions.mjs
npx tsc --noEmit
npx vite build
```

真实 dryRun 验证（需 dev server）：

```bash
curl -sS -X POST http://127.0.0.1:5273/api/seedance -H 'Content-Type: application/json' \
  -d '{"transition":{"bridging":"morph"},"prompt":"过渡","seconds":4,"ratio":"16:9","dryRun":true,"modelKey":"apimart-video-seedance-2-5"}'
```

期望：`ok:true`、`mode:"text"`、request 中无图片字段。
