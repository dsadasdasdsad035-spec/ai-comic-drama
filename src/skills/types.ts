import type { Stage } from '../api'

/** `tools`：跑在聊天工具循环里；`scene3d`：3D 场景代码。`json-tools` 是旧名，解析时归一化。 */
export type SkillRuntime = 'tools' | 'scene3d'
export type SkillSource = 'builtin' | 'override' | 'skillhub' | 'upload'

export type SkillManifest = {
  name: string
  description: string
  stage: Stage
  runtime: SkillRuntime
  tools: string[]
  inputs: string[]
  output: string
  contracts: string[]
  version: number
}

export type SkillProfile = 'workbench' | 'agent-pack'

export type AgentPackInfo = {
  /** SkillHub / Codex 风格 declared tools；本应用不自动映射为 Pi 工具 */
  allowedTools: string[]
}

export type Skill = {
  id: string
  manifest: SkillManifest
  /** 进入 system 的角色与约束 */
  role: string
  /** 一次性生成时渲染为 prompt；聊天时渲染为任务卡 */
  task: string
  /** 原始 SKILL.md（内置或用户覆盖） */
  text: string
  source: SkillSource
  builtinText?: string
  /** 缺省为 workbench（严格 manifest） */
  profile?: SkillProfile
  agentPack?: AgentPackInfo
}

export type SkillHubMeta = {
  slug?: string
  namespace?: string
  version?: string
  homepage?: string
  name?: string
}

export type SkillTextRecord = {
  id: string
  text: string
  builtinText: string
  source: SkillSource
  skillhub?: SkillHubMeta
  /** 安装时写入；旧记录可缺省并由装载期推断 */
  profile?: SkillProfile
}

export type SkillParseIssue = {
  field: string
  message: string
}

export class SkillParseError extends Error {
  issues: SkillParseIssue[]
  constructor(id: string, issues: SkillParseIssue[]) {
    super(`技能「${id}」不可用：${issues.map((i) => `${i.field} ${i.message}`).join('；')}`)
    this.name = 'SkillParseError'
    this.issues = issues
  }
}

export type SkillInputs = Record<string, unknown>
export type SkillRenderMode = 'inline' | 'chat'

export type SkillReference = { key: string; chars: number }

export type SkillPrompt = {
  system: string
  task: string
  missing: string[]
  references: SkillReference[]
}
