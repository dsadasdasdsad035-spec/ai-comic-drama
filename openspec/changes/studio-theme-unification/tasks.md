# Tasks

## 1. 调色板落点与 token 覆盖

- [x] 1.1 把 `applyStudioTheme` 的写入目标从 `documentElement.style` 改为 `body.style`，并把 `colorScheme` 一并写到 `body`；验证：`tests/studio-shell.mjs` 的假文档断言改读 `body.vars`，且新增一条断言「`documentElement.style` 上不再出现 `--dsw-*`」
- [x] 1.2 把映射表从 8 个扩到 design.md D2 的约 25 个 token（文字、交互态、表面、描边、状态、区域专用、滚动条）；验证：测试逐个断言夜间与日间两套值分别等于 `src/theme.css` 里对应语义变量的字面值
- [x] 1.3 给假文档补齐 `body.style.setProperty`、`body.getAttribute`、`removeProperty` 与 `documentElement.attributes`，保证桥的幂等比较逻辑可在无 DOM 环境下测；验证：`node tests/studio-shell.mjs` 通过且不依赖浏览器
- [x] 1.4 补一条降级断言：映射表缺某个宿主变量时，桥的写入调用不抛错、其余变量照常写入；验证：从测试里临时移除一个 token 后断言其余值仍然到齐

## 2. 明暗所有权

- [x] 2.1 在 `StudioFrame` 的 effect 里挂 `MutationObserver`（`body` 与 `documentElement` 的 `attributes`），回调调用同一个 `applyStudioTheme`；验证：断言组件源码存在观察者挂载与 `disconnect` 清理（沿用 `tests/studio-shell.mjs` 已有的源码断言手法）
- [x] 2.2 回写前做幂等比较：目标值已等于当前值时不写入，避免观察者自激；验证：新增单元断言「连续两次 `applyStudioTheme` 同模式时第二次不产生 setProperty 调用」（用计数型假文档）
- [x] 2.3 注入样式表隐藏宿主「外观」设置行，选择器按中文与英文两份文案匹配且限定在设置面板容器内；验证：断言样式表含两份文案选择器，且选择器以设置容器为前缀
- [x] 2.4 补隐藏失败的退化路径断言：选择器未命中时不允许抛错、不允许改动设置面板其余行；验证：在测试里用一个不含该文案的假 DOM 片段跑隐藏函数，断言无异常且其它节点 `display` 未被改写

## 3. 设计尺度

- [x] 3.1 注入 6 个圆角变量映射（`xs 4→4`、`sm 8→5`、`md 12→7`、`lg 16→10`、`xl 20→10`、`panel 28→10`）；验证：断言注入样式表含这 6 条声明，且取值与 design.md D5 一致
- [x] 3.2 为依赖大圆角差建立层级的浮层补 `border` 或阴影补偿，避免 `xl` 与 `panel` 同值后层级糊；验证：在桌面端实际页面上逐层截图确认浮层与背景可分辨，并在 `src/theme.css` 注入区块留下说明注释
- [x] 3.3 断言圆角注入不随主题变化、且在 `day` 与 `night` 下写入相同取值；验证：对同一注入函数用两套模式调用后比对字符串相等

## 4. 品牌降噪

- [x] 4.1 在 `StudioFrame` 里把 `document.title` 改写为应用名称，并在宿主再次改写后重新写回；验证：断言源码含标题写入与写回逻辑，测试用假 `document` 断言赋值为应用名
- [x] 4.2 用注入样式隐藏侧栏版本徽标与首页空态吉祥物，选择器限定在对应容器内；验证：断言样式表含这两条规则，且不含任何新增图形或背景图声明（降噪只做减法）
- [x] 4.3 补布局不塌陷断言：隐藏后侧栏项间距与首页输入区位置的既有取值不变；验证：在桌面端实际页面上对比隐藏前后的侧栏项 `offsetTop` 序列，断言差值不超过 2px

## 5. 集成验证

- [x] 5.1 跑通 `node tests/studio-shell.mjs`（含既有的「不改变外壳导航位置」与新增的全部断言）；验证：命令退出码为 0 且无失败项
- [x] 5.2 跑通既有创意宿主冒烟测试 `node tests/creative-host-smoke.mjs`，确认 41 个工具与专家、技能包加载未受影响；验证：命令退出码为 0，工具计数仍为 41
- [x] 5.3 在运行中的桌面端实测：用 CDP 读创意视图 `body` 的计算样式，逐项比对应用语义 token；夜间与日间各一轮；验证：所有映射项的计算值与应用 `src/theme.css` 对应变量一致（无 `#151517` 之类宿主默认值残留）
- [x] 5.4 在桌面端实测抗回写：在宿主侧手动移除 `data-ds-dark-theme` 并清除 `body` 上的 `--dsw-*`，观察界面在时限内恢复夜间；验证：截图对比，界面无浅色残留
- [x] 5.5 在桌面端实测首帧：在应用为日间、宿主偏好为深色的组合下首次打开创意视图；验证：加载遮罩撤除瞬间即为日间底色，录屏或连续截图无深色闪帧
- [x] 5.6 修掉实测挡路的范围外缺陷：`server/studio-proxy.mjs` 的鉴权 cookie 判定从前缀改为按当前 upstream authority 派生的精确名，并作废换端口前的旧 cookie；验证：`node tests/studio-proxy.mjs` 新增三条断言全过，真实宿主重启后不手删 cookie 也能进入创意视图

## Workflow follow-up

- 项目评审通过后归档本变更（`openspec archive`）。
- 归档后确认 `creative-dsh-host` 与 `creative-layout` 两份主规格已吸收新增需求。
