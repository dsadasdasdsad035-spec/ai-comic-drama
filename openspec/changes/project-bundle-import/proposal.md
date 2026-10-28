# Proposal

## Why

真实的生产资料不是一张表，而是一个文件夹：剧本、分镜表、提示词、角色档案、参考照片混在一起，还常常有两个版本的分镜。用户现在只能一个文件一个文件地复制进对应的输入框，图片一张张上传。仓库 `github.com/dsadasdasdsad035-spec/cat` 就是一个典型样本——10 个分集剧本、6 份制作文档、9 张角色参考照，全部以 Markdown 与 JPEG 形式躺在一个目录里。

## What Changes

- 三个文本工作台与素材/角色页共用的「导入」入口支持**压缩包**：上传 `.zip` 后在服务端安全解包到临时目录，再按内容分派。
- 解包后**先分类，后预览**：每个文件被判定为剧本 / 分镜表 / 提示词 / 角色档案 / 参考图 / 无关文档之一，用户能在预览里改判或排除。
- 分类按三条依据，优先级从高到低：**路径与文件名关键词**（`角色档案`、`分镜`、`提示词`、`参考照片`）→ **内容特征**（Markdown 表格表头、`**Prompt**` 代码块、`### 外观锚点` 小节）→ **模型判断**（只在用户点了「让模型分析」时）。
- 多文件冲突必须显式处理：同一集出现两个分镜表时，MUST NOT 静默合并或覆盖，必须让人选一个。
- 解包安全边界：拒绝路径穿越、绝对路径、符号链接、嵌套压缩包、macOS 资源叉与 `.DS_Store`；限制条目数、单文件大小与解压后总大小，防压缩炸弹。
- 中文文件名编码兜底：ZIP 的 UTF-8 标志位未设置时（macOS `zip` 的常见行为），依次尝试 UTF-8 与 GBK/GB18030 解码，仍失败则用重映射后的安全名并在预览里标注原名。
- 不做：`.rar` / `.7z` / 加密 zip / 分卷 zip / 解压后自动建项目 / 从 Git URL 直接拉取。

## Capabilities

### New Capabilities

- `project-bundle-import`: 压缩包的上传与安全解包、文件分类与人工改判、多文件冲突处理、以及把每个文件分派到既有文本导入与图片上传链路的边界。

### Modified Capabilities

（无。文本导入的解析与合并语义、图片上传的落盘与校验都复用既有能力，本变更只新增「从压缩包到这些入口」的一段。）

## Impact

- 服务端：新增 `server/zip.mjs`（ZIP 中央目录解析、`zlib.inflateRawSync` 解压、解包安全校验）与 `POST /api/import/bundle` 路由；解包产物写系统临时目录并在请求结束后清理。
- 前端：新增 `src/intake/bundle.ts`（分类器）与 `src/intake/BundleDialog.tsx`（文件清单、分类改判、冲突选择、分组预览）；`src/intake/IntakeDialog.tsx` 增加「压缩包」入口。
- 复用：`src/intake/` 的格式识别、表头映射、值归一化、差异预览与 `merge` 合并；图片经 `/api/save-image` 与既有上传校验。
- 依赖：不新增 npm 包。Node 22 的 `zlib.inflateRawSync` 覆盖 ZIP 的 stored 与 deflate 两种压缩方式；Docker 镜像当前没有 `unzip` 命令，不依赖它。
- 数据：不新增表、不改 `project.json` 结构；解包中间产物不落项目目录。
- 验收：新增 `verify-bundle-import.mjs`，以真实资料包（`fixtures/bundle-cat.zip`）为端到端样本。
