# Spec Delta

## ADDED Requirements

### Requirement: 转场共用分镜出片提示词面板

转场「生成」模式下的 `gen-box vid-box` MUST 使用与分镜视频 Tab 相同的「本次出片提示词」面板组件与 DOM 结构（`vp-panel`、`vp-summary`、`vp-refs`、`vp-issue`、`vp-text`、`vp-meta`）。转场预览数据 MUST 映射为与分镜可读的摘要字段（模式/秒/分辨率/正文来源/参考计数）；分镜专有项（表情、表演、音色）MUST 显示为「无」或省略，MUST NOT 另起一套手写 `vp-panel`。

#### Scenario: 转场与分镜同组件

- **WHEN** 用户对比分镜视频 Tab 与转场生成区的「本次出片提示词」
- **THEN** 两者使用同一组件类名与折叠/徽章/编辑流程，转场无第二套平行 UI

#### Scenario: 成片元数据可回看

- **WHEN** 转场视频生成成功且用户展开提示词面板底部元数据区
- **THEN** 可见当次实际发送的正文、模型与时间戳，与分镜 `videoMeta` 行为等价

### Requirement: 转场生成前校验与反馈对齐分镜

`generateTransitionVideo`（或等价入口）MUST 在置 running 之前读取拼装结果的 `blocking`，首条 blocking MUST 阻止开跑并 surfacing 与分镜相同的错误态（不设 running、可写 error/toast）。当参考图或参考视频因上限或首期规则被省略时，开跑前 SHOULD 以与分镜出片相同的 toast 文案提示用户。

#### Scenario: blocking 阻止开跑

- **WHEN** 预览列出 blocking 且用户点击底栏主按钮
- **THEN** 不进入生成中状态，footnote 提示先处理上方出片提示词里的阻止项

#### Scenario: 省略参考 toast

- **WHEN** 合并结果含 omitted 或 omittedVideos 且用户开始生成
- **THEN** 出现与分镜出片相同语义的省略说明 toast（若存在省略项）

### Requirement: 转场 blocking 与 warning 结构

转场拼装结果的 `blocking` 与 `warnings` MUST 使用与分镜相同的 issue 结构（含稳定 `code` 与 `message`），面板 MUST 按 code 渲染 `vp-issue` 行，以便共用提示词面板与测试断言。

#### Scenario: 互斥参考带 code

- **WHEN** 首尾直变导致风格参考不提交
- **THEN** warning 或 omitted 说明带可断言 code，且 message 对用户可读

### Requirement: 手改时分层输入 footnote

当转场最终正文为手改覆盖时，「画面与过渡」「声音描述」字段上方 MUST 显示与分镜运动提示词相同的 footnote：说明分层字段修改不影响出片，须在提示词面板恢复自动拼装。

#### Scenario: 手改后编辑短提示

- **WHEN** 用户已保存手改正文并修改画面与过渡
- **THEN** 可见 footnote，且生成仍发送手改正文

### Requirement: 转场参考与边界高级编辑

继承开关、排除/增补参考、边界路径手填与「刷新边界帧」MUST 存在于转场工作台内，但 MUST 收纳在单一折叠区（如「转场参考与边界」），MUST NOT 在主 `vp-refs` 外再铺一套平行参考列表。主 `vp-refs` MUST 唯一展示结构首尾帧、合并图/视频参考与省略项。

#### Scenario: 无重复参考列表

- **WHEN** 用户扫读转场 gen-box
- **THEN** 参考条目只出现在本次出片提示词面板的 `vp-refs` 中一次

#### Scenario: 高级区可排除

- **WHEN** 用户展开转场参考与边界折叠并排除一条继承参考
- **THEN** 主 `vp-refs` 与将提交计数即时更新

## MODIFIED Requirements

### Requirement: 转场出片底栏主操作

转场面板在「生成」模式下 MUST 提供与分镜视频 Tab 底栏同构的主操作区：固定于面板底部，主按钮文案为「生成视频」「重出视频」「出片中…」（与分镜一致），footnote 为估价或「先处理上方出片提示词里的阻止项」或错误摘要。存在 blocking 时主按钮 MUST 禁用。转场生成中主按钮文案 MUST 变为「取消生成」且可点击取消，此行为为转场相对分镜的明确例外。

#### Scenario: blocking 禁用底栏

- **WHEN** 预览列出 blocking 且用户未在生成中
- **THEN** 底栏主按钮禁用，footnote 提示先处理上方出片提示词里的阻止项

#### Scenario: 文案与分镜一致

- **WHEN** 用户无转场成片且未在生成中
- **THEN** 主按钮文案为「生成视频」

#### Scenario: 生成中取消

- **WHEN** 转场视频正在生成
- **THEN** 底栏主按钮为「取消生成」，可中止本地等待

### Requirement: 出片信息分区顺序

「生成」模式下转场 `gen-box vid-box` MUST 按与分镜视频 Tab 相同顺序展示：出片设置与估价、成片预览（若有）、出片模型与分辨率、`gen-controls` 时长摘要、原生音频（禁用展示）、`vid-note` 与 `vid-refs` 摘要行、本次出片提示词面板。画面与过渡、声音描述 MUST 位于 gen-box 之上（与分镜「运动提示词」同级）。接缝与效果区 MUST 位于 gen-box 之上。转场成片时长控件 MUST 位于 gen-box 外或接缝区旁，MUST NOT 插在模型行与原生音频之间。时间轴 delta 摘要 MUST NOT 占据 gen-box 与底栏之间的独立脚注条。

#### Scenario: 扫读顺序

- **WHEN** 用户展开转场生成出片工作台
- **THEN** 自上而下与分镜视频 Tab 的 gen-box 内顺序一致，提示词面板位于 gen-box 末尾

#### Scenario: 时长控件位置

- **WHEN** 用户调整转场成片秒数
- **THEN** 控件不在原生音频区块与 vid-note 之间

### Requirement: 转场出片只有一个拼装结果

系统 SHALL 为每条生成转场边提供单一拼装结果，同时给出最终提示词、结构锚点附件、参考图与参考视频附件（含省略项）、锚点策略及阻止原因；转场面板展示的正文 MUST 与实际 `/api/seedance` 转场请求中的 `prompt` 逐字一致，结构首尾帧与（在策略允许时）参考图、参考视频 MUST 与面板列出的附件一致。成功出片后 MUST 持久化当次 prompt 的元数据以供提示词面板「当前视频的提示词」展示。

#### Scenario: 预览与请求一致

- **WHEN** 用户展开「本次出片提示词」并点击底栏「生成视频」
- **THEN** 面板正文与请求 `prompt` 完全相同，且 `vp-refs` 列出的首尾帧与请求边界字段一致

#### Scenario: 互斥时清单诚实

- **WHEN** 锚点策略为首尾直变且当前模型禁止同时提交尾帧与 reference_image
- **THEN** 面板仍将参考图列出，并标明本次未提交及原因；生成不因隐藏项而静默丢参考

#### Scenario: 允许提交时参考图一致

- **WHEN** 锚点策略与模型允许同时提交风格参考图
- **THEN** 请求 `refImages` 与面板标记为将提交的参考图 URL 集合一致

## REMOVED Requirements

（无）
