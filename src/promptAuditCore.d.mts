/** src/promptAuditCore.mjs 的类型声明：浏览器与 server/db.mjs 共用的审计纯函数 */
export declare function parseDialogueCore(text: string): { speaker: string; text: string }[]
export declare function auditKeyframePromptCore(
  shot: any,
  chars: { name?: string; lookEn?: string }[],
): { cast: string[]; missing: string[]; maybe: string[]; unknown: string[]; empty: boolean }
export declare function projectHealthCore(
  shots: any[],
  chars: { name?: string; lookEn?: string }[],
): { empty: boolean; missing_keyframe: number; missing_anchor: number }

/** 单项审计结果 */
export type AuditCheck = {
  id: string
  level: 'error' | 'warn'
  applicable: boolean
  ok: boolean
  evidence?: string
  hint?: string
}

export type VideoPromptAudit = {
  checks: AuditCheck[]
  /** applicable && !ok && level=error，用于阻断写回 */
  blockers: AuditCheck[]
  /** applicable && !ok && level=warn，只提示 */
  warnings: AuditCheck[]
}

export type VideoAuditRef = { kind?: string; name?: string }

export type VideoAuditContext = {
  vocab: Record<string, string[]>
  /** 该镜所属场次 beats */
  sceneBeats?: string
  prevShot?: any
  nextShot?: any
  /** 调用方解析好的参考集摘要 */
  refs?: VideoAuditRef[]
  chars?: { name?: string; lookEn?: string }[]
  /** 显式说话人；缺省时从 dialogue 解析 */
  speakers?: string[]
  isLastShot?: boolean
  /** 项目内已建档的场景名；用于判定是否该有场景参考 */
  castSceneNames?: string[]
  /** 项目内已建档的道具名 */
  propNames?: string[]
  /** 剧本 / 视觉设定 / 分镜定稿拼成的可检索文本，供引文守真比对 */
  dialogueSource?: string
}

export declare function auditVideoPromptCore(shot: any, ctx?: VideoAuditContext): VideoPromptAudit

/** 审计项的稳定 id 清单 */
export declare const VIDEO_AUDIT_CHECK_IDS: string[]
