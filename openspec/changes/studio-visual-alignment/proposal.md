# Proposal

## Why

创意视图把自己的外壳和宿主的 AppFrame 并排放在一起，但两套界面的尺度没有对齐：应用侧栏 240px、宿主侧栏 280px；正文 13px 对 14px；宿主侧栏顶部 60px 的品牌行在品牌被降噪隐藏后只剩一个折叠按钮；导航行 32px 对应用侧的 28–30px。主题、圆角与配色已经由现有桥接对齐，剩下这些尺度差异让操作员觉得"创意是嵌进来的另一个产品"。

## What Changes

- 在 `StudioFrame` 已有的注入样式（`studioStyleText`）里新增尺度规则：
  - 内容区 `--dsh-content-font-size: 13px`；
  - 侧栏根节点与会话行标题统一到 13px，避免导航行与会话列表大小混排；
  - 侧栏顶部品牌行高度 60px → 44px，让折叠按钮与对话标题行居中对齐；
  - 导航行 `panelRow` 高度 32px → 30px、行高 18px、行内 padding 9px。
- 新增注入文本断言：规则缺失（宿主类名漂移）时由测试报警，而不是静默退化成原样。
- 在 `docs/creative-host.md` 的人工验收清单补充"大屏/窄屏 + 日间/夜间"的尺度检查。
- 不修改：iframe 挂载方式、宿主列宽、宿主源码与 profile composition、任何服务端接口。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `creative-layout`: 新增"创意视图与主应用视觉尺度一致"的要求，覆盖内容字号、侧栏顶部带与导航行高。

## Impact

- 代码：`src/creative/StudioFrame.tsx`（`studioStyleText`）。
- 测试：沿用注入样式断言，新增或扩展一条用例检查三条规则存在。
- 文档：`docs/creative-host.md` 的人工验收清单。
- 无服务端、API、依赖、磁盘状态或数据迁移变化。
