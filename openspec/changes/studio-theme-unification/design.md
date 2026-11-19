# Design

## Context

创意视图的容器在 `src/creative/StudioFrame.tsx`：一个同源 `<iframe src="/studio/">`，加一个「主题桥」`applyStudioTheme(doc, mode)`。桥目前只写 8 个变量，且写在 `doc.documentElement.style` 上。宿主 `dsh-client-ui-theme` 的两套调色板声明在 `body` 与 `body[data-ds-dark-theme]` 上，所以桥的写入被继承覆盖——实测 `body` 计算值仍是宿主的 `#151517`。

宿主设计系统的两套尺度可以直接读源码：圆角 `--dsw-radius-xs/sm/md/lg/xl/panel` = 4/8/12/16/20/28px，被引用 337 次，硬编码 `border-radius: Npx` 只有 139 处；字号硬编码 774 处但集中在 11/12/13/14px，内容字号轴 `--dsh-content-font-size` 默认 14px。

宿主的主题服务 `ctx.theme` 被 `ui-layout`（呈现器）、`ui-sidebar-terminal`、`ui-settings-account` 消费，因此 `ui-theme` 这一行不能禁用。宿主还有 `overrideTokens(source, tokens)` 与 `register(definition)`，但那是**客户端插件**的能力，需要 pnpm workspace + tsdown + client ln 构建链，与本仓库现有的 `server/dsh-plugins/*`（纯 Node 插件）不是一条线。

约束：`tests/studio-shell.mjs` 已经用 esbuild 把 `applyStudioTheme` 单独抽出、在假文档上跑断言；测试形态必须保持可这样测。

## Goals / Non-Goals

**Goals:**
- 调色板在宿主文档中真正生效，覆盖到文字三层与全部高频表面/描边。
- 应用是明暗的唯一来源，且能抵抗宿主呈现器的改写。
- 控件形状与应用控件体系可辨地一致，且不为改字号引入排版回归。
- 全部改动留在父页面一侧，不新增构建链，不动宿主插件与工具桥。

**Non-Goals:**
- 不自造品牌素材，不替换宿主侧栏图标。
- 不改宿主字号体系（正文行高与工具卡密度会连带变化）。
- 不接管宿主的会话列表、消息流、审批交互逻辑。
- 不追求与 dsh 上游升级解耦——升级后需要重新校对选择器，这是已知代价。

## Decisions

### D1：写入落点从 `html` 改为 `body` 内联样式

宿主的调色板是 `body` 自身声明，自身声明胜过继承，所以只有写在 `body` 上才有效。

替代方案：写在 `body` 之前注入一个 `<style>` 标签。否决理由——宿主的呈现器会逐个 `removeProperty` 它自己写过的内联变量，但不会动 `<style>` 里的一条规则；反过来，样式表里 `body{...}` 的优先级与宿主同表内的规则要靠插入顺序博弈，脆弱。内联是优先级最高且与宿主呈现器同一战场，观察者回写时也是同样的操作。

### D2：token 表从 8 个扩到约 25 个，按引用热度取舍

映射集合（名字取自宿主设计系统的公开面）：

```
文字    label-primary / label-secondary / label-tertiary / label-caption
交互    interactive-bg-hover / interactive-bg-active
表面    bg-base / bg-layer-1 / bg-layer-2 / bg-layer-3 / bg-layer-4 / bg-overlay
描边    border-l1 / border-l2 / border-l3 / border-l4
状态    state-business-primary / state-error-primary / state-warn-primary / state-success-primary
区域    specific-sidebar-fill / specific-sidebar-nav-item-active / specific-bubble / specific-tip
滚动条  scrollbar-bg-l2 / scrollbar-hover-l2
```

取值全部来自 `src/theme.css` 的语义变量（夜间 `--bg #070b11`、`--panel #0e1620`、`--panel-2 #111c28`、`--panel-2` 之上还有 `--chrome-1 #101b27`、`--line #1d2b3a`、`--line-2 #2a3d52`、`--text #dbe7f3`、`--text-2 #b6c8da`、`--muted #7d93ab`、`--accent #38bdf8`、`--ok #4ade80`、`--warn #fbbf24`、`--danger #f87171`）。

替代方案：把 `--dsw-static-*`（82 个）也接上。否决理由——alias 层是组件实际消费的层，static 只是 alias 的来源；改 static 等于污染宿主的面板定义，收益与风险不成比例。

映射表在 TS 里必须继续是**字面量常量**而不是 `getComputedStyle` 读取：测试要在无 DOM 的假文档上断言具体色值，运行时读计算样式会让断言依赖浏览器。

### D3：用 `MutationObserver` 做回写守卫，而不是轮询或覆写宿主方法

`observe(doc.body, { attributes: true })` 盯 `data-ds-dark-theme`，另 `observe(doc.documentElement, { attributes: true })` 兜住宿主可能改根节点 `color-scheme` 的情况；回调里调用同一个 `applyStudioTheme`。

替代方案：
- `MutationObserver` on `style` 属性：变量内联在 `body.style` 上，宿主逐条 `removeProperty` 会触发 `style` 变更，但这个 attribute 变更过于频繁（我们自己的写入也会触发），容易自激。用属性 + 回调里幂等比较（写入前先比当前值，相同则不写）来阻断自激。
- 覆写 `ThemePresenter` 或 `ctx.theme`：跨 bundle 边界改第三方实例，升级即碎。

回写时限取一个可测的短值（≤ 300ms），足以覆盖一次宿主写入，又不至于让断言需要长等待。

### D4：隐藏宿主「外观」设置行，但把失败做成无副作用

设置行没有稳定的 `data-*` 钩子，只有 CSS Modules 哈希类名。做法是在注入的样式表里按文案匹配（中文与英文两份）把该行 `display: none`，选择器限定在设置面板容器内以避免误伤。

替代方案：直接禁用 `ui-theme` 插件行。否决——`ui-layout`、`ui-sidebar-terminal`、`ui-settings-account` 都注入 `ctx.theme`，禁用会让这三个客户端插件激活失败，等于拆掉外壳。

失败语义：选择器未命中 → 该行照常显示、照常可点，但点了不改变配色（因为 D3 已经保证配色跟着应用走）。这条退化路径必须被测试覆盖，它是我们与宿主文案漂移之间的缓冲。

### D5：圆角只改 6 个变量，字号不动

`--dsw-radius-*` 是宿主自己暴露的尺度轴，改它一次覆盖 337 处引用，不需要逐组件补丁。映射到应用的 5/7/10 体系：`xs 4→4`、`sm 8→5`、`md 12→7`、`lg 16→10`、`xl 20→10`、`panel 28→10`。

`panel` 从 28 压到 10 是最大的视觉变化（输入框与首屏大卡），但正是它让「胶囊形输入框」这个最显眼的不一致消失。`xl` 与 `panel` 同值是有意的：宿主在这个体系里用它们区分「大卡片」与「容器」，压到应用尺度后两者本就应该同值。

字号不动：宿主的内容字号轴默认 14px、硬编码集中在 11–14px，与应用 11/12/13/15 交错重合；改它会连带行高与工具卡密度，收益不抵回归风险。

### D6：品牌降噪只做父页面能做的减法

`document.title` 由父页面直接改写；版本徽标与首页吉祥物用注入样式隐藏。宿主品牌是独立插槽插件 `ui-brand-official`（占 `sidebar.brand.mark`、`sidebar.brand.name`、`conversation.hero.frame`），替换插槽 occupant 需要客户端插件——明确排除。

保留宿主侧栏图标，是为了避免"降噪"变成"自造图形"，后者每次宿主改图标我们都要重画。

### D7：主题桥保持纯函数形态可测

`applyStudioTheme` 继续只接收 `(doc, mode)` 并只做 DOM 写入，不依赖 React。`MutationObserver` 与标题改写放在组件层（`StudioFrame` 的 effect），不塞进纯函数。这样 `tests/studio-shell.mjs` 现有的假文档测法原样可用，新增断言只需给假文档补 `body.style` 与 `body.getAttribute`。

## Risks / Trade-offs

- **宿主升级后 token 名变动** → 未映射的变量退化为宿主默认色，局部区域色差但不致不可读（已写成场景）。CI 的 token 比对断言会在升级时先炸，而不是等用户发现。
- **隐藏设置行的文案选择器失效** → 退化为"多一个无效开关"，配色不受影响（D4 的失败语义 + 对应场景）。
- **观察者自激导致 CPU 占用** → 回写前先做幂等比较，值相同不写；观察者只监听 `body` 与根节点的 `attributes`，不监听 `style` 子属性。仍有理论残留风险：若宿主以与我们不同的值反复写同一属性，会形成有限频率的拉锯。按宿主的实现（仅在主题偏好或系统配色变化时发布）这不会发生，但要留一条"若观察到持续回写则降级为一次性写入"的退路。
- **圆角压平导致层级糊** → `xl` 与 `panel` 同值后，某些依赖大圆角差建立层级的浮层可能失去区分。场景里要求「相邻层级保持可辨认的圆角差」，实现时对浮层补 `border` 或阴影来补偿。
- **`panel 28→10` 是审美取舍** → 若实际观感过硬，回退成本只是改一个值；这条写进 tasks 的验收项，而不是设计假设。

## Migration Plan

1. 先改 `applyStudioTheme` 的落点与 token 表，同步改 `tests/studio-shell.mjs` 的落点断言——这一步单独可验证，且是收益最大的一步。
2. 加观察者与标题改写，补抗回写与标题断言。
3. 注入样式表：圆角变量 + 品牌降噪 + 隐藏设置行，各自独立断言。
4. 全量跑 `tests/studio-shell.mjs` 与既有的创意宿主冒烟测试。

回滚：所有改动都在 `StudioFrame.tsx` 与 `theme.css` 的 `.studio-frame*` 区块，回退这两个文件即恢复原状；宿主侧零改动，不需要迁移或清理。

## Open Questions

- 观察者的回写时限具体取 300ms 还是 500ms，等第一次实测宿主写入延迟后再定，不影响本设计。

## 实测中带出的范围外修正

桌面端实测（5.3–5.5）被一个与本变更无关的缺陷挡住，经确认后一并修掉：

- **现象**：宿主每次重启换随机端口，创意视图就永久停在 `dsh web authentication required`，只能手删浏览器 cookie 才恢复。
- **成因**：`server/studio-proxy.mjs` 的 `hasHostCookie` 只按 `dsh-auth-` **前缀**判断。宿主 cookie 的完整名是 `dsh-auth-<base64url(sha256(host:port))>`，换端口就换名字；旧 cookie 留在浏览器里会让代理误判「已持有凭据」而不再注入引导令牌。
- **修正**：按当前上游 authority 派生出的精确名字匹配（`hostCookieName` / `hasHostCookie(header, authority)`），并在响应里对旧名字补 `Max-Age=0` 作废；`withBootstrapToken` 增加 authority 参数，HTTP 与 WebSocket 两条路径都传入。
- **验证**：`tests/studio-proxy.mjs` 新增「只认当前 authority」「过期凭据作废」「换端口后重新注入令牌」三条断言；真实宿主下重启后不手删 cookie 直接进入创意视图成功，浏览器里只剩当前实例的一条凭据。
