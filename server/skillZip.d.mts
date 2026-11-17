export declare type SkillPackageFile = { path: string; data: Uint8Array }
export declare function manifestNameFromSkillText(text: string): string
export declare const MAX_READABLE_FILE_BYTES: number
export declare function parseSkillPackage(buffer: Buffer | Uint8Array): {
  path: string
  text: string
  files: SkillPackageFile[]
}
export declare function extractSkillMdFromZip(buffer: Buffer): { path: string; text: string }
