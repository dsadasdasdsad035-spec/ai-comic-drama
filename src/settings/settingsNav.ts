/** 设置页五枢纽 IA（v3）导航映射 */

export type SettingsHub = 'connections' | 'pipeline' | 'extensions' | 'billing' | 'data'

export type SettingsLegacySection =
  | 'providers'
  | 'models'
  | 'routing'
  | 'agent'
  | 'creative'
  | 'stock'
  | 'pricing'
  | 'billing'
  | 'lipsync'
  | 'voices'
  | 'skills'
  | 'experts'
  | 'mcp'
  | 'data'

export type SettingsPane = SettingsLegacySection | 'overview'

/** 深链与历史 API 仍使用 legacy section id */
export type SettingsInitialSection = SettingsLegacySection

export const ALL_LEGACY_SECTIONS: SettingsLegacySection[] = [
  'providers',
  'models',
  'routing',
  'agent',
  'creative',
  'stock',
  'pricing',
  'billing',
  'lipsync',
  'voices',
  'skills',
  'experts',
  'mcp',
  'data',
]

export const LEGACY_SECTION_TO_NAV: Record<SettingsLegacySection, { hub: SettingsHub; pane: SettingsPane }> = {
  providers: { hub: 'connections', pane: 'providers' },
  models: { hub: 'connections', pane: 'models' },
  routing: { hub: 'pipeline', pane: 'routing' },
  lipsync: { hub: 'pipeline', pane: 'lipsync' },
  voices: { hub: 'pipeline', pane: 'voices' },
  agent: { hub: 'extensions', pane: 'agent' },
  creative: { hub: 'extensions', pane: 'creative' },
  stock: { hub: 'extensions', pane: 'stock' },
  skills: { hub: 'extensions', pane: 'skills' },
  mcp: { hub: 'extensions', pane: 'mcp' },
  experts: { hub: 'extensions', pane: 'experts' },
  pricing: { hub: 'billing', pane: 'pricing' },
  billing: { hub: 'billing', pane: 'billing' },
  data: { hub: 'data', pane: 'data' },
}

export const HUB_NAV: { id: SettingsHub; label: string }[] = [
  { id: 'connections', label: '连接与模型' },
  { id: 'pipeline', label: '制作管线' },
  { id: 'extensions', label: '智能与扩展' },
  { id: 'billing', label: '费用' },
  { id: 'data', label: '数据' },
]

export const HUB_COPY: Record<SettingsHub, { title: string; subtitle: string }> = {
  connections: {
    title: '连接与模型',
    subtitle: '配置渠道 Key，并把模型同步进库',
  },
  pipeline: {
    title: '制作管线',
    subtitle: '各环节默认模型、口型与配音音色',
  },
  extensions: {
    title: '智能与扩展',
    subtitle: 'Agent 限制、创意助手与 SkillHub / MCP',
  },
  billing: {
    title: '费用',
    subtitle: '本地估算单价与钱包充值',
  },
  data: {
    title: '数据',
    subtitle: '项目清理与数据库路径',
  },
}

export const HUB_PANES: Record<SettingsHub, { id: SettingsPane; label: string }[]> = {
  connections: [
    { id: 'providers', label: '渠道' },
    { id: 'models', label: '模型库' },
  ],
  pipeline: [
    { id: 'routing', label: '默认路由' },
    { id: 'lipsync', label: '口型' },
    { id: 'voices', label: '音色' },
  ],
  extensions: [
    { id: 'overview', label: '总览' },
    { id: 'agent', label: 'Agent' },
    { id: 'creative', label: '创意' },
    { id: 'skills', label: '技能' },
    { id: 'mcp', label: 'MCP' },
    { id: 'experts', label: '创意专家' },
    { id: 'stock', label: '素材库' },
  ],
  billing: [
    { id: 'pricing', label: '计价' },
    { id: 'billing', label: '账户与充值' },
  ],
  data: [{ id: 'data', label: '数据' }],
}

export function hubDefaultPane(hub: SettingsHub): SettingsPane {
  return HUB_PANES[hub][0]?.id ?? 'data'
}

export function assertLegacySectionNavCoverage(): void {
  for (const id of ALL_LEGACY_SECTIONS) {
    if (!LEGACY_SECTION_TO_NAV[id]) {
      throw new Error(`LEGACY_SECTION_TO_NAV 缺少 ${id}`)
    }
  }
}

assertLegacySectionNavCoverage()