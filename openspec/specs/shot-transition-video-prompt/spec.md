# shot-transition-video-prompt Specification

## Purpose
让画布用户在生成转场视频前，以与分镜出片相同的方式查看并编辑结构锚点、风格参考与最终提示词，且预览与实际 Seedance 请求一致。

## Requirements

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

### Requirement: 结构锚点可见且可校正

系统 SHALL 在生成转场模式下展示结构锚点：首帧与尾帧两个槽位，默认均为未选择，MUST NOT 自动派生或预填。用户 MUST 能为每个槽位从候选里手动选择、清除、改写，并看到每条锚点的用途说明。首帧与尾帧 MUST 全部选定后才允许生成；缺任一侧时 MUST 在提交前 blocking，且 blocking MUST 对应可执行操作（选择候选、抽取两镜成片帧或打开相邻镜出片）。

#### Scenario: 首次打开两槽为空

- **WHEN** 用户首次打开一条生成转场的「选择出片参考 → 首尾帧」，且此前未选过边界
- **THEN** 首帧与尾帧两个槽位均显示未选择，且各自可展开候选

#### Scenario: 边界齐全可生成

- **WHEN** 首帧与尾帧均已由用户选定，且当前模型支持尾帧
- **THEN** 结构锚点区显示两枚缩略图，生成按钮可用

#### Scenario: 缺尾帧阻止

- **WHEN** 首尾直变但首帧或尾帧仍为空
- **THEN** 面板显示 blocking，生成按钮禁用，文案要求用户选择缺失槽位，而非提示刷新边界

#### Scenario: 旧项目保留已选

- **WHEN** 打开一个已保存过 `generated.boundary` 的旧项目转场
- **THEN** 两槽显示已保存的选择，用户可清除或改选

### Requirement: 风格参考可继承、排除与增补

系统 SHALL 默认继承相邻两镜已通过连线解析的角色与图片素材参考；用户 MUST 能关闭继承、逐项排除继承项，并从项目角色/素材/候选池增补参考。增补与排除 MUST 持久化在转场 `generated` 配置中，刷新与重开项目后保留。

#### Scenario: 排除继承项

- **WHEN** 用户关闭某条继承的角色参考
- **THEN** 该参考不再出现在「将提交」列表中，且 token 记入排除集

#### Scenario: 增补素材

- **WHEN** 用户从候选列表添加一张未连线的场景图
- **THEN** 该参考出现在风格参考列表并持久化 token

### Requirement: 提示词分层与手改全文

系统 SHALL 区分画面与过渡短提示、声音描述（无音色参考）、自动衔接约束段（只读或可折叠）与最终发送正文。最终正文在非编辑态 MUST 以只读预览展示；手改 MUST 通过明确的编辑、保存、取消动作提交，MUST NOT 在只读区直接写入 override。存在已保存的手改正文时生成 MUST 逐字发送该正文，MUST NOT 再追加自动衔接段；用户 MUST 能恢复自动拼装、用当前字段重填手改，并在输入变化导致拼装指纹不匹配时看到「旧快照」状态（与分镜出片手改行为一致）。

#### Scenario: 自动拼装含衔接

- **WHEN** 用户未手改全文且填写了画面短提示
- **THEN** 最终正文包含短提示、衔接约束与 morph 尾句（与 `shot-transition-continuity` 一致）

#### Scenario: 手改优先

- **WHEN** 用户通过保存手改提交全文并生成
- **THEN** 请求 prompt 与手改正文逐字相同，不含系统追加的衔接段

#### Scenario: 编辑流

- **WHEN** 用户点「编辑」修改正文并保存
- **THEN** 面板 badge 为「已手改」，只读区显示保存后的全文

#### Scenario: 旧快照

- **WHEN** 用户已保存手改后改变了边界、风格参考或画面/声音短提示使拼装指纹变化
- **THEN** 面板 badge 为「旧快照」，正文仍为手改版本，用户可继续生成或点「重新拼装」

### Requirement: 条件过期提示

当转场边界、风格参考、锚点策略或相邻镜提示词相对上次成功出片发生变化时，系统 SHALL 标记转场出片条件为 stale，并提示用户核对预览或重生成；该行为 MUST NOT 单独阻止生成。

#### Scenario: 改边界后 stale

- **WHEN** 用户手改边界路径或刷新边界导致 URL 变化，且已有转场成片
- **THEN** 面板显示 stale 警告，建议重出生成视频

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

继承开关、排除/增补参考、边界路径手填与「抽取两镜成片帧」MUST 存在于转场工作台内，但 MUST 收纳在单一折叠区（如「转场参考与边界」），MUST NOT 在主 `vp-refs` 外再铺一套平行参考列表。主 `vp-refs` MUST 唯一展示结构首尾帧、合并图/视频参考与省略项。

#### Scenario: 无重复参考列表

- **WHEN** 用户扫读转场 gen-box
- **THEN** 参考条目只出现在本次出片提示词面板的 `vp-refs` 中一次

#### Scenario: 高级区可排除

- **WHEN** 用户展开转场参考与边界折叠并排除一条继承参考
- **THEN** 主 `vp-refs` 与将提交计数即时更新

#### Scenario: 抽取只产候选

- **WHEN** 用户在该折叠区点「抽取两镜成片帧」
- **THEN** 结果只出现在首尾帧候选里，槽位与 `generated.boundary` 都不变

### Requirement: 转场出片底栏主操作

转场面板在「生成」模式下 MUST 提供与分镜视频 Tab 底栏同构的主操作区：固定于面板底部，主按钮文案为「生成视频」「重出视频」（与分镜一致），footnote 为估价或 blocking 首条 message 或错误摘要。存在 blocking 时主按钮 MUST 禁用。转场生成中主按钮文案 MUST 变为「取消生成」且可点击取消，此行为为转场相对分镜的明确例外。

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

### Requirement: blocking 可执行引导

转场 blocking 涉及首尾帧未选或相邻镜缺画面时，面板 MUST 提供跳转到对应镜头检查区（选中该镜并聚焦视频相关设置）的入口，与文案提示并列。

#### Scenario: 缺边界引导

- **WHEN** blocking 提示首帧或尾帧未选
- **THEN** 用户除「抽取两镜成片帧」外可见打开上镜或下镜的快捷入口

### Requirement: 首尾帧候选来源

每个首尾帧槽位 MUST 提供可用候选，至少包含：上镜/下镜当前画面与全部候选图、项目媒体库图片、手填地址。首帧候选 SHOULD 优先展示上镜画面，尾帧候选 SHOULD 优先展示下镜画面。候选 MUST NOT 在用户点选前写入槽位。

#### Scenario: 现成画面候选

- **WHEN** 上镜已有当前画面且下镜已有当前画面，用户展开首帧候选
- **THEN** 上镜当前画面出现在首帧候选中，下镜当前画面出现在尾帧候选中，两槽仍保持未选择

#### Scenario: 媒体库候选

- **WHEN** 用户从项目媒体库选择一张图片作为首帧
- **THEN** 该图片写入首帧槽位并可预览

#### Scenario: 手填地址

- **WHEN** 用户在槽位地址框粘贴一个本地路径或 URL
- **THEN** 该地址写入对应槽位，与点选候选等价

### Requirement: 抽取两镜成片帧只产候选

系统 SHALL 提供显式的「抽取两镜成片帧」动作：上镜成片抽尾帧、下镜成片抽首帧，结果 MUST 只作为对应槽位的候选缩略图展示，MUST NOT 自动写入任何槽位。抽取失败 MUST 提示失败原因并保留现有候选；没有成片时 MUST NOT 阻塞其他候选来源。

#### Scenario: 抽取后仍未选中

- **WHEN** 用户点击「抽取两镜成片帧」且两镜都有成片
- **THEN** 首帧候选出现上镜尾帧、尾帧候选出现下镜首帧，两槽仍为未选择状态

#### Scenario: 抽取失败不覆盖

- **WHEN** 上镜抽帧失败
- **THEN** 面板提示失败，首帧槽位保持用户当前选择或空值

### Requirement: 生成不自动覆盖手选边界

生成转场视频时 MUST 只使用 `generated.boundary` 中已保存的首尾帧，MUST NOT 在提交前重新抽帧或改写边界。出片成功后 MUST NOT 用自动抽取结果覆盖用户选择。若提交前边界缺失，MUST 以 blocking 阻止，MUST NOT 就地补齐。

#### Scenario: 生成使用手选边界

- **WHEN** 用户选定首尾帧后点击生成
- **THEN** 请求中的首帧/尾帧 URL 与用户所选完全一致

#### Scenario: 成片存在也不重抽

- **WHEN** 两镜都有成片，且用户已手选边界后生成
- **THEN** 系统不调用自动抽帧，不改变已保存的边界

#### Scenario: 缺边界的请求被拒绝

- **WHEN** 边界缺失时绕过面板直接发起转场请求
- **THEN** 请求被拒绝，错误信息要求先选择首帧与尾帧

### Requirement: 首尾帧槽位显示来源

系统 SHALL 记录并展示每个已选边界的来源类别（上镜/下镜画面、抽取帧、媒体库、手填），使提示词参考列表与弹窗标签与用户实际选择一致，MUST NOT 对非抽取来源标注「上一镜尾帧」或「下一镜首帧」。

#### Scenario: 媒体库来源标签

- **WHEN** 用户用项目媒体库图片填充首帧
- **THEN** 该锚点标签不显示为「上一镜尾帧」，而显示其实际来源

#### Scenario: 旧数据无来源

- **WHEN** 旧项目边界没有来源字段
- **THEN** 标签使用中性文案，不推断为抽取帧
