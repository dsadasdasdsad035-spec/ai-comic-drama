/** server/skillStore.mjs 的类型声明（技能包落盘与卸载清理） */
export declare function writeInstalledSkill(
  appRoot: string,
  id: string,
  files: Array<{ path: string; data: Uint8Array }>,
): { dir: string; fileCount: number; totalBytes: number }
export declare function removeInstalledSkill(appRoot: string, id: string): boolean
