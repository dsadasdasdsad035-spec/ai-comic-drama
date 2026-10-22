# Tasks

## 1. 项目媒体服务端基础

- [x] 1.1 新增 `server/media.mjs`：实现项目媒体目录解析、保存/读取、`/project-assets/<项目>/<文件>` URL 解析与路径安全校验，并把 `resolveRef()` 迁入该模块。验证：用临时目录写一个图片后经 `saveProjectImage` → URL → `resolveRef` 读回，同时旧 `/generated/...` 路径仍能解析。
- [x] 1.2 在 `vite.config.ts` 中间件注册 `/project-assets/` 静态路由，复用 `serveFile()`。验证：对临时项目文件 curl 返回 200，对包含 `..` 或非法项目名的 URL 返回 400/404。
- [x] 1.3 在 `GET /api/project` 中加入同步迁移：优先复用项目目录同名文件，其次从 `public/generated/` 复制旧图并改写引用，返回 `project.media = { migrated, missing }`。验证：给临时项目写入旧引用后连续 GET 两次，第一次改写并复制、第二次不再变化，缺失文件只出现在 `missing`。
- [x] 1.4 `/api/seedream` 接受 `project` 并把生成结果写入项目媒体目录；`/api/save-image` 接受 `project`、文件大小与格式校验。验证：curl 用 dataURL 保存图片后文件出现在 `projects/<项目>/assets/` 且 URL 可访问；生图路径用本地 mock provider 返回一张图片，确认结果 URL 为 `/project-assets/...`。
- [x] 1.5 `/api/media` 把当前项目的媒体文件合并进图片列表。验证：临时项目 assets 中的文件出现在返回的 `images` 中且 URL 可访问。

## 2. 客户端生成与即时保存

- [x] 2.1 `src/api.ts` 增加 `project` 生成参数、项目媒体保存函数和 `ProjectData.media` 类型。验证：`npm run build` 通过，`generateImage({ project })` 的请求体包含项目名。
- [x] 2.2 `src/App.tsx` 的 `patchCharacter` 返回更新后的角色数组并同步 `charactersRef`；新增 `onPersist` 立即调用 `patchProject({ characters })`，成功后才更新 `charSnapRef`，失败 toast。验证：在角色板生成图片后立刻刷新，角色与图片仍在；模拟保存失败时出现提示。
- [x] 2.3 `src/CharacterBoard.tsx` 接收 `projectName`、`onPersist`、`missing`；生成、上传、清除、切换候选都走即时保存；上传改为先调用 `/api/save-image` 落盘，不再直接保存 dataURL。验证：上传一张图后刷新仍在，`projects/<项目>/assets/` 出现对应文件。
- [x] 2.4 `src/AssetBoard.tsx` 生成设定图时传 `project`，生成完成后立即 `patchProject({ designs })` 并推进 `savedSigRef`。验证：生成设定图后立刻刷新，设定卡与图片仍在，且 URL 为 `/project-assets/...`。

## 3. 缺失状态与生成保护

- [x] 3.1 `src/App.tsx` 读取 `project.media.missing` 并存入状态，传给角色板和素材板；画布角色节点在图片缺失时回退到名字占位。验证：删除一个项目媒体文件后刷新，角色卡和画布节点都不出现破图。
- [x] 3.2 角色卡显示「图片文件缺失」与「重新生成 / 清除引用」，清除后即时保存；设定卡显示缺失且「加入画布」被阻止；`<img onError>` 作为兜底。验证：删除文件后刷新可见缺失状态，清除后刷新回到待生成，重新生成后恢复正常。
- [x] 3.3 `generateOne` 在收集参考图时检查缺失集合，命中时直接报「角色「X」的三视图文件缺失，请先重新生成」，不发出生图请求。验证：删除角色图后触发出图，请求未到达 `/api/seedream`，界面显示该错误。

## 4. 数据恢复与文档

- [x] 4.1 恢复当前项目已缺失的 8 张历史角色图：把旧工作区备份中的同名文件放进 `projects/<项目>/assets/`，重新打开项目确认迁移按 basename 改写引用并显示；找不到的文件在角色板重新生成。验证：刷新角色板后 4 个角色的图片都可见，`media.missing` 为空。
- [x] 4.2 在 `README.md` 补充项目媒体目录、旧图迁移、缺失恢复与 `public/generated/` 清理边界。验证：文档中的命令与目录与实际实现一致，照文档可复现一次恢复。

## 5. 集成验证

- [x] 5.1 新增 `verify-media-persistence.mjs`（临时库 + mock 文本/生图）：覆盖生成落项目目录、上传落盘、刷新恢复、旧图迁移幂等、缺失标记、缺失图不参与出图、路径穿越拒绝。验证：脚本全部通过且不写真实项目库。
- [x] 5.2 回归既有链路：`verify-charboard.mjs`、`verify-asset-board.mjs`、`verify-project-scope.mjs`、`npm run build`。验证：脚本全绿，构建通过。

## Workflow follow-up

- 归档前确认项目媒体目录在 `.gitignore` 中仍被忽略，且 `projects/storyboard.sqlite` 与 `projects/<项目>/assets/` 一起搬迁后图片可见。
- 通过 `/opsx:archive` 归档本变更。
