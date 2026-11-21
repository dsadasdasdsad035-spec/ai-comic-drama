/** refIds 追加工具，避免与 shot-prev 混在同一函数文件里循环依赖 */
export function appendRefToken(refIds: string[] | undefined, token: string): string[] {
  const cur = refIds ?? []
  if (!token || cur.includes(token)) return cur
  return [...cur, token]
}