# Tasks

## 1. 共享单元格语法（渲染侧）

- [x] 1.1 新建 `src/shotCellSyntax.ts`，定义台词标注、表演、选角、运镜参照、参考五组渲染函数；验证：对新文件跑 `npx tsc --noEmit` 无错，且模块不含任何 React、DOM 与 localStorage 引用
- [x] 1.2 在同文件写出对应的解析函数签名与实现（与渲染成对），本次先由 `storyboard-import-fidelity` 之外的地方不使用；验证：`verify-storyboard-md-export.mjs` 里加往返断言，渲染再解析得到等值对象
- [x] 1.3 渲染函数对空值、全空槽、含 `<br>` 多条的分支各写断言；验证：新增用例在该脚本中通过

## 2. 镜头语言绑定落库

- [x] 2.1 `src/api.ts` 的 `ProjectShot` 增加 `lexicon_ref_key`、`lexicon_ref_url`、`motion_lexicon_as_ref` 三个可选字段；验证：`npx tsc --noEmit` 无错
- [x] 2.2 `src/shotSync.ts` 的 `nodeToShot` 与 `shotToData` 双向映射三个字段；验证：在 `verify-camera-lexicon.mjs` 加断言，节点数据经 `nodeToShot` 再 `shotToData` 后三个字段等值
- [x] 2.3 `src/shotSync.ts` 的 `bizSignature` 纳入三个字段，使绑定与解绑都触发写回；验证：脚本断言两段不同的绑定值产生不同签名
- [x] 2.4 在 `verify-camera-lexicon.mjs` 补端到端断言：绑定条目后重新加载项目，该镜的 `lexicon_ref_key` 仍在；验证：该脚本通过

## 3. 分镜表列扩展

- [x] 3.1 `SHOT_TABLE_HEADER` 扩到十三列，新四列依次追加在末尾，分隔行随列数生成；验证：`verify-storyboard-md-export.mjs` 断言表头数量为 13 且前九列与旧值逐字一致
- [x] 3.2 `renderShotRow` 依次渲染选角、表演、运镜参照、参考四列；验证：脚本用一条全字段镜头断言四列内容，并用一条空字段镜头断言四列为空且列数不变
- [x] 3.3 台词列改为内联标注渲染，`角色[情绪/强度/语速/音量]{强调}：台词`；验证：脚本覆盖完整标注、部分标注、无标注、说话人为空四种情形
- [x] 3.4 台词原文含方括号时不被当作标注；验证：脚本断言 `[系统]警告：电池耗尽` 原样出现在冒号之后

## 4. 参考与运镜参照解析

- [x] 4.1 `StoryboardSource` 增加可选 `refIndex`，含素材节点 id → 标题映射与已知角色 id 集合；验证：`npx tsc --noEmit` 无错，且不传 `refIndex` 时模块仍能渲染
- [x] 4.2 实现 `refIds` → 可读名字的解析：`char-<id>` 取角色名，`char-miss-<name>` 取名字，`asset-<uid>` 查索引取标题；验证：脚本覆盖命中、缺失索引、指向已删角色三种情形
- [x] 4.3 未解析的参考从参考列剔除并写入附注，附注列出镜号与未解析目标；验证：脚本断言参考列不含占位符与原始 id，附注含该镜号
- [x] 4.4 运镜参照列按绑定 key 解析中文名，解析不到退化写 key，未绑定留空且不从 `move` 反推；验证：脚本覆盖三种情形，并断言 `move="推"` 时该列为空

## 5. 接线与端到端

- [x] 5.1 画布导出入口构建 `refIndex` 传给导出函数：素材节点 id → 标题、角色 id 集合；验证：`verify-storyboard-md-export.mjs` 断言传入索引后素材参考列写出标题
- [x] 5.2 确认导出文件仍被压缩包导入识别为单集分镜表（十三列不破坏识别）；验证：`verify-bundle-import.mjs` 与 `verify-storyboard-md-export.mjs` 全部通过
- [x] 5.3 在 `openspec/specs/storyboard-markdown-export/spec.md` 之外，同步 `pi-agent-material-tools` 的 proposal：字段落库已归入本变更，该变更只剩 agent 工具；验证：`openspec validate pi-agent-material-tools` 通过且 proposal 不再声称新增字段

## Workflow follow-up

- 归档后与 `storyboard-import-fidelity` 联调往返：十三列导出后能原样导入。
