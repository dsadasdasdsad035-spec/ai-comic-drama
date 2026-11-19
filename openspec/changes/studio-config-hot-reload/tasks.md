# Tasks

## 1. 专家变更指纹

- [x] 1.1 `server/dsh-experts.mjs` 导出 `expertFingerprint(expert)`（覆盖 `id`、`name`、`description`、`soul`、排序后的 `toolIds` 与 `skillIds`），并让 `writeExpertsPatch` 返回整批签名；`node tests/dsh-experts.mjs` 通过
- [x] 1.2 `server/index.mjs` 改用 `result.signature` 比较，删除本地 `id:工具数:技能数:是否通配` 拼接；手工只改 `soul.md` 一个字符并保存，日志出现重新同步记录
- [x] 1.3 新增 `tests/studio-expert-signature.mjs`，覆盖「改 soul 变」「同数量换工具变」「同数量换技能变」「内容不变不变」四例，并加入 `test:studio`；`npm run test:studio` 通过
- [x] 1.4 在 `docs/creative-experts-ux.md` 写明「哪些改动会触发重新同步、哪些必须重启宿主」；文档列出的判据字段与 `expertFingerprint` 实现字段一一对应

## 2. 技能变更通知与增量技能根

- [x] 2.1 `server/app.ts` 的设置变更钩子改为携带 `reason`（`settings` / `experts` / `skills`），并在 `saveAppSettings`、专家保存、`/api/skills/upload`、`/api/skills/upload-zip`、`DELETE /api/skill-installs/<id>`、技能覆盖重置六处分别传入正确原因；上传技能后日志显示只刷新配置、未重启宿主
- [x] 2.2 `server/index.mjs` 按 `reason` 决定 `restartIfRunning`：`skills` 传 `false`，其余保持 `true`；上传技能后 `/studio/_host/status` 的 `restarts` 计数不增加
- [x] 2.3 `server/dsh-experts.mjs` 的 `syncExpertSkillRoot` 改为增量同步（`desired` 集合、只删多余、临时名建好后 `rename`）；`node tests/studio-host-experts.mjs` 通过
- [x] 2.4 新增 `tests/studio-skill-hot.mjs`，覆盖「上传后软链出现且未重启」「卸载后软链消失」「同步期间技能根不为空」「通配白名单覆盖新技能」四例，并加入 `test:studio`；`npm run test:studio` 通过
- [x] 2.5 手工验证宿主监听器：不重启宿主、直接向某专家技能根新增一条软链，观察会话候选技能列表是否更新；结论写入 `docs/creative-host.md` 的「热更新边界」小节
- [x] 2.6 按 2.5 的结论决定是否落地降级路径（共享技能根 + 运行时白名单闸门）；若落地，同一手工步骤在降级后同样通过，并记录取舍说明

## 3. 工具清单热更新

- [x] 3.1 `/api/studio/tools` 响应增加 `version`（对工具声明做稳定排序后取哈希前 12 位）；连续两次请求 `version` 相同，修改任一工具的参数定义后 `version` 变化
- [x] 3.2 `server/dsh-plugins/creative-tools/index.js` 实现 `reconcile()`：比对 `version`、先构建新注册表再注销旧的、`inFlight > 0` 时跳过、15 秒兜底、失败保留旧表并记中文日志；`node tests/creative-tools-plugin.mjs` 通过
- [x] 3.3 缺少 `version` 字段时插件退化为启动时拉取一次，保持与旧服务端兼容；用旧响应体跑一次插件初始化，工具仍正常注册
- [x] 3.4 新增 `tests/studio-tools-hot.mjs`，覆盖「version 变后重注册」「拉取失败保留旧表」「执行中不刷新」三例，并加入 `test:studio`；`npm run test:studio` 通过
- [x] 3.5 在 `docs/creative-studio.md` 记录边界：schema 改动热生效、工具实现改动需重建 `server-build`；按文档描述各做一次改动，观察结果与描述一致

## 4. 工具实现热更新（可选，可独立延后）

- [x] 4.1 `server/studio-tool-bridge.mjs` 的 `ensureLoaded` 记录 bundle `mtimeMs`，变化时以 `?v=<mtime>` 重新导入并清空工具缓存；`node tests/studio-tool-bridge.mjs` 通过
- [x] 4.2 重建 `server-build/studio-tools.mjs` 后不重启宿主，下一次调用使用新实现；手工改一个工具的返回文案并观察生效
- [x] 4.3 补充该行为的用例与 `docs/creative-studio.md` 说明；新增用例在 `npm run test:studio` 中通过

## 5. 集成验收

- [x] 5.1 `npm run test:studio` 与 `npm run build` 全绿；用例清单比改动前增加 3 个（必要时 4 个）
- [x] 5.2 端到端手工三连：改 `soul` 后新会话 persona 更新、上传技能后会话可见、改工具 schema 后下一轮校验按新声明；三条都成立
- [x] 5.3 回滚演练：分别回退「工具版本刷新」与「技能通知」两步，确认另一部分仍工作，且宿主不会因缺少 `version` 而报错

## Workflow follow-up

- 完成项目评审要求后归档该 change。
- 归档后确认 `openspec/specs/dsh-tool-bridge/spec.md` 的「技能从文件系统包发现并可热加载」已替换为更新版本，且新增的「工具清单变更无需重启即可生效」已合入。
