import type { Stage } from '../api'
import { SkillParseError, type Skill, type SkillManifest, type SkillParseIssue, type SkillSource } from './types'

const STAGES: Stage[] = [
  'character',
  'asset',
  'shot',
  'prompt',
  'sceneCode',
  'vision',
  'videoVision',
  'creative',
]
/**
 * 运行时取值。`json-tools` 是协议改名前的旧字面量，仍接受并归一化为 `tools`，
 * 否则用户已保存的技能覆盖会因为一次改名而整份加载失败。
 */
const RUNTIMES = ['tools', 'json-tools', 'scene3d'] as const
const normalizeRuntime = (value: string): string => (value === 'json-tools' ? 'tools' : value)
const ROLE_HEADING = '## 角色与约束'
const TASK_HEADING = '## 任务'
const PLACEHOLDER = /\{\{input:([A-Za-z0-9_]+)\}\}/g

function fail(issues: SkillParseIssue[]): never {
  throw new SkillParseError('unknown', issues)
}

function parseScalar(raw: string): unknown {
  const v = raw.trim()
  if (!v) return ''
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim()
    if (!inner) return []
    return inner.split(',').map((x) => unquote(x.trim()))
  }
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return unquote(v)
  if (/^-?\d+$/.test(v)) return Number(v)
  return v
}

function unquote(v: string): string {
  return v.replace(/^["']|["']$/g, '').trim()
}

const FRONTMATTER_SKIP_KEYS = new Set(['allowed-tools', 'metadata'])
const FRONTMATTER_ARRAY_KEYS = new Set(['tools', 'inputs', 'contracts'])

function topLevelKeyLine(line: string): { key: string; rest: string } | null {
  if (/^\s/.test(line)) return null
  const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
  if (!m) return null
  return { key: m[1], rest: m[2] }
}

function parseFrontmatter(text: string): { fields: Record<string, unknown>; body: string; issues: SkillParseIssue[] } {
  const issues: SkillParseIssue[] = []
  const clean = text.replace(/^\uFEFF/, '')
  const lines = clean.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') {
    return { fields: {}, body: clean, issues: [{ field: 'frontmatter', message: '缺少开头的 ---' }] }
  }
  let end = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      end = i
      break
    }
  }
  if (end < 0) {
    return { fields: {}, body: clean, issues: [{ field: 'frontmatter', message: '缺少结尾的 ---' }] }
  }
  const fields: Record<string, unknown> = {}
  const fmLines = lines.slice(1, end)
  let skipBlock = false
  let arrayKey: string | null = null
  let literalKey: string | null = null
  let literalLines: string[] = []

  const flushLiteral = () => {
    if (!literalKey) return
    fields[literalKey] = literalLines.join('\n').trim()
    literalKey = null
    literalLines = []
  }

  for (const line of fmLines) {
    if (literalKey) {
      const top = topLevelKeyLine(line)
      if (top) {
        flushLiteral()
      } else {
        literalLines.push(line.replace(/^\s{0,2}/, ''))
        continue
      }
    }

    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    if (skipBlock) {
      if (topLevelKeyLine(line)) skipBlock = false
      else continue
    }

    const listItem = trimmed.match(/^-\s+(.+)$/)
    if (listItem && arrayKey) {
      const arr = fields[arrayKey]
      const list = Array.isArray(arr) ? arr : []
      list.push(parseScalar(listItem[1]))
      fields[arrayKey] = list
      continue
    }

    const top = topLevelKeyLine(line)
    if (!top) {
      const hint = trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed
      issues.push({
        field: 'frontmatter',
        message: `无法解析行：${hint}（frontmatter 仅支持单行 key: value、key: [a,b]，或 description: | 多行；其它扩展字段请删掉或改成单行）`,
      })
      continue
    }

    arrayKey = null
    const { key, rest } = top

    if (FRONTMATTER_SKIP_KEYS.has(key)) {
      skipBlock = true
      continue
    }

    const scalar = rest.trim()
    if (scalar === '|' || scalar === '>') {
      literalKey = key
      literalLines = []
      continue
    }

    if (!scalar && FRONTMATTER_ARRAY_KEYS.has(key)) {
      fields[key] = []
      arrayKey = key
      continue
    }

    fields[key] = parseScalar(rest)
    if (Array.isArray(fields[key]) && FRONTMATTER_ARRAY_KEYS.has(key)) arrayKey = key
  }
  flushLiteral()
  return { fields, body: lines.slice(end + 1).join('\n'), issues }
}

/** 仅读取 frontmatter 字段（供 Agent 包元数据；不做 manifest 完整性校验） */
export function peekFrontmatterFields(text: string): Record<string, unknown> {
  return parseFrontmatter(text).fields
}

function section(body: string, heading: string): string | null {
  const lines = body.split(/\r?\n/)
  const start = lines.findIndex((line) => line.trim() === heading)
  if (start < 0) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].trim() === ROLE_HEADING || lines[i].trim() === TASK_HEADING) {
      end = i
      break
    }
  }
  return lines
    .slice(start + 1, end)
    .join('\n')
    .replace(/^\r?\n/, '')
    .replace(/\r?\n+$/, '')
}

function asString(fields: Record<string, unknown>, key: string, issues: SkillParseIssue[]): string {
  const v = fields[key]
  if (typeof v !== 'string' || !v.trim()) {
    issues.push({ field: key, message: '必须是非空字符串' })
    return ''
  }
  return v.trim()
}

function asStringArray(fields: Record<string, unknown>, key: string, issues: SkillParseIssue[]): string[] {
  const v = fields[key]
  if (v === undefined) {
    issues.push({ field: key, message: '必须是数组' })
    return []
  }
  if (!Array.isArray(v)) {
    issues.push({ field: key, message: '必须是数组，例如 [a, b]' })
    return []
  }
  const out = v.map((x) => String(x).trim()).filter(Boolean)
  if (out.length !== v.length) issues.push({ field: key, message: '数组中不能有空项' })
  if (new Set(out).size !== out.length) issues.push({ field: key, message: '数组不能有重复项' })
  return out
}

/**
 * 解析一个 SKILL.md。只认 `{{input:key}}` 占位符；
 * 提示词里本来就有 `{{角色名}}` 这类示例，必须当普通文本。
 */
export function parseSkillText(id: string, text: string, source: SkillSource = 'builtin', builtinText?: string): Skill {
  const issues: SkillParseIssue[] = []
  const { fields, body, issues: fmIssues } = parseFrontmatter(text)
  issues.push(...fmIssues)

  const name = asString(fields, 'name', issues)
  const description = asString(fields, 'description', issues)
  const stage = asString(fields, 'stage', issues) as Stage
  const runtime = asString(fields, 'runtime', issues)
  const tools = asStringArray(fields, 'tools', issues)
  const inputs = asStringArray(fields, 'inputs', issues)
  const output = asString(fields, 'output', issues)
  const contractsRaw = fields.contracts
  const contracts =
    contractsRaw === undefined
      ? output
        ? [output]
        : []
      : Array.isArray(contractsRaw)
        ? contractsRaw.map((x) => String(x).trim()).filter(Boolean)
        : []
  if (contractsRaw !== undefined && !Array.isArray(contractsRaw)) {
    issues.push({ field: 'contracts', message: '必须是数组，例如 [script-v1]' })
  }
  if (new Set(contracts).size !== contracts.length) {
    issues.push({ field: 'contracts', message: '数组不能有重复项' })
  }
  const versionRaw = fields.version
  const version = Number(versionRaw)
  if (!Number.isFinite(version) || version < 1) {
    issues.push({ field: 'version', message: '必须是大于 0 的整数' })
  }

  if (name && name !== id) issues.push({ field: 'name', message: `必须与目录 id「${id}」一致` })
  if (stage && !STAGES.includes(stage)) issues.push({ field: 'stage', message: `未知环节：${stage}` })
  if (runtime && !(RUNTIMES as readonly string[]).includes(runtime)) {
    issues.push({ field: 'runtime', message: `未知运行时：${runtime}` })
  }

  const role = section(body, ROLE_HEADING)
  const task = section(body, TASK_HEADING)
  if (role === null) issues.push({ field: 'role', message: '缺少「## 角色与约束」段' })
  if (task === null) issues.push({ field: 'task', message: '缺少「## 任务」段' })

  const used = new Set<string>()
  for (const m of (task || '').matchAll(PLACEHOLDER)) {
    const key = m[1]
    used.add(key)
    if (!inputs.includes(key)) issues.push({ field: 'task', message: `占位符 {{input:${key}}} 未在 inputs 声明` })
  }
  for (const key of inputs) {
    if (!used.has(key)) issues.push({ field: 'inputs', message: `输入「${key}」没有在任务模板中使用` })
  }

  if (issues.length) throw new SkillParseError(id, issues)

  const manifest: SkillManifest = {
    name,
    description,
    stage,
    runtime: normalizeRuntime(runtime) as SkillManifest['runtime'],
    tools,
    inputs,
    output,
    contracts,
    version,
  }
  return {
    id,
    manifest,
    role: role || '',
    task: task || '',
    text,
    source,
    ...(builtinText !== undefined ? { builtinText } : {}),
  }
}

/** 把用户编辑的两节重新拼成 SKILL.md 正文（frontmatter 由内置文件提供） */
export function composeSkillBody(role: string, task: string): string {
  return `${ROLE_HEADING}\n${role.trim()}\n\n${TASK_HEADING}\n${task.trim()}\n`
}

export { ROLE_HEADING, TASK_HEADING }
