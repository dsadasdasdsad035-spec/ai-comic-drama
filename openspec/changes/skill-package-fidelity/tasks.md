# Tasks

## 1. 空文件保留

- [x] 1.1 移除 `server/skillZip.mjs` 中 `parseSkillPackage` 的 `if (!data?.length) continue`，保留目录条目与 `__MACOSX` / `.DS_Store` 过滤；验证：构造含 `references/.keep`、`scripts/__init__.py`、空 `config.yaml` 的 zip，断言 `parseSkillPackage` 返回条目数与 zip 一致且空文件在列
- [x] 1.2 确认写盘链路对 0 字节文件正常：`writeInstalledSkill` 落盘后文件存在、大小为 0，`listSkillAttachments` 列出该路径且 `bytes` 为 0；验证：同一测试用临时状态根跑一次真实落盘后读清单
- [x] 1.3 保留「空 SKILL.md 被拒绝」与「只有空目录的 zip 被拒绝」两条守卫；验证：测试分别断言 `SKILL.md` 为空时抛「SKILL.md 为空」，zip 仅含空目录时抛「没有可用文件」
- [x] 1.4 回归既有解压验收，确认没有断言依赖「空文件被跳过」；验证：`node verify-skill-upload-zip.mjs` 与 `node verify-skills-unit.mjs` 全绿。无需改动既有断言：原先没有断言依赖「空文件被跳过」，`verify-skill-upload-zip.mjs` 只断言 references/guide.md 这类非空文件

## 2. 缺文件可见

- [x] 2.1 在 `server/skills.mjs` 增加只读判定 `hasInstalledSkillDir(appRoot, id)`（存在且为目录）；验证：`tests/skill-package-fidelity.ts` 对「有目录」「无目录」「同名文件占位」三种情况各断言一次
- [x] 2.2 `/api/skills` 的 `asRecord` 对 `skillhub` / `upload` 来源写入 `filesMissing: !hasInstalledSkillDir(...)`；验证：临时 DB 造一条无目录的安装记录，断言列表与详情回执都带 `filesMissing: true`
- [x] 2.3 纯文本上装的包（目录存在、附件为 0）不得带该标记；验证：同一测试用纯文本接口安装后断言 `filesMissing` 缺省、`fileCount` 为 0
- [x] 2.4 客户端类型与工具行透传：`SkillTextRecord.filesMissing` 可选字段、`skillSummaryRow` 输出该字段；验证：`tests/skill-package-fidelity.ts` 断言 `skillSummaryRow` 对带标记与不带标记的技能分别输出正确值
- [x] 2.5 设置页技能详情在 `filesMissing` 为真时显示「包内文件缺失，需重新安装」一行，且不再只显示「无附加文件」；验证：新增 `verify-skill-package-fidelity.mjs` 构造无目录记录后断言该文案出现，并断言此时不渲染 `data-skill-no-attachments`

## 3. 集成验收

- [x] 3.1 市场安装端到端：用真实市场包安装后断言磁盘文件数等于 zip 条目数、附件清单条数等于条目数减一；验证：`node verify-creative-host-gate.mjs` 已有的市场/内置断言保持通过，`verify-skill-package-fidelity.mjs` 用本地 mock hub 安装含 0 字节文件的市场包，断言磁盘 4 个文件 == zip 4 条目、附件 3 == 条目数减一
- [x] 3.2 跑完整单元测试与构建；验证：`node verify-skills-unit.mjs` 全绿、`npm run build` 成功

## Workflow follow-up

- 归档前跑 `openspec validate skill-package-fidelity --strict`。
- 归档用 `/opsx-archive`，不要手工移动 change 目录。
- 若要一并处理「二进制附件被当文本读」，另开变更；本次设计已明确排除。
