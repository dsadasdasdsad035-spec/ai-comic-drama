/** 内置案例种子的加载与灌入（见 prompt-cases-seed.mjs 的模块注释） */
export declare const SEED_REL_DIR: string
export declare const SEED_MARK_KEY: string
export declare function seedPromptCases(
  appRoot: string,
  root: string,
  options?: { log?: (line: string) => void },
): { seeded: boolean; cases?: number; facets?: number; reason?: string }
