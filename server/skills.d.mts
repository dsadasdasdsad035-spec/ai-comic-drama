/** server/skills.mjs 的类型声明（技能文件读取与路径校验） */
export declare const MAX_SKILL_BYTES: number
export declare const MAX_SKILL_FILE_BYTES: number
export declare function safeSkillId(id: unknown): string
export declare function skillsDir(appRoot: string): string
export declare function installedSkillsDir(appRoot: string): string
export declare function installedSkillDir(appRoot: string, id: unknown): string
export declare function hasInstalledSkillDir(appRoot: string, id: unknown): boolean
export declare function resolveSkillDir(
  appRoot: string,
  id: unknown,
): { dir: string; source: 'installed' | 'builtin' } | null
export declare function splitSkillText(text: string): { frontmatter: string; body: string }
export declare function withBuiltinFrontmatter(builtinText: string, body: string): string
export declare function readSkillFile(appRoot: string, id: unknown): string
export declare function readSkillSubFile(
  appRoot: string,
  id: unknown,
  relPath: string,
): { text: string; bytes: number; path: string; source: 'installed' | 'builtin' }
export declare type SkillAttachment = { path: string; bytes: number }
export declare function listSkillAttachments(appRoot: string, id: unknown): SkillAttachment[]
export declare function listSkillFiles(appRoot: string): {
  skills: { id: string; text: string; attachments: SkillAttachment[]; fileCount: number }[]
  errors: { id: string; message: string }[]
}
export declare function mergeSkillCatalog(
  diskSkills: { id: string; text: string }[],
  installs: Array<{
    id: string
    text: string
    provider?: string
    slug?: string
    namespace?: string
    version?: string
    meta?: Record<string, unknown>
  }>,
): Array<{ id: string; text: string; source: string; skillhub?: Record<string, unknown> }>
export declare function ensureInstalledSkillsDir(appRoot: string): string
export declare function installedSkillsRoot(appRoot: string): string
