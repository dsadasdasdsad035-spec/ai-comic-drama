import { contractBlocks } from './contracts'
import type { Skill } from './types'

/**
 * 一次性代码生成/改写的 system 组装：
 * 角色层 + 锁定 ABI + 任务（输出 JSON 说明）。只来自技能文件，没有旧常量兜底。
 */
export function buildSceneJobSystem(skill: Skill): string {
  const blocks = contractBlocks(skill.manifest.contracts)
  return `${skill.role}\n${blocks}\n\n${skill.task}`.trim()
}
