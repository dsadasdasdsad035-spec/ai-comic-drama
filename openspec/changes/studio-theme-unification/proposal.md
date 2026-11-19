# Proposal

## Why

创意视图把 dsh 作为同源 iframe 嵌入，主题桥（`src/creative/StudioFrame.tsx` 的 `applyStudioTheme`）却把 `--dsw-*` 变量写在 iframe 的 `documentElement` 上。宿主的明暗两套 token 直接声明在 `body` 与 `body[data-ds-dark-theme]` 上（`dsh-client-ui-theme/src/styles/design-platform.css`），而自定义属性「自身声明永远胜过继承」——于是桥上那 8 个变量对宿主组件**完全无效**。实测夜间主题下 `body` 计算值仍是宿主的 `#151517`，不是应用的 `#070b11`；文字三层 `label-primary/secondary/tertiary`（合计 1144 处引用）根本没被映射，仍是宿主的中性灰。

结果是外壳与内容在边界处呈现「两种黑」，创意视图看起来像嵌进来的另一个产品。这个问题在 dsh 迁移（`creative-studio-dsh-runtime`）后一直存在，只是被 iframe 边界掩盖了。

## What Changes

- 主题桥落点从 `html` 改到 `body` 内联样式，并把映射的 token 从 8 个扩到约 25 个：文字三层、交互态、表面五层、描边四层、状态四色、区域专用（侧栏、气泡、提示）、滚动条。文字颜色从此跟随应用，而不是宿主的中性灰。
- 新增回写守卫：宿主自身的主题呈现器会在用户操作或系统配色变化时改写 `body` 属性与变量，应用侧用一个 `MutationObserver` 发现被改回就重新贴，保证「应用是明暗的唯一决定者」。
- 应用的明暗成为唯一来源。宿主的设置页里那行「外观」开关只改宿主状态、改不动界面，因此需要一并隐藏，避免设置页呈现一个撒谎的开关。隐藏失败只允许退化成「多一个无效开关」，不得影响配色。
- **BREAKING**（对外观预期）：创意视图不再响应用户在 dsh 设置页里单独切换的明暗。用户在宿主内切到浅色、应用仍是夜间时，界面保持夜间。
- 设计尺度对齐：把宿主 6 个圆角变量（`--dsw-radius-xs/sm/md/lg/xl/panel`，被引用 337 处）压到应用的 5/7/10 体系。字号不动——宿主硬编码字号集中在 11/12/13/14px，内容字号轴默认 14px，与应用 11/12/13/15 本就重合，强行改会连带正文行高与工具卡密度。
- 品牌降噪：标签页标题改用应用名；隐藏侧栏的版本徽标与首页空态的大鲸鱼。宿主侧栏图标保留，不自造品牌素材。
- **不引入** dsh 客户端插件构建链（pnpm workspace + tsdown + client ln）。所有改动保持在父页面一侧。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `creative-dsh-host`：加强「外壳与应用主题和导航保持一致」。现有要求只约束「跟随主题、两套主题下呈现对应配色」，没有约束落点、覆盖范围与抗回写。新增要求：调色板变量 MUST 写在宿主 `body` 的有效层上；文字与表面 MUST 取自应用语义 token；宿主改写后 MUST 在限定时间内被重新贴回；应用是明暗的唯一决定者。
- `creative-layout`：新增「创意视图沿用应用的设计尺度」与「创意视图品牌降噪」。现有要求只约束导航位置与正文对比度，没有圆角、控件形状与品牌标识的约束。

## Impact

- 代码：`src/creative/StudioFrame.tsx`（主题桥、token 表、观察者、标题）、`src/theme.css` 的 `.studio-frame*` 区块（尺度与降噪样式）。
- 测试：`tests/studio-shell.mjs` 现有的 `applyStudioTheme` 断言需要随落点变更调整；新增 token 覆盖、明暗同向、抗回写三组断言。
- 宿主：`server/dsh-plugins/*` 与 41 个工具桥、专家人设、技能包加载路径**不改动**。宿主的 `ui-theme` 插件行不能禁用——`ui-layout`、`ui-sidebar-terminal`、`ui-settings-account` 三处依赖 `ctx.theme` 服务。
- 升级耦合：`--dsw-*` 变量名属于宿主设计系统公开面，相对稳定；隐藏设置行的文案选择器是最脆的一点，dsh 换语言或改文案即失效。这条风险由测试断言兜住，而不是靠人工复查。
