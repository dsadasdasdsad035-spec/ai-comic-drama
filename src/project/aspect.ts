/**
 * 项目支持的画幅。界面下拉与 Agent 工具共用这一份，
 * 避免「工具能写一个界面选不到的画幅」这种两处枚举漂移。
 */
export const ASPECT_OPTIONS = ['16:9', '9:16', '4:3', '3:4', '1:1'] as const

export type AspectOption = (typeof ASPECT_OPTIONS)[number]

export function isAspectOption(value: unknown): value is AspectOption {
  return typeof value === 'string' && (ASPECT_OPTIONS as readonly string[]).includes(value)
}
