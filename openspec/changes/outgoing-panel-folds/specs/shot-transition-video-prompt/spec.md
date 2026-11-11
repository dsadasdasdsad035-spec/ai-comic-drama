# Spec Delta

## MODIFIED Requirements

### Requirement: 转场共用分镜出片提示词面板

转场「生成」模式下的 `gen-box vid-box` MUST 使用与分镜视频 Tab 相同的「本次出片提示词」面板组件与 DOM 结构（`vp-panel`、`vp-summary`、`vp-refs`、`vp-issue`、`vp-text`、`vp-meta`）。转场预览数据 MUST 映射为与分镜可读的摘要字段（模式/秒/分辨率/正文来源/参考计数）；分镜专有项（表情、表演、音色）MUST 显示为「无」或省略，MUST NOT 另起一套手写 `vp-panel`。转场 MUST 复用分镜的折叠原语与摘要行样式，「AI 扩写」MUST 同样以单行入口加浮层呈现，MUST NOT 在转场维护另一套展开行为。

#### Scenario: 转场与分镜同组件

- **WHEN** 用户对比分镜视频 Tab 与转场生成区的「本次出片提示词」
- **THEN** 两者使用同一组件类名与折叠/徽章/编辑流程，转场无第二套平行 UI

#### Scenario: 折叠与浮层行为一致

- **WHEN** 用户在转场生成区折叠提示词或打开 AI 扩写浮层
- **THEN** 折叠箭头、摘要行布局与浮层内容与分镜视频 Tab 一致

#### Scenario: 成片元数据可回看

- **WHEN** 转场视频生成成功且用户展开提示词面板底部元数据区
- **THEN** 可见当次实际发送的正文、模型与时间戳，与分镜 `videoMeta` 行为等价

### Requirement: 出片信息分区顺序

「生成」模式下转场 `gen-box vid-box` MUST 保留与分镜视频 Tab 相同的分区内容与先后关系：出片设置与估价、成片预览（若有）、出片模型与分辨率、`gen-controls` 时长摘要、原生音频（禁用展示）、`vid-note` 与 `vid-refs` 摘要行、本次出片提示词面板。在上述顺序下 MUST 以「单行摘要条 + 就地展开」承载：提示词默认展开，出片设置、参考与边界默认折叠，且转场 MUST NOT 出现分镜没有的分区层级。画面与过渡、声音描述 MUST 位于 gen-box 之上（与分镜「运动提示词」同级）。接缝与效果区 MUST 位于 gen-box 之上。转场成片时长控件 MUST 位于 gen-box 外或接缝区旁，MUST NOT 插在模型行与原生音频之间。时间轴 delta 摘要 MUST NOT 占据 gen-box 与底栏之间的独立脚注条。

#### Scenario: 扫读顺序

- **WHEN** 用户展开转场生成出片工作台
- **THEN** 自上而下的分区与分镜视频 Tab 一致，提示词面板位于 gen-box 末尾

#### Scenario: 默认折叠

- **WHEN** 用户首次打开转场生成模式
- **THEN** 提示词区为展开态，出片设置与参考与边界为折叠态，底部主按钮可见

#### Scenario: 时长控件位置

- **WHEN** 用户调整转场成片秒数
- **THEN** 控件不在原生音频区块与 vid-note 之间
