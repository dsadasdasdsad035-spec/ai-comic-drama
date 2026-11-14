import type {
  Cap,
  CustomVoice,
  LipSyncSettings,
  ModelEntry,
  Provider,
  ProviderCap,
  ProviderKind,
  RulePack,
  Stage,
} from '../api'
import type { AgentHostMode } from '../agent/agentHostMode'
import type { AgentLimitSettings } from '../agent/agentLimits'
import type { CreativeSettings } from '../creative/settings'
import type { Pricing } from '../pricing'
import type { StockSettings } from '../stock/types'
import { tryAgentPackSkill } from '../skills/agentPack'
import { parseSkillText } from '../skills/parse'
import { LEGACY_RUNTIME_SKILL_IDS } from '../skills/validate'
import { getContract } from '../skills/contracts'
import type { Skill, SkillTextRecord } from '../skills/types'

export const DEFAULT_LIP_SYNC: LipSyncSettings = {
  provider: 'off',
  baseUrl: 'https://api.sync.so',
  apiKey: '',
  pricePerSecond: 0,
}

export function normalizeLipSyncSettings(raw?: LipSyncSettings): LipSyncSettings {
  return {
    provider: raw?.provider === 'sync-labs' ? 'sync-labs' : 'off',
    baseUrl: String(raw?.baseUrl || 'https://api.sync.so'),
    apiKey: String(raw?.apiKey || ''),
    pricePerSecond: Math.max(0, Number(raw?.pricePerSecond) || 0),
  }
}

export const CAP_META: { cap: Cap; label: string; hint: string }[] = [
  { cap: 'text', label: '文本 · 常规', hint: '拆镜/提示词之外的批量生成' },
  { cap: 'textPro', label: '文本 · 高质量', hint: '拆镜 / 拆角色 / 长输出' },
  { cap: 'vision', label: '视觉 · 图像理解', hint: '素材 brief / 其它工作台视觉；只选实际支持图像输入的模型' },
  { cap: 'videoVision', label: '视觉 · 视频理解', hint: '首次 3D 代码生成的视频理解；本地视频不支持时回退关键帧' },
  { cap: 'image', label: '图像 · 出画面', hint: '画布生成画面' },
  { cap: 'view', label: '图像 · 角色三视图', hint: '角色板生成三视图' },
  { cap: 'video', label: '视频 · 首帧出片', hint: '单图图生视频；2.0+ 可带视频参考' },
  { cap: 'videoRef', label: '视频 · 多参考图 / 视频参考', hint: 'reference_image 1~4 张；2.0+ 可带 reference_video' },
  { cap: 'audio', label: '音频 · 配音', hint: '台词合成' },
]

export const CAP_TO_PC: Record<Cap, ProviderCap> = {
  text: 'text',
  textPro: 'text',
  vision: 'text',
  videoVision: 'text',
  image: 'image',
  view: 'image',
  video: 'video',
  videoRef: 'video',
  audio: 'audio',
}

export const PROVIDER_CAPS: { pc: ProviderCap; label: string }[] = [
  { pc: 'text', label: '文本' },
  { pc: 'image', label: '图像' },
  { pc: 'video', label: '视频' },
  { pc: 'audio', label: '音频' },
]

export const KIND_META: { kind: ProviderKind; label: string }[] = [
  { kind: 'apimart', label: 'APIMart（APIB）' },
  { kind: 'ark', label: '字节方舟（ARK）' },
  { kind: 'ark-plan', label: '字节方舟 · Agent Plan' },
  { kind: 'openai', label: 'OpenAI 兼容' },
  { kind: 'minimax', label: 'MiniMax' },
  { kind: 'elevenlabs', label: 'ElevenLabs' },
  { kind: 'volc-tts', label: '火山语音 · Seed TTS' },
]

export const STAGE_META: { stage: Stage; label: string; hint: string }[] = [
  { stage: 'character', label: '角色（拆角色）', hint: '分集梗概/分镜 → 角色外观锚点' },
  { stage: 'asset', label: '素材（历史）', hint: '素材页已改为手工/创意写设定卡；此项仅兼容旧流程，可不绑' },
  { stage: 'shot', label: '画布 · 拆镜', hint: '一集场次 → 镜头列表；3D 文本编排也用它' },
  {
    stage: 'prompt',
    label: '提示词（辅助）',
    hint: '画布单镜与 prompt-intake 导入用；整集分镜请用画布「导入」',
  },
  { stage: 'sceneCode', label: '白模 3D 代码（生成/聊天）', hint: '白模描述 → Blender Python 代码；空则沿用文本默认' },
  { stage: 'vision', label: '视觉（素材 brief）', hint: '选中图片/视频关键帧 → MediaBrief；未绑定则素材只给标签' },
  { stage: 'videoVision', label: '视频理解（首次 3D）', hint: '可选；本地视频不支持时回退关键帧，聊天不使用' },
  { stage: 'creative', label: '创意（对话助手）', hint: '创意工作室聊天主循环；空则沿用文本默认' },
]

export type AddPreset = Omit<Provider, 'apiKey' | 'keyAvailable'> & { custom?: boolean }

export const PROVIDER_PRESETS: AddPreset[] = [
  {
    id: 'apimart',
    label: 'APIMart（APIB）',
    kind: 'apimart',
    baseUrl: 'https://api.apimart.ai/v1',
    note: '文本 / 图像 / 视频 / 配音；目录可同步全部模型',
    caps: ['text', 'image', 'video', 'audio'],
  },
  {
    id: 'ark',
    label: '字节 · 火山方舟',
    kind: 'ark',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    note: '文本 / Seedream 生图 / Seedance 视频',
    caps: ['text', 'image', 'video'],
  },
  {
    id: 'ark-plan',
    label: '字节 · Agent Plan',
    kind: 'ark-plan',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/plan/v3',
    note: 'Agent Plan 专属 Key；文本/图片可用',
    caps: ['text', 'image'],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    kind: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    note: 'OpenAI 兼容',
    caps: ['text'],
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    kind: 'minimax',
    baseUrl: 'https://api.minimaxi.com/v1',
    note: '文本 + 配音',
    caps: ['text', 'audio'],
  },
  {
    id: 'openai',
    label: '第三方 · OpenAI 兼容',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    note: '中转站 / 自建服务',
    caps: ['text', 'image'],
  },
  {
    id: 'elevenlabs',
    label: 'ElevenLabs',
    kind: 'elevenlabs',
    baseUrl: 'https://api.elevenlabs.io',
    note: '配音',
    caps: ['audio'],
  },
  {
    id: 'volc-tts',
    label: '火山语音 · Seed TTS',
    kind: 'volc-tts',
    baseUrl: 'https://openspeech.bytedance.com/api/v3/plan',
    note: 'Agent Plan 语音',
    caps: ['audio'],
  },
  {
    id: '',
    label: '自定义渠道',
    kind: 'openai',
    baseUrl: 'https://',
    note: '自己填 Base URL 和用途',
    caps: ['text'],
    custom: true,
  },
]

export type SkillRow = { record: SkillTextRecord; skill?: Skill; error?: string }

export function toSkillRow(record: SkillTextRecord): SkillRow {
  const pack = tryAgentPackSkill(record)
  if (pack) return { record, skill: pack }
  if (LEGACY_RUNTIME_SKILL_IDS.has(record.id)) {
    try {
      return { record, skill: parseSkillText(record.id, record.text, record.source, record.builtinText) }
    } catch (e) {
      return { record, error: (e as Error).message || String(e) }
    }
  }
  return {
    record,
    error:
      '工作台形态已停用。请从 SkillHub 安装 Agent 技能包；平台 read/submit 为内置工具，不需 workbench manifest。',
  }
}

export function lockedContractText(skill: Skill): string {
  return skill.manifest.contracts
    .map((id) => {
      const c = getContract(id)
      return c?.lockedBlock ? `【${c.label}】\n${c.lockedBlock}` : ''
    })
    .filter(Boolean)
    .join('\n\n')
}

export const capsOf = (p: Provider): ProviderCap[] => p.caps ?? ['text']

export function providerInitial(label: string, id: string): string {
  const ch = Array.from(String(label || '').trim())[0]
  if (ch) return ch.toUpperCase()
  const fallback = String(id || '?').replace(/[^a-z0-9]/gi, '').slice(0, 2)
  return (fallback || '?').toUpperCase()
}

export function kindShortLabel(kind: ProviderKind): string {
  return KIND_META.find((k) => k.kind === kind)?.label ?? kind
}

export function cleanHash(input: {
  providers: Provider[]
  models: ModelEntry[]
  defaults: Partial<Record<Cap, string>>
  stageModels: Partial<Record<Stage, string>>
  pricing: Pricing
  agentLimits: Required<AgentLimitSettings>
  agentHostMode: AgentHostMode
  creative?: CreativeSettings
  stock?: StockSettings
  lipSync: LipSyncSettings
  customVoices: CustomVoice[]
  apiKey: string
  rules: Record<string, RulePack>
}) {
  return JSON.stringify({
    ...input,
    providers: input.providers.map(({ keyAvailable: _k, ...p }) => p),
  })
}

export function providerKeyPlaceholder(kind: ProviderKind): string {
  if (kind === 'ark') return '留空 = 沿用 .env 的 ARK_API_KEY'
  if (kind === 'ark-plan') return '留空 = 沿用 .env 的 ARK_AGENT_PLAN_API_KEY'
  if (kind === 'apimart') return '留空 = 沿用 .env 的 APIB_API_KEY / APIMART_API_KEY'
  if (kind === 'volc-tts') return '留空 = 沿用 .env 的 VOLC_TTS_API_KEY'
  if (kind === 'minimax') return '留空 = 沿用 .env 的 MINIMAX_API_KEY'
  if (kind === 'elevenlabs') return '留空 = 沿用 .env 的 ELEVENLABS_API_KEY'
  return '留空 = 沿用 .env 的 OPENAI_API_KEY'
}
