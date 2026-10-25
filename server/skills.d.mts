/** server/skills.mjs 的类型声明（技能文件读取与路径校验） */
export declare const MAX_SKILL_BYTES: number
export declare function safeSkillId(id: unknown): string
export declare function skillsDir(appRoot: string): string
export declare function splitSkillText(text: string): { frontmatter: string; body: string }
export declare function withBuiltinFrontmatter(builtinText: string, body: string): string
export declare function readSkillFile(appRoot: string, id: unknown): string
export declare function listSkillFiles(appRoot: string): {
  skills: { id: string; text: string }[]
  errors: { id: string; message: string }[]
}
