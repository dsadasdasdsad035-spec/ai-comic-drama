# Tasks

## 1. ZIP 解析与安全解包

- [x] 1.1 新建 `server/zip.mjs`：EOCD 定位、中央目录遍历、本地头偏移取值、`method 0` 直取 / `method 8` 用 `zlib.inflateRawSync`、`unixMode = externalAttrs >>> 16` 取文件类型。新建 `verify-bundle-import.mjs` 骨架（临时目录 + 断言工具）。用 `zip -q` 造一个含 2 个文件的包，断言能列出条目并正确解出内容。
- [x] 1.2 在 `server/zip.mjs` 加入中文文件名解码：`flags & 0x800` 置位按 UTF-8；未置位先 `TextDecoder('utf-8', {fatal:true})` 再试 `gb18030`，都失败返回 safeName + 原名标注。在 `verify-bundle-import.mjs` 增加段：用 `/tmp/cat-probe` 打成的包（实测未置 UTF-8 标志位）验证 19 个中文名 Markdown 全部可读；再造一个 GBK 名条目验证兜底。
- [x] 1.3 在 `server/zip.mjs` 加入拒绝规则：`..` 路径段、绝对路径、盘符、前导反斜杠、符号链接与设备文件（按 unixMode）、内层压缩包；忽略 `__MACOSX/`、`.DS_Store`、`._*`。在 `verify-bundle-import.mjs` 用构造的恶意包逐条断言：路径穿越被拒、符号链接被拒、内层 zip 被列为不可导入、`__MACOSX` 被静默忽略且不出现在结果里。
- [x] 1.4 在 `server/zip.mjs` 加入三层限额（条目 2000、单文件 30MB 图片 / 2MB 文本、总计 300MB）与「解压时累计计数、超限立即中止并删除已写文件」。在 `verify-bundle-import.mjs` 构造一个声明大小远小于实际内容的 deflate 条目，断言解压在超限处中止且临时目录被清空。明确不支持 ZIP64：遇到 EOCD 的 ZIP64 标记时返回明确错误。

## 2. 解包接口与临时目录生命周期

- [x] 2.1 在 `vite.config.ts` 注册 `POST /api/import/bundle`：接受 `application/octet-stream` 直传（文件名走 `X-File-Name` header，与 `/api/deliverables/import` 一致），返回 `{ bundleId, files: [{ id, path, name, size, kind: 'text'|'image', textPreview }], rejected, warnings }`；文本预览截断到 4000 字符。在 `verify-bundle-import.mjs` 启动临时 dev server 验证：真实资料包返回 31 条（含 19 文本 + 9 图片 + 2 目录被忽略），无 `__MACOSX`。
- [x] 2.2 注册 `GET /api/import/bundle/:id/file/:fileId` 读取临时目录内的图片（只允许该 bundle 目录内的安全名，拒绝任何拼接路径）；返回正确 Content-Type。在 `verify-bundle-import.mjs` 断言正常读取、越界 fileId 被拒、不存在的 bundleId 返回 404。
- [x] 2.3 实现临时目录生命周期：解包写 `os.tmpdir()/bundle-<random>/`；`res.on('close')` 不删（要留给确认导入）；确认导入完成后删除；进程内 10 分钟空闲回收定时器。在 `verify-bundle-import.mjs` 断言：取消后调用清理接口能删除目录；超过空闲阈值的目录被回收。

## 3. 分类器

- [x] 3.1 新建 `src/intake/classify.ts`：`classifyFile({ path, textPreview })` 返回 `{ labels: Label[], episodeScope, episodeNo?, confidence, reason }`，实现路径 → 文件名 → 内容三段规则。**必须按实测校准过的规则写**：图片按目录名含「参考照片/图片/参考图」；`角色档案/项目设定`→characters；`分镜`→shotlist；`提示词`→prompts；分镜表锚定**表头行首列**为「镜头」或 `shot`（`/^\|\s*(镜头|shot)\s*\|/im`），不是含「镜头」二字；`**Prompt**`/`Negative prompt`→prompts；`### 外观锚点`/`## 角色A：`→characters；`# 第N集`/`故事梗概`→script。在 `verify-bundle-import.mjs` 用真实资料包断言：9 张图为 image、`01_…角色档案.md` 为 characters、`05_…提示词.md` 为 prompts、10 个分集文件为 `script+shotlist` 双用途。
- [x] 3.2 实现 `episodeScope` 判定：内容里 `## 第(\d+)集` 小节数为 0→none、1→single、≥2→multi。在 `verify-bundle-import.mjs` 断言：`02_前10集分集大纲.md` 为 multi（10 节）而不是第 1 集；`03_第1集完整剧本与分镜.md` 为 single/1；角色档案与提示词文档为 none。同时断言目录与内容冲突时以内容为准并给出标注。
- [x] 3.3 无线索文件返回空 `labels`：用 `04_真实拍摄清单.md`、`06_剪辑与发布规范.md`、两个 README 断言为待判断；**特别断言 `猫咪真实参考照片/README.md` 不被判成 shotlist**（它的表格单元格里含「走路镜头」「转场空镜」，这是原设计的误判点）。
- [x] 3.4 在 `src/intake/classify.ts` 加入冲突检测 `findConflicts(files)`：按 `${label}:${episodeNo}` 聚合并返回同组多候选项；`episodeScope !== 'single'` 的跳过。在 `verify-bundle-import.mjs` 断言：两条第 1 集分镜表（10 镜 vs 12 镜）报冲突；10 个不同集号的剧本互不冲突。

## 4. 列表与分组预览

- [x] 4.1 新建 `src/intake/BundleDialog.tsx`：文件清单（原名、大小、用途徽标可多个、置信度、原因）、逐项改判多选（剧本/分镜/提示词/角色/参考图）、冲突项的并排选择、「让模型分析」按钮（仅空 labels 项出现）。用 `verify-bundle-import.mjs` 的 DOM 断言确认：改判后该项的分组变化、排除后不出现在预览、冲突未解决时应用按钮禁用。
- [x] 4.2 冲突选择器：显示两个候选的文件名、镜数、表头列名，提供「只用这份」「分别导入到不同集号」两种处理；未选择时阻止应用。在 `verify-bundle-import.mjs` 断言两种路径各自产生的导入计划。
- [x] 4.3 新增 `src/intake/bundlePlan.ts`：把已分类文件按用途展开合成导入计划 `{ scripts, shotlists, prompts, characters, images, excluded, conflicts, multiEpisode }`，每项带目标集号与预计新增/更新数；一个双用途文件 MUST 同时出现在 `scripts` 与 `shotlists`。在 `verify-bundle-import.mjs` 断言计划与真实资料包预期一致（10 个剧本 + 11 份分镜来源（含冲突的 2 份）+ 1 份提示词 + 3 个角色 + 9 张图 + 待排除项）。

## 5. 分派到既有导入链路

- [x] 5.1 文本分派：把分组后的剧本/分镜/提示词文件交给 `src/intake/` 既有的格式识别 → 表头映射 → 值归一化 → `merge` 合并链，产出与单独导入一致的草稿。在 `verify-bundle-import.mjs` 断言：第 1 集分镜表经压缩包导入的结果与直接导入同一文件的结果逐字段相等。
- [x] 5.2 图片分派：按 fileId 从临时目录取字节 → 走 `mediaUpload` 的校验 → `/api/save-image` 落盘 → 汇总为可发布的素材卡或角色参考图。在 `verify-bundle-import.mjs` 断言：9 张图落盘后均有 `/project-assets/` 地址、原图 >30MB 的单张被拒且其余成功。
- [x] 5.3 角色档案分派：把 `角色档案.md` 交给 `characters-v1` 的整理路径（模型整理或直接解析 `### 外观锚点` 小节），产出角色草稿并进入既有 `mergeCharacters`。在 `verify-bundle-import.mjs` 断言：3 个角色（狸花猫、白猫、铲屎官）的名称与外观锚点被正确提取，「性格属于创作设定」这类备注不进入 lookEn。
- [x] 5.4 事务性应用与回滚：整套计划一次性应用，任一组失败则项目数据不写入并报告；已落盘的图片保留并在结果里列出。在 `verify-bundle-import.mjs` 断言文本组失败时镜头与角色表均未变化。

## 6. 集成与回归

- [x] 6.1 把真实资料包存为 `fixtures/bundle-cat.zip`（约 7.4MB，含 19 个中文名 Markdown 与 9 张 JPEG/PNG），并在 `verify-bundle-import.mjs` 用它跑完整端到端：上传 → 分类 → 冲突检测 → 预览 → 应用 → 断言项目的 `episodes`、`shots`、`characters`、`assets` 均按预期写入。
- [x] 6.2 运行 `npx tsc --noEmit` 与 `npm run build`；修复类型问题。
- [x] 6.3 运行 `node verify-all.mjs`。新增 `verify-bundle-import` / `verify-bundle-ui` 全绿（含真实 7.4MB 资料包端到端）。全量跑相对基线无新增失败。
- [x] 6.4 手工验证：在 UI 里上传该 zip，确认清单显示 19 个中文文件名、冲突提示指向两份第 1 集分镜表、改判后预览随之更新、取消后临时目录被清理。
- [x] 6.5 在 `README.md` 补一段「导入项目资料包」：支持 zip、解包在服务端、不支持 rar/7z/加密包，以及冲突必须先选择的规则。
