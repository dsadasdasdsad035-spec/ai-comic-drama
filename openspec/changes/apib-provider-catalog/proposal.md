# Proposal

## Why

用户提供的 APIMart 网关（文档站 `docs.apib.ai`，网关 `api.apimart.ai`）覆盖文本、图像、视频、音频等大量模型，但当前应用只有 6 种写死的渠道协议：第三方图像只认同步 `data[].url`，视频只支持方舟，第三方文本也没有处理 APIMart 的 `{code, data}` 外层包装。要接入这些模型，必须补齐异步任务适配、模型目录同步，并把按能力重复渲染的渠道/模型 UI 收敛成按渠道管理。

如果提供的 Key 余额为 0，网关对所有请求（包括 `GET /v1/models`）返回 402；真实生成验收需要先充值。

## What Changes

- 新增 APIMart 渠道预设：`kind: 'apimart'`、`baseUrl: 'https://api.apimart.ai/v1'`、用途为文本/图像/视频/音频，独立 Key，绝不回退方舟 Key。
- 新增模型目录同步：读取 `GET /v1/models?expand=category`，按分类与能力标签映射到现有能力，一个模型只登记一行。
- `ModelEntry` 增加可选 `caps?: Cap[]`（保留 `cap` 兼容旧数据），让文本/高质量、图像/三视图、视频/视频参考不再重复登记。
- 新增 APIMart 运行时适配：
  - 文本/视觉：OpenAI 兼容 `/chat/completions`，解包 `{code, data}`，流式 SSE 容错归一化。
  - 图像/三视图：异步提交、`/v1/tasks/{id}` 轮询、结果立即下载；参考图先走 `/v1/uploads/images` 换 URL。
  - 视频/视频参考：Seedance 2.5 与 Kling v3 使用专用字段；其余生成型视频模型走统一 schema 通用适配；编辑/动作控制/再生成等工具模型只登记目录、不可运行。
  - 配音：`/v1/audio/speech`，使用 OpenAI 风格 6 个音色。
- 设置页重构：左侧导航、渠道卡每个渠道只出现一次、添加渠道预设下拉、模型库（搜索/筛选/批量）、默认路由“渠道 → 模型”两级下拉、目录同步弹窗、状态条与固定保存/未保存提示。
- 渠道测试区分 402 余额不足、401 鉴权失败与可用。
- 预置版本升到 9（v5 追加 DeepSeek Flash，v9 追加 APIMart），只合并一次；已有默认模型保持不变。

**Out of scope**：

- Whisper 转写、Suno/Flow Music、内容审核：属于新产品能力，另立项。
- 视频编辑/动作控制/源任务再生成模型的运行时：保持目录-only；通用适配只覆盖“给首帧/参考图就出片”的生成型模型。
- APIMart 原生 tool calls：统一 chat 文档未声明 `tools`，实测前继续 JSON 协议。
- 本地参考视频上传：APIMart 未文档化视频上传接口，`videoRef` 仅接受公网 `video_urls`。
- 设置页迁移到 Tailwind/shadcn：保留现有全局 CSS 与 Cinema Dark token。

## Capabilities

### New Capabilities

- `provider-model-catalog`: 从渠道拉取模型目录，按分类/标签映射到能力，并幂等合并到模型表。
- `provider-settings-ui`: 设置页的信息架构、渠道卡、模型库、默认路由两级选择、目录同步弹窗与状态反馈。

### Modified Capabilities

- `model-provider-routing`: 新增 APIMart 渠道、四类能力路由、异步图像/视频协议、OpenAI 音频协议、`caps[]` 多能力模型、目录-only 模型不可选、402 测试语义。

## Impact

- 代码：`src/api.ts`、`src/Settings.tsx`、`src/ModelSelect.tsx`、`src/theme.css`、`vite.config.ts`，新增 `server/apimart.mjs`；可能抽取 `server/video.mjs` 的轮询/下载逻辑复用。
- 设置数据：`presetsVersion` 升到 9；`Provider` / `ModelEntry` 读时兼容新字段；不改变已有默认模型。
- 验证：`verify-providers.mjs`、`verify-settings-db.mjs`、`verify-stage-models-ui.mjs`、`verify-video-ref-ui.mjs` 等依赖 `.st-*` 选择器的脚本需要同步更新。
- 依赖：不新增 npm 依赖；目录同步与异步任务使用现有 `fetch`，UI 使用现有 React/CSS。
- 运维：APIMart Key 需充值后才能做真实生成验收；Key 不写入仓库，按现有方式存 SQLite 或 `.env`。
