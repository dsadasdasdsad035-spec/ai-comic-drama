/** server/load-env.mjs 的类型声明 */

/** 把仓库根 `.env` 读进 process.env（已存在的变量优先）；返回是否读到文件 */
export function loadDotEnv(root: string): boolean
