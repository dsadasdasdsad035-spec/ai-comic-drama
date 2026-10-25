# Design

## Context

动机与范围见 `proposal.md`，行为契约见 `specs/`。这里只记录影响实现方式的现状：

- `server/publish-platforms.mjs` 的平台记录是静态表，字段为 `id / label / short / backendUrl / contentTypes / modes / manualOnly / verified / coverAspects / limits / max / notes`。`limits` 是 `{ title, description, tags }` 三个上限。
- 预检的标题校验是 `!title.trim()` 阻断 + `title.length > platform.limits.title` 阻断，没有下限分支。封面校验已经按 `platform.coverAspects` 逐个遍历，天然支持多比例，只是 `CoverAspect` 类型和 CSS 只有两档。
- `server/publish-package.mjs` 用 `aspectSlug()` 把比例转成文件名（`9:16` → `9x16`），对四比例无需改逻辑。
- 前端 `src/publish/types.ts` 声明 `CoverAspect = '9:16' | '16:9'`；`PublishBoard.tsx` 收集所需比例时写了 `if (a === '9:16' || a === '16:9')`，其余静默丢弃；`publish.css` 只有 `.pb-cover-frame.portrait`（9/16）与 `.landscape`（16/9）两条。
- `src/publish/PlatformBadge.tsx` 写死了三个 id 到缩写的映射与 `known` 判定；`publish.css` 里有三个 `.pb-badge.<id>` 色块。
- `server/publish-adapters.mjs` 的 `runSteps(page, steps, ctx)` 只在主 `page` 上定位元素，步骤类型支持 `goto / wait / click / fill / setInputFiles / waitForFunction / captchaCheck`。视频号的表单在 `micro/content/post/create` iframe 里。
- 登录已经具备：`openLoginWindow()` 打开有头 Chrome、`launchPersistentContext` 把登录态留在 `.publish-profiles/<accountId>/`。新增平台只需填 `backendUrl`，无需新机制。
- `verify-publish-contract.mjs` 有一条 `assert.equal(PLATFORMS.length, 3)`；`verify-publish-api.mjs` 的 mock 页按 URL 关键字（`bili` / `toutiao`）选择页面模板。

## Goals / Non-Goals

**Goals:**

- 让「加一个平台」退化为只改两张声明表，前端组件与 CSS 不再需要为每个平台单独改。
- 让封面、标题、草稿三处表达能力覆盖调研到的全部国内平台差异，一次改到位。
- 保持现有安全边界不变：凭据只在本机 profile、自动流程不点最终发布、无证据平台不盲点。

**Non-Goals:**

- 不做海外四个平台（YouTube / TikTok / Instagram / Facebook）。它们走官方 OAuth + 平台 API，与浏览器自动化是两条通道，属于后续独立变更。
- 不改队列并发模型、任务状态机、幂等键与发布包目录结构。
- 不为微博、企鹅号、网易号、搜狐号编写猜测选择器。
- 不做定时发布、多账号同时发布、发布数据回收。

## Decisions

### 1. 封面比例扩为四元联合，CSS 用具名比例映射

`CoverAspect` 扩为 `'9:16' | '16:9' | '3:4' | '4:3'`；`COVER_ASPECT_ORDER` 保持「先竖后横」并补全四档。CSS 不再用 `portrait` / `landscape` 两个语义类，改为 `data-aspect` 属性配合 `aspect-ratio`，由一条规则覆盖四档。发布包的 `aspectSlug()` 已能处理任意比例，无需改。

- 替代方案：保留两个语义类，3:4 归入 portrait、4:3 归入 landscape。否决——`aspect-ratio` 值不同，靠类名归类仍是给每档写一条规则，只是把硬编码换了位置。
- 替代方案：用内联 style 设置 `aspect-ratio`。否决——比例同时影响容器尺寸与内部填充方式，散在组件里比一处 CSS 更难审。

### 2. limits 拆成上限 + 可选下限 + 可选缺省

平台记录改为：

```
limits: {
  titleMax: number
  titleMin?: number          // 声明下限
  titleOptional?: true       // 无独立标题字段
  descriptionMax: number
  tagsMax: number
}
```

预检分支顺序为：`titleOptional` → 跳过标题校验；空值 → 若 `titleMin` 存在则报太短、否则报不能为空；`length < titleMin` → 太短；`length > titleMax` → 超长。两种原因用不同 issue code，便于界面分别定位与文案。

- 替代方案：保留 `title` 作为 `titleMax` 的别名，只追加 `titleMin`。否决——同一字段两种语义，读代码的人会猜；rename 一次的成本远低于长期歧义。
- 替代方案：把 `titleOptional` 做成 `titleMax: 0`。否决——用数值编码「没有这个字段」是隐式约定，且 0 与「上限为零」无法区分。

### 3. 草稿类型用枚举声明，界面文案由它驱动

平台记录加 `draftKind: 'server' | 'local' | 'none'`。`modes` 里的 `draft` 仍表示「允许走保存草稿流程」，`draftKind` 表示「草稿存在哪里」。两者组合后：

| modes 含 draft | draftKind | 行为 |
|---|---|---|
| 是 | server | 正常保存，回执说在平台后台 |
| 是 | local | 正常保存，回执说明仅本机浏览器、清数据即丢 |
| 是 | none | 预检阻断并说明该平台无草稿 |
| 否 | 任意 | 不出现保存草稿选项 |

- 替代方案：只靠 `modes` 表达，不引入 `draftKind`。否决——小红书能存草稿但存在浏览器里，只靠 modes 会让界面承诺「已存入平台」。
- 替代方案：给小红书这类平台单独加一个 `localDraft: true` 布尔。否决——布尔无法表达第三种状态（快手未确认有草稿），枚举更诚实。

### 4. 适配器步骤增加 frame 作用域，用一次性包装而非改全部步骤

`runSteps` 增加可选的第四段作用域：步骤上可带 `frame: '<url 片段或选择器>'`，执行器在该步骤前用 `page.frameLocator(...)` 定位，失败按 `selectors_changed` 处理。默认不填时行为不变。

- 替代方案：把整个 `runSteps` 改成接收 `frameLocator` 而不是 `page`。否决——会改动三个现有适配器与队列调用方，收益只是少一个可选参数。
- 替代方案：视频号单独写一个不走 `runSteps` 的实现。否决——步骤表的可审计性是这套设计的核心，为单个平台绕开它会让两套逻辑并行。

### 5. 徽标信息进平台表，前端只做通用渲染

平台记录加 `badge: { text: string, color: string }`。`PlatformBadge` 改为从传入的平台对象取这两个值；没有时回退到 id 首字母 + 通用样式。`publish.css` 里三个 `.pb-badge.<id>` 色块删除，改成一个用 CSS 变量上色的通用规则。

- 替代方案：在 `PlatformBadge` 里维护 id → 徽标的映射表。否决——那仍然是前端需要为每个新平台改一次的硬编码，只是从三处收成一处。
- 替代方案：徽标色由 id 哈希生成。否决——平台品牌色是已知信息，哈希出的颜色既不准确也不稳定。

### 6. 平台清单与分层

新增 12 个平台，按「是否有可核实的表单证据」分层：

```
可直接执行（verified 域保持 false，即只有草稿路径）：
  xigua         西瓜视频   16:9     标题 30            server
  xiaohongshu   小红书     3:4      标题 20            local
  kuaishou      快手       9:16     无独立标题          none
  wechat-channels 视频号   4:3+3:4  短标题 6-16         server
  zhihu         知乎       16:9     标题 5-50          none
  baijiahao     百家号     16:9     标题 9-30          none
  dayu          大鱼号     16:9     标题 5-60          none

只能人工（manualOnly）：
  weibo / qiehao / netease-hao / sohu-hao
```

「可直接执行」的平台仍保持适配器 `verified: false`，即预检只允许草稿与发布包，不允许点最终发布——这与现有三个平台一致，不因新增平台而放宽。

- 替代方案：把四个无证据平台也写成适配器并标 `verified: false`。否决——`verified: false` 允许走草稿自动化，等于用猜测的选择器去点真实后台；现有设计明确反对盲点。
- 替代方案：先只加「有把握」的七个，微博等四个等有账号再说。否决——用户要求全部对接；把它们注册为 manualOnly 既满足「能选、能配文案、能导出发布包」，又不冒盲点风险。

### 7. 快手「无独立标题」按 description 承载

快手视频页没有独立标题字段，发布时把标题并入描述。`titleOptional: true`，适配器 `fillMetadata` 只填描述（标题作为描述前缀），避免把一个不存在的字段硬塞进选择器。

- 替代方案：把快手 titleMin/titleMax 设成与实际描述一致，用标题字段填描述。否决——字段语义错位，回执与校验信息都会误导。
- 替代方案：为快手扩展一个 `titleFallback: 'description'` 能力。否决——只有快手一个平台需要，先用 `titleOptional` + 适配器内处理更简单，等第二个平台出现再抽象。

## Risks / Trade-offs

- **[七个新平台的选择器来自公开的开源实现与前端 bundle，未经真实登录态验证]** → 全部保持 `verified: false`，只能跑草稿；失败必然落在 `selectors_changed` 而非盲点。任务里要求每个新适配器都有本地 mock 页断言，且失败信息记录具体阶段。
- **[小红书草稿是浏览器本地存储，用户清理浏览器数据即丢失]** → 用 `draftKind: 'local'` 在界面明确说明，回执不承诺「已存入平台」。
- **[视频号表单在 iframe 内且上传完成会刷新表单]** → 适配器要求先等上传完成的信号再填文案与封面，任务里单列这一条；iframe 地址变化按 `selectors_changed` 失败。
- **[封面从两档扩到四档，已有成片配置里只有 9:16 / 16:9]** → 旧配置不需要迁移，缺失的 3:4 / 4:3 只在选中需要它的平台时才被预检报告；解析层对未知比例仍按「忽略」处理而不是报错。
- **[平台数量从 3 增到 15，发布台列表可能拥挤]** → 目标平台沿用现有列表布局；任务里要求在 900px 宽度下验证不横向溢出。若确实拥挤，另行处理，不在本次扩列。
- **[删掉 `.pb-badge.<id>` 色块会让已有三个平台的品牌色需要重新填进平台表]** → 首次迁移时把现有三个色值原样搬进 `badge.color`，视觉不变；任务里要求截图对比。

## Migration Plan

无数据迁移：`CoverAspect` 扩展对旧配置向后兼容，`limits` 改名只影响服务端与类型定义，平台新增不影响已有账号与任务。

上线顺序：

1. 模型改造（封面四档、limits 拆分、draftKind、badge、frame 作用域）——先让现有三平台在新模型下全部通过原有校验，确认无回归。
2. 逐个加七个可执行平台，每加一个配一份 mock 页断言。
3. 加四个 manualOnly 平台。
4. 发布台界面适配（四档封面、标题太短/超长文案、草稿类型表述、徽标通用渲染）。
5. 更新三个校验脚本并重拍发布台证据截图（1500 / 1100 / 900 三个宽度）。

回滚即 revert；已生成的发布包与任务记录不受影响。

## Open Questions

无。海外四个平台已明确排除在本次范围之外，需要时另立变更。
