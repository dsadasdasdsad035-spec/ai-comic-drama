# Tasks

## 1. Context manifest 与投影

- [x] 1.1 新增 `src/contextManifest.ts`：`ContextManifest`/`Attachment` 类型、`buildManifest`、`manifestText`、`manifestSummary`；`Shot3DContext` 增加可选 `briefOff`。验证：单测覆盖空清单、文本、媒体、brief 排除与元数据边界
- [x] 1.2 生成和聊天共用 manifest：`buildSceneCodeContext` 的镜头头只保留镜号/时长/画幅，景别/运镜只在文本附件里；`agentContextText` 改为 manifest 投影。验证：单测断言未附加的景别/运镜/台词不出现
- [x] 1.3 移除画布路径的 `catalog.defaults` 和聊天输入框预填；空清单时生成前提示添加附件。验证：画布空上下文返回可读提示，打开有文本的镜头输入框为空

## 2. 左浏览 / 右附加

- [x] 2.1 左浏览器增加当前项目显示和集数下拉，场景文本按集过滤；点选条目只预览。验证：切换集数只显示该集场次，预览不改变附件数
- [x] 2.2 预览区增加「加入上下文」动作，左浏览本身不修改上下文。验证：只预览后附件数不变，点击加入后 +1
- [x] 2.3 用附件栏替换 chips：展示 manifest 的媒体、文本和 brief 附件，逐项可移除；输入框默认空。验证：打开带文本的镜头附件可见且输入框为空，移除后清单少一项
- [x] 2.4 新增「推荐参考」：先预览 `catalog.defaults` 的条目，确认后才写入附件。验证：首开为空，取消不改变，确认后附件增加

## 3. 可见性与审计

- [x] 3.1 新增「查看将发送」面板：系统提示、镜头元数据、附件缩略图/全文、brief 原文与预计大小。验证：内容与 manifest 一致，且不展示图片字节
- [x] 3.2 每轮上下文审计：新增 `context_manifest` 事件与 reducer 部件，聊天渲染可折叠的「本轮上下文」卡。验证：一轮运行出现卡片，内容为附件标识/数量/元数据，不含 Key 或 CoT
- [x] 3.3 检查器区分两条通道：视觉模型收到 N 张图、代码模型收到哪些文本与 brief。验证：有图片附件时两行都出现

## 4. 运行时契约

- [x] 4.1 `get_shot_context` 只返回 manifest 投影与代码摘要，移除自动 brief、上次选择和镜头头内容。验证：mock agent 测试中未附加项不出现
- [x] 4.2 图在每轮模型调用前发出 manifest 摘要事件。验证：事件顺序正确，摘要不含图片字节或 Key

## 5. 验证与文档

- [x] 5.1 单测：manifest 构建、文本边界、`briefOff`、summary 与审计摘要
- [x] 5.2 Playwright：首开空附件、预览不附加、推荐确认、附件栏与检查器、审计卡、输入框无预填
- [x] 5.3 回归：工作台、chat-first、画布出片（空上下文提示与有附件生成）、legacy 只读、`npm run build`
- [x] 5.4 README 更新上下文规则：浏览/附加、manifest、推荐参考、无预填与审计

## Workflow follow-up

- 归档前先同步 `shot-3d-context`、`scene-agent-chat-ui`、`scene-agent-runtime` 主规格。
