#!/usr/bin/env node
/**
 * 由词表 JSON 生成对照表文档。
 *
 * 为什么不让文档独立维护：18 轴 400+ 值，手写必然漂移。这里让
 * `public/presets/prompt-taxonomy/v1.json` 成为唯一事实来源，文档只是它的
 * 只读视图，改词表后重跑一次即可。
 *
 * 用法：
 *   node scripts/gen-prompt-taxonomy-doc.mjs           # 写入 docs/prompt-taxonomy.md
 *   node scripts/gen-prompt-taxonomy-doc.mjs --check   # 只校验是否同步（CI/验收用）
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const JSON_PATH = path.join(ROOT, 'public/presets/prompt-taxonomy/v1.json')
const OUT_PATH = path.join(ROOT, 'docs/prompt-taxonomy.md')
const CHECK = process.argv.includes('--check')

const doc = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'))
const axes = [...(doc.axes || [])].sort((a, b) => (a.order || 0) - (b.order || 0))
const totalValues = axes.reduce((n, a) => n + (a.values?.length || 0), 0)

/** Markdown 表格单元格：竖线会截断列，必须转义 */
const cell = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()

function axisTable(axis) {
  const lines = [
    `### ${axis.order}. ${axis.cn}（\`${axis.id}\`）`,
    '',
    `| id | 中文 | English | token | 别名 | 其它映射 |`,
    `| --- | --- | --- | --- | --- | --- |`,
  ]
  for (const v of axis.values || []) {
    const extras = []
    if (v.mapsToSize) extras.push(`size→${v.mapsToSize}`)
    if (v.mapsToMove) extras.push(`move→${v.mapsToMove}`)
    lines.push(
      `| \`${cell(v.id)}\` | ${cell(v.cn)} | ${cell(v.en)} | ${cell(v.token)} | ${cell((v.aliases || []).join('、'))} | ${cell(extras.join('；'))} |`,
    )
  }
  lines.push('')
  return lines
}

function mappingTable(title, mappings, describeTarget) {
  const lines = [`## ${title}`, '', `| 输入 | 映射到 |`, `| --- | --- |`]
  for (const [key, value] of Object.entries(mappings || {})) {
    const target = Array.isArray(value) ? value.join('、') : String(value ?? '')
    lines.push(`| ${cell(describeTarget(key))} | ${cell(target)} |`)
  }
  lines.push('')
  return lines
}

function build() {
  const lines = [
    `# 提示词分类体系（18 轴）`,
    '',
    `> 本文件由 \`scripts/gen-prompt-taxonomy-doc.mjs\` 从 \`public/presets/prompt-taxonomy/v1.json\` 生成，请勿手改。`,
    '',
    `- 词表版本：**${doc.version || '(未标注)'}**`,
    `- 轴数：**${axes.length}**`,
    `- 受控值总数：**${totalValues}**`,
    `- 单轴推导上限：默认 ${doc.limits?.perAxis ?? 6}，题材 ${doc.limits?.genre ?? 8}`,
    '',
    `## 怎么用`,
    '',
    `- 筛选接口：\`GET /api/prompt-cases?facet=axis:value\`，可重复；同轴 OR、跨轴 AND。`,
    `- 计数接口：\`GET /api/prompt-cases/facets\`，算某轴时排除该轴自身条件。`,
    `- 人工修正：\`PATCH /api/prompt-cases/:id/facets\`，\`{ add, remove, restore }\` 都用 \`axis:value\`。`,
    `- 回填旧案例：\`node scripts/backfill-prompt-facets.mjs --dry-run\` 预演，去掉 \`--dry-run\` 写入；\`--only-stale\` 只补版本落后的案例。`,
    `- 新增来源分类映射：在 JSON 的 \`sourceMappings.<来源>\` 里加一项，值为 \`axis:value\` 数组，然后重跑本脚本。`,
    '',
    `## 轴与值`,
    '',
    ...axes.flatMap(axisTable),
    ...mappingTable('来源分类映射（sourceMappings.vflow）', doc.sourceMappings?.vflow, (k) => k),
    ...mappingTable('反推制作方式映射（kindMappings）', doc.kindMappings, (k) => k),
  ]
  return lines.join('\n')
}

const content = build()
if (CHECK) {
  const current = fs.existsSync(OUT_PATH) ? fs.readFileSync(OUT_PATH, 'utf8') : ''
  if (current !== content) {
    console.error(`❌ ${path.relative(ROOT, OUT_PATH)} 与词表不同步，请运行 node scripts/gen-prompt-taxonomy-doc.mjs`)
    process.exit(1)
  }
  console.log(`✅ 文档与词表同步：${axes.length} 轴 / ${totalValues} 值`)
} else {
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true })
  fs.writeFileSync(OUT_PATH, content)
  console.log(`已生成 ${path.relative(ROOT, OUT_PATH)}：${axes.length} 轴 / ${totalValues} 值`)
}
