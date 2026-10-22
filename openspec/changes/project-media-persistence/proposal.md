# Proposal

## Why

角色三视图是贯穿全流程的长效参考图，但它的文件只落在被 gitignore 的 `public/generated/`，项目数据库里只存了 `/generated/...` 路径。工作区被复制、重建或清理产物目录后，路径还在、文件已经没了；刷新页面时图片请求 404，卡片表现为一片空白。当前项目里 4 个角色的 8 张候选图已经全部处于这种悬空状态，而当天新生成的场景/道具图因为文件还在，看起来「刷新后还在」——两者用的是同一套脆弱机制，只是文件存活时间不同。

同时还有两个会造成「刚生成也丢」的窗口：角色改动只在 1.2 秒防抖后回写，生成完立刻刷新会整卡丢失；上传的角色图是 dataURL，`toProject()` 明确丢弃，永远不会落库。

## What Changes

- 新增**项目媒体目录** `projects/<项目名>/assets/`：角色三视图、场景/道具设定图生成或上传后直接写入该目录，项目数据与图片一起移动、一起备份；`public/generated/` 继续只放镜头首帧、调度帧、视频等可重生成产物。
- 新增项目媒体 URL 方案 `/project-assets/<项目名>/<文件>`，由 dev server 提供静态访问；`resolveRef()` 同时识别旧 `/generated/...` 与新项目媒体路径，方舟参考图请求不受影响。
- `POST /api/seedream` 与 `POST /api/save-image` 接受项目名：生图结果写入项目媒体目录；上传的角色图由服务端落盘后再存路径，不再丢弃 dataURL。
- 角色卡新增**图片文件缺失**状态：项目加载时校验角色/设定图引用，缺失时显示明确提示和「重新生成」入口，而不是空白图框；生成参考图时遇到缺失文件返回可读错误，不把空路径送进模型请求。
- 角色图片生成/上传完成后**立即持久化**，不再依赖 1.2 秒防抖；保存失败通过 toast 暴露，不再被 `.catch(() => {})` 静默吞掉。文本编辑仍保留防抖。
- 项目首次打开时做一次幂等迁移：把仍存在于 `public/generated/` 的角色/设定图复制进项目媒体目录并改写引用；文件已缺失的引用保留并标记缺失，由用户重新生成或手工恢复。
- **BREAKING**（仅内部接口）：项目数据里的新图片引用从 `/generated/...` 改为 `/project-assets/<项目名>/...`；`/api/seedream`、`/api/save-image` 新增可选 `project` 字段。旧 `/generated/...` 引用继续兼容读取。

明确不做：不迁移镜头首帧、调度帧、视频、配音等大体积可重生成产物；不改变生图模型与提示词；不做跨工作区自动搜图恢复。

## Capabilities

### New Capabilities

- `project-media-persistence`: 项目级参考图存储与访问、旧图幂等迁移、缺失文件检测与提示、角色图生成/上传的即时持久化。

### Modified Capabilities

无。

## Impact

- 代码：新增 `server/media.mjs`；`vite.config.ts`（项目媒体静态路由、`/api/seedream`、`/api/save-image`、`/api/project` 返回缺失媒体、`resolveRef`）；`src/api.ts`（生成/保存参数与项目媒体类型）；`src/CharacterBoard.tsx`（上传落盘、缺失状态、即时保存）；`src/AssetBoard.tsx`（设定图写入项目媒体）；`src/App.tsx`（传递项目名、保存失败提示、迁移结果处理）。
- 数据：项目媒体文件新增 `projects/<项目名>/assets/`（已在 `.gitignore` 中忽略）；SQLite 结构不变，只有 image/candidates 字段的取值从 `/generated/...` 逐步过渡到 `/project-assets/...`。
- 存储：角色三视图和设定图从共享产物池复制到项目目录，每个项目会多占用一份参考图体积；镜头级大量产物保持原状，避免无谓膨胀。
- 验证：新增 `verify-media-persistence.mjs` 覆盖生成落项目目录、上传落盘、刷新后仍在、旧图迁移、缺失标记、快速刷新不丢；回归 `verify-charboard.mjs`、`verify-asset-board.mjs` 与构建。
