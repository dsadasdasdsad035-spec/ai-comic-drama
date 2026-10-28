# Tasks

## 1. 服务端删除能力

- [x] 1.1 新增 `server/project-lifecycle.mjs`，定义 `PROJECT_CASCADE` 清单（含 `project_id` 与项目名两类键、`publish_events` 子查询）与 `deleteProjects`、`previewProjectDelete` 导出；运行 `node -e "import('./server/project-lifecycle.mjs').then(m=>console.log(Object.keys(m)))"` 确认模块可加载，并在 `verify-project-lifecycle.mjs` 骨架里断言清单覆盖 12 张项目域表。
- [x] 1.2 实现 `previewProjectDelete(root, name)`：按清单统计各表行数、递归统计 `<projects>/<项目>/` 字节数、用 `listJobs(root, { project, active: true })` 收集活动任务、返回 `exists`；在临时 `SB_PROJECTS_DIR` 下运行 `node verify-project-lifecycle.mjs`，断言预览计数与预置数据一致、预览前后行数不变、不存在的项目返回 `exists: false`。
- [x] 1.3 实现快照写入（`<projects>/.deleted/<项目>-<时间戳>.json`，同目录临时文件后 rename，含 `version/project/tables/deletedAt`），并把 `.gitignore` 的忽略规则加上 `projects/.deleted/`；在 `verify-project-lifecycle.mjs` 用只读目录模拟写入失败，确认删除中止、快照不存在、项目行数与文件不变。
- [x] 1.4 实现级联删除事务：`BEGIN IMMEDIATE` → 按清单删除 → `DELETE FROM projects` → `COMMIT`，异常回滚；运行 `verify-project-lifecycle.mjs`，断言删除后 12 张表均无该项目行、另一项目行数不变、同名重建为空项目。
- [x] 1.5 在 `deleteProjects` 中加入活动任务拦截（命中 `ACTIVE_STATES` 时返回 `active_jobs` 与任务摘要）与批量逐项执行（单项失败不中断、上限 50）；运行 `verify-project-lifecycle.mjs`，断言一条 queued 任务的项目被拒绝删除且任务行仍在，批量中另一项目照常删除并逐项返回结果。
- [x] 1.6 在事务提交后清理 `<projects>/<项目>/` 与 `<appRoot>/.scene-drafts/<项目>/`，失败收集到 `warnings` 且响应带 `sharedFilesKept: true`；运行 `verify-project-lifecycle.mjs`，断言项目目录与草稿目录消失、`public/exports/` 下的占位文件仍在、`warnings` 为空。

## 2. 项目 API 路由

- [x] 2.1 在 `vite.config.ts` 的 `/api/project` 分支接入 `GET ?preview=delete`，对非法项目名返回 400、对不存在项目返回 `exists: false`；用临时 dev server 跑 `verify-project-lifecycle.mjs` 的 API 段，确认预览响应字段与 JSON 契约一致。
- [x] 2.2 接入 `DELETE ?name=` 与 `DELETE ?names=`：名字逐个 `safeProjectName`、批量上限 50、活动任务返回 409 与任务清单；运行 `verify-project-lifecycle.mjs`，确认单删 200、批量部分失败仍 200、非法名 400、活动任务 409。
- [x] 2.3 在 `src/api.ts` 增加 `previewProjectDelete(name)`、`deleteProjects(names)` 类型化调用，与现有 `readJsonRes` 错误处理保持一致；运行 `npx tsc --noEmit` 确认无类型错误。

## 3. 全局带入口

- [x] 3.1 新增 `src/project/NewProjectDialog.tsx`（目录名 + 标题、现有正则校验、`createProject` 调用、已存在错误提示），把 `ShotTable.tsx` 里的 `creating/newName/newTitle/doCreate` 状态与 `wb-new` 表单整块移除，保留 `onProjectsChanged`；运行 `npx tsc --noEmit`，并在 `verify-project-lifecycle.mjs` 的 UI 段确认镜头表不再出现「+ 新建项目」。
- [x] 3.2 新增 `src/project/ProjectMenu.tsx`（项目选择器旁的非强调触发器 + portal 弹层「新建项目 / 管理项目」，沿用 `EpPicker` 的 Esc 关闭、点击外部关闭、窗口 resize/scroll 关闭与焦点归还）；把它接进 `App.tsx` 全局带的 `topbar-project-slot`，运行 `verify-project-lifecycle.mjs`，确认所有项目视图都有该入口、创建成功后列表刷新并切换到新项目。
- [x] 3.3 确认入口在窄宽度下不被收起：检查它没有落在 `wb-bar-optional` 或 `wb-bar-settings` 内，并在 `verify-project-lifecycle.mjs` 把视口缩到 900px 后断言按钮仍可见可点。

## 4. 项目管理与删除界面

- [x] 4.1 新增 `src/project/ProjectManagerDialog.tsx`：项目列表（名称、标题、集/镜数、更新时间）、搜索、单选与多选、逐项删除按钮；在 `verify-project-lifecycle.mjs` 的 UI 段断言列表条数与 `/api/project` 一致、搜索只保留匹配项、多选计数正确。
- [x] 4.2 实现删除确认层：选中项先汇总调用 `GET /api/project?name=&preview=delete`，显示各表计数、媒体体积与活动任务；单项要求输入项目名、批量要求输入选中数量，不符时确认按钮禁用；运行 `verify-project-lifecycle.mjs`，断言错误输入不发 `DELETE`、正确输入才发出。
- [x] 4.3 接入删除结果展示：成功项从列表移除、被 409 拒绝项标出活动任务、失败原因逐项可见，`sharedFilesKept` 说明常驻；运行 `verify-project-lifecycle.mjs`，确认 UI 文案与响应一致。
- [x] 4.4 在 `src/settings/SettingsPage.tsx` 的「数据」分区内嵌项目管理面板（同一组件），显示 SQLite 路径、`.deleted/` 快照路径与共享产物目录说明；运行 `verify-project-lifecycle.mjs`，确认设置页能打开面板并成功删除一个项目后列表刷新。

## 5. 删除后的全局上下文回退

- [x] 5.1 在 `App.tsx` 实现 `applyProjectDeletion(names)`：先 `setReadyProject('')`，再清 `localStorage['storyboard-canvas-v1:<项目>']`，再 `reloadProjects()`；若删的是当前项目则切到剩余首个项目或空字符串，并重置集号、节点、连线、角色与选中；运行 `verify-project-lifecycle.mjs`，断言删除当前项目后顶栏切到下一项目且不再请求已删除项目。
- [x] 5.2 覆盖「同名重建不恢复旧画布」：在 `verify-project-lifecycle.mjs` 先用同名项目写一份画布 localStorage，删除并重建后打开画布，断言节点与连线为空。
- [x] 5.3 覆盖删除最后一个项目：`verify-project-lifecycle.mjs` 断言顶栏显示「未选项目」、项目视图进入空状态、没有自动创建新项目；同时验证删除非当前项目时当前项目与视图不变。

## 6. 集成验收与文档

- [x] 6.1 新增 `docs/project-lifecycle.md`：新建入口位置、删除预览与确认规则、级联范围表、快照位置与手工恢复步骤（含从快照重建的 SQL/JSON 说明）、共享产物不被清理的边界、活动发布任务的处理方式；按文档里的命令逐条执行确认可用。
- [x] 6.2 更新 `README.md`（项目上下文与项目媒体章节补充生命周期说明）与 `DEPLOY-CHECKLIST.md`（`.deleted/` 快照目录随数据卷保留、备份时一并处理）；核对文档中的路径与脚本名与实际一致。
- [x] 6.3 运行 `npm run build`、`node verify-project-lifecycle.mjs`、`node verify-project-scope.mjs`、`node verify-project.mjs`，确认全部通过、没有新增 TypeScript 错误，且既有项目切换与画布隔离行为未被破坏。

## Workflow follow-up

- 归档前先同步主规格：`project-context`、`workbench-shell` 的 delta 需要先 `openspec sync specs`，再确认新能力 `project-lifecycle` 的 Purpose 已写入。
- 归档后复跑一次 `node verify-all.mjs project`，确认真实仓库状态下项目相关验收仍可独立通过。

## 归档后调整：移除批量删除数量上限

1.5 与 2.2 里写的「上限 50」已在归档后按用户要求移除。清理几百个测试项目时该上限只是把一次操作拆成多次，并让查询串更容易超过 URL 长度。

- [x] 7.1 删除 `server/project-lifecycle.mjs` 的 `MAX_BATCH` 常量与数量校验，`deleteProjects` 只保留去重与名字合法性校验。
- [x] 7.2 `DELETE /api/project` 支持请求体 `{names:[...]}`，查询串 `?names=` 保留兼容；`src/api.ts` 的 `deleteProjects` 改走请求体，不再拼接查询串。
- [x] 7.3 新增 `previewProjectDeletes` 与 `POST /api/project?preview=delete`，一次连接算完所有选中项；`ProjectManagerDialog` 改用批量预览，不再为每个选中项并发请求。
- [x] 7.4 验收改为断言「120 个名字不被数量上限拒绝且逐项报告」与「API 一次删除 60 个项目」，并在 `openspec/specs/project-lifecycle/spec.md` 补「一次清理大量项目」场景；`node verify-project-lifecycle.mjs` 全绿。
