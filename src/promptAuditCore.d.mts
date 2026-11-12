/** src/promptAuditCore.mjs 的类型声明：浏览器与 server/db.mjs 共用的锚点审计纯函数 */
export declare function parseDialogueCore(text: string): { speaker: string; text: string }[]
export declare function auditKeyframePromptCore(
  shot: any,
  chars: { name?: string; lookEn?: string }[],
): { cast: string[]; missing: string[]; maybe: string[]; unknown: string[]; empty: boolean }
export declare function projectHealthCore(
  shots: any[],
  chars: { name?: string; lookEn?: string }[],
): { empty: boolean; missing_keyframe: number; missing_anchor: number }
