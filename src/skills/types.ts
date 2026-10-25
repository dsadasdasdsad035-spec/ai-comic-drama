import type { Stage } from '../api'

export type SkillRuntime = 'json-tools' | 'scene3d'
export type SkillSource = 'builtin' | 'override'

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
}

export type SkillTextRecord = {
  id: string
  text: string
  builtinText: string
  source: SkillSource
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
