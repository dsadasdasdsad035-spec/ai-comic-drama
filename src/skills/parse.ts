import type { Stage } from '../api'
import { SkillParseError, type Skill, type SkillManifest, type SkillParseIssue, type SkillSource } from './types'

const STAGES: Stage[] = ['script', 'character', 'asset', 'shot', 'prompt', 'sceneCode', 'vision', 'videoVision']
const RUNTIMES = ['json-tools', 'scene3d'] as const
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
  for (const line of lines.slice(1, end)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const m = trimmed.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!m) {
      issues.push({ field: 'frontmatter', message: `无法解析行：${trimmed.slice(0, 40)}` })
      continue
    }
    fields[m[1]] = parseScalar(m[2])
  }
  return { fields, body: lines.slice(end + 1).join('\n'), issues }
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
    runtime: runtime as SkillManifest['runtime'],
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
