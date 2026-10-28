import { defineConfig, type Plugin } from 'vite'
import type { DialogueDelivery } from './src/types'
import tailwindcss from '@tailwindcss/vite'
import { normalizeAgentLimits, type AgentLimitSettings } from './src/agent/agentLimits'
import { normalizeSceneAgentEngine, type SceneAgentEngine } from './src/agent/sceneAgentEngine'
import {
  entryOf,
  mergeCustomVoices,
  miniMaxVoicesFromResponse,
  normalizeCustomVoices,
  voiceCapabilitiesForKind,
  type CustomVoice,
} from './src/voiceCatalog'
import { normalizeToolProtocol, toolThinkingMode, supportsNativeTools } from './src/agent/toolCapabilities'
import { validateContract as validateSkillContract } from './src/skills/contracts'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import { openBundle, getBundle, readBundleFile, cleanupBundle, cleanupAllBundles } from './server/bundle.mjs'
import { createProject, listProjects, readProject, writeProject, mergeShots, deleteShots, pruneDanglingTransitions, findDuplicateShotNos, resolveRoot, getSetting, setSetting, dbPath, safeProjectName, listSkillOverrides, getSkillOverride, setSkillOverride, deleteSkillOverride, getChatThread, saveChatThread, deleteChatThread } from './server/db.mjs'
import { deleteProjects, previewProjectDelete, previewProjectDeletes } from './server/project-lifecycle.mjs'
import { createDeliverable, deleteDeliverable, getDeliverable, listDeliverables, normalizeDeliverableConfig, patchDeliverableConfig } from './server/deliverables.mjs'
import { getPlatform, listPlatforms } from './server/publish-platforms.mjs'
import { listAdapters } from './server/publish-adapters.mjs'
import {
  accountProfileDir,
  deleteAccount,
  findAccountByPlatform,
  getAccount,
  getAccountInternal,
  listAccounts,
  setAccountStatus,
  upsertAccount,
} from './server/publish-accounts.mjs'
import { adapterLoginProbe, cancelLogin, checkSession, confirmLogin, getSession, startLogin } from './server/publish-browser.mjs'
import { runPreflight } from './server/publish-preflight.mjs'
import {
  createJob,
  getJob,
  getJobWithEvents,
  jobSummary,
  listJobs,
  markPublished,
  RETRYABLE_STATES,
  transitionJob,
} from './server/publish-jobs.mjs'
import { cancel, closeKeptOpenWindows, enqueue, keptOpenWindowCount } from './server/publish-queue.mjs'
import { buildPublishPackage } from './server/publish-package.mjs'
import { autoDraftOnExport } from './server/publish-auto.mjs'
import { chromeAvailable, hasDisplay, NO_DISPLAY_HINT, profilesRoot, resolveChrome, sanitizeError } from './server/publish-utils.mjs'
import { recoverInterruptedJobs } from './server/publish-jobs.mjs'
import {
  cancelIntent,
  confirmIntent,
  expireStaleIntents,
  getIntent,
  stageIntent,
  sweepIntents,
} from './server/publish-intents.mjs'
import { MAX_SKILL_BYTES, listSkillFiles, readSkillFile, safeSkillId, splitSkillText, withBuiltinFrontmatter } from './server/skills.mjs'
/** 压缩包上传上限：7.4MB 的真实资料包留足余量，同时挡住误传大文件 */
const MAX_BUNDLE_BYTES = 200 * 1024 * 1024

import {
  MAX_REF_BYTES,
  copyIntoProjectMedia,
  listProjectImages,
  migrateProjectMedia,
  parseProjectMediaUrl,
  resolveProjectMediaPath,
  resolveRef,
  saveProjectImage,
} from './server/media.mjs'
import {
  mergeStockSettings,
  normalizeStockSettings,
  redactStockSettings,
} from './server/stock-settings.mjs'
import {
  StockError,
  describeProviders as describeStockProviders,
  importStockItem,
  searchStock as searchStockItems,
  stockMetaForUrl,
} from './server/stock.mjs'
import {
  VideoParamError,
  buildVideoPayload,
  downloadVideoArtifacts,
  pollVideoTask,
  submitVideoTask,
} from './server/video.mjs'
import {
  ApimartError,
  APIMART_DEFAULT_VOICE,
  APIMART_VOICES,
  buildImagePayload as buildApimartImagePayload,
  buildVideoPayload as buildApimartVideoPayload,
  downloadResult as downloadApimartResult,
  errorFromResponse,
  fetchCatalog as fetchApimartCatalog,
  imageUrlsFromTask,
  isSupportedVideoModel,
  parseChatBody,
  pollTask as pollApimartTask,
  submitImage as submitApimartImage,
  submitVideo as submitApimartVideo,
  synthesizeSpeech as synthesizeApimartSpeech,
  uploadImage as uploadApimartImage,
  videoFamilyFor,
  videoUrlFromTask,
} from './server/apimart.mjs'
import { FileError, ensureUploadedVideo } from './server/files.mjs'
import { runSyncLabs } from './server/lipsync.mjs'
import { analyzeLipSync } from './server/lipsyncQa.mjs'
import { ChatStreamParser } from './server/text-stream.mjs'
import { isRunnableModel, modelHasCap } from './src/modelCaps'
import {
  normalizeChatMessages,
  normalizeToolCalls,
  normalizeToolSchemas,
  toolRequestError,
} from './server/text-tools.mjs'
import {
  appendDraft,
  beginDraft,
  commitDraft,
  discardAllDrafts,
  discardDraft,
  draftText,
  patchDraft,
  readDraft,
  sweepStaleDrafts,
} from './server/scene-draft.mjs'
import {
  DEFAULT_VOLC_TTS_VOICE,
  VOLC_TTS_VOICES,
  synthesizeVolcTts,
} from './server/volc-tts.mjs'
import {
  blenderHealth,
  cancelRenderJob,
  cleanupStaleJobs,
  getRenderJob,
  listRenderJobs,
  shutdownRenderJobs,
  submitRenderJob,
} from './server/blender.mjs'
import {
  MAX_CREATIVE_THREAD_BYTES,
  createSession as createCreativeSession,
  deleteSession as deleteCreativeSession,
  getArtifact as getCreativeArtifact,
  getSession as getCreativeSessionRecord,
  getSource as getCreativeSource,
  getThread as getCreativeThread,
  insertSource as insertCreativeSource,
  listArtifacts as listCreativeArtifacts,
  listSessions as listCreativeSessions,
  listShots as listCreativeShots,
  listSources as listCreativeSources,
  patchSource as patchCreativeSource,
  patchShot as patchCreativeShot,
  replaceShots as replaceCreativeShots,
  resolveCreativeFile,
  saveArtifact as saveCreativeArtifact,
  saveThread as saveCreativeThread,
  sessionDir as creativeSessionDir,
  sessionSummary as creativeSessionSummary,
  touchSession as touchCreativeSession,
} from './server/creative.mjs'
import { promoteReversePack, reversePackToText } from './server/creative-promote.mjs'
import {
  extractCover as extractCreativeCover,
  extractFrame as extractCreativeFrame,
  ffmpegStatus,
  probeMedia,
  splitScenes,
} from './server/video-analyze.mjs'
import {
  ingestSource as ingestCreativeSource,
  listAdapters as listIngestAdapters,
} from './server/ingest.mjs'
import {
  applyCreativeEnvDefaults,
  normalizeCreativeSettings,
  redactCreativeSettings,
  type CreativeSettings,
} from './src/creative/settings'

const ARK_URL = 'https://ark.cn-beijing.volces.com/api/v3/images/generations'
const ARK_CHAT = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions'
const MODEL = 'doubao-seedream-4-5-251128'
/** 文本档位：拆镜 / 提示词这种长输出用 pro，其余用 lite */
const TEXT_MODELS = {
  lite: process.env.ARK_TEXT_MODEL || 'doubao-seed-2-0-lite-260428',
  pro: process.env.ARK_TEXT_MODEL_PRO || 'doubao-seed-2-1-pro-260915',
} as const

/** 账户已开通的图生视频模型（2.0 / 2.5 系列需在方舟控制台单独开通） */
const VIDEO_MODEL = 'doubao-seedance-1-0-pro-250528'
/** 多参考图（reference_image，1~4 张）走 Lite I2V；已开通 1.5 pro 可在设置页换模型 */
const VIDEO_REF_MODEL = 'doubao-seedance-1-0-lite-i2v-250428'

/** 画幅 → Seedream 合规像素（4.5 要求总像素 ≥ 3,686,400） */
/** Seedream 单候选 / 下载超时；测试可用环境变量缩短 */
const SEEDREAM_TIMEOUT_MS = Math.max(1000, Number(process.env.SEEDREAM_TIMEOUT_MS) || 180_000)
const SEEDREAM_DOWNLOAD_TIMEOUT_MS = Math.max(1000, Number(process.env.SEEDREAM_DOWNLOAD_TIMEOUT_MS) || 60_000)

function linkedTimeout(parent: AbortSignal | undefined, ms: number) {
  const ctrl = new AbortController()
  let timedOut = false
  const onParent = () => ctrl.abort()
  if (parent?.aborted) ctrl.abort()
  else parent?.addEventListener('abort', onParent, { once: true })
  const timer = setTimeout(() => {
    timedOut = true
    ctrl.abort()
  }, ms)
  return {
    signal: ctrl.signal,
    timedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timer)
      parent?.removeEventListener('abort', onParent)
    },
  }
}

const RATIO_SIZE: Record<string, string> = {
  '16:9': '2560x1440',
  '9:16': '1440x2560',
  '4:3': '2304x1728',
  '3:4': '1728x2304',
  '1:1': '2048x2048',
  '21:9': '3024x1296',
}

function readApiKey(): string | null {
  // 设置页里填的 Key 优先于 .env / 环境变量
  const fromSettings = String(getAppSettings().apiKey || '').trim()
  if (fromSettings) return fromSettings
  const candidates = [
    path.join(os.homedir(), '.canghe-skills', '.env'),
    path.join(process.cwd(), '.canghe-skills', '.env'),
    path.join(process.cwd(), '.env'),
  ]
  for (const f of candidates) {
    try {
      const txt = fs.readFileSync(f, 'utf8')
      const m = txt.match(/^\s*ARK_API_KEY\s*=\s*(.+)$/m)
      if (m) return m[1].trim().replace(/^["']|["']$/g, '')
    } catch {
      /* 继续找下一个 */
    }
  }
  return process.env.ARK_API_KEY || null
}

/** 从 ~/.canghe-skills/.env 或进程环境里读任意 KEY */
function readEnvKey(name: string): string | null {
  const candidates = [
    path.join(os.homedir(), '.canghe-skills', '.env'),
    path.join(process.cwd(), '.canghe-skills', '.env'),
    path.join(process.cwd(), '.env'),
  ]
  const re = new RegExp(`^\\s*${name}\\s*=\\s*(.+)$`, 'm')
  for (const f of candidates) {
    try {
      const m = fs.readFileSync(f, 'utf8').match(re)
      if (m) return m[1].trim().replace(/^["']|["']$/g, '')
    } catch {
      /* 继续找下一个 */
    }
  }
  return process.env[name] || null
}

// ---------------------------------------------------------------- 设置（存 SQLite settings 表）

type RulePack = { enabled: boolean; text: string }

/** 能力：文本两档 / 图像 / 三视图 / 视频两档 / 音频 */
type Cap = 'text' | 'textPro' | 'vision' | 'videoVision' | 'image' | 'view' | 'video' | 'videoRef' | 'audio'
const CAP_VALUES: Cap[] = ['text', 'textPro', 'vision', 'videoVision', 'image', 'view', 'video', 'videoRef', 'audio']

/** 生成环节：环节默认值只引用模型表里的键，不携带模型 ID */
type Stage = 'script' | 'character' | 'asset' | 'shot' | 'prompt' | 'sceneCode' | 'vision' | 'videoVision' | 'publish'
const STAGES: Stage[] = ['script', 'character', 'asset', 'shot', 'prompt', 'sceneCode', 'vision', 'videoVision', 'publish']

/** 渠道协议：决定请求怎么发 */
type ProviderKind = 'ark' | 'ark-plan' | 'apimart' | 'openai' | 'minimax' | 'elevenlabs' | 'volc-tts'

type Provider = {
  id: string
  label: string
  kind: ProviderKind
  baseUrl: string
  /** 留空则 ARK 回落到 .env / 环境变量 */
  apiKey?: string
  note?: string
  /** 这个渠道能做哪几类活：文本 / 图片 / 视频 / 音频 */
  caps?: ProviderCap[]
  /** 只读：该渠道当前是否解析到 Key；不落库 */
  keyAvailable?: boolean
}
type ProviderCap = 'text' | 'image' | 'video' | 'audio'

type ModelFeatureSet = {
  vision?: boolean
  videoInput?: boolean
  imageRef?: 'none' | 'single' | 'multi'
  videoRef?: boolean
  firstFrame?: boolean
  lastFrame?: boolean
  audioOut?: boolean
  tools?: boolean
}

type ModelEntry = {
  /** 唯一键，生成时按它选模型 */
  key: string
  label: string
  cap: Cap
  /** 一个模型可服务多个能力；缺省时按 cap 的旧语义路由 */
  caps?: Cap[]
  /** Provider.id */
  provider: string
  /** 真实模型 ID */
  model: string
  note?: string
  /** 这个模型能否把视频作为 reference_video（Seedance 2.0/2.5） */
  supportsVideoRef?: boolean
  /** 2.5 需要显式指定 reference；2.0 留空 */
  videoRefTaskType?: 'reference'
  /**
   * DeepSeek Flash 混合推理开关：
   * auto（默认）= 普通文本开思考、JSON/工具协议关思考；enabled/disabled = 强制。
   */
  thinking?: 'auto' | 'enabled' | 'disabled'
  /** 目录/预设来源 */
  source?: 'preset' | 'catalog' | 'manual'
  /** 目录已登记但运行时尚未接入时不可选 */
  runtime?: 'ready' | 'catalog-only'
  /** 能力细节，供 UI 与服务端判定 */
  features?: ModelFeatureSet
}

/** 计价（设置页可改；默认值为估算，对不上账单时按实际单价校准） */
type Pricing = { image?: number; video480?: number; video720?: number; audio?: number }

type AppSettings = {
  providers: Provider[]
  models: ModelEntry[]
  defaults: Partial<Record<Cap, string>>
  /** 每个生成环节的默认模型键；空 = 沿用 defaults.text */
  stageModels?: Partial<Record<Stage, string>>
  pricing?: Pricing
  /** 3D agent 的运行上限；缺省使用默认值 */
  agentLimits?: AgentLimitSettings
  /** 3D agent 的工具协议；缺省 auto */
  agentToolProtocol?: 'auto' | 'native' | 'json'
  /** 3D agent 执行引擎；缺省 pi，模型不支持原生工具时回退 langgraph */
  agentEngine?: SceneAgentEngine
  /** 设置库里的自定义音色条目 */
  customVoices?: CustomVoice[]
  /** 创意会话：摄取、能力绑定、分析档位与成本闸门；缺省用默认值 */
  creative?: CreativeSettings
  /** 在线素材来源：每个来源的启用、Key 与可选 Base URL；缺省全部关闭 */
  stock?: ReturnType<typeof normalizeStockSettings>
  /** 口型 provider；默认关闭 */
  lipSync?: {
    provider: 'off' | 'sync-labs'
    baseUrl?: string
    apiKey?: string
    pricePerSecond?: number
  }
  /** 旧的单 Key 字段，保留给 ARK 兜底与老数据 */
  apiKey: string
  rules: Record<string, RulePack>
  /** 旧规则包已迁移为技能覆盖；避免重复迁移 */
  skillsMigrated?: boolean
  /** 预设迁移版本：只在升级时合并一次新渠道/模型 */
  presetsVersion?: number
}

/** 环节绑定只接受已知环节与合法模型键 */
function normalizeStageModels(raw: unknown): Partial<Record<Stage, string>> {
  const out: Partial<Record<Stage, string>> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const stage of STAGES) {
    const value = (raw as Record<string, unknown>)[stage]
    if (typeof value === 'string' && value.trim()) out[stage] = value.trim()
  }
  return out
}

/** 预置渠道：用户不用配也能跑（Key 留空时 ARK 走 .env） */
const DEFAULT_PROVIDERS: Provider[] = [
  {
    id: 'ark',
    label: '字节 · 火山方舟',
    kind: 'ark',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    note: '文本 / Seedream 生图 / Seedance 视频，Key 可留空沿用 .env',
    caps: ['text', 'image', 'video'],
  },
  {
    id: 'ark-plan',
    label: '字节 · Agent Plan',
    kind: 'ark-plan',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/plan/v3',
    note: 'Agent Plan 专属 Key（可留空沿用 .env 的 ARK_AGENT_PLAN_API_KEY）；文本/图片可用，视频不在本套餐，按 AFP 计费',
    caps: ['text', 'image'],
  },
  {
    id: 'apimart',
    label: 'APIMart（APIB）',
    kind: 'apimart',
    baseUrl: 'https://api.apimart.ai/v1',
    note: '文本 / 图像 / 视频 / 配音；Key 可留空沿用 .env 的 APIB_API_KEY / APIMART_API_KEY；余额不足时网关返回 402',
    caps: ['text', 'image', 'video', 'audio'],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    kind: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    note: 'OpenAI 兼容，填 Key 即用',
    caps: ['text'],
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    kind: 'minimax',
    baseUrl: 'https://api.minimaxi.com/v1',
    note: '文本 chat/completions / 语音 t2a_v2',
    caps: ['text', 'audio'],
  },
  {
    id: 'elevenlabs',
    label: 'ElevenLabs',
    kind: 'elevenlabs',
    baseUrl: 'https://api.elevenlabs.io',
    note: '配音，多角色音色',
    caps: ['audio'],
  },
  {
    id: 'volc-tts',
    label: '火山语音 · Seed TTS',
    kind: 'volc-tts',
    baseUrl: 'https://openspeech.bytedance.com/api/v3/plan',
    note: 'Agent Plan 语音（可留空沿用 .env 的 ARK_AGENT_PLAN_API_KEY）；需在控制台开启扣减，按 AFP 计费',
    caps: ['audio'],
  },
  {
    id: 'openai',
    label: '第三方 · OpenAI 兼容',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    note: '中转站 / 自建服务，改 baseUrl 即可',
    caps: ['text', 'image'],
  },
]

/** 预置模型：每个能力至少一条，默认指向 ARK 现状 */
const DEFAULT_MODELS: ModelEntry[] = [
  { key: 'ark-text-lite', label: '豆包 · lite', cap: 'text', provider: 'ark', model: TEXT_MODELS.lite },
  { key: 'ark-text-pro', label: '豆包 · pro', cap: 'textPro', provider: 'ark', model: TEXT_MODELS.pro },
  {
    key: 'ark-plan-text-lite',
    label: '豆包 2.1 lite（Agent Plan）',
    cap: 'text',
    provider: 'ark-plan',
    model: 'doubao-seed-2-1-lite-260915',
  },
  {
    key: 'ark-plan-text-pro',
    label: '豆包 2.1 pro（Agent Plan）',
    cap: 'textPro',
    provider: 'ark-plan',
    model: 'doubao-seed-2-1-pro-260915',
  },
  {
    key: 'ark-plan-text-evolving',
    label: '豆包 Seed Evolving（Agent Plan）',
    cap: 'textPro',
    provider: 'ark-plan',
    model: 'doubao-seed-evolving',
  },
  { key: 'ark-plan-text-deepseek', label: 'DeepSeek V4 Pro（Agent Plan）', cap: 'text', provider: 'ark-plan', model: 'deepseek-v4-pro' },
  {
    key: 'ark-plan-text-deepseek-flash',
    label: 'DeepSeek Flash（Agent Plan · 混合推理）',
    cap: 'text',
    provider: 'ark-plan',
    model: 'deepseek-v4-flash',
    note: '普通文本启用思考，JSON / 工具协议自动关闭思考',
    thinking: 'auto',
  },
  {
    key: 'ark-plan-vision-deepseek-flash',
    label: 'DeepSeek Flash Vision（Agent Plan · 混合推理）',
    cap: 'vision',
    provider: 'ark-plan',
    model: 'deepseek-v4-flash',
    note: '关键帧/参考板视觉理解；JSON 验收自动关闭思考',
    thinking: 'auto',
  },
  { key: 'ark-plan-text-kimi', label: 'Kimi K3（Agent Plan）', cap: 'text', provider: 'ark-plan', model: 'kimi-k3' },
  { key: 'ark-plan-text-glm', label: 'GLM 5.3（Agent Plan）', cap: 'text', provider: 'ark-plan', model: 'glm-5.3' },
  { key: 'deepseek-chat', label: 'DeepSeek Chat', cap: 'text', provider: 'deepseek', model: 'deepseek-chat' },
  {
    key: 'deepseek-reasoner',
    label: 'DeepSeek Reasoner',
    cap: 'textPro',
    provider: 'deepseek',
    model: 'deepseek-reasoner',
  },
  { key: 'minimax-text', label: 'MiniMax M3', cap: 'text', provider: 'minimax', model: 'MiniMax-M3' },
  { key: 'minimax-text-pro', label: 'MiniMax M3（高质量）', cap: 'textPro', provider: 'minimax', model: 'MiniMax-M3' },
  { key: 'ark-image', label: 'Seedream 4.5', cap: 'image', provider: 'ark', model: MODEL },
  { key: 'ark-view', label: 'Seedream 4.5（三视图）', cap: 'view', provider: 'ark', model: MODEL },
  {
    key: 'ark-plan-image',
    label: 'Seedream 5.0 Pro（Agent Plan）',
    cap: 'image',
    provider: 'ark-plan',
    model: 'doubao-seedream-5-0-pro-260628',
  },
  {
    key: 'ark-plan-view',
    label: 'Seedream 5.0 Pro（三视图 · Agent Plan）',
    cap: 'view',
    provider: 'ark-plan',
    model: 'doubao-seedream-5-0-pro-260628',
  },
  {
    key: 'openai-image',
    label: 'gpt-image-1（第三方）',
    cap: 'image',
    provider: 'openai',
    model: 'gpt-image-1',
    note: '需在渠道里配好 baseUrl + Key',
  },
  {
    key: 'apimart-text-gpt-5-1',
    label: 'GPT-5.1（APIMart）',
    cap: 'text',
    caps: ['text', 'textPro', 'vision'],
    provider: 'apimart',
    model: 'gpt-5.1',
    source: 'preset',
    features: { vision: true },
  },
  {
    key: 'apimart-text-claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6（APIMart）',
    cap: 'text',
    caps: ['text', 'textPro'],
    provider: 'apimart',
    model: 'claude-sonnet-4-6',
    source: 'preset',
  },
  {
    key: 'apimart-text-gemini-3-5-flash',
    label: 'Gemini 3.5 Flash（APIMart）',
    cap: 'text',
    caps: ['text', 'textPro', 'vision'],
    provider: 'apimart',
    model: 'gemini-3.5-flash',
    source: 'preset',
    features: { vision: true },
  },
  {
    key: 'apimart-text-deepseek-v4-flash',
    label: 'DeepSeek V4 Flash（APIMart）',
    cap: 'text',
    caps: ['text', 'textPro'],
    provider: 'apimart',
    model: 'deepseek-v4-flash',
    source: 'preset',
  },
  {
    key: 'apimart-image-seedream-5-0-pro',
    label: 'Seedream 5.0 Pro（APIMart）',
    cap: 'image',
    caps: ['image', 'view'],
    provider: 'apimart',
    model: 'seedream-5-0-pro',
    source: 'preset',
    features: { imageRef: 'multi' },
  },
  {
    key: 'apimart-video-seedance-2-5',
    label: 'Seedance 2.5（APIMart）',
    cap: 'video',
    caps: ['video'],
    provider: 'apimart',
    model: 'seedance-2.5',
    supportsVideoRef: true,
    source: 'preset',
    features: { firstFrame: true, lastFrame: true, videoRef: true, audioOut: true },
  },
  {
    key: 'apimart-video-kling-v3',
    label: 'Kling v3（APIMart）',
    cap: 'video',
    caps: ['video'],
    provider: 'apimart',
    model: 'kling-v3',
    source: 'preset',
    features: { firstFrame: true, lastFrame: true },
  },
  {
    key: 'apimart-tts-gpt-4o-mini-tts',
    label: 'GPT-4o mini TTS（APIMart）',
    cap: 'audio',
    caps: ['audio'],
    provider: 'apimart',
    model: 'gpt-4o-mini-tts',
    source: 'preset',
    features: { audioOut: true },
  },
  { key: 'ark-video', label: 'Seedance 1.0 pro', cap: 'video', provider: 'ark', model: VIDEO_MODEL },
  { key: 'ark-video-ref', label: 'Seedance Lite I2V（多参考）', cap: 'videoRef', provider: 'ark', model: VIDEO_REF_MODEL },
  {
    key: 'ark-video-2-0',
    label: 'Seedance 2.0（视频参考）',
    cap: 'video',
    provider: 'ark',
    model: 'doubao-seedance-2-0-260128',
    supportsVideoRef: true,
  },
  {
    key: 'ark-video-2-5',
    label: 'Seedance 2.5（视频参考）',
    cap: 'video',
    provider: 'ark',
    model: 'doubao-seedance-2-5-260628',
    supportsVideoRef: true,
    videoRefTaskType: 'reference',
  },
  { key: 'eleven-tts', label: 'ElevenLabs 多语言 v2', cap: 'audio', provider: 'elevenlabs', model: 'eleven_multilingual_v2' },
  { key: 'volc-tts', label: '火山 Seed TTS 2.0', cap: 'audio', provider: 'volc-tts', model: 'doubao-seed-tts-2.0' },
  { key: 'minimax-tts', label: 'MiniMax speech-2.8-hd', cap: 'audio', provider: 'minimax', model: 'speech-2.8-hd' },
]

const DEFAULT_DEFAULTS: Partial<Record<Cap, string>> = {
  text: 'minimax-text',
  textPro: 'minimax-text-pro',
  image: 'ark-plan-image',
  view: 'ark-plan-view',
  video: 'ark-video',
  videoRef: 'ark-video-ref',
  audio: 'minimax-tts',
  // Agent Plan 网关不解析 image_url，视觉默认走 APIMart 的多模态模型
  vision: 'apimart-text-gemini-3-5-flash',
}

/** 老渠道没有 caps 字段时按协议推一个默认用途 */
function capsOfKind(kind: ProviderKind): ProviderCap[] {
  if (kind === 'ark') return ['text', 'image', 'video']
  if (kind === 'ark-plan') return ['text', 'image']
  if (kind === 'apimart') return ['text', 'image', 'video', 'audio']
  if (kind === 'openai') return ['text', 'image']
  if (kind === 'minimax') return ['text', 'audio']
  if (kind === 'volc-tts') return ['audio']
  return ['audio']
}

/** 预设迁移版本：只在升级时合并一次新增的渠道/模型 */
const CURRENT_PRESETS_VERSION = 10
const V2_PRESET_PROVIDER_IDS = new Set(['ark-plan', 'volc-tts'])
const V2_PRESET_MODEL_KEYS = new Set(
  DEFAULT_MODELS.filter((m) => V2_PRESET_PROVIDER_IDS.has(m.provider)).map((m) => m.key),
)
/** v3：Seedance 2.x 视频参考模型；不改变默认 video 仍指向 1.0 */
const V3_PRESET_MODEL_KEYS = new Set(['ark-video-2-0', 'ark-video-2-5'])
/** v4：DeepSeek Flash 混合推理文本模型；不改变任何默认模型 */
const V4_PRESET_MODEL_KEYS = new Set(['ark-plan-text-deepseek-flash'])
/** v5：DeepSeek Flash 视觉模型；没有其它视觉模型时成为默认视觉候选 */
const V5_PRESET_MODEL_KEYS = new Set(['ark-plan-vision-deepseek-flash'])
/**
 * v10：Agent Plan 的 /api/plan/v3 网关不解析 image_url —— 它把 dataURL 当普通文本
 * 塞进 prompt（模型回答「图片数据被截断」）。该条目因此只剩文本能力，
 * 视觉默认改绑 APIMart 的多模态模型（实测能真正读到图）。
 */
const V10_BROKEN_VISION_KEY = 'ark-plan-vision-deepseek-flash'
const V10_VISION_FALLBACK_KEY = 'apimart-text-gemini-3-5-flash'

/** v6-v8：APIMart 渠道与已接入运行时的预置模型；不改变任何默认模型 */
function mergeApimartPresets(providers: Provider[], models: ModelEntry[]) {
  const providerIds = new Set(providers.map((p) => p.id))
  const modelKeys = new Set(models.map((m) => m.key))
  const addProviders = DEFAULT_PROVIDERS.filter((p) => p.id === 'apimart' && !providerIds.has(p.id))
  const addModels = DEFAULT_MODELS.filter((m) => m.provider === 'apimart' && !modelKeys.has(m.key))
  return {
    providers: [...providers, ...addProviders],
    models: [...models, ...addModels],
  }
}

function mergePresets(cur: AppSettings, version: number): AppSettings {
  if (version >= CURRENT_PRESETS_VERSION) return { ...cur, presetsVersion: version }
  let providers = cur.providers
  let models = cur.models
  let defaults = cur.defaults
  let stageModels: Partial<Record<Stage, string>> = { ...cur.stageModels }
  if (version < 2) {
    const providerIds = new Set(providers.map((p) => p.id))
    const modelKeys = new Set(models.map((m) => m.key))
    providers = [
      ...providers,
      ...DEFAULT_PROVIDERS.filter((p) => V2_PRESET_PROVIDER_IDS.has(p.id) && !providerIds.has(p.id)),
    ]
    models = [
      ...models,
      ...DEFAULT_MODELS.filter((m) => V2_PRESET_MODEL_KEYS.has(m.key) && !modelKeys.has(m.key)),
    ]
  }
  if (version < 3) {
    const modelKeys = new Set(models.map((m) => m.key))
    models = [
      ...models,
      ...DEFAULT_MODELS.filter((m) => V3_PRESET_MODEL_KEYS.has(m.key) && !modelKeys.has(m.key)),
    ]
  }
  if (version < 4) {
    const modelKeys = new Set(models.map((m) => m.key))
    models = [
      ...models,
      ...DEFAULT_MODELS.filter((m) => V4_PRESET_MODEL_KEYS.has(m.key) && !modelKeys.has(m.key)),
    ]
  }
  if (version < 5) {
    const modelKeys = new Set(models.map((m) => m.key))
    models = [
      ...models,
      ...DEFAULT_MODELS.filter((m) => V5_PRESET_MODEL_KEYS.has(m.key) && !modelKeys.has(m.key)),
    ]
  }
  if (version < 9) {
    const merged = mergeApimartPresets(providers, models)
    providers = merged.providers
    models = merged.models
  }
  if (version < 10) {
    // 该条目仍是可用的文本模型，但不能再当视觉模型用。
    // 注意必须同时改写 cap：caps 为空数组时 modelHasCap 会回退到 cap，
    // 只删 vision 会让它继续被当成视觉模型。
    models = models.map((m) =>
      m.key === V10_BROKEN_VISION_KEY
        ? { ...m, cap: 'text' as const, caps: ['text' as Cap] }
        : m,
    )
  }
  return { ...cur, providers, models, defaults, stageModels, presetsVersion: CURRENT_PRESETS_VERSION }
}

/**
 * 视觉绑定自愈：历史数据里可能绑着已经不能读图的模型
 * （Agent Plan 的 /api/plan/v3 不解析 image_url，实测把 dataURL 当文本喂给模型）。
 * 在每次读取设置时兜一次，不依赖预设版本号——否则已经写坏一次的库永远修不回来。
 * 同时把坏条目本身降级成文本模型，避免它继续出现在视觉候选里。
 */
function repairVisionBinding(s: AppSettings): AppSettings {
  let changed = false
  const models = s.models.map((m) => {
    if (m.key !== V10_BROKEN_VISION_KEY) return m
    if (!modelHasCap(m, 'vision')) return m
    changed = true
    return { ...m, cap: 'text' as const, caps: ['text' as Cap] }
  })
  const usable = (key: string | undefined) => {
    if (!key) return false
    const m = models.find((x) => x.key === key)
    return Boolean(m && modelHasCap(m, 'vision') && isRunnableModel(m))
  }
  let defaults = s.defaults
  let stageModels = { ...s.stageModels }
  if (!usable(defaults.vision)) {
    defaults = { ...defaults }
    if (usable(V10_VISION_FALLBACK_KEY)) {
      defaults.vision = V10_VISION_FALLBACK_KEY
      changed = true
    } else if (defaults.vision) {
      delete defaults.vision
      changed = true
    }
  }
  for (const stage of ['vision', 'videoVision'] as const) {
    if (stageModels[stage] && !usable(stageModels[stage])) {
      delete stageModels[stage]
      changed = true
    }
  }
  if (!stageModels.vision && defaults.vision && usable(defaults.vision)) {
    stageModels.vision = defaults.vision
    changed = true
  }
  return changed ? { ...s, models, defaults, stageModels } : s
}

/** 目录/手工条目可能带未知能力值；只保留已知能力并去重 */
function normalizeModelCaps(raw: unknown): Cap[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const list = raw.filter((c): c is Cap => CAP_VALUES.includes(c as Cap))
  return list.length ? [...new Set(list)] : undefined
}

function normalizeFeatures(raw: any): ModelFeatureSet | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const out: ModelFeatureSet = {}
  for (const key of ['vision', 'videoInput', 'videoRef', 'firstFrame', 'lastFrame', 'audioOut', 'tools'] as const) {
    if (typeof raw[key] === 'boolean') out[key] = raw[key]
  }
  if (raw.imageRef === 'none' || raw.imageRef === 'single' || raw.imageRef === 'multi') {
    out.imageRef = raw.imageRef
  }
  return Object.keys(out).length ? out : undefined
}

function normalizeProviderCaps(raw: unknown, kind: ProviderKind, def?: Provider): ProviderCap[] {
  const allowed: ProviderCap[] = ['text', 'image', 'video', 'audio']
  const list = Array.isArray(raw) ? raw.filter((c): c is ProviderCap => allowed.includes(c as ProviderCap)) : []
  return list.length ? [...new Set(list)] : (def?.caps ?? capsOfKind(kind))
}

/** 老结构（models.lite/pro/image/video/videoRef）→ 新结构，只做读时转换 */
function normalizeSettings(raw: any): AppSettings {
  const rules = (raw?.rules || {}) as Record<string, RulePack>
  const apiKey = String(raw?.apiKey || '')
  if (Array.isArray(raw?.providers) && Array.isArray(raw?.models)) {
    const providers = (raw.providers as Provider[]).map((p) => {
      // 老数据可能缺 caps / baseUrl：按同 id 的预置渠道兜底，再退到协议推断
      const def = DEFAULT_PROVIDERS.find((d) => d.id === p.id)
      const { keyAvailable: _keyAvailable, ...rest } = p
      const rawBase = String(p.baseUrl || def?.baseUrl || '')
      // APIMart 旧默认网关（api.apib.ai）迁移到 api.apimart.ai；用户自定义的其他地址不动
      const baseUrl =
        p.id === 'apimart' && /^https:\/\/api\.apib\.ai(?:\/v1)?\/?$/i.test(rawBase)
          ? 'https://api.apimart.ai/v1'
          : rawBase
      return {
        ...rest,
        baseUrl,
        caps: normalizeProviderCaps(p.caps, p.kind, def),
      }
    })
    const version = Number(raw.presetsVersion) || 1
    const models = (raw.models as ModelEntry[]).map((m) => {
      const next: ModelEntry = { ...m, supportsVideoRef: Boolean(m.supportsVideoRef) }
      const caps = normalizeModelCaps(m.caps)
      if (caps) next.caps = caps
      else delete next.caps
      const features = normalizeFeatures(m.features)
      if (features) next.features = features
      else delete next.features
      if (m.source === 'preset' || m.source === 'catalog' || m.source === 'manual') next.source = m.source
      else delete next.source
      if (m.runtime === 'ready' || m.runtime === 'catalog-only') next.runtime = m.runtime
      else delete next.runtime
      if (m.videoRefTaskType === 'reference') next.videoRefTaskType = 'reference'
      else delete next.videoRefTaskType
      if (m.thinking === 'auto' || m.thinking === 'enabled' || m.thinking === 'disabled') next.thinking = m.thinking
      else delete next.thinking
      return next
    })
    return mergePresets(
      {
        providers,
        models,
        defaults: { ...DEFAULT_DEFAULTS, ...(raw.defaults || {}) },
        stageModels: normalizeStageModels(raw.stageModels),
        pricing: raw.pricing || {},
        agentLimits: normalizeAgentLimits(raw.agentLimits),
        agentToolProtocol: normalizeToolProtocol(raw.agentToolProtocol),
        agentEngine: normalizeSceneAgentEngine(raw.agentEngine),
        lipSync: normalizeLipSyncSettings(raw.lipSync),
        customVoices: normalizeCustomVoices(raw.customVoices),
        creative: normalizeCreativeSettings(raw.creative),
        stock: normalizeStockSettings(raw.stock),
        apiKey,
        rules,
        skillsMigrated: Boolean(raw.skillsMigrated),
        presetsVersion: version,
      },
      version,
    )
  }
  const legacy = (raw?.models || {}) as Record<string, string>
  const providers = DEFAULT_PROVIDERS.map((p) => (p.id === 'ark' ? { ...p, apiKey } : { ...p }))
  const models = DEFAULT_MODELS.map((m) => {
    if (m.key === 'ark-text-lite' && legacy.lite) return { ...m, model: legacy.lite }
    if (m.key === 'ark-text-pro' && legacy.pro) return { ...m, model: legacy.pro }
    if (m.key === 'ark-image' && legacy.image) return { ...m, model: legacy.image }
    if (m.key === 'ark-view' && legacy.image) return { ...m, model: legacy.image }
    if (m.key === 'ark-video' && legacy.video) return { ...m, model: legacy.video }
    if (m.key === 'ark-video-ref' && legacy.videoRef) return { ...m, model: legacy.videoRef }
    return { ...m }
  })
  return {
    providers,
    models,
    defaults: { ...DEFAULT_DEFAULTS },
    stageModels: {},
    pricing: {},
    agentLimits: normalizeAgentLimits(undefined),
    agentToolProtocol: 'auto',
    agentEngine: normalizeSceneAgentEngine(undefined),
    lipSync: normalizeLipSyncSettings(raw?.lipSync),
    customVoices: normalizeCustomVoices(raw?.customVoices),
    creative: normalizeCreativeSettings(raw?.creative),
    stock: normalizeStockSettings(raw?.stock),
    apiKey,
    rules,
    skillsMigrated: Boolean(raw?.skillsMigrated),
    presetsVersion: CURRENT_PRESETS_VERSION,
  }
}

let settingsReady = false
/** 插件启动时赋值（server.config.root），供设置层定位 DB */
let appRoot = ''
/** 懒打开 DB（供设置/模型覆盖用；项目路由也会各自 open，同一文件同一连接缓存） */
function getAppSettings(): AppSettings {
  try {
    if (!settingsReady) {
      dbPath(resolveRoot(appRoot || process.cwd()))
      settingsReady = true
    }
    const raw = getSetting('app')
    const base = normalizeSettings(raw)
    const normalized = repairVisionBinding(base)
    // 预设迁移只落盘一次；之后用户删掉的预设不会被反复加回来。
    // 自愈修掉坏绑定时也顺手落盘，避免每次启动都重算。
    const migrated = (Number(raw?.presetsVersion) || 1) < CURRENT_PRESETS_VERSION
    if (migrated || normalized !== base) {
      try {
        setSetting('app', normalized)
      } catch {
        /* 只读环境忽略，内存里仍可用 */
      }
    }
    return normalized
  } catch {
    return repairVisionBinding(normalizeSettings(null))
  }
}

/** keyAvailable 是响应期派生字段，不能写回设置库 */
function stripKeyState(p: Provider): Provider {
  const next = { ...p }
  delete next.keyAvailable
  return next
}

/** 设置页状态条只需要“有没有 Key”，不回传 Key 本身 */
function withKeyStatus(s: AppSettings): AppSettings {
  return {
    ...s,
    providers: s.providers.map((p) => ({ ...p, keyAvailable: Boolean(providerKey(p)) })),
    // 创意配置里的 DTK Key 同样只回「有没有」
    creative: redactCreativeSettings(normalizeCreativeSettings(s.creative)) as AppSettings['creative'],
    // 在线素材来源的 Key 也不回传原文
    stock: redactStockSettings(s.stock) as AppSettings['stock'],
  }
}

function saveAppSettings(patch: Partial<AppSettings>): AppSettings {
  dbPath(resolveRoot(appRoot || process.cwd()))
  settingsReady = true
  const cur = getAppSettings()
  const next: AppSettings = {
    providers: Array.isArray(patch.providers) ? patch.providers.map(stripKeyState) : cur.providers,
    models: Array.isArray(patch.models) ? patch.models : cur.models,
    defaults: { ...cur.defaults, ...(patch.defaults || {}) },
    // 设置页提交完整映射：整体替换才能清空某个环节；patch 省略时保留原值
    stageModels:
      patch.stageModels !== undefined
        ? normalizeStageModels(patch.stageModels)
        : normalizeStageModels(cur.stageModels),
    pricing: { ...(cur.pricing || {}), ...(patch.pricing || {}) },
    agentLimits: normalizeAgentLimits({ ...(cur.agentLimits || {}), ...(patch.agentLimits || {}) }),
    agentToolProtocol: normalizeToolProtocol(patch.agentToolProtocol ?? cur.agentToolProtocol),
    agentEngine: normalizeSceneAgentEngine(patch.agentEngine ?? cur.agentEngine),
    lipSync: patch.lipSync !== undefined ? normalizeLipSyncSettings(patch.lipSync) : normalizeLipSyncSettings(cur.lipSync),
    customVoices: patch.customVoices !== undefined ? normalizeCustomVoices(patch.customVoices) : normalizeCustomVoices(cur.customVoices),
    // 创意配置：请求里带了就以请求为准（可整体覆盖），没带就保留原值。
    // DTK Key 回读时被脱敏成空串，保存时不能因此把它清掉。
    creative:
      patch.creative !== undefined
        ? normalizeCreativeSettings({
            ...patch.creative,
            ingest: {
              ...(patch.creative as CreativeSettings)?.ingest,
              dtk: {
                ...(patch.creative as CreativeSettings)?.ingest?.dtk,
                apiKey:
                  String((patch.creative as CreativeSettings)?.ingest?.dtk?.apiKey || '').trim() ||
                  String(cur.creative?.ingest?.dtk?.apiKey || ''),
              },
            },
          })
        : normalizeCreativeSettings(cur.creative),
    // 在线素材：请求里没带就保留原值；Key 回读被脱敏成空串，合并时保留旧 Key
    stock:
      patch.stock !== undefined
        ? mergeStockSettings(cur.stock, patch.stock)
        : normalizeStockSettings(cur.stock),
    apiKey: typeof patch.apiKey === 'string' ? patch.apiKey : cur.apiKey,
    rules: { ...cur.rules, ...(patch.rules || {}) },
    skillsMigrated:
      typeof patch.skillsMigrated === 'boolean' ? patch.skillsMigrated : cur.skillsMigrated,
    presetsVersion: CURRENT_PRESETS_VERSION,
  }
  setSetting('app', next)
  voiceCache.clear()
  return next
}

/** 按能力取模型条目：显式 key > 该能力默认 > 该能力第一条 */
function pickModel(cap: Cap, keyOverride?: string): { entry?: ModelEntry; provider?: Provider } {
  const s = getAppSettings()
  const key = String(keyOverride || '').trim()
  const usable = (m: ModelEntry) => modelHasCap(m, cap) && isRunnableModel(m)
  const entry =
    (key && s.models.find((m) => m.key === key && usable(m))) ||
    s.models.find((m) => m.key === s.defaults[cap] && usable(m)) ||
    s.models.find(usable)
  const provider = entry ? s.providers.find((p) => p.id === entry.provider) : undefined
  return { entry, provider }
}

type VideoPick = {
  entry?: ModelEntry
  provider?: Provider
  error?: 'model-key-not-found' | 'video-ref-unsupported'
}

/**
 * 视频族解析：显式 key 在 video / videoRef 两族里精确命中，找不到就报错，
 * 不静默换成另一档。视频参考还必须由条目显式声明 supportsVideoRef。
 */
function pickVideoModel(
  keyOverride?: string,
  opts: { needVideoRef?: boolean; refMode?: boolean } = {},
): VideoPick {
  const s = getAppSettings()
  const key = String(keyOverride || '').trim()
  const family = s.models.filter(
    (m) =>
      (modelHasCap(m, 'video') || modelHasCap(m, 'videoRef')) &&
      isRunnableModel(m),
  )
  const withProvider = (entry: ModelEntry): VideoPick => ({
    entry,
    provider: s.providers.find((p) => p.id === entry.provider),
  })
  if (key) {
    const entry = family.find((m) => m.key === key)
    if (!entry) return { error: 'model-key-not-found' }
    if (opts.needVideoRef && !modelHasCap(entry, 'videoRef')) {
      return { ...withProvider(entry), error: 'video-ref-unsupported' }
    }
    return withProvider(entry)
  }
  const cap: Cap = opts.refMode ? 'videoRef' : 'video'
  const entry =
    family.find((m) => m.key === s.defaults[cap] && modelHasCap(m, cap)) ||
    family.find((m) => modelHasCap(m, cap)) ||
    (opts.refMode ? family.find((m) => modelHasCap(m, 'video')) : undefined)
  if (!entry) return { error: 'model-key-not-found' }
  if (opts.needVideoRef && !modelHasCap(entry, 'videoRef')) {
    return { ...withProvider(entry), error: 'video-ref-unsupported' }
  }
  return withProvider(entry)
}

/** 文本族：text / textPro 只是档位，手选时两族都算合法 */
const isTextCap = (cap: Cap) => cap === 'text' || cap === 'textPro'
const hasTextCap = (m: ModelEntry) => modelHasCap(m, 'text') || modelHasCap(m, 'textPro')

type TextPick = {
  entry?: ModelEntry
  provider?: Provider
  error?: 'model-key-not-found' | 'no-text-model'
}

/**
 * 文本模型解析。
 * 显式 modelKey 必须是 text/textPro 里真实存在的键，找不到就报错 —— 不静默换成别的模型。
 * 不带 modelKey 时保留旧档位：defaults.text / defaults.textPro，再退到族内第一条。
 */
function pickTextModel(keyOverride?: string, tier: 'lite' | 'pro' = 'lite'): TextPick {
  const s = getAppSettings()
  const key = String(keyOverride || '').trim()
  const usable = (m: ModelEntry) => hasTextCap(m) && isRunnableModel(m)
  if (key) {
    const entry = s.models.find((m) => m.key === key && usable(m))
    if (!entry) return { error: 'model-key-not-found' }
    return { entry, provider: s.providers.find((p) => p.id === entry.provider) }
  }
  const cap: Cap = tier === 'pro' ? 'textPro' : 'text'
  const entry =
    s.models.find((m) => m.key === s.defaults[cap] && usable(m)) ||
    s.models.find((m) => modelHasCap(m, cap) && usable(m)) ||
    s.models.find(usable)
  if (!entry) return { error: 'no-text-model' }
  return { entry, provider: s.providers.find((p) => p.id === entry.provider) }
}

type VisionPick = {
  entry?: ModelEntry
  provider?: Provider
  error?: 'model-key-not-found' | 'no-vision-model' | 'no-video-vision-model'
}

/** 视觉模型解析：只认 cap=vision，显式 key 找不到就报错，不静默换文本模型 */
function pickVisionModel(keyOverride?: string): VisionPick {
  const s = getAppSettings()
  const key = String(keyOverride || '').trim()
  const usable = (m: ModelEntry) => modelHasCap(m, 'vision') && isRunnableModel(m)
  if (key) {
    const entry = s.models.find((m) => m.key === key && usable(m))
    if (!entry) return { error: 'model-key-not-found' }
    return { entry, provider: s.providers.find((p) => p.id === entry.provider) }
  }
  const entry =
    s.models.find((m) => m.key === s.defaults.vision && usable(m)) || s.models.find(usable)
  if (!entry) return { error: 'no-vision-model' }
  return { entry, provider: s.providers.find((p) => p.id === entry.provider) }
}

/** 视频理解只认 cap=videoVision；本地文件不能直接交给远端模型，由调用方回退关键帧。 */
function pickVideoVisionModel(keyOverride?: string): VisionPick {
  const s = getAppSettings()
  const key = String(keyOverride || '').trim()
  const usable = (m: ModelEntry) => modelHasCap(m, 'videoVision') && isRunnableModel(m)
  if (key) {
    const entry = s.models.find((m) => m.key === key && usable(m))
    if (!entry) return { error: 'model-key-not-found' }
    return { entry, provider: s.providers.find((p) => p.id === entry.provider) }
  }
  const entry =
    s.models.find((m) => m.key === s.defaults.videoVision && usable(m)) || s.models.find(usable)
  if (!entry) return { error: 'no-video-vision-model' }
  return { entry, provider: s.providers.find((p) => p.id === entry.provider) }
}

/** 渠道 Key：设置库里的值优先；没有时再读本地 .env / 环境变量，避免重建库后丢 Key */
function providerKey(p?: Provider): string {
  const own = String(p?.apiKey || '').trim()
  if (own) return own
  if (!p || p.kind === 'ark') return readApiKey() || ''
  if (p.kind === 'ark-plan') {
    return (
      readEnvKey('ARK_AGENT_PLAN_API_KEY') ||
      readEnvKey('ARK_PLAN_API_KEY') ||
      readEnvKey('VOLC_API_KEY') ||
      ''
    )
  }
  if (p.kind === 'apimart') {
    return readEnvKey('APIB_API_KEY') || readEnvKey('APIMART_API_KEY') || ''
  }
  if (p.kind === 'volc-tts') {
    return (
      readEnvKey('VOLC_TTS_API_KEY') ||
      readEnvKey('ARK_AGENT_PLAN_API_KEY') ||
      readEnvKey('ARK_PLAN_API_KEY') ||
      readEnvKey('VOLC_API_KEY') ||
      ''
    )
  }
  if (p.kind === 'elevenlabs') return readEnvKey('ELEVENLABS_API_KEY') || ''
  if (p.kind === 'minimax') return readEnvKey('MINIMAX_API_KEY') || ''
  if (p.kind === 'openai') return readEnvKey('OPENAI_API_KEY') || ''
  return ''
}

/** DeepSeek Flash 的模型 ID 在官方渠道是 deepseek-flash，在 Agent Plan 是 deepseek-v4-flash */
function isDeepSeekFlash(provider: Provider | undefined, model: string): boolean {
  if (!/^deepseek-(?:v[\d.]+-)?flash(?:$|[-.])/i.test(String(model || '').trim())) return false
  return (
    provider?.id === 'ark-plan' ||
    provider?.id === 'deepseek' ||
    /deepseek\.com/i.test(String(provider?.baseUrl || ''))
  )
}

/**
 * DeepSeek Flash 混合推理：普通文本默认开思考，JSON / 工具协议默认关思考，
 * 避免 reasoning 吃掉结构化输出的 token 预算。模型条目可显式覆盖。
 */
function deepSeekThinking(
  entry: ModelEntry,
  provider: Provider | undefined,
  model: string,
  wantJson: boolean,
): 'enabled' | 'disabled' | undefined {
  if (!isDeepSeekFlash(provider, model)) return undefined
  if (entry.thinking === 'enabled' || entry.thinking === 'disabled') return entry.thinking
  return wantJson ? 'disabled' : 'enabled'
}

function effImageModel(cap: 'image' | 'view' = 'image'): string {
  return pickModel(cap).entry?.model || MODEL
}
function effVideoModel(): string {
  return pickModel('video').entry?.model || VIDEO_MODEL
}

/** 多参考图（reference_image）模式用的模型：默认 Lite I2V，可在设置页覆盖 */
function effVideoRefModel(): string {
  return pickModel('videoRef').entry?.model || VIDEO_REF_MODEL
}

function readJson(req: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > 40 * 1024 * 1024) {
        reject(new Error('请求体超过 40MB'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch {
        reject(new Error('请求体不是合法 JSON'))
      }
    })
    req.on('error', reject)
  })
}

/** 模型常把 JSON 包在 ```json 代码块里，或前后带解释文字，这里剥出来 */
function extractJson(text: string): any {
  const s = String(text || '').trim()
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = (fence ? fence[1] : s).trim()
  try {
    return JSON.parse(body)
  } catch {
    /* 降级到截取首个 {...} */
  }
  const a = body.indexOf('{')
  const b = body.lastIndexOf('}')
  if (a >= 0 && b > a) {
    try {
      return JSON.parse(body.slice(a, b + 1))
    } catch {
      /* ignore */
    }
  }
  throw new Error(`模型返回的不是合法 JSON：${body.slice(0, 120)}`)
}

/** 参考视频：asset:// / http(s) 原样用；本地路径只接受 public 下的文件 */
function resolveVideoRef(ref: string, root: string): { local: string; external: string } {
  const s = String(ref || '').trim()
  if (!s) throw new Error('参考视频为空')
  if (s.startsWith('asset://') || /^https?:\/\//i.test(s)) return { local: '', external: s }
  const clean = s.split('?')[0].replace(/^\//, '')
  const file = path.join(root, 'public', clean)
  if (!fs.existsSync(file)) throw new Error(`参考视频不存在：${ref}`)
  return { local: file, external: '' }
}

/** Files API 只收 mp4/mov；调度视频偶尔是 webm 兜底，先转成 mp4 */
async function ensureMp4Video(file: string): Promise<{ file: string; temp: boolean }> {
  const ext = path.extname(file).toLowerCase()
  if (ext === '.mp4' || ext === '.mov') return { file, temp: false }
  if (ext !== '.webm') throw new Error(`参考视频只支持 mp4 / mov，当前是 ${ext || '未知格式'}`)
  const out = file.replace(/\.webm$/i, '') + `-ref-${Date.now()}.mp4`
  await runFfmpeg(['-y', '-i', file, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out])
  if (!fs.existsSync(out) || fs.statSync(out).size < 1024) throw new Error('调度视频转 mp4 失败')
  return { file: out, temp: true }
}

// ---------- 视频任务 ----------

type VideoJob = {
  status: 'running' | 'succeeded' | 'failed'
  url?: string
  message?: string
  startedAt: number
  elapsed?: number
  /** 方舟任务 id，便于排查与后续恢复 */
  taskId?: string
}

const videoJobs = new Map<string, VideoJob>()

/** 静态文件直出：绕开 vite 启动时建立的 public 索引 + 支持 Range（视频拖动进度条需要） */
function serveFile(res: any, req: any, file: string, mime: string) {
  if (!fs.existsSync(file)) {
    res.statusCode = 404
    res.end()
    return
  }
  const size = fs.statSync(file).size
  const range = String(req.headers?.range || '')
  res.setHeader('Content-Type', mime)
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Cache-Control', 'no-cache')
  const m = range.match(/bytes=(\d*)-(\d*)/)
  if (m) {
    const start = m[1] ? Number(m[1]) : 0
    const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
    if (start >= size || start > end) {
      res.statusCode = 416
      res.setHeader('Content-Range', `bytes */${size}`)
      res.end()
      return
    }
    res.statusCode = 206
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`)
    res.setHeader('Content-Length', String(end - start + 1))
    fs.createReadStream(file, { start, end }).pipe(res)
    return
  }
  res.setHeader('Content-Length', String(size))
  fs.createReadStream(file).pipe(res)
}

function mimeOf(ext: string): string {
  const e = ext.toLowerCase()
  if (e === 'jpg' || e === 'jpeg') return 'image/jpeg'
  if (e === 'webp') return 'image/webp'
  if (e === 'gif') return 'image/gif'
  if (e === 'mp4') return 'video/mp4'
  if (e === 'mov') return 'video/quicktime'
  if (e === 'm4a') return 'audio/mp4'
  if (e === 'aac') return 'audio/aac'
  if (e === 'mp3') return 'audio/mpeg'
  if (e === 'wav') return 'audio/wav'
  if (e === 'ogg' || e === 'opus') return 'audio/ogg'
  if (e === 'flac') return 'audio/flac'
  return 'image/png'
}

/** 缓存的可用音色列表：按渠道 id 分开，切换配音模型时不会串音色 */
type VoiceCacheEntry = {
  provider: string
  providerKind?: string
  modelKey?: string
  voices: any[]
  capabilities?: any
  error?: string
  at: number
}
const voiceCache = new Map<string, VoiceCacheEntry>()

/** MiniMax 没有稳定的音色列表接口，先用常用音色 */
const MINIMAX_VOICES = [
  { id: 'male-qn-qingse', label: 'MiniMax · 青涩男声' },
  { id: 'female-shaonv', label: 'MiniMax · 少女音' },
  { id: 'male-qn-jingying', label: 'MiniMax · 精英男声' },
  { id: 'female-yujie', label: 'MiniMax · 御姐音' },
]

/** say 的 zh 发音人里有一堆"列表里有但没下载"的，会静默输出 15ms 空音频，必须实测 */
async function probeSayVoices(): Promise<{ id: string; label: string }[]> {
  const labels: Record<string, string> = {
    Tingting: 'Tingting · 普通话 · 女',
    Meijia: 'Meijia · 台湾国语 · 女',
    Sinji: 'Sinji · 粤语 · 男',
  }
  const ids = Object.keys(labels)
  const tmp = path.join(os.tmpdir(), 'storyboard-canvas')
  fs.mkdirSync(tmp, { recursive: true })

  const results = await Promise.all(
    ids.map(async (id) => {
      const f = path.join(tmp, `probe-${id}.aiff`)
      try {
        await new Promise<void>((resolve, reject) => {
          execFile(
            SAY,
            ['-v', id, '-r', '180', '-o', f, '--data-format=BEI16@22050', '测试'],
            { timeout: 20000 },
            (err) => (err ? reject(err) : resolve()),
          )
        })
        const d = await probeDuration(f)
        return d > 0.4 ? { id, label: labels[id] } : null
      } catch {
        return null
      } finally {
        try {
          fs.unlinkSync(f)
        } catch {
          /* ignore */
        }
      }
    }),
  )
  return results.filter((v): v is { id: string; label: string } => Boolean(v))
}

async function listVoices(modelKey?: string, refresh = false): Promise<VoiceCacheEntry> {
  const { provider, entry } = pickModel('audio', modelKey)
  const kind = provider?.kind || 'macos-say'
  const providerId = provider?.id || kind
  const resolvedModelKey = modelKey || entry?.key || ''
  const key = providerKey(provider)
  const keyFingerprint = key ? crypto.createHash('sha1').update(key).digest('hex').slice(0, 10) : 'nokey'
  const cacheKey = `${providerId}|${resolvedModelKey}|${keyFingerprint}`
  if (!refresh) {
    const cached = voiceCache.get(cacheKey)
    if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached
  }

  const capabilities = voiceCapabilitiesForKind(kind)
  let voices: any[] = []
  let error = ''

  if (kind === 'apimart') {
    voices = APIMART_VOICES.map((v) => entryOf({
      id: v.id, label: v.label, provider: providerId, providerKind: kind, modelKey: resolvedModelKey, source: 'preset',
    }))
    if (!key) error = 'APIMart 渠道没有配置 Key'
  } else if (kind === 'volc-tts') {
    voices = VOLC_TTS_VOICES.map((v) => entryOf({
      id: v.id, label: v.label, provider: providerId, providerKind: kind, modelKey: resolvedModelKey, source: 'preset',
    }))
    if (!key) error = '火山 TTS 渠道没有配置 Key'
  } else if (kind === 'minimax') {
    if (key) {
      try {
        const base = String(provider?.baseUrl || 'https://api.minimaxi.com/v1').replace(/\/+$/, '')
        const r = await fetch(`${base}/get_voice`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ voice_type: 'all' }),
          signal: AbortSignal.timeout(20_000),
        })
        if (!r.ok) {
          error = r.status === 401 || r.status === 403 ? 'MiniMax 鉴权失败' : `MiniMax 音色列表 ${r.status}`
        } else {
          const j: any = await r.json()
          voices = miniMaxVoicesFromResponse(j, { provider: providerId, providerKind: kind, modelKey: resolvedModelKey })
          if (voices.length === 0) error = 'MiniMax 账号没有返回音色'
        }
      } catch (e) {
        error = `MiniMax 音色列表失败：${(e as Error).message}`
      }
    } else {
      error = 'MiniMax 渠道没有配置 Key'
    }
    if (voices.length === 0) {
      voices = MINIMAX_VOICES.map((v) => entryOf({
        id: v.id, label: v.label, provider: providerId, providerKind: kind, modelKey: resolvedModelKey, source: 'preset',
      }))
    }
  } else if (kind === 'elevenlabs') {
    if (key) {
      try {
        const r = await fetch(ELEVEN_VOICES, { headers: { 'xi-api-key': key }, signal: AbortSignal.timeout(20_000) })
        if (!r.ok) {
          error = r.status === 401 || r.status === 403 ? 'ElevenLabs 鉴权失败' : `ElevenLabs 音色列表 ${r.status}`
        } else {
          const j: any = await r.json()
          voices = (j?.voices ?? []).map((v: any) => entryOf({
            id: String(v.voice_id),
            label: `${v.name || v.voice_id}${v.labels?.accent ? ` · ${v.labels.accent}` : ''}${v.labels?.gender ? ` · ${v.labels.gender}` : ''}`,
            provider: providerId,
            providerKind: kind,
            modelKey: resolvedModelKey,
            source: 'account',
          }))
          if (voices.length === 0) error = 'ElevenLabs 账号没有返回音色'
        }
      } catch (e) {
        error = `ElevenLabs 音色列表失败：${(e as Error).message}`
      }
    } else {
      error = 'ElevenLabs 渠道没有配置 Key'
    }
  } else {
    voices = (await probeSayVoices()).map((v) => entryOf({
      id: v.id, label: v.label, provider: providerId, providerKind: 'macos-say', modelKey: resolvedModelKey, source: 'system',
    }))
  }

  try {
    const settings = getAppSettings()
    voices = mergeCustomVoices(voices, settings.customVoices, {
      provider: providerId,
      providerKind: kind,
      modelKey: resolvedModelKey,
      capabilities,
    })
  } catch {
    /* 设置读取失败不阻塞预置音色 */
  }

  const result: VoiceCacheEntry = {
    provider: kind,
    providerKind: kind,
    modelKey: resolvedModelKey,
    voices,
    capabilities,
    ...(error ? { error } : {}),
    at: Date.now(),
  }
  voiceCache.set(cacheKey, result)
  return result
}

// ---------- animatic 合成（ffmpeg） ----------

const FFMPEG = process.env.FFMPEG_PATH || '/opt/homebrew/bin/ffmpeg'
const FFPROBE = process.env.FFPROBE_PATH || '/opt/homebrew/bin/ffprobe'
/** 带 libass 的完整版优先（keg-only，不会顶掉系统 ffmpeg）；部署环境用环境变量覆盖 */
const FFMPEG_CANDIDATES = [
  process.env.FFMPEG_PATH,
  '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg',
  '/opt/homebrew/bin/ffmpeg',
  '/usr/local/bin/ffmpeg',
  '/usr/bin/ffmpeg',
].filter((x): x is string => Boolean(x))

/** 运行时探测结果：哪条二进制、支不支持 subtitles 滤镜、有没有可用 CJK 字体 */
let FF: { bin: string; probe: string; ass: boolean; font?: string } | null = null

function siblingProbe(bin: string) {
  const p = bin.replace(/ffmpeg$/, 'ffprobe')
  return fs.existsSync(p) ? p : FFPROBE
}

async function hasSubtitlesFilter(bin: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!fs.existsSync(bin) && bin !== 'ffmpeg') return resolve(false)
    execFile(bin, ['-hide_banner', '-h', 'filter=subtitles'], { timeout: 10000 }, (err, stdout, stderr) => {
      if (err) return resolve(false)
      resolve(!/Unknown filter/i.test(`${stdout}${stderr}`))
    })
  })
}

/** ASS/SRT 需要真实存在的 CJK 字体，否则宁可用 PNG 兜底，不输出方框 */
async function findCjkFont(): Promise<string> {
  if (process.platform === 'darwin') {
    if (fs.existsSync('/System/Library/Fonts/PingFang.ttc')) return 'PingFang SC'
    if (fs.existsSync('/System/Library/Fonts/STHeiti Light.ttc')) return 'Heiti SC'
    if (fs.existsSync('/Library/Fonts/NotoSansCJK-Regular.ttc')) return 'Noto Sans CJK SC'
    return ''
  }
  if (process.platform === 'win32') {
    if (fs.existsSync('C:/Windows/Fonts/msyh.ttc')) return 'Microsoft YaHei'
    return ''
  }
  return new Promise((resolve) => {
    execFile('fc-list', [':lang=zh', 'family'], { timeout: 5000 }, (err, stdout) => {
      if (err) return resolve('')
      const families = String(stdout)
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => s.split(':')[0].split(',')[0].trim())
        .filter(Boolean)
      // fc-list 默认把 Noto CJK 的 JP 字面排前面；简体中文用 JP 字面会出现
      // 异体字（直/骨/关 等），所以优先挑 SC 字面，且 Sans 比 Serif/Mono 更清楚。
      const sc = families.find((f) => /\bSC\b/.test(f) && !/Mono/i.test(f) && /Sans/i.test(f))
      const anySc = families.find((f) => /\bSC\b/.test(f) && !/Mono/i.test(f))
      resolve(sc || anySc || families[0] || '')
    })
  })
}

async function ensureFf() {
  if (FF) return FF
  const font = await findCjkFont()
  for (const bin of FFMPEG_CANDIDATES) {
    if (await hasSubtitlesFilter(bin)) {
      FF = { bin, probe: siblingProbe(bin), ass: Boolean(font), ...(font ? { font } : {}) }
      return FF
    }
  }
  const bin = FFMPEG_CANDIDATES.find((b) => fs.existsSync(b)) || FFMPEG
  FF = { bin, probe: siblingProbe(bin), ass: false, ...(font ? { font } : {}) }
  return FF
}

const ffBin = () => FF?.bin ?? FFMPEG
const ffProbe = () => FF?.probe ?? FFPROBE
const SAY = '/usr/bin/say'
const ELEVEN_TTS = 'https://api.elevenlabs.io/v1/text-to-speech'
const ELEVEN_VOICES = 'https://api.elevenlabs.io/v1/voices'
const ELEVEN_MODEL = 'eleven_multilingual_v2'
const EXPORT_SIZE: Record<string, [number, number]> = {
  '480p': [854, 480],
  '720p': [1280, 720],
  '1080p': [1920, 1080],
}

type ExportJob = {
  status: 'running' | 'succeeded' | 'failed'
  url?: string
  message?: string
  shots?: number
  transitions?: number
  seconds?: number
  voiced?: number
  subbed?: number
  captions?: number
  srtUrl?: string
  captionWarnings?: string[]
  overflows?: { shot: number; voice: number; shotLen: number }[]
  startedAt: number
  elapsed?: number
}

const exportJobs = new Map<string, ExportJob>()

function runFfmpeg(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      ffBin(),
      args,
      { timeout: 8 * 60 * 1000, maxBuffer: 32 * 1024 * 1024 },
      (err, _stdout, stderr) => {
        if (err) {
          const tail = String(stderr || '')
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean)
            .slice(-3)
            .join(' · ')
          reject(new Error(tail || err.message))
          return
        }
        resolve('')
      },
    )
  })
}

/** 站内路径 / http / dataURL → 本地绝对路径（ffmpeg 只吃文件） */
function materialize(ref: string, root: string, tmpDir: string, tag: string): string {
  if (ref.startsWith('http')) return ref
  if (ref.startsWith('data:')) {
    const b64 = ref.split(',')[1] || ''
    const ext = /image\/png/.test(ref) ? 'png' : 'jpg'
    const file = path.join(tmpDir, `${tag}.${ext}`)
    fs.writeFileSync(file, Buffer.from(b64, 'base64'))
    return file
  }
  // 项目媒体在 <projects>/<项目>/assets/，不在 public 下；
  // 少了这一支，从素材库选的图会在导出时被当成不存在而静默丢镜。
  const pm = parseProjectMediaUrl(ref)
  if (pm) {
    try {
      return resolveProjectMediaPath(root, pm.name, pm.file)
    } catch {
      return path.join(tmpDir, `${tag}-missing`)
    }
  }
  return path.join(root, 'public', ref.replace(/^\//, '').split('?')[0])
}

function normalizeLipSyncSettings(raw: any) {
  const provider: 'off' | 'sync-labs' = raw?.provider === 'sync-labs' ? 'sync-labs' : 'off'
  return {
    provider,
    baseUrl: String(raw?.baseUrl || 'https://api.sync.so').trim(),
    apiKey: String(raw?.apiKey || ''),
    pricePerSecond: Math.max(0, Number(raw?.pricePerSecond) || 0),
  }
}

/** 只允许 public 或 /project-assets/<项目>/<文件> 的本地媒体。 */
function localMediaFile(appRoot: string, ref: string): string {
  const value = String(ref || '').trim()
  if (!value) throw new Error('缺少媒体路径')
  if (value.startsWith('http') || value.startsWith('data:')) throw new Error('口型只接受本地媒体')
  if (value.startsWith('/project-assets/')) {
    const parts = value.split('?')[0].split('/').filter(Boolean)
    if (parts.length < 3) throw new Error('项目媒体路径不完整')
    return resolveProjectMediaPath(appRoot, decodeURIComponent(parts[1]), decodeURIComponent(parts[2]))
  }
  if (!value.startsWith('/')) throw new Error('媒体路径必须是站内路径')
  const publicDir = path.join(appRoot, 'public')
  const file = path.join(publicDir, value.replace(/^\//, '').split('?')[0])
  const rel = path.relative(publicDir, file)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('媒体路径越界')
  if (!fs.existsSync(file)) throw new Error(`媒体文件不存在：${value}`)
  return file
}


/** APIMart Seedance 2.5 音色参考：URL 直传；本地音频转 data URL。 */
async function resolveApimartAudioRef(appRoot: string, ref: string): Promise<string> {
  const value = String(ref || '').trim()
  if (!value) throw new Error('缺少音色参考音频')
  if (/^https?:\/\//i.test(value)) return value
  if (/^data:audio\//i.test(value)) return value
  const file = localMediaFile(appRoot, value)
  const bytes = fs.readFileSync(file)
  if (bytes.length > 15 * 1024 * 1024) throw new Error('音色参考音频超过 15MB')
  const seconds = await probeDuration(file)
  if (seconds < 2 || seconds > 30) throw new Error(`音色参考需 2-30 秒，当前 ${seconds.toFixed(1)} 秒`)
  const ext = path.extname(file).slice(1).toLowerCase()
  const mime = mimeOf(ext)
  return `data:${mime};base64,${bytes.toString('base64')}`
}

type VoicePerformance = DialogueDelivery
type VoiceSynthResult = {
  url: string
  engine: string
  seconds: number
  applied?: string[]
  unsupported?: string[]
}

const VOICE_EMOTIONS = new Set(['neutral', 'happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised', 'calm'])
const PACE_SPEED = { slow: 0.9, normal: 1, fast: 1.1 } as const
const VOLUME_VOL = { whisper: 0.5, soft: 0.75, normal: 1, loud: 1.35, shout: 1.6 } as const

function normalizedPerformance(input?: VoicePerformance): VoicePerformance {
  const p = input || {}
  const out: VoicePerformance = {}
  if (p.emotion && VOICE_EMOTIONS.has(p.emotion)) out.emotion = p.emotion
  if (typeof p.intensity === 'number' && Number.isFinite(p.intensity)) {
    out.intensity = Math.max(0, Math.min(5, Math.round(p.intensity)))
  }
  if (p.pace && p.pace in PACE_SPEED) out.pace = p.pace
  if (p.volume && p.volume in VOLUME_VOL) out.volume = p.volume
  if (p.emphasis?.trim()) out.emphasis = p.emphasis.trim()
  return out
}

function unsupportedVoice(p: VoicePerformance, applied: string[]): string[] {
  const requested: string[] = []
  if (p.emotion && p.emotion !== 'neutral') requested.push('emotion')
  if (typeof p.intensity === 'number') requested.push('intensity')
  if (p.pace && p.pace !== 'normal') requested.push('pace')
  if (p.volume && p.volume !== 'normal') requested.push('volume')
  if (p.emphasis) requested.push('emphasis')
  return requested.filter((key) => !applied.includes(key))
}

function voiceInstructions(p: VoicePerformance): string {
  const parts: string[] = []
  if (p.emotion && p.emotion !== 'neutral') {
    parts.push(`情绪 ${p.emotion}${typeof p.intensity === 'number' ? `，强度 ${p.intensity}/5` : ''}`)
  }
  if (p.pace && p.pace !== 'normal') parts.push(`语速 ${p.pace}`)
  if (p.volume && p.volume !== 'normal') parts.push(`音量 ${p.volume}`)
  if (p.emphasis) parts.push(`重读「${p.emphasis}」`)
  return parts.length ? `表演要求：${parts.join('；')}。台词保持原文。` : ''
}

function elevenTags(p: VoicePerformance): string {
  const tags: string[] = []
  if (p.emotion && p.emotion !== 'neutral') tags.push(`[${p.emotion}]`)
  if (p.pace === 'slow') tags.push('[drawn out]')
  if (p.pace === 'fast') tags.push('[rushed]')
  if (p.volume === 'whisper') tags.push('[whispers]')
  if (p.volume === 'shout') tags.push('[shouts]')
  return tags.join('')
}

/**
 * 配音 provider 分发：
 *   1. 有 ELEVENLABS_API_KEY → ElevenLabs REST（多角色，中文走 multilingual_v2）
 *   2. 否则 → macOS say（单机兜底，普通话实际只有 Tingting 可用）
 * 换引擎只改这一个函数。
 */
async function synthesize(
  text: string,
  voice: string,
  rate: number,
  outDir: string,
  stamp: string,
  modelKey?: string,
  inputPerformance?: VoicePerformance,
  allowCustomVoice = false,
): Promise<VoiceSynthResult> {
  const performance = normalizedPerformance(inputPerformance)
  // 设置页选了哪个音频模型，就走对应渠道；没配 Key 再回落旧行为
  const { provider, entry } = pickModel('audio', modelKey)
  const kind = provider?.kind
  const ownKey = providerKey(provider)
  if (kind === 'apimart') {
    if (!ownKey) throw new Error('APIMart 渠道没有填 API Key，去设置页填一下')
    const base = String(provider?.baseUrl || 'https://api.apimart.ai/v1').replace(/\/+$/, '')
    const model = entry?.model || 'gpt-4o-mini-tts'
    const supportsInstructions = /gpt-4o-mini-tts/i.test(model)
    const applied = ['pace']
    const instructions = supportsInstructions ? voiceInstructions(performance) : ''
    if (instructions) {
      applied.push('emotion', 'intensity', 'volume')
      if (performance.emphasis) applied.push('emphasis')
    }
    const out = await synthesizeApimartSpeech({
      baseUrl: base,
      apiKey: ownKey,
      text,
      voice,
      model,
      speed: PACE_SPEED[performance.pace ?? 'normal'],
      instructions: instructions || undefined,
      strictVoice: allowCustomVoice,
    })
    const file = path.join(outDir, `voice-${stamp}.mp3`)
    fs.writeFileSync(file, out.audio)
    const seconds = await probeDuration(file)
    return {
      url: `/voices/voice-${stamp}.mp3`,
      engine: `apimart:${out.voice}`,
      seconds,
      applied,
      unsupported: unsupportedVoice(performance, applied),
    }
  }
  if (kind === 'volc-tts') {
    if (!ownKey) throw new Error('火山 TTS 渠道没有填 API Key，去设置页填一下')
    const base = String(provider?.baseUrl || 'https://openspeech.bytedance.com/api/v3/plan').replace(
      /\/+$/,
      '',
    )
    const speaker = VOLC_TTS_VOICES.some((v) => v.id === voice) ? voice : DEFAULT_VOLC_TTS_VOICE
    const out = await synthesizeVolcTts({ baseUrl: base, apiKey: ownKey, text, speaker, performance, allowCustomSpeaker: allowCustomVoice })
    const file = path.join(outDir, `voice-${stamp}.mp3`)
    fs.writeFileSync(file, out.audio)
    const seconds = await probeDuration(file)
    return {
      url: `/voices/voice-${stamp}.mp3`,
      engine: out.engine,
      seconds,
      applied: out.applied,
      unsupported: out.unsupported,
    }
  }
  if (kind === 'minimax' && ownKey) {
    return synthesizeMinimax(text, voice, ownKey, outDir, stamp, provider!, entry?.model, performance, allowCustomVoice)
  }
  if (kind === 'elevenlabs' && ownKey) {
    return synthesizeEleven(text, voice, ownKey, outDir, stamp, entry?.model, performance)
  }
  const elevenKey = readEnvKey('ELEVENLABS_API_KEY')
  if (elevenKey) return synthesizeEleven(text, voice, elevenKey, outDir, stamp, entry?.model, performance)
  const applied: string[] = []
  return {
    ...(await synthesizeSay(text, voice, rate, outDir, stamp)),
    applied,
    unsupported: unsupportedVoice(performance, applied),
  }
}

/** MiniMax 语音合成：t2a_v2 返回 hex 音频 */
async function synthesizeMinimax(
  text: string,
  voiceId: string,
  key: string,
  outDir: string,
  stamp: string,
  provider: Provider,
  model?: string,
  inputPerformance?: VoicePerformance,
  allowCustomVoice = false,
): Promise<VoiceSynthResult> {
  const base = String(provider.baseUrl || 'https://api.minimaxi.com/v1').replace(/\/+$/, '')
  const vid = allowCustomVoice && voiceId
    ? voiceId
    : MINIMAX_VOICES.some((v) => v.id === voiceId)
      ? voiceId
      : 'male-qn-qingse'
  const performance = normalizedPerformance(inputPerformance)
  const applied: string[] = []
  const voiceSetting: Record<string, unknown> = {
    voice_id: vid,
    speed: PACE_SPEED[performance.pace ?? 'normal'],
    vol: VOLUME_VOL[performance.volume ?? 'normal'],
    pitch: 0,
  }
  if (performance.pace) applied.push('pace')
  if (performance.volume) applied.push('volume')
  if (performance.emotion && performance.emotion !== 'neutral') {
    const emotion = performance.emotion === 'fearful' ? 'fearful' : performance.emotion
    if (['happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised', 'calm'].includes(emotion)) {
      voiceSetting.emotion = emotion
      applied.push('emotion')
    }
  }
  const r = await fetch(`${base}/t2a_v2`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model || 'speech-02-hd',
      text,
      stream: false,
      voice_setting: voiceSetting,
      audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3' },
    }),
  })
  const raw = await r.text()
  if (!r.ok) throw new Error(`MiniMax ${r.status} — ${raw.slice(0, 240)}`)
  let j: any
  try {
    j = JSON.parse(raw)
  } catch {
    throw new Error(`MiniMax 返回非 JSON：${raw.slice(0, 160)}`)
  }
  const code = j?.base_resp?.status_code
  if (code !== undefined && code !== 0) {
    throw new Error(`MiniMax ${code} — ${j?.base_resp?.status_msg || '合成失败'}`)
  }
  const hex = String(j?.data?.audio || '')
  if (!hex) throw new Error('MiniMax 未返回音频数据')
  const buf = Buffer.from(hex, 'hex')
  if (buf.length < 1024) throw new Error('MiniMax 返回的音频为空')
  const file = path.join(outDir, `voice-${stamp}.mp3`)
  fs.writeFileSync(file, buf)
  const seconds = await probeDuration(file)
  return {
    url: `/voices/voice-${stamp}.mp3`,
    engine: `minimax:${vid}`,
    seconds,
    applied,
    unsupported: unsupportedVoice(performance, applied),
  }
}

async function synthesizeEleven(
  text: string,
  voiceId: string,
  key: string,
  outDir: string,
  stamp: string,
  model?: string,
  inputPerformance?: VoicePerformance,
  allowCustomVoice = false,
): Promise<VoiceSynthResult> {
  const id = voiceId || '21m00Tcm4TlvDq8ikWAM'
  const performance = normalizedPerformance(inputPerformance)
  const applied = new Set<string>()
  const tags = elevenTags(performance)
  const isV3 = /v3/i.test(model || '')
  const ttsText = isV3 && tags ? `${tags} ${text}` : text
  if (isV3 && tags) {
    if (performance.emotion && performance.emotion !== 'neutral') applied.add('emotion')
    if (performance.pace && performance.pace !== 'normal') applied.add('pace')
    if (performance.volume && performance.volume !== 'normal') applied.add('volume')
  }
  const style = Math.max(
    0.1,
    Math.min(1, 0.15 + (typeof performance.intensity === 'number' ? performance.intensity * 0.08 : 0)),
  )
  if (performance.emotion && performance.emotion !== 'neutral' && !applied.has('emotion')) {
    applied.add('emotion')
  }
  if (typeof performance.intensity === 'number') applied.add('intensity')
  const r = await fetch(`${ELEVEN_TTS}/${encodeURIComponent(id)}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: ttsText,
      model_id: model || ELEVEN_MODEL,
      voice_settings: {
        stability: performance.emotion && performance.emotion !== 'neutral' ? 0.35 : 0.45,
        similarity_boost: 0.8,
        style,
      },
    }),
  })
  if (!r.ok) {
    const msg = (await r.text()).slice(0, 240)
    throw new Error(`ElevenLabs ${r.status} — ${msg}`)
  }
  const buf = Buffer.from(await r.arrayBuffer())
  if (buf.length < 1024) throw new Error('ElevenLabs 返回的音频为空')
  const file = path.join(outDir, `voice-${stamp}.mp3`)
  fs.writeFileSync(file, buf)
  const seconds = await probeDuration(file)
  const appliedList = [...applied]
  return {
    url: `/voices/voice-${stamp}.mp3`,
    engine: `elevenlabs:${id.slice(0, 6)}`,
    seconds,
    applied: appliedList,
    unsupported: unsupportedVoice(performance, appliedList),
  }
}

/** macOS say → aiff → m4a（Chrome 不认 aiff，必须转码） */
async function synthesizeSay(
  text: string,
  voice: string,
  rate: number,
  outDir: string,
  stamp: string,
): Promise<{ url: string; engine: string; seconds: number }> {
  if (!fs.existsSync(SAY)) throw new Error('未找到 /usr/bin/say（非 macOS 环境请改用其他 TTS 引擎）')

  const aiff = path.join(outDir, `tmp-${stamp}.aiff`)
  const m4a = path.join(outDir, `voice-${stamp}.m4a`)

  await new Promise<void>((resolve, reject) => {
    execFile(
      SAY,
      ['-v', voice, '-r', String(rate), '-o', aiff, '--data-format=BEI16@22050', text],
      { timeout: 120000 },
      (err, _o, stderr) => {
        if (err) reject(new Error(String(stderr || '').trim() || err.message))
        else resolve()
      },
    )
  })

  try {
    await runFfmpeg(['-y', '-i', aiff, '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', m4a])
  } finally {
    try {
      fs.unlinkSync(aiff)
    } catch {
      /* 临时文件删不掉无所谓 */
    }
  }

  const seconds = await probeDuration(m4a)
  return { url: `/voices/voice-${stamp}.m4a`, engine: `say:${voice}`, seconds }
}

/** 读媒体真实时长，失败返回 0 */
async function probeDuration(file: string): Promise<number> {
  try {
    const out = await new Promise<string>((resolve, reject) => {
      execFile(
        ffProbe(),
        ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
        (err, stdout) => (err ? reject(err) : resolve(stdout)),
      )
    })
    const d = Number(String(out).trim())
    return Number.isFinite(d) && d > 0 ? d : 0
  } catch {
    return 0
  }
}

function srtTime(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000))
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s2 = Math.floor((ms % 60000) / 1000)
  const r = ms % 1000
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s2).padStart(2, '0')},${String(r).padStart(3, '0')}`
}

/** 单引号包裹 + 反斜杠转义，给 filter_complex 用 */
function filtQuote(v: string): string {
  return `'${v.replace(/\\/g, '\\\\').replace(/'/g, "'\\''")}'`
}

/** CSS 颜色 → ASS &HAABBGGRR（AA 在前） */
function assColor(input: string, fallback: string): string {
  const raw = String(input || '').trim()
  const rgba = /^rgba?\(([^)]+)\)$/i.exec(raw)
  if (rgba) {
    const parts = rgba[1].split(',').map((part) => Number(part.trim()))
    if (parts.length >= 3 && parts.slice(0, 3).every((n) => Number.isFinite(n))) {
      const [r, g, b] = parts
      const a = parts.length >= 4 && Number.isFinite(parts[3]) ? parts[3] : 1
      const hex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0').toUpperCase()
      const alpha = hex((1 - Math.max(0, Math.min(1, a))) * 255)
      return `&H${alpha}${hex(b)}${hex(g)}${hex(r)}`
    }
  }
  const hex6 = /^#([0-9a-f]{6})$/i.exec(raw)
  if (hex6) {
    const v = hex6[1].toUpperCase()
    return `&H00${v.slice(4, 6)}${v.slice(2, 4)}${v.slice(0, 2)}`
  }
  return fallback
}

type CaptionCueInput = {
  startOffsetMs: number
  endOffsetMs: number
  text: string
  /** 无 libass 时该 cue 的整帧透明 PNG */
  sub?: string
}

type CaptionStyleInput = {
  fontRatio?: number
  bottomRatio?: number
  maxWidthRatio?: number
  lineHeight?: number
  maxLines?: number
  background?: string
  textColor?: string
}

type ResolvedSeg = {
  kind: 'shot' | 'transition'
  file: string
  isVideo: boolean
  dur: number
  /** 生成转场只取前 N 秒（仅首帧模型） */
  trim?: number
  voice?: string
  voiceDur?: number
  audioMode?: 'tts' | 'native' | 'none'
  voiceOffset: number
  captions: CaptionCueInput[]
}

type ExportJoinInput =
  | { mode: 'cut' }
  | { mode: 'effect'; seconds?: number; xfade?: string }

type EffectiveJoin =
  | { mode: 'cut' }
  | { mode: 'effect'; seconds: number; xfade: string }

/**
 * 一条 ffmpeg 命令把静帧 + 视频混编成片：
 *   每段统一 分辨率/帧率/SAR（letterbox 补边，不裁切）
 *   → 有字幕的段先 overlay 一张整帧透明 PNG（本机 ffmpeg 没有 libass，不能用 subtitles 滤镜）
 *   → 按接缝折叠：cut 走 concat，effect 走 xfade（重叠 T 秒）
 *   → 台词配音按镜头起点 adelay 后 amix 到音轨
 */
async function buildAnimatic(
  segments: {
    kind?: 'shot' | 'transition'
    seconds: number
    video?: string
    image?: string
    /** 生成转场只取前 N 秒 */
    trim?: number
    audioMode?: 'tts' | 'native' | 'none'
    voice?: string
    /** 配音相对镜头起点的偏移（秒，可负＝提前），由时间线拖动产生 */
    voiceOffset?: number
    /** 字幕相对镜头起点的偏移（秒）；旧调用兼容，新客户端用 captions */
    subOffset?: number
    /** 无 libass 时的兜底：整帧透明 PNG；旧调用兼容 */
    sub?: string
    /** 有 libass 时走真字幕（SRT + subtitles 滤镜）；旧调用兼容 */
    dialogue?: string
    /** 相对镜头起点的字幕 cue；新客户端使用 */
    captions?: CaptionCueInput[]
  }[],
  resolution: '480p' | '720p' | '1080p',
  root: string,
  outFile: string,
  joins: ExportJoinInput[] = [],
  captionStyle: CaptionStyleInput = {},
  captionMode: 'auto' | 'png' = 'auto',
): Promise<{
  shots: number
  transitions: number
  seconds: number
  voiced: number
  subbed: number
  captions: number
  captionWarnings: string[]
  srtFile?: string
  overflows: { shot: number; voice: number; shotLen: number }[]
}> {
  const [W, H] = EXPORT_SIZE[resolution] || EXPORT_SIZE['720p']
  const tmpDir = path.join(os.tmpdir(), 'storyboard-canvas')
  fs.mkdirSync(tmpDir, { recursive: true })

  // 先解析每段并拿到真实时长 —— 字幕/配音都要按真实起点对齐
  const resolved: ResolvedSeg[] = []
  const captionWarnings: string[] = []
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    const nominal = Math.min(30, Math.max(0.5, Number(seg.seconds) || 2))
    let file = ''
    let isVideo = false
    if (seg.video) {
      file = materialize(seg.video, root, tmpDir, `exp-${i}`)
      isVideo = true
    } else if (seg.image) {
      file = materialize(seg.image, root, tmpDir, `exp-${i}`)
    }
    if (!file || !fs.existsSync(file)) continue

    const probed = isVideo ? (await probeDuration(file)) || nominal : nominal
    // 只有显式给了 trim 才裁；缺省 0 表示保留整段（首尾帧模型的成片不能裁尾）
    const rawTrim = Number(seg.trim)
    const trimTo = Number.isFinite(rawTrim) && rawTrim > 0 ? Math.min(30, Math.max(0.4, rawTrim)) : 0
    const dur = isVideo && trimTo ? Math.min(probed, trimTo) : probed

    let voice: string | undefined
    let voiceDur: number | undefined
    if (seg.voice && seg.audioMode !== 'native') {
      const vf = materialize(seg.voice, root, tmpDir, `exp-a-${i}`)
      if (fs.existsSync(vf)) {
        voice = vf
        voiceDur = await probeDuration(vf)
      }
    }

    const captions: CaptionCueInput[] = []
    if (Array.isArray(seg.captions)) {
      for (const cue of seg.captions) {
        const text = String(cue?.text ?? '').trim()
        if (!text) continue
        const rawStart = Number(cue.startOffsetMs) || 0
        const rawEnd = Number(cue.endOffsetMs) || 0
        if (rawEnd > dur * 1000 + 1) {
          captionWarnings.push(`第 ${i + 1} 段字幕超出真实时长，已夹紧`)
        }
        const start = Math.max(0, Math.min(dur * 1000, rawStart))
        const end = Math.max(start, Math.min(dur * 1000, rawEnd))
        if (end <= start + 20) continue
        captions.push({
          startOffsetMs: start,
          endOffsetMs: end,
          text,
          ...(cue.sub ? { sub: String(cue.sub) } : {}),
        })
      }
    }

    // 偏移只在镜头时长内有效，夹紧避免拖出荒唐值
    const vo = Math.max(-dur, Math.min(dur, Number(seg.voiceOffset) || 0))
    resolved.push({
      kind: seg.kind === 'transition' ? 'transition' : 'shot',
      file,
      isVideo,
      dur,
      ...(isVideo && trimTo ? { trim: trimTo } : {}),
      voice,
      voiceDur,
      audioMode: seg.audioMode || (seg.voice ? 'tts' : 'none'),
      voiceOffset: vo,
      captions,
    })
  }

  if (resolved.length === 0) throw new Error('没有任何可用的画面或视频，先出图/出片再导出')

  // 接缝在真实片长上再夹一次：短镜最多让出 80%，低于 0.2s 退回硬切
  const effective: EffectiveJoin[] = resolved.map((r, i) => {
    if (i === 0) return { mode: 'cut' }
    const raw = joins[i]
    if (!raw || raw.mode !== 'effect') return { mode: 'cut' }
    const want = Math.max(0, Number(raw.seconds) || 0)
    const max = Math.min(1.5, Math.min(resolved[i - 1].dur, r.dur) * 0.8)
    const seconds = Math.min(want, max)
    if (seconds < 0.2) return { mode: 'cut' }
    return { mode: 'effect', seconds: Math.round(seconds * 100) / 100, xfade: String(raw.xfade || 'fade') }
  })

  const starts: number[] = []
  let total = 0
  for (let i = 0; i < resolved.length; i++) {
    const j = effective[i]
    const start = i === 0 ? 0 : total - (j.mode === 'effect' ? j.seconds : 0)
    starts.push(Math.max(0, start))
    total = starts[i] + resolved[i].dur
  }

  /** 配音比镜头长 → 会被截断，回传给前端告警 */
  const overflows = resolved
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => {
      const avail = Math.max(0.3, r.dur - Math.max(0, r.voiceOffset))
      return !!r.voiceDur && r.voiceDur > avail + 0.2
    })
    .map(({ r, i }) => ({
      shot: i + 1,
      voice: Math.round((r.voiceDur as number) * 10) / 10,
      shotLen: Math.round(r.dur * 10) / 10,
    }))

  const args: string[] = ['-y']
  const vFilters: string[] = []
  const aFilters: string[] = []
  const vIdx: number[] = []
  const cueInputs: { seg: number; start: number; end: number; idx: number }[] = []
  const aInputs: { idx: number; startMs: number; keep: number; cut: boolean; volume?: number }[] = []
  let inputIdx = 0

  // 输入顺序：画面 → 字幕 PNG → 配音（索引必须按这个顺序记）
  resolved.forEach((r) => {
    if (r.isVideo) {
      // 生成转场只取前 N 秒；输入 -t 比在滤镜里 trim 更省解码
      if (r.trim) args.push('-t', r.trim.toFixed(3))
      args.push('-i', r.file)
    } else {
      args.push('-loop', '1', '-t', r.dur.toFixed(3), '-i', r.file)
    }
    vIdx.push(inputIdx++)
  })

  resolved.forEach((r, i) => {
    r.captions.forEach((cue, j) => {
      if (!cue.sub) return
      const sf = materialize(cue.sub, root, tmpDir, `exp-c-${i}-${j}`)
      if (!fs.existsSync(sf)) {
        captionWarnings.push(`第 ${i + 1} 段字幕 PNG 缺失，已跳过`)
        return
      }
      args.push('-i', sf)
      cueInputs.push({
        seg: i,
        start: cue.startOffsetMs / 1000,
        end: cue.endOffsetMs / 1000,
        idx: inputIdx++,
      })
    })
  })

  resolved.forEach((r, i) => {
    if (!r.voice) return
    args.push('-i', r.voice)
    // 配音比镜头长：在镜头末尾收掉（0.12s 淡出），否则会盖住后面几镜的声音，
    // 也会跟字幕的截断点对不上。
    // 起点 = 镜头起点 + 用户拖出来的偏移（不能为负时刻）
    const absStart = Math.max(0, starts[i] + r.voiceOffset)
    // 延后多少就少多少可用时长；提前的话可用时长仍是整镜
    const available = Math.max(0.3, r.dur - Math.max(0, r.voiceOffset))
    const cut = !!r.voiceDur && r.voiceDur > available + 0.2
    aInputs.push({
      idx: inputIdx,
      startMs: Math.round(absStart * 1000),
      keep: cut ? available : 0,
      cut,
    })
    inputIdx++
  })

  // native 镜头直接取视频输入的音轨；与 TTS 镜头一起参与 mix。
  resolved.forEach((r, i) => {
    if (r.audioMode !== 'native' || !r.isVideo) return
    aInputs.push({ idx: vIdx[i], startMs: Math.round(starts[i] * 1000), keep: 0, cut: false, volume: 1 })
  })

  const vTails = resolved.map((r, i) => {
    vFilters.push(
      `[${vIdx[i]}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease:in_range=auto:out_range=tv,` +
        `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x000000,` +
        `fps=24,setsar=1,format=yuv420p[v${i}]`,
    )
    const cues = cueInputs.filter((cue) => cue.seg === i)
    if (cues.length === 0) return `[v${i}]`
    // 每条 cue 一张整帧透明 PNG，按自己的相对镜头时间窗口叠加
    let cur = `[v${i}]`
    cues.forEach((cue, j) => {
      const tag = `[vw${i}_${j}]`
      vFilters.push(
        `${cur}[${cue.idx}:v]overlay=0:0:format=auto:enable='between(t,${cue.start.toFixed(
          3,
        )},${cue.end.toFixed(3)})'${tag}`,
      )
      cur = tag
    })
    vFilters.push(`${cur}format=yuv420p[vw${i}]`)
    return `[vw${i}]`
  })

  // 折叠：cut 直接拼；effect 用 xfade 重叠（offset 正好等于当前段的起点）
  let vOut = vTails[0]
  for (let i = 1; i < vTails.length; i++) {
    const j = effective[i]
    if (j.mode === 'effect') {
      const tag = `[vx${i}]`
      vFilters.push(
        `${vOut}${vTails[i]}xfade=transition=${j.xfade}:duration=${j.seconds.toFixed(3)}:offset=${starts[i].toFixed(3)}${tag}`,
      )
      vOut = tag
    } else {
      const tag = `[vc${i}]`
      vFilters.push(`${vOut}${vTails[i]}concat=n=2:v=1:a=0${tag}`)
      vOut = tag
    }
  }

  // 字幕 cue 由客户端提供，服务端只加真实段起点；SRT 同时作为烧录源和 sidecar
  const captionCues = resolved
    .flatMap((r, i) =>
      r.captions.map((cue) => ({
        start: starts[i] + cue.startOffsetMs / 1000,
        end: starts[i] + cue.endOffsetMs / 1000,
        text: cue.text,
      })),
    )
    .filter((cue) => cue.end > cue.start + 0.03)
    .sort((a, b) => a.start - b.start)

  let srtFile = ''
  if (captionCues.length > 0) {
    srtFile = outFile.replace(/\.mp4$/i, '.srt')
    const body = captionCues
      .map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`)
      .join('\n')
    fs.writeFileSync(srtFile, body, 'utf8')
  }

  // 有 libass + CJK 字体：用真字幕；否则走 cue PNG overlay
  if (FF?.ass && captionMode !== 'png' && captionCues.length > 0) {
    const fontRatio = Math.min(0.1, Math.max(0.02, Number(captionStyle.fontRatio) || 0.044))
    const bottomRatio = Math.min(0.2, Math.max(0, Number(captionStyle.bottomRatio) || 0.06))
    const maxWidthRatio = Math.min(0.95, Math.max(0.4, Number(captionStyle.maxWidthRatio) || 0.78))
    const fontSize = Math.round(H * fontRatio)
    const marginV = Math.round(H * bottomRatio)
    const marginLR = Math.round((W * (1 - maxWidthRatio)) / 2)
    const bg = assColor(String(captionStyle.background || 'rgba(4,8,14,0.58)'), '&H6604080E')
    const fg = assColor(String(captionStyle.textColor || '#f4f8fc'), '&H00FCF8F4')
    const fontName = FF.font || 'PingFang SC'
    const style =
      `FontName=${fontName},FontSize=${fontSize},` +
      `PrimaryColour=${fg},OutlineColour=${bg},BackColour=${bg},` +
      `BorderStyle=3,Outline=${Math.max(2, Math.round(fontSize * 0.12))},Shadow=0,Spacing=1,` +
      `Alignment=2,MarginV=${marginV},MarginL=${marginLR},MarginR=${marginLR}`
    vFilters.push(
      `${vOut}subtitles=filename=${filtQuote(srtFile)}:` +
        `original_size=${W}x${H}:force_style=${filtQuote(style)}[vsub]`,
    )
    vOut = '[vsub]'
  } else if (captionCues.length > 0) {
    resolved.forEach((r, i) => {
      r.captions.forEach((cue) => {
        if (!cue.sub) captionWarnings.push(`第 ${i + 1} 段字幕缺少 PNG，无法烧录`)
      })
    })
  }

  if (aInputs.length > 0) {
    aInputs.forEach((a, i) => {
      let chain =
        `[${a.idx}:a]aresample=48000,` +
        `aformat=sample_fmts=fltp:channel_layouts=stereo`
      if (a.cut) {
        const fade = 0.12
        const st = Math.max(0, a.keep - fade)
        chain += `,atrim=0:${a.keep.toFixed(3)},asetpts=PTS-STARTPTS`
        if (st > 0) chain += `,afade=t=out:st=${st.toFixed(3)}:d=${fade}`
      }
      chain += `,volume=${a.volume ?? 1.6},adelay=${a.startMs}:all=1[a${i}]`
      aFilters.push(chain)
    })
    aFilters.push(
      `${aInputs.map((_, i) => `[a${i}]`).join('')}` +
        `amix=inputs=${aInputs.length}:normalize=0:dropout_transition=0,` +
        `apad=whole_dur=${total.toFixed(3)},atrim=0:${total.toFixed(3)}[aout]`,
    )
  }

  args.push('-filter_complex', [...vFilters, ...aFilters].join(';'), '-map', vOut)

  if (aInputs.length > 0) {
    args.push('-map', '[aout]', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000')
  } else {
    args.push('-an')
  }

  args.push(
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-color_range', 'tv',
    '-r', '24',
    '-movflags', '+faststart',
    '-shortest',
    outFile,
  )

  await runFfmpeg(args)

  // 上报真实片长（静帧段按名义时长、视频段按实际长度，拼完以探测结果为准）
  let real = total
  try {
    const out = await new Promise<string>((resolve, reject) => {
      execFile(
        ffProbe(),
        ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', outFile],
        (err, stdout) => (err ? reject(err) : resolve(stdout)),
      )
    })
    const d = Number(String(out).trim())
    if (Number.isFinite(d) && d > 0) real = d
  } catch {
    /* 探测失败就用估算值 */
  }

  return {
    shots: resolved.filter((r) => r.kind === 'shot').length,
    transitions: resolved.filter((r) => r.kind === 'transition').length,
    seconds: Math.round(real * 10) / 10,
    voiced: aInputs.length,
    subbed: resolved.filter((r) => r.captions.length > 0).length,
    captions: captionCues.length,
    captionWarnings: [...new Set(captionWarnings)],
    ...(srtFile ? { srtFile } : {}),
    overflows,
  }
}


function seedreamProxy(): Plugin {
  return {
    name: 'seedream-proxy',
    configureServer(server) {
      const root = server.config.root
      appRoot = root
      const outDir = path.join(root, 'public', 'generated')
      // dev server 重启后清掉上一次的残留作业目录；运行中的作业随进程退出终止。
      try {
        cleanupStaleJobs(root)
      } catch {
        /* 清理失败不阻塞启动 */
      }
      try {
        sweepStaleDrafts(root)
      } catch {
        /* 清理失败不阻塞启动 */
      }
      // 上一进程遗留的发布任务一律标 unknown：不自动续跑，交给用户确认
      try {
        const recovered = recoverInterruptedJobs(resolveRoot(root))
        if (recovered > 0) console.log(`[publish] 恢复中断任务 ${recovered} 条 → unknown`)
      } catch (e) {
        console.warn('[publish] 中断任务恢复失败:', sanitizeError(e))
      }
      // 暂存提交意图：超过有效期的先标过期，再清掉早该丢弃的终态行
      try {
        const expired = expireStaleIntents(resolveRoot(root))
        if (expired.expired > 0) console.log(`[publish] 提交意图过期 ${expired.expired} 条`)
        sweepIntents(resolveRoot(root))
      } catch (e) {
        console.warn('[publish] 提交意图清理失败:', sanitizeError(e))
      }
      server.httpServer?.on('close', () => {
        shutdownRenderJobs()
        discardAllDrafts()
      })

      server.middlewares.use(async (req, res, next) => {
        const url = (req.url || '').split('?')[0]

        // 项目媒体：<projects>/<项目>/assets/，和项目数据同生命周期
        if (url.startsWith('/project-assets/')) {
          const parts = url.split('/').filter(Boolean)
          if (parts.length !== 3) {
            res.statusCode = 404
            res.end()
            return
          }
          let file = ''
          try {
            file = resolveProjectMediaPath(
              root,
              decodeURIComponent(parts[1]),
              decodeURIComponent(parts[2]),
            )
          } catch {
            res.statusCode = 400
            res.end()
            return
          }
          serveFile(res, req, file, mimeOf(path.extname(file).slice(1) || 'png'))
          return
        }

        // 创意会话媒体：<projects>/creatives/<会话>/...，与创意记录同生命周期
        if (url.startsWith('/creative/')) {
          let file = ''
          try {
            file = resolveCreativeFile(root, decodeURIComponent(url))
          } catch {
            res.statusCode = 400
            res.end()
            return
          }
          serveFile(res, req, file, mimeOf(path.extname(file).slice(1) || 'png'))
          return
        }

        // 直接提供生成产物：vite 的 public 索引在启动时建立，
        // 运行中新写入的文件在 watcher 更新前会被 SPA fallback 吃掉（返回 index.html）。
        // 保留子目录（导出/导入会落在 exports/imports 下），并拒绝路径穿越。
        for (const dir of ['generated', 'videos', 'exports', 'voices', 'publish-packages']) {
          if (url.startsWith(`/${dir}/`)) {
            const baseDir = path.join(root, 'public', dir)
            const rel = decodeURIComponent(url.slice(dir.length + 2).split('?')[0])
            const file = path.join(baseDir, rel)
            const inside = path.relative(baseDir, file)
            if (!rel || inside.startsWith('..') || path.isAbsolute(inside)) {
              res.statusCode = 400
              res.end()
              return
            }
            serveFile(res, req, file, mimeOf(path.extname(file).slice(1) || 'png'))
            return
          }
        }

        if (url === '/api/health') {
          const ff = await ensureFf()
          // 视频可用性按当前绑定的视频渠道判断：早先只认 kind==='ark'，
          // 换成 APIMart 后即使 Key 正常也会误报 videoReady:false。
          const videoPick = pickModel('video')
          const videoRefPick = pickModel('videoRef')
          const videoReady = [videoPick, videoRefPick].some(({ provider }) =>
            provider ? Boolean(providerKey(provider)) : Boolean(readApiKey()),
          )
          // 配音可用性看当前绑定的音频渠道，不再只看 macOS say：
          // Linux 容器里没有 say，但 MiniMax/火山/APIMart 仍能正常出声。
          const audioPick = pickModel('audio')
          const audioKeyReady = audioPick.provider ? Boolean(providerKey(audioPick.provider)) : false
          const sayReady = fs.existsSync(SAY)
          res.setHeader('Content-Type', 'application/json')
          res.end(
            JSON.stringify({
              hasKey: Boolean(readApiKey()),
              ffmpegAss: ff.ass,
              ffmpegCaptionFont: ff.font || '',
              ffmpegPath: ff.bin,
              model: effImageModel(),
              videoModel: effVideoModel(),
              videoRefModel: effVideoRefModel(),
              videoReady,
              ffmpegReady: fs.existsSync(FFMPEG),
              ttsReady: audioKeyReady || sayReady,
              ttsProvider: audioKeyReady
                ? `${audioPick.provider?.kind}:${audioPick.entry?.model || ''}`
                : sayReady
                  ? 'macos-say'
                  : '',
            }),
          )
          return
        }

        // ---- 聊天线程：按项目/工作台/集/镜头隔离，只存文本和摘要 ----
        if (url === '/api/chat-thread') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          const rootDir = resolveRoot(root)
          try {
            dbPath(rootDir)
            const q = new URL(req.url || '', 'http://x')
            const readKey = (source: Record<string, unknown> | URLSearchParams) => {
              const get = (k: string) =>
                source instanceof URLSearchParams ? source.get(k) : (source[k] as unknown)
              const project = safeProjectName(String(get('project') || ''))
              const surface = String(get('surface') || '').trim()
              if (!/^[a-z0-9-]{1,40}$/.test(surface)) throw new Error(`surface 不合法：${surface}`)
              const ep = Number(get('episode'))
              const episode = Number.isFinite(ep) ? Math.max(0, Math.floor(ep)) : 0
              const shotId = String(get('shotId') || '').trim().slice(0, 80)
              return { project, surface, episode, shotId }
            }
            if (req.method === 'GET') {
              res.end(JSON.stringify({ ok: true, thread: getChatThread(readKey(q.searchParams)) ?? null }))
              return
            }
            if (req.method === 'DELETE') {
              deleteChatThread(readKey(q.searchParams))
              res.end(JSON.stringify({ ok: true }))
              return
            }
            if (req.method === 'PUT') {
              const body = await readJson(req)
              const key = readKey(body || {})
              if (!Array.isArray(body.messages)) throw new Error('messages 必须是数组')
              if (body.activeSkills !== undefined && !Array.isArray(body.activeSkills)) {
                throw new Error('activeSkills 必须是数组')
              }
              const thread = saveChatThread(key, body.messages, body.activeSkills || [])
              res.end(JSON.stringify({ ok: true, thread }))
              return
            }
            res.statusCode = 405
            res.end(JSON.stringify({ ok: false, message: '只支持 GET / PUT / DELETE' }))
          } catch (e: any) {
            res.statusCode = 400
            res.end(JSON.stringify({ ok: false, message: e?.message || String(e) }))
          }
          return
        }

        // ---- 创意会话：与项目无关的独立存储；线程、源视频与产物都按会话隔离 ----
        if (url === '/api/creative/sessions' || url.startsWith('/api/creative/sessions/')) {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          const rootDir = resolveRoot(root)
          try {
            dbPath(rootDir)
            const tail = url.slice('/api/creative/sessions'.length).replace(/^\/+/, '')
            if (req.method === 'GET') {
              if (!tail) {
                const q = new URL(req.url || '', 'http://x')
                res.end(
                  JSON.stringify({
                    ok: true,
                    sessions: listCreativeSessions(root, Number(q.searchParams.get('limit')) || 100),
                  }),
                )
                return
              }
              const [id, sub] = tail.split('/')
              if (sub === 'thread') {
                const thread = getCreativeThread(root, id)
                res.end(JSON.stringify({ ok: true, thread }))
                return
              }
              if (sub === 'artifacts') {
                res.end(JSON.stringify({ ok: true, artifacts: listCreativeArtifacts(root, id) }))
                return
              }
              if (!sub) {
                const summary = creativeSessionSummary(root, id)
                if (!summary) {
                  res.statusCode = 404
                  res.end(JSON.stringify({ ok: false, message: `创意会话不存在：${id}` }))
                  return
                }
                res.end(JSON.stringify({ ok: true, session: summary }))
                return
              }
              res.statusCode = 404
              res.end(JSON.stringify({ ok: false, message: '未知的创意会话资源' }))
              return
            }
            if (req.method === 'POST' && !tail) {
              const body = await readJson(req)
              const session = createCreativeSession(root, {
                title: body?.title,
                mode: body?.mode,
              })
              res.end(JSON.stringify({ ok: true, session }))
              return
            }
            if (req.method === 'PUT') {
              const body = await readJson(req)
              const [id, sub] = tail.split('/')
              if (sub === 'thread') {
                const thread = saveCreativeThread(root, id, body?.messages, body?.activeSkills || [])
                res.end(JSON.stringify({ ok: true, thread }))
                return
              }
              if (sub) {
                res.statusCode = 404
                res.end(JSON.stringify({ ok: false, message: '未知的创意会话资源' }))
                return
              }
              const session = touchCreativeSession(root, id, {
                ...(body?.title !== undefined ? { title: body.title } : {}),
                ...(body?.mode !== undefined ? { mode: body.mode } : {}),
              })
              if (!session) {
                res.statusCode = 404
                res.end(JSON.stringify({ ok: false, message: `创意会话不存在：${id}` }))
                return
              }
              res.end(JSON.stringify({ ok: true, session }))
              return
            }
            if (req.method === 'DELETE') {
              if (!tail) {
                res.statusCode = 400
                res.end(JSON.stringify({ ok: false, message: '缺少会话 id' }))
                return
              }
              const removed = deleteCreativeSession(root, tail.split('/')[0])
              res.end(JSON.stringify({ ok: true, removed }))
              return
            }
            res.statusCode = 405
            res.end(JSON.stringify({ ok: false, message: '只支持 GET / POST / PUT / DELETE' }))
          } catch (e: any) {
            // 线程超限是用户可恢复的输入问题，不是服务端故障
            const tooLarge = e?.kind === 'thread-too-large'
            res.statusCode = tooLarge ? 413 : 400
            res.end(JSON.stringify({ ok: false, kind: e?.kind || 'creative-error', message: e?.message || String(e) }))
          }
          return
        }

        // ---- 创意媒体：摄取、探测、切分、抽帧 ----
        if (url === '/api/creative/ingest' || url === '/api/creative/analyze' || url === '/api/creative/adapters') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          const rootDir = resolveRoot(root)
          try {
            dbPath(rootDir)
            const settings = getAppSettings()
            // 环境变量兜底：容器部署时地址与凭据从环境注入
            const creative = applyCreativeEnvDefaults(normalizeCreativeSettings(settings.creative), process.env).settings

            if (url === '/api/creative/adapters') {
              res.end(
                JSON.stringify({
                  ok: true,
                  adapters: listIngestAdapters(creative),
                  ffmpeg: ffmpegStatus(),
                  analysis: creative.analysis,
                }),
              )
              return
            }
            if (req.method !== 'POST') {
              res.statusCode = 405
              res.end(JSON.stringify({ ok: false, message: '只支持 POST' }))
              return
            }

            const body = await readJson(req)

            if (url === '/api/creative/ingest') {
              const sessionId = String(body.sessionId || '')
              if (!creativeSessionSummary(root, sessionId)) {
                res.statusCode = 404
                res.end(JSON.stringify({ ok: false, message: `创意会话不存在：${sessionId || '(空)'}` }))
                return
              }
              const sessionDir = creativeSessionDir(root, sessionId)
              const sourceId = `src-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`
              const got = await ingestCreativeSource(
                { url: body.url, data: body.data, name: body.name, adapter: body.adapter },
                { sessionId, sourceId, sourcesDir: path.join(sessionDir, 'sources') },
                creative,
              )
              let probe = null
              let probeError = ''
              try {
                probe = await probeMedia(got.file)
              } catch (e: any) {
                probeError = e?.message || String(e)
              }
              const meta = got.meta || {}
              const source = insertCreativeSource(root, sessionId, {
                id: sourceId,
                kind: 'video',
                platform: String(meta.platform || ''),
                platformId: String(meta.platformId || ''),
                author: String(meta.author || ''),
                title: String(meta.title || ''),
                url: String(meta.url || body.url || ''),
                file: `/creative/${sessionId}/sources/${path.basename(got.file)}`,
                bytes: got.bytes,
                ...(probe
                  ? {
                      duration: probe.duration,
                      width: probe.width,
                      height: probe.height,
                      fps: probe.fps,
                      bitrate: probe.bitrate,
                      vcodec: probe.vcodec,
                      acodec: probe.acodec,
                      hasAudio: probe.hasAudio,
                    }
                  : {}),
                meta: { adapter: got.adapter, warnings: got.warnings || [] },
              })
              // 封面失败不阻塞摄取：用户仍可切分与抽帧
              let cover = ''
              try {
                const coverName = `${sourceId}-cover-${crypto.randomBytes(2).toString('hex')}.jpg`
                const got2 = await extractCreativeCover(got.file, path.join(sessionDir, 'frames', coverName))
                cover = `/creative/${sessionId}/frames/${path.basename(got2.file)}`
                patchCreativeSource(root, sourceId, { cover })
              } catch {
                /* 封面可选 */
              }
              res.end(
                JSON.stringify({
                  ok: true,
                  adapter: got.adapter,
                  adapterLabel: got.adapterLabel,
                  warnings: got.warnings || [],
                  probeError,
                  source: getCreativeSource(root, sourceId),
                }),
              )
              return
            }

            // /api/creative/analyze
            const sourceId = String(body.sourceId || '')
            const source = getCreativeSource(root, sourceId)
            if (!source) {
              res.statusCode = 404
              res.end(JSON.stringify({ ok: false, message: `源视频不存在：${sourceId || '(空)'}` }))
              return
            }
            const sessionId = source.sessionId
            const sessionDir = creativeSessionDir(root, sessionId)
            const file = resolveCreativeFile(root, source.file)
            const action = String(body.action || 'probe')

            if (action === 'probe') {
              const probe = await probeMedia(file)
              const updated = patchCreativeSource(root, sourceId, {
                duration: probe.duration,
                width: probe.width,
                height: probe.height,
                fps: probe.fps,
                bitrate: probe.bitrate,
                vcodec: probe.vcodec,
                acodec: probe.acodec,
                hasAudio: probe.hasAudio,
              })
              res.end(JSON.stringify({ ok: true, probe, source: updated }))
              return
            }

            if (action === 'split') {
              const analysis = creative.analysis || {}
              const threshold = body.threshold == null ? analysis.threshold : Number(body.threshold)
              const minShotSeconds =
                body.minShotSeconds == null ? analysis.minShotSeconds : Number(body.minShotSeconds)
              const split = await splitScenes(file, { threshold, minShotSeconds })
              const maxShots = creative.limits?.maxShots ?? 40
              if (split.shots.length > maxShots) {
                res.statusCode = 400
                res.end(
                  JSON.stringify({
                    ok: false,
                    kind: 'too-many-shots',
                    message: `切分出 ${split.shots.length} 个镜头，超过上限 ${maxShots}；把阈值调高或缩短视频`,
                  }),
                )
                return
              }
              const existing = listCreativeShots(root, sourceId)
              // 重新切分：旧结果只标记过期，证据帧与分析结果保留
              const kept = new Map<number, { frames: string[]; analysis: unknown; status: string }>()
              existing.forEach((s) => {
                if (s.frames.length || s.analysis) {
                  kept.set(s.index, { frames: s.frames, analysis: s.analysis, status: 'stale' })
                }
              })
              const shots = replaceCreativeShots(
                root,
                sourceId,
                split.shots.map((s, i) => ({
                  start: s.start,
                  end: s.end,
                  frames: kept.get(i)?.frames ?? [],
                  status: kept.get(i)?.status ?? 'pending',
                  analysis: kept.get(i)?.analysis ?? null,
                })),
              )
              res.end(
                JSON.stringify({
                  ok: true,
                  duration: split.duration,
                  threshold: split.threshold,
                  shots,
                  staleCount: [...kept.values()].length,
                }),
              )
              return
            }

            if (action === 'frames') {
              const all = listCreativeShots(root, sourceId)
              if (!all.length) {
                res.statusCode = 400
                res.end(JSON.stringify({ ok: false, message: '还没有切分结果，先执行切分再抽帧' }))
                return
              }
              const wanted = Array.isArray(body.shotIndexes) && body.shotIndexes.length
                ? all.filter((s) => body.shotIndexes.map(Number).includes(s.index))
                : all
              const framesPerShot = Math.round(
                Math.min(
                  creative.limits?.maxFramesPerShot ?? 3,
                  Math.max(1, Number(body.framesPerShot) || creative.analysis?.framesPerShot || 1),
                ),
              )
              const results = []
              for (const shot of wanted) {
                const span = Math.max(0.05, shot.end - shot.start)
                const times =
                  framesPerShot === 1
                    ? [shot.start + span / 2]
                    : Array.from({ length: framesPerShot }, (_, i) =>
                        shot.start + span * ((i + 0.5) / framesPerShot),
                      )
                const frames = []
                const usedTimes = []
                const errors = []
                for (const t of times) {
                  const name = `${sourceId}-s${String(shot.index).padStart(2, '0')}-${crypto.randomBytes(2).toString('hex')}.jpg`
                  try {
                    const grabbed = await extractCreativeFrame(
                      file,
                      t,
                      path.join(sessionDir, 'frames', name),
                    )
                    frames.push(`/creative/${sessionId}/frames/${path.basename(grabbed.file)}`)
                    usedTimes.push(grabbed.at)
                  } catch (e: any) {
                    errors.push(e?.message || String(e))
                  }
                }
                // 重抽时覆盖，否则在旧帧后追加；空结果不动旧帧
                const nextFrames = frames.length
                  ? Boolean(body.overwrite)
                    ? frames
                    : [...shot.frames, ...frames]
                  : shot.frames
                const updated = patchCreativeShot(root, sourceId, shot.index, {
                  frames: nextFrames,
                  ...(frames.length ? { status: 'framed' } : {}),
                })
                results.push({ index: shot.index, frames: nextFrames, times: usedTimes, errors, shot: updated })
              }
              res.end(JSON.stringify({ ok: true, framesPerShot, shots: results }))
              return
            }

            res.statusCode = 400
            res.end(JSON.stringify({ ok: false, message: `未知的分析动作：${action}` }))
          } catch (e: any) {
            res.statusCode = 400
            res.end(JSON.stringify({ ok: false, kind: e?.kind || 'creative-media-error', message: e?.message || String(e) }))
          }
          return
        }

        // ---- 创意产物：保存反推结果（服务端二次校验 reverse-v1）----
        if (url === '/api/creative/artifacts') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          if (req.method !== 'POST') {
            res.statusCode = 405
            res.end(JSON.stringify({ ok: false, message: '只支持 POST' }))
            return
          }
          try {
            const body = await readJson(req)
            const sessionId = String(body.sessionId || '')
            const checked = validateSkillContract('reverse-v1', body.payload)
            if (!checked.ok) {
              res.statusCode = 400
              res.end(
                JSON.stringify({
                  ok: false,
                  kind: 'contract-invalid',
                  message: `反推结果不符合 reverse-v1：${checked.errors.join('；')}`,
                }),
              )
              return
            }
            const value = checked.value as Record<string, unknown>
            const title =
              String(body.title || '').trim() ||
              `${String((value.source as Record<string, unknown>)?.platform || '视频')}拆解 · ${
                Array.isArray(value.shots) ? value.shots.length : 0
              } 镜`
            const artifact = saveCreativeArtifact(root, sessionId, {
              kind: String(body.kind || 'reverse'),
              title,
              sourceId: String(body.sourceId || ''),
              payload: value,
              modelLabel: String(body.modelLabel || ''),
            })
            res.end(JSON.stringify({ ok: true, artifact }))
          } catch (e: any) {
            res.statusCode = 400
            res.end(JSON.stringify({ ok: false, kind: 'artifact-error', message: e?.message || String(e) }))
          }
          return
        }

        // ---- 创意产物：导出与晋升（晋升只走现有项目写入路径）----
        if (url === '/api/creative/promote' || url === '/api/creative/export') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          const rootDir = resolveRoot(root)
          try {
            dbPath(rootDir)
            if (req.method !== 'POST') {
              res.statusCode = 405
              res.end(JSON.stringify({ ok: false, message: '只支持 POST' }))
              return
            }
            const body = await readJson(req)
            const artifactId = String(body.artifactId || '')
            const artifact = getCreativeArtifact(root, artifactId)
            if (!artifact) {
              res.statusCode = 404
              res.end(JSON.stringify({ ok: false, message: `产物不存在：${artifactId || '(空)'}` }))
              return
            }
            const payload = artifact.payload && typeof artifact.payload === 'object' ? artifact.payload : {}
            const session = getCreativeSessionRecord(root, artifact.sessionId)
            const sourceUrl = String(body.sourceUrl || '')

            if (url === '/api/creative/export') {
              res.end(
                JSON.stringify({
                  ok: true,
                  format: 'json',
                  title: artifact.title || session?.title || '',
                  payload,
                  text: reversePackToText(payload as Record<string, unknown>, artifact.title || session?.title || ''),
                }),
              )
              return
            }

            const result = promoteReversePack(root, payload as Record<string, unknown>, {
              sessionId: artifact.sessionId,
              sourceId: artifact.sourceId,
              sourceUrl,
              title: String(body.title || artifact.title || session?.title || ''),
              style: String(body.style || ''),
              aspect: String(body.aspect || ''),
              target: body.target === 'existing' ? 'existing' : 'new',
              projectName: String(body.projectName || ''),
              episode: Number(body.episode) || 1,
            })
            res.end(JSON.stringify({ ok: true, ...result }))
          } catch (e: any) {
            res.statusCode = 400
            res.end(JSON.stringify({ ok: false, kind: e?.kind || 'promote-error', message: e?.message || String(e) }))
          }
          return
        }

        // ---- 技能：内置 SKILL.md + 用户覆盖（只读文件、数据-only）----
        if (url === '/api/skills' || url.startsWith('/api/skills/')) {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          const rootDir = resolveRoot(root)
          try {
            dbPath(rootDir)
            const tail = url.slice('/api/skills'.length).replace(/^\/+/, '')
            const overrides = listSkillOverrides()
            const asRecord = (id: string, text: string) => {
              const ov = overrides[id]
              return {
                id,
                text: ov ? withBuiltinFrontmatter(text, ov.body) : text,
                builtinText: text,
                source: ov ? 'override' : 'builtin',
                ...(ov ? { baseVersion: ov.baseVersion, updatedAt: ov.updatedAt } : {}),
              }
            }
            if (req.method === 'GET') {
              if (!tail) {
                const { skills, errors } = listSkillFiles(root)
                res.end(JSON.stringify({ ok: true, skills: skills.map((s) => asRecord(s.id, s.text)), errors }))
                return
              }
              const id = safeSkillId(decodeURIComponent(tail))
              const text = readSkillFile(root, id)
              res.end(JSON.stringify({ ok: true, skill: asRecord(id, text) }))
              return
            }
            if (!tail) {
              res.statusCode = 405
              res.end(JSON.stringify({ ok: false, message: '只支持 GET /api/skills 或 /api/skills/<id>' }))
              return
            }
            const id = safeSkillId(decodeURIComponent(tail))
            if (req.method === 'PUT') {
              const body = await readJson(req)
              const submitted = String(body.body || '')
              const { body: skillBody } = splitSkillText(submitted)
              if (!skillBody.trim()) throw new Error('技能正文不能为空')
              if (Buffer.byteLength(skillBody, 'utf8') > MAX_SKILL_BYTES) {
                throw new Error(`技能正文超过 ${MAX_SKILL_BYTES} 字节`)
              }
              const builtin = readSkillFile(root, id)
              setSkillOverride(id, skillBody, Number(body.baseVersion) || 1)
              res.end(
                JSON.stringify({
                  ok: true,
                  skill: {
                    id,
                    text: withBuiltinFrontmatter(builtin, skillBody),
                    builtinText: builtin,
                    source: 'override',
                  },
                }),
              )
              return
            }
            if (req.method === 'DELETE') {
              const builtin = readSkillFile(root, id)
              deleteSkillOverride(id)
              res.end(JSON.stringify({ ok: true, skill: { id, text: builtin, builtinText: builtin, source: 'builtin' } }))
              return
            }
            res.statusCode = 405
            res.end(JSON.stringify({ ok: false, message: '只支持 GET / PUT / DELETE' }))
          } catch (e: any) {
            res.statusCode = 400
            res.end(JSON.stringify({ ok: false, message: e?.message || String(e) }))
          }
          return
        }

        // ---- 设置页：大模型 + 技能规则包，存 SQLite settings 表 ----
        if (url === '/api/settings') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          try {
            if (req.method === 'GET') {
              res.end(
                JSON.stringify({
                  ok: true,
                  settings: withKeyStatus(getAppSettings()),
                  db: dbPath(resolveRoot(root)),
                }),
              )
              return
            }
            if (req.method === 'PUT') {
              const body = await readJson(req)
              const settings = saveAppSettings(body || {})
              res.end(JSON.stringify({ ok: true, settings: withKeyStatus(settings) }))
              return
            }
            res.statusCode = 405
            res.end(JSON.stringify({ ok: false, message: '只支持 GET / PUT' }))
          } catch (e: any) {
            res.statusCode = 500
            res.end(JSON.stringify({ ok: false, message: e?.message || String(e) }))
          }
          return
        }

        // ---- APIMart 模型目录：只读，不写设置库；用草稿渠道的 Key/Base URL ----
        if (url === '/api/provider-catalog') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          if (req.method !== 'POST') {
            res.statusCode = 405
            res.end(JSON.stringify({ ok: false, message: '只支持 POST' }))
            return
          }
          try {
            const body = await readJson(req)
            const s = getAppSettings()
            const p =
              (body.provider as Provider | undefined) ||
              s.providers.find((x) => x.id === String(body.id || ''))
            if (!p) throw new Error('找不到这个渠道')
            if (p.kind !== 'apimart') {
              res.statusCode = 400
              res.end(JSON.stringify({ ok: false, kind: 'unsupported', message: '只有 APIMart 渠道支持模型目录同步' }))
              return
            }
            const key = providerKey(p)
            if (!key) {
              res.statusCode = 400
              res.end(JSON.stringify({ ok: false, kind: 'no-key', message: '这个渠道还没有 APIMart API Key' }))
              return
            }
            const entries = await fetchApimartCatalog({
              baseUrl: String(p.baseUrl || 'https://api.apimart.ai/v1'),
              apiKey: key,
            })
            res.end(JSON.stringify({ ok: true, entries }))
          } catch (e: any) {
            res.statusCode = e?.status || 500
            res.end(
              JSON.stringify({
                ok: false,
                kind: e?.kind || 'api',
                status: e?.status,
                message: e?.message || String(e),
              }),
            )
          }
          return
        }

        // ---- 渠道连通性测试：用最轻的真实调用验证 Key / baseUrl / 模型名 ----
        if (url === '/api/test-provider') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          if (req.method !== 'POST') {
            res.statusCode = 405
            res.end(JSON.stringify({ ok: false, message: '只支持 POST' }))
            return
          }
          try {
            const body = await readJson(req)
            const s = getAppSettings()
            const p =
              (body.provider as Provider | undefined) ||
              s.providers.find((x) => x.id === String(body.id || ''))
            if (!p) throw new Error('找不到这个渠道')
            const key = providerKey(p)
            if (!key) {
              res.end(
                JSON.stringify({
                  ok: false,
                  kind: 'no-key',
                  message:
                    p.kind === 'ark'
                      ? '没有 Key：填到设置页或配 ARK_API_KEY'
                      : p.kind === 'ark-plan'
                        ? 'Agent Plan 渠道需要单独填 Key，不会沿用标准方舟 Key'
                        : '这个渠道还没填 API Key',
                  latency: 0,
                }),
              )
              return
            }
            const base = String(p.baseUrl || '').replace(/\/+$/, '')
            if (!/^https?:\/\//.test(base)) throw new Error('Base URL 必须带 http(s)://')

            // 每个协议挑最轻的鉴权调用：文本类发 1 token 对话，其余查资源
            const t0 = Date.now()
            let endpoint = ''
            let init: RequestInit
            if (p.kind === 'elevenlabs') {
              endpoint = `${base}/v1/user`
              init = { headers: { 'xi-api-key': key } }
            } else if (p.kind === 'apimart') {
              // 目录是 APIMart 最轻的鉴权调用；404 再退到 1-token 对话
              endpoint = `${base}/models?expand=category`
              const t0Apimart = Date.now()
              let rv = await fetch(endpoint, { headers: { Authorization: `Bearer ${key}` } })
              let raw = (await rv.text()).slice(0, 800)
              let endpointUsed = endpoint
              if (rv.status === 404) {
                const m = s.models.find((x) => x.provider === p.id && hasTextCap(x) && isRunnableModel(x))?.model
                if (!m) {
                  res.end(
                    JSON.stringify({
                      ok: false,
                      kind: 'config',
                      message: '这个渠道还没有可运行的文本模型，先同步目录或手动添加一条',
                      latency: Date.now() - t0Apimart,
                      endpoint,
                    }),
                  )
                  return
                }
                endpointUsed = `${base}/chat/completions`
                rv = await fetch(endpointUsed, {
                  method: 'POST',
                  headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    model: m,
                    messages: [{ role: 'user', content: 'ping' }],
                    max_tokens: 1,
                    stream: false,
                  }),
                })
                raw = (await rv.text()).slice(0, 800)
              }
              const latencyApimart = Date.now() - t0Apimart
              if (rv.ok) {
                let count = 0
                try {
                  const j = JSON.parse(raw)
                  count = Array.isArray(j?.data) ? j.data.length : 0
                } catch {
                  /* 对话成功但不一定可解析，按连通处理 */
                }
                res.end(
                  JSON.stringify({
                    ok: true,
                    kind: 'ok',
                    status: rv.status,
                    latency: latencyApimart,
                    endpoint: endpointUsed,
                    message: count ? `连通，目录 ${count} 个模型` : '连通，鉴权通过',
                  }),
                )
                return
              }
              const err = errorFromResponse(raw, rv.status)
              res.end(
                JSON.stringify({
                  ok: false,
                  kind: err.kind,
                  status: rv.status,
                  latency: latencyApimart,
                  endpoint: endpointUsed,
                  message:
                    err.kind === 'billing'
                      ? `余额不足，充值后再试：${err.message}`
                      : err.message,
                }),
              )
              return
            } else if (p.kind === 'minimax') {
              // MiniMax 没有稳定的 models 端点，用 1 token 文本对话验鉴权
              const m = s.models.find((x) => x.provider === p.id && x.cap === 'text')?.model || 'MiniMax-M1'
              endpoint = `${base}/chat/completions`
              init = {
                method: 'POST',
                headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  model: m,
                  messages: [{ role: 'user', content: 'ping' }],
                  max_tokens: 1,
                  ...(m === 'MiniMax-M3' ? { thinking: { type: 'disabled' } } : {}),
                }),
              }
            } else if (p.kind === 'ark-plan') {
              // Agent Plan 不提供 /models，直接用该渠道绑定的文本模型发 1 token
              const m = s.models.find((x) => x.provider === p.id && x.cap === 'text')?.model
              if (!m) {
                res.end(
                  JSON.stringify({
                    ok: false,
                    kind: 'config',
                    message: '这个渠道还没有文本模型，先在模型表加一条再测试',
                    latency: 0,
                  }),
                )
                return
              }
              endpoint = `${base}/chat/completions`
              init = {
                method: 'POST',
                headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  model: m,
                  messages: [{ role: 'user', content: 'ping' }],
                  max_tokens: 1,
                  ...(isDeepSeekFlash(p, m) ? { thinking: { type: 'disabled' } } : {}),
                }),
              }
            } else if (p.kind === 'volc-tts') {
              // 语音没有免费鉴权端点：发空请求，不产生音频；45000000 表示缺少 req_params
              const ttsEndpoint = `${base}/tts/unidirectional`
              const rv = await fetch(ttsEndpoint, {
                method: 'POST',
                headers: {
                  'X-Api-Key': key,
                  'X-Api-Resource-Id': 'seed-tts-2.0',
                  'X-Api-Connect-Id': crypto.randomUUID(),
                  'Content-Type': 'application/json',
                },
                body: '{}',
                signal: AbortSignal.timeout(30_000),
              })
              const rawTts = (await rv.text()).slice(0, 800)
              const firstLine = rawTts.split('\n').map((x) => x.trim()).find(Boolean) || ''
              let parsed: any = {}
              try {
                parsed = JSON.parse(firstLine)
              } catch {
                /* 保持原文 */
              }
              const code = Number(parsed?.code ?? parsed?.header?.code ?? 0)
              const msg = String(parsed?.message ?? parsed?.header?.message ?? '')
              const latencyTts = Date.now() - t0
              if (rv.status === 401 || rv.status === 403) {
                res.end(
                  JSON.stringify({
                    ok: false,
                    kind: 'auth',
                    status: rv.status,
                    latency: latencyTts,
                    endpoint: ttsEndpoint,
                    message: `Key 无效或没权限（HTTP ${rv.status}）：${(msg || rawTts).slice(0, 160)}`,
                  }),
                )
                return
              }
              if (/AgentPlanDeductNotEnabled/.test(rawTts)) {
                res.end(
                  JSON.stringify({
                    ok: false,
                    kind: 'plan',
                    status: rv.status,
                    latency: latencyTts,
                    endpoint: ttsEndpoint,
                    message: `Key 可用，但需在 Agent Plan 控制台开启扣减：${msg || rawTts.slice(0, 160)}`,
                  }),
                )
                return
              }
              if (code === 45000000 || code === 0) {
                res.end(
                  JSON.stringify({
                    ok: true,
                    kind: 'ok',
                    status: rv.status,
                    latency: latencyTts,
                    endpoint: ttsEndpoint,
                    message: '连通，鉴权通过（未合成音频）',
                  }),
                )
                return
              }
              res.end(
                JSON.stringify({
                  ok: false,
                  kind: 'api',
                  status: rv.status,
                  latency: latencyTts,
                  endpoint: ttsEndpoint,
                  message: `HTTP ${rv.status} code ${code}：${(msg || rawTts).slice(0, 160)}`,
                }),
              )
              return
            } else {
              // ark / openai：先试 models 列表（免费），不行再退回 1 token 对话
              endpoint = `${base}/models`
              init = { headers: { Authorization: `Bearer ${key}` } }
            }

            let r = await fetch(endpoint, init)
            if (!r.ok && r.status === 404 && (p.kind === 'ark' || p.kind === 'openai')) {
              const m = s.models.find((x) => x.provider === p.id && x.cap === 'text')?.model || ''
              endpoint = `${base}/chat/completions`
              r = await fetch(endpoint, {
                method: 'POST',
                headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  model: m,
                  messages: [{ role: 'user', content: 'ping' }],
                  max_tokens: 1,
                  ...(isDeepSeekFlash(p, m) ? { thinking: { type: 'disabled' } } : {}),
                }),
              })
            }
            const latency = Date.now() - t0
            const raw = (await r.text()).slice(0, 300)
            if (r.ok) {
              res.end(
                JSON.stringify({
                  ok: true,
                  kind: 'ok',
                  status: r.status,
                  latency,
                  endpoint,
                  message: '连通，鉴权通过',
                }),
              )
              return
            }
            const kind = r.status === 401 || r.status === 403 ? 'auth' : 'api'
            res.end(
              JSON.stringify({
                ok: false,
                kind,
                status: r.status,
                latency,
                endpoint,
                message:
                  kind === 'auth'
                    ? `Key 无效或没权限（HTTP ${r.status}）：${raw.slice(0, 160)}`
                    : `HTTP ${r.status}：${raw.slice(0, 160)}`,
              }),
            )
          } catch (e: any) {
            res.end(JSON.stringify({ ok: false, kind: 'net', message: e?.message || String(e), latency: 0 }))
          }
          return
        }

        // ---- 项目数据：SQLite 读写（工作台与画布共用同一真相源；首次启动自动迁移 project.json）----
        if (url === '/api/project') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          const q = new URL(req.url || '', 'http://x')
          const name = q.searchParams.get('name') || ''
          try {
            const rootDir = resolveRoot(root)

            if (req.method === 'GET' && !name) {
              res.end(JSON.stringify({ ok: true, root: rootDir, projects: listProjects(rootDir) }))
              return
            }

            // 删除预览：只读，不存在的项目返回 exists:false 而不是报错
            // ?names= 或请求体 {names:[...]} 走批量，一次算完，避免几百个选中项各发一次
            if (req.method === 'GET' && q.searchParams.get('preview') === 'delete') {
              const rawNames = q.searchParams.get('names')
              if (rawNames) {
                const list = rawNames.split(',').map((s) => s.trim()).filter(Boolean)
                res.end(JSON.stringify(previewProjectDeletes(rootDir, list)))
                return
              }
              const preview = previewProjectDelete(rootDir, name)
              res.end(JSON.stringify(preview))
              return
            }

            // 批量预览（POST + preview）：名字可能上百个，用请求体承载
            if (req.method === 'POST' && q.searchParams.get('preview') === 'delete') {
              const body = await readJson(req)
              const list = Array.isArray(body?.names) ? body.names : []
              if (!list.length) {
                res.statusCode = 400
                res.end(JSON.stringify({ ok: false, message: '缺少项目名' }))
                return
              }
              res.end(JSON.stringify(previewProjectDeletes(rootDir, list)))
              return
            }

            // 删除项目：?name= 单个，?names=a,b,c 或请求体 {names:[...]} 批量。
            // 批量不设数量上限，所以客户端优先用请求体——几百个项目名放查询串会顶到 URL 长度限制。
            if (req.method === 'DELETE') {
              const raw = q.searchParams.get('names')
              const body = raw ? null : await readJson(req).catch(() => ({}))
              const fromBody = Array.isArray(body?.names) ? body.names : []
              const names = raw
                ? raw.split(',').map((s) => s.trim()).filter(Boolean)
                : fromBody.length
                  ? fromBody
                  : name
                    ? [name]
                    : []
              if (!names.length) {
                res.statusCode = 400
                res.end(JSON.stringify({ ok: false, message: '缺少项目名' }))
                return
              }
              if (raw || fromBody.length) {
                const result = deleteProjects(rootDir, names, { appRoot: root })
                res.end(JSON.stringify(result))
                return
              }
              const one = deleteProjects(rootDir, names, { appRoot: root })
              const first = one.results[0]
              if (!first.ok && first.code === 'active_jobs') res.statusCode = 409
              else if (!first.ok && first.code === 'not_found') res.statusCode = 404
              else if (!first.ok) res.statusCode = 500
              res.end(JSON.stringify({ ...first, sharedFilesKept: true }))
              return
            }

            if (req.method === 'GET') {
              const cur = readProject(rootDir, name)
              // 旧 /generated 引用幂等迁移：复制进项目目录并改写；缺失项只标记不猜
              const migrated = migrateProjectMedia(root, name, cur)
              let project = cur
              let copied = 0
              if (migrated.changed) {
                try {
                  writeProject(rootDir, name, {
                    characters: migrated.characters,
                    designs: migrated.designs,
                  })
                  project = { ...cur, characters: migrated.characters, designs: migrated.designs }
                  copied = migrated.migrated
                } catch {
                  /* 迁移失败不阻塞项目读取；下次打开再试 */
                }
              }
              res.end(
                JSON.stringify({
                  ok: true,
                  project: { ...project, media: { migrated: copied, missing: migrated.missing } },
                }),
              )
              return
            }

            // 新建项目：?create=1
            if (req.method === 'POST' && q.searchParams.get('create')) {
              const body = await readJson(req).catch(() => ({}))
              const made = createProject(rootDir, name, body || {})
              res.end(JSON.stringify({ ok: true, name: made.name, created: true }))
              return
            }

            const body = await readJson(req)

            // POST = 局部合并（镜头按 id 合并、角色整体替换），保留未传的字段
            if (req.method === 'POST') {
              const cur = readProject(rootDir, name)
              const patch: Record<string, unknown> = {}
              // 显式删除：必须是字符串数组；先 merge 再删，同一 id 两处出现时以删除为准
              const deleteIds = body.deleteShotIds
              if (deleteIds !== undefined && !Array.isArray(deleteIds)) {
                throw new Error('deleteShotIds 必须是字符串数组')
              }
              if (Array.isArray(body.shots)) patch.shots = mergeShots(cur.shots, body.shots)
              if (Array.isArray(deleteIds) && deleteIds.length) {
                const ids = deleteIds.map((x: unknown) => String(x))
                if (ids.some((x: string) => !x)) throw new Error('deleteShotIds 不能含空值')
                const base = Array.isArray(patch.shots) ? (patch.shots as any[]) : cur.shots
                const after = deleteShots(base, ids)
                const pruned = pruneDanglingTransitions(after.shots)
                patch.shots = pruned.shots
                ;(patch as Record<string, unknown>).__removedShots = after.removed
              } else if (Array.isArray(body.shots)) {
                // 没删镜头也要兜底清一次悬空转场
                const pruned = pruneDanglingTransitions(patch.shots as any[])
                if (pruned.cleared) patch.shots = pruned.shots
              }
              // 角色 / 场景道具设定 / 集 / 素材整体替换（都是人改的结果，不是 LLM 增量）
              for (const k of ['characters', 'designs', 'sceneLayouts', 'episodes', 'assets']) {
                if (body[k] === undefined) continue
                if (!Array.isArray(body[k])) throw new Error(`${k} 必须是数组`)
                patch[k] = body[k]
              }
              for (const k of ['source', 'logline', 'style', 'aspect']) {
                if (body[k] === undefined) continue
                if (typeof body[k] !== 'string') throw new Error(`${k} 必须是字符串`)
                patch[k] = body[k]
              }
              if (Object.keys(patch).length === 0) {
                throw new Error('POST 需要 shots / characters / designs / sceneLayouts / episodes / source 等字段之一')
              }
              // 集内镜号唯一：重复会让 E{集}-{镜号} 的 id 碰撞
              if (Array.isArray(patch.shots)) {
                const dups = findDuplicateShotNos(patch.shots as any[])
                if (dups.length) {
                  const first = dups[0]
                  throw new Error(
                    `第 ${first.episode} 集镜号「${first.no}」重复（共 ${dups.length} 处）；镜头 id 由集号+镜号生成，重复会互相覆盖`,
                  )
                }
              }
              const removedShots = Number((patch as Record<string, unknown>).__removedShots) || 0
              delete (patch as Record<string, unknown>).__removedShots
              const saved = writeProject(rootDir, name, patch)
              res.end(
                JSON.stringify({
                  ok: true,
                  shots: saved.shots ?? [],
                  characters: saved.characters ?? [],
                  ...(removedShots ? { removedShots } : {}),
                  savedAt: saved.updated_at,
                }),
              )
              return
            }

            if (req.method === 'PUT') {
              const saved = writeProject(rootDir, name, body.project || body)
              res.end(JSON.stringify({ ok: true, savedAt: saved.updated_at, shots: saved.shots?.length ?? 0 }))
              return
            }

            res.statusCode = 405
            res.end(JSON.stringify({ ok: false, message: '只支持 GET / POST / PUT / DELETE' }))
          } catch (e: any) {
            res.statusCode = 400
            res.end(JSON.stringify({ ok: false, message: e?.message || String(e) }))
          }
          return
        }

        // ---- 视觉理解：只接受声明 vision 能力的模型与参考板 dataURL ----
        if (url === '/api/vision') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          if (req.method !== 'POST') {
            res.statusCode = 405
            res.end(JSON.stringify({ ok: false, message: '只支持 POST' }))
            return
          }
          try {
            const body = await readJson(req)
            const prompt = String(body.prompt || '').trim()
            let image = String(body.image || '').trim()
            if (!prompt) throw new Error('prompt 不能为空')
            const m = image.match(/^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/)
            if (!m) throw new Error('参考板必须是 png/jpeg/webp 的 dataURL')
            if (Buffer.byteLength(m[2], 'base64') > 4 * 1024 * 1024) throw new Error('参考板超过 4MB')
            const picked = pickVisionModel(String(body.modelKey || '').trim())
            if (picked.error || !picked.entry) {
              res.statusCode = 400
              res.end(JSON.stringify({
                ok: false,
                kind: picked.error || 'no-vision-model',
                message: picked.error === 'model-key-not-found'
                  ? `模型表里找不到视觉模型「${body.modelKey}」`
                  : '设置页还没有可用的视觉模型，3D 将回退为文本生成',
              }))
              return
            }
            const entry = picked.entry
            const provider = picked.provider
            if (!provider || !['ark', 'ark-plan', 'apimart', 'openai'].includes(provider.kind)) {
              res.statusCode = 400
              res.end(JSON.stringify({ ok: false, kind: 'unsupported-vision-provider', message: '视觉模型只支持方舟 / APIMart / OpenAI 兼容渠道' }))
              return
            }
            const key = providerKey(provider)
            if (!key) {
              res.statusCode = 400
              res.end(JSON.stringify({ ok: false, kind: 'no-key', message: `渠道「${provider.label || provider.kind}」没有 API Key` }))
              return
            }
            const base = String(provider.baseUrl || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/+$/, '')
            const messages: { role: string; content: unknown }[] = []
            if (body.system) messages.push({ role: 'system', content: String(body.system) })
            messages.push({
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                { type: 'image_url', image_url: { url: image } },
              ],
            })
            const deepThink = deepSeekThinking(entry, provider, entry.model, Boolean(body.json))
            const r = await fetch(`${base}/chat/completions`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                model: entry.model,
                messages,
                max_tokens: Number(body.maxTokens) || 1800,
                temperature: 0.2,
                ...(deepThink ? { thinking: { type: deepThink } } : {}),
              }),
            })
            const raw = await r.text()
            if (!r.ok) throw new Error(`${provider.label || provider.kind} ${r.status}: ${raw.slice(0, 300)}`)
            const j = parseChatBody(raw, r.headers.get('content-type') || '')
            const text = String(j?.choices?.[0]?.message?.content ?? j?.reply ?? '')
            if (!text.trim()) throw new Error('视觉模型没有返回内容')
            res.end(JSON.stringify({
              ok: true,
              text,
              ...(body.json ? { json: extractJson(text) } : {}),
              model: entry.model,
              modelKey: entry.key,
              modelLabel: entry.label,
              provider: provider.label || provider.kind,
            }))
          } catch (e: any) {
            res.statusCode = 500
            res.end(JSON.stringify({ ok: false, message: e?.message || String(e) }))
          }
          return
        }

        // ---- 视频理解：只接受公网可访问 URL；本地视频由前端回退关键帧 ----
        if (url === '/api/video-vision') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          if (req.method !== 'POST') {
            res.statusCode = 405
            res.end(JSON.stringify({ ok: false, message: '只支持 POST' }))
            return
          }
          try {
            const body = await readJson(req)
            const prompt = String(body.prompt || '').trim()
            const video = String(body.video || '').trim()
            if (!prompt) throw new Error('prompt 不能为空')
            if (!/^https?:\/\//i.test(video)) {
              res.statusCode = 400
              res.end(JSON.stringify({
                ok: false,
                kind: 'unsupported-video-input',
                message: '当前视频理解渠道不支持本地视频；请使用关键帧回退',
              }))
              return
            }
            const picked = pickVideoVisionModel(String(body.modelKey || '').trim())
            if (picked.error || !picked.entry) {
              res.statusCode = 400
              res.end(JSON.stringify({
                ok: false,
                kind: picked.error || 'no-video-vision-model',
                message: picked.error === 'model-key-not-found'
                  ? `模型表里找不到视频理解模型「${body.modelKey}」`
                  : '设置页还没有可用的视频理解模型，已回退关键帧',
              }))
              return
            }
            const entry = picked.entry
            const provider = picked.provider
            if (!provider || !['ark', 'ark-plan', 'openai'].includes(provider.kind)) {
              res.statusCode = 400
              res.end(JSON.stringify({ ok: false, kind: 'unsupported-video-provider', message: '视频理解只支持方舟 / OpenAI 兼容渠道' }))
              return
            }
            const key = providerKey(provider)
            if (!key) {
              res.statusCode = 400
              res.end(JSON.stringify({ ok: false, kind: 'no-key', message: `渠道「${provider.label || provider.kind}」没有 API Key` }))
              return
            }
            const base = String(provider.baseUrl || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/+$/, '')
            const messages: { role: string; content: unknown }[] = []
            if (body.system) messages.push({ role: 'system', content: String(body.system) })
            messages.push({
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                { type: 'video_url', video_url: { url: video } },
              ],
            })
            const deepThink = deepSeekThinking(entry, provider, entry.model, Boolean(body.json))
            const r = await fetch(`${base}/chat/completions`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                model: entry.model,
                messages,
                max_tokens: Number(body.maxTokens) || 1800,
                temperature: 0.2,
                ...(deepThink ? { thinking: { type: deepThink } } : {}),
              }),
            })
            const raw = await r.text()
            if (!r.ok) throw new Error(`${provider.label || provider.kind} ${r.status}: ${raw.slice(0, 300)}`)
            const j = JSON.parse(raw)
            const text = String(j?.choices?.[0]?.message?.content ?? j?.reply ?? '')
            if (!text.trim()) throw new Error('视频理解模型没有返回内容')
            res.end(JSON.stringify({
              ok: true,
              text,
              ...(body.json ? { json: extractJson(text) } : {}),
              model: entry.model,
              modelKey: entry.key,
              modelLabel: entry.label,
              provider: provider.label || provider.kind,
            }))
          } catch (e: any) {
            res.statusCode = 500
            res.end(JSON.stringify({ ok: false, message: e?.message || String(e) }))
          }
          return
        }

        // ---- 文本 LLM：拆镜 / 提示词共用这一个原语 ----
        if (url === '/api/text') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          if (req.method !== 'POST') {
            res.statusCode = 405
            res.end(JSON.stringify({ ok: false, message: '只支持 POST' }))
            return
          }
          try {
            const body = await readJson(req)
            const system = String(body.system || '')
            const prompt = String(body.prompt || '')
            const wantJson = Boolean(body.json)
            const chatMessages = normalizeChatMessages(body.messages)
            const tools = normalizeToolSchemas(body.tools)
            const toolMode = tools.length > 0
            if (!chatMessages.length && !prompt.trim()) throw new Error('prompt 不能为空')
            if (Array.isArray(body.tools) && body.tools.length && !toolMode) {
              res.statusCode = 400
              res.end(JSON.stringify({ ok: false, kind: 'tools-invalid', message: 'tools 不是合法的 function 定义' }))
              return
            }

            // 选模型：modelKey（设置页里的模型表键，text/textPro 都算）> 档位 lite/pro
            const modelKey = String(body.modelKey || '').trim()
            const tier: 'lite' | 'pro' = body.model === 'pro' ? 'pro' : 'lite'
            const picked = pickTextModel(modelKey, tier)
            if (picked.error || !picked.entry) {
              res.statusCode = 400
              res.end(
                JSON.stringify({
                  ok: false,
                  kind: picked.error || 'no-text-model',
                  message:
                    picked.error === 'model-key-not-found'
                      ? `模型表里找不到可用的文本模型「${modelKey}」，请到设置页检查环节模型或重新选择`
                      : '设置页还没有可用的文本模型，先添加一条 text / textPro 模型',
                }),
              )
              return
            }
            const entry = picked.entry
            const provider = picked.provider
            const model = entry.model
            const kind: ProviderKind = provider?.kind || 'ark'
            const key = providerKey(provider)
            if (!key) {
              res.statusCode = 400
              res.end(
                JSON.stringify({
                  ok: false,
                  message: `渠道「${provider?.label || kind}」没有 API Key，去设置页填一下`,
                  kind: 'no-key',
                }),
              )
              return
            }
            if (kind === 'elevenlabs') {
              throw new Error('ElevenLabs 渠道不支持文本生成，请换文本模型')
            }
            if (toolMode) {
              const toolErr = toolRequestError({
                tools,
                providerId: provider?.id,
                model,
                supported: supportsNativeTools(provider?.id, model),
              })
              if (toolErr) {
                res.statusCode = 400
                res.end(JSON.stringify({ ok: false, kind: 'tools-unsupported', message: toolErr }))
                return
              }
            }
            const base = String(provider?.baseUrl || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/+$/, '')
            // MiniMax 也走 OpenAI 兼容 /chat/completions；这个端点支持 thinking 开关
            const endpoint = `${base}/chat/completions`

            const messages = chatMessages.length
              ? chatMessages
              : [
                  ...(system ? [{ role: 'system', content: system }] : []),
                  { role: 'user', content: prompt },
                ]

            const isMiniMaxM3 = kind === 'minimax' && /^MiniMax-M3$/i.test(model)
            const deepThink = deepSeekThinking(entry, provider, model, wantJson)
            // 工具调用模式优先关 thinking：M3/豆包/DeepSeek Flash 的 reasoning 会吃掉参数输出预算。
            const toolThinking =
              toolMode && toolThinkingMode(provider?.id, model) === 'disable' ? 'disabled' : undefined
            const thinkingMode =
              toolThinking ||
              deepThink ||
              (isMiniMaxM3 && !toolMode ? (wantJson ? 'disabled' : 'adaptive') : undefined)
            const providerBody = {
              model,
              messages,
              max_tokens: Number(body.maxTokens) || 8192,
              temperature: body.temperature ?? 0.7,
              ...(tools.length
                ? {
                    tools,
                    tool_choice:
                      typeof body.toolChoice === 'string' || (body.toolChoice && typeof body.toolChoice === 'object')
                        ? body.toolChoice
                        : 'auto',
                  }
                : {}),
              ...(thinkingMode ? { thinking: { type: thinkingMode } } : {}),
            }
            if (toolMode) {
              console.log(
                '[text] tool-mode',
                JSON.stringify({
                  provider: provider?.id,
                  model,
                  thinking: thinkingMode || 'omit',
                  tools: tools.length,
                  messages: messages.length,
                }),
              )
            }

            // ---- 流式：只发进度与最终结果；JSON 模式不把原始片段发给客户端
            if (body.stream) {
              res.writeHead(200, {
                'Content-Type': 'text/event-stream; charset=utf-8',
                'Cache-Control': 'no-cache, no-transform',
                Connection: 'keep-alive',
                'X-Accel-Buffering': 'no',
              })
              res.flushHeaders?.()
              const upstreamCtrl = new AbortController()
              let closed = false
              res.on('close', () => {
                closed = true
                upstreamCtrl.abort()
              })
              const send = (payload: Record<string, unknown>) => {
                if (closed || res.writableEnded) return
                res.write(`data: ${JSON.stringify(payload)}\n\n`)
              }
              const streamMeta = {
                model,
                modelKey: entry.key,
                modelLabel: entry.label,
                provider: provider?.label || kind,
              }
              send({ type: 'meta', ...streamMeta })
              try {
                const upstream = await fetch(endpoint, {
                  method: 'POST',
                  headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ ...providerBody, stream: true }),
                  signal: upstreamCtrl.signal,
                })
                if (!upstream.ok) {
                  const raw = await upstream.text()
                  send({
                    type: 'error',
                    message: `${provider?.label || kind} ${upstream.status}: ${raw.slice(0, 300)}`.slice(0, 600),
                  })
                  res.end()
                  return
                }
                const contentType = String(upstream.headers.get('content-type') || '')
                if (!upstream.body || !contentType.includes('text/event-stream')) {
                  // 渠道忽略 stream：按整段 JSON 回退，客户端仍能完成本轮。
                  const raw = await upstream.text()
                  const j = parseChatBody(raw, contentType)
                  const message = j?.choices?.[0]?.message
                  const toolCalls = normalizeToolCalls(message?.tool_calls, `call_${Date.now().toString(36)}`)
                  const text = String(message?.content ?? j?.reply ?? '')
                  if (!text.trim() && !toolCalls.length) {
                    send({ type: 'error', message: '模型没有返回内容' })
                    res.end()
                    return
                  }
                  let jsonValue: unknown
                  if (wantJson && text.trim()) {
                    try {
                      jsonValue = extractJson(text)
                    } catch {
                      jsonValue = undefined
                    }
                  }
                  send({
                    type: 'done',
                    text,
                    toolCalls,
                    ...(wantJson ? { json: jsonValue } : {}),
                    ...streamMeta,
                    ...(j?.choices?.[0]?.finish_reason ? { finishReason: j.choices[0].finish_reason } : {}),
                    ...(j?.usage ? { usage: j.usage } : {}),
                  })
                  res.end()
                  return
                }
                const parser = new ChatStreamParser()
                const reader = upstream.body.getReader()
                const decoder = new TextDecoder()
                let lastChars = 0
                let lastAt = Date.now()
                for (;;) {
                  const { done, value } = await reader.read()
                  if (done) break
                  const out = parser.push(decoder.decode(value, { stream: true }))
                  for (const delta of out.toolDeltas || []) {
                    send({
                      type: 'tool_call_delta',
                      index: delta.index,
                      id: delta.id,
                      name: delta.name,
                      delta: delta.delta,
                    })
                  }
                  if (out.done) break
                  const now = Date.now()
                  if (out.chars > lastChars && (out.chars - lastChars >= 32 || now - lastAt >= 150)) {
                    lastChars = out.chars
                    lastAt = now
                    send({ type: 'progress', chars: out.chars })
                  }
                }
                // 放出被 think 标签检测扣住的尾巴；未闭合的 think 块会被丢弃。
                parser.flush()
                if (parser.error) {
                  send({ type: 'error', message: parser.error.slice(0, 600) })
                  res.end()
                  return
                }
                const text = parser.text.trim()
                const toolCalls = parser.finalToolCalls()
                if (!text && !toolCalls.length) {
                  send({
                    type: 'error',
                    message: `模型没有返回内容（finish=${parser.finishReason || '?'}）`,
                  })
                  res.end()
                  return
                }
                let jsonValue: unknown
                if (wantJson && text) {
                  try {
                    jsonValue = extractJson(text)
                  } catch {
                    jsonValue = undefined
                  }
                }
                send({
                  type: 'done',
                  text,
                  toolCalls,
                  ...(wantJson ? { json: jsonValue } : {}),
                  ...streamMeta,
                  ...(parser.finishReason ? { finishReason: parser.finishReason } : {}),
                  ...(parser.usage ? { usage: parser.usage } : {}),
                })
                res.end()
              } catch (e: any) {
                if (!closed) {
                  send({ type: 'error', message: (e?.message || String(e)).slice(0, 600) })
                  res.end()
                }
              }
              return
            }

            const r = await fetch(endpoint, {
              method: 'POST',
              headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
              body: JSON.stringify(providerBody),
            })
            const raw = await r.text()
            if (!r.ok) throw new Error(`${provider?.label || kind} ${r.status}: ${raw.slice(0, 300)}`)

            const j = parseChatBody(raw, r.headers.get('content-type') || '')
            const message = j?.choices?.[0]?.message
            const toolCalls = normalizeToolCalls(message?.tool_calls, `call_${Date.now().toString(36)}`)
            const text = String(message?.content ?? j?.reply ?? '')
            if (!text.trim() && !toolCalls.length) {
              const finish = j?.choices?.[0]?.finish_reason
              const usage = j?.usage
              const reasoning = usage?.completion_tokens_details?.reasoning_tokens
              throw new Error(
                `模型没有返回内容（finish=${finish || '?'}，completion=${usage?.completion_tokens ?? '?'}${
                  reasoning != null ? `，reasoning=${reasoning}` : ''
                }）`,
              )
            }
            const meta = {
              model,
              modelKey: entry.key,
              modelLabel: entry.label,
              provider: provider?.label || kind,
              ...(thinkingMode ? { thinking: thinkingMode } : {}),
            }
            let parsedJson: unknown
            if (wantJson && text.trim()) {
              try {
                parsedJson = extractJson(text)
              } catch {
                // 保留原始文本，让客户端按 action 协议报错/修复；不要把 provider 的原始 JSON 丢掉。
                parsedJson = undefined
              }
            }
            res.end(
              JSON.stringify({
                ok: true,
                ...(wantJson ? { json: parsedJson } : {}),
                text,
                toolCalls,
                finishReason: j?.choices?.[0]?.finish_reason,
                usage: j?.usage,
                ...meta,
              }),
            )
          } catch (e: any) {
            res.statusCode = 500
            res.end(JSON.stringify({ ok: false, message: e?.message || String(e) }))
          }
          return
        }

        // ---- 场景草稿：agent 分片写代码的临时文件 ----
        if (url.startsWith('/api/scene-draft')) {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          try {
            if (req.method === 'GET') {
              const id = new URL(req.url || '', 'http://x').searchParams.get('id') || ''
              res.end(JSON.stringify({ ok: true, ...draftText(id) }))
              return
            }
            if (req.method !== 'POST') {
              res.statusCode = 405
              res.end(JSON.stringify({ ok: false, message: '只支持 POST' }))
              return
            }
            const body = await readJson(req)
            const action = url.slice('/api/scene-draft'.length).replace(/^\/+/, '')
            if (action === 'begin') {
              res.end(JSON.stringify({ ok: true, draft: beginDraft(body, root) }))
              return
            }
            if (action === 'append') {
              res.end(JSON.stringify({ ok: true, draft: appendDraft(body.id, body.chunk) }))
              return
            }
            if (action === 'read') {
              res.end(JSON.stringify({ ok: true, ...readDraft(body.id, body.startLine, body.endLine) }))
              return
            }
            if (action === 'patch') {
              res.end(JSON.stringify({ ok: true, draft: patchDraft(body.id, body.startLine, body.endLine, body.text) }))
              return
            }
            if (action === 'commit') {
              res.end(JSON.stringify({ ok: true, ...commitDraft(body.id) }))
              return
            }
            if (action === 'discard' || action === 'close') {
              res.end(JSON.stringify({ ok: true, ...discardDraft(body.id) }))
              return
            }
            res.statusCode = 404
            res.end(JSON.stringify({ ok: false, message: '未知的草稿接口' }))
          } catch (e: any) {
            res.statusCode = e?.code === 'not-found' ? 404 : 400
            res.end(JSON.stringify({ ok: false, message: e?.message || String(e) }))
          }
          return
        }

        // ---- Blender 渲染宿主：健康检查 / 提交 / 进度 / 取消 ----
        if (url.startsWith('/api/blender/')) {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          const action = url.slice('/api/blender/'.length)
          try {
            if (action === 'health') {
              const refresh = new URL(req.url || '', 'http://x').searchParams.get('refresh') === '1'
              res.end(JSON.stringify(await blenderHealth({ refresh })))
              return
            }
            if (action === 'render') {
              if (req.method !== 'POST') {
                res.statusCode = 405
                res.end(JSON.stringify({ ok: false, message: '只支持 POST' }))
                return
              }
              const body = await readJson(req)
              const job = await submitRenderJob(body, root)
              res.end(JSON.stringify({ ok: true, job }))
              return
            }
            if (action === 'progress') {
              const id = new URL(req.url || '', 'http://x').searchParams.get('id') || ''
              const job = getRenderJob(id)
              if (!job) throw new Error('作业不存在或已清理')
              res.end(JSON.stringify({ ok: true, job }))
              return
            }
            if (action === 'jobs') {
              res.end(JSON.stringify({ ok: true, jobs: listRenderJobs() }))
              return
            }
            if (action === 'cancel') {
              if (req.method !== 'POST') {
                res.statusCode = 405
                res.end(JSON.stringify({ ok: false, message: '只支持 POST' }))
                return
              }
              const body = await readJson(req)
              const job = cancelRenderJob(String(body.id || ''))
              if (!job) throw new Error('作业不存在')
              res.end(JSON.stringify({ ok: true, job }))
              return
            }
            res.statusCode = 404
            res.end(JSON.stringify({ ok: false, message: '未知的 Blender 接口' }))
          } catch (e: any) {
            res.statusCode = 400
            res.end(JSON.stringify({ ok: false, message: e?.message || String(e) }))
          }
          return
        }

        // ---- 保存浏览器录制的调度视频（webm）+ 抽帧 ----
        if (url === '/api/save-video') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          if (req.method !== 'POST') {
            res.statusCode = 405
            res.end(JSON.stringify({ ok: false, message: '只支持 POST' }))
            return
          }
          try {
            const body = await readJson(req)
            const dataUrl = String(body.dataUrl || '')
            const duration = Number(body.duration) || 0
            const m = dataUrl.match(/^data:video\/(webm|mp4);base64,(.+)$/)
            if (!m) throw new Error('dataUrl 不是视频')
            const dir = path.join(root, 'public', 'videos')
            fs.mkdirSync(dir, { recursive: true })
            const stamp = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`
            const src = path.join(dir, `schedule-${stamp}.webm`)
            fs.writeFileSync(src, Buffer.from(m[2], 'base64'))
            // 转 mp4：webm 在 Safari/剪辑软件里兼容性差，转失败就退回 webm
            const mp4 = path.join(dir, `schedule-${stamp}.mp4`)
            let out = `/videos/schedule-${stamp}.webm`
            try {
              const args = ['-y', '-i', src, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart']
              if (duration > 0) args.push('-t', String(duration))
              args.push(mp4)
              await runFfmpeg(args)
              if (fs.existsSync(mp4) && fs.statSync(mp4).size > 1024) {
                try {
                  fs.unlinkSync(src)
                } catch {
                  /* 源文件删不掉无所谓 */
                }
                out = `/videos/schedule-${stamp}.mp4`
              }
            } catch {
              /* 保留 webm */
            }
            res.end(JSON.stringify({ ok: true, url: out }))
          } catch (e: any) {
            res.statusCode = 400
            res.end(JSON.stringify({ ok: false, message: e?.message || String(e) }))
          }
          return
        }

        // ---- 从视频抽关键帧（调度视频 → 出片参考图）----
        if (url === '/api/frames') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          if (req.method !== 'POST') {
            res.statusCode = 405
            res.end(JSON.stringify({ ok: false, message: '只支持 POST' }))
            return
          }
          try {
            const body = await readJson(req)
            const rel = String(body.video || '')
            const local = rel.startsWith('/') ? path.join(root, 'public', rel.replace(/^\//, '')) : rel
            if (!local || !fs.existsSync(local)) throw new Error('视频不存在')
            const count = Math.min(6, Math.max(2, Number(body.count) || 3))
            const dur = await probeDuration(local).catch(() => 0)
            const times =
              Array.isArray(body.times) && body.times.length
                ? body.times.map(Number)
                : Array.from({ length: count }, (_, i) =>
                    Math.max(0.05, (dur || 3) * (count === 1 ? 0 : i / (count - 1)) * 0.92),
                  )
            const dir = path.join(root, 'public', 'generated')
            fs.mkdirSync(dir, { recursive: true })
            const urls: string[] = []
            const usedTimes: number[] = []
            for (const [i, t] of times.entries()) {
              const safeT = Math.max(0, Math.min(Number(t) || 0, Math.max(0, (dur || 3) - 0.05)))
              const name = `sched-${Date.now()}-${i}-${crypto.randomBytes(2).toString('hex')}.jpg`
              const out = path.join(dir, name)
              try {
                await runFfmpeg(['-y', '-ss', String(safeT), '-i', local, '-frames:v', '1', '-q:v', '2', out])
                if (fs.existsSync(out) && fs.statSync(out).size > 512) {
                  urls.push(`/generated/${name}`)
                  usedTimes.push(Math.round(safeT * 100) / 100)
                }
              } catch {
                /* 时间点可能落在最后一帧之后；跳过这一帧，别让整次抽帧失败 */
              }
            }
            if (urls.length === 0) throw new Error('抽帧失败')
            res.end(JSON.stringify({ ok: true, urls, duration: Math.round(dur * 100) / 100, times: usedTimes }))
          } catch (e: any) {
            res.statusCode = 400
            res.end(JSON.stringify({ ok: false, message: e?.message || String(e), urls: [] }))
          }
          return
        }

        // ---- 压缩包导入：解包到系统临时目录，返回清单 ----
        if (url.startsWith('/api/import/bundle')) {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          try {
            // GET /api/import/bundle/:id/file/:fileId —— 读临时目录内的图片
            const tail = url.slice('/api/import/bundle'.length).replace(/^\/+/, '')
            if (req.method === 'GET' && tail) {
              const parts = tail.split('/').filter(Boolean)
              if (parts.length !== 3 || parts[1] !== 'file') {
                res.statusCode = 404
                res.end(JSON.stringify({ ok: false, message: '没有这个接口' }))
                return
              }
              const got = readBundleFile(decodeURIComponent(parts[0]), decodeURIComponent(parts[2]))
              if (!got) {
                res.statusCode = 404
                res.end(JSON.stringify({ ok: false, message: '文件不存在或已过期' }))
                return
              }
              const ct = /\.png$/i.test(got.file.name)
                ? 'image/png'
                : /\.webp$/i.test(got.file.name)
                  ? 'image/webp'
                  : /\.gif$/i.test(got.file.name)
                    ? 'image/gif'
                    : 'image/jpeg'
              res.setHeader('Content-Type', ct)
              res.setHeader('Cache-Control', 'no-store')
              res.end(got.bytes)
              return
            }

            if (req.method === 'DELETE' && tail) {
              const removed = cleanupBundle(decodeURIComponent(tail.split('/')[0]))
              res.end(JSON.stringify({ ok: true, removed }))
              return
            }

            if (req.method === 'POST' && !tail) {
              // 二进制直传：与 /api/deliverables/import 一致，避免 base64 膨胀
              const chunks: Buffer[] = []
              let size = 0
              await new Promise<void>((resolve, reject) => {
                req.on('data', (c: Buffer) => {
                  size += c.length
                  if (size > MAX_BUNDLE_BYTES) {
                    reject(new Error(`压缩包超过 ${Math.round(MAX_BUNDLE_BYTES / 1024 / 1024)}MB 上限`))
                    req.destroy()
                    return
                  }
                  chunks.push(c)
                })
                req.on('end', () => resolve())
                req.on('error', reject)
              })
              const bytes = Buffer.concat(chunks)
              if (!bytes.length) throw new Error('上传内容为空')
              const result = openBundle(bytes)
              res.end(JSON.stringify({ ok: true, ...result }))
              return
            }

            res.statusCode = 405
            res.end(JSON.stringify({ ok: false, message: '只支持 POST 上传、GET 取文件、DELETE 清理' }))
          } catch (e: any) {
            res.statusCode = 400
            res.end(JSON.stringify({ ok: false, message: e?.message || String(e) }))
          }
          return
        }

        // ---- 在线素材库：来源、检索、导入与来源元数据 ----
        if (url.startsWith('/api/stock/')) {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          const stockSettings = getAppSettings().stock
          // 与其它渠道一致：设置库没填时读 .env / 环境变量
          const stockEnv = {
            PEXELS_API_KEY: readEnvKey('PEXELS_API_KEY') || '',
            PIXABAY_API_KEY: readEnvKey('PIXABAY_API_KEY') || '',
            OPENVERSE_API_KEY: readEnvKey('OPENVERSE_API_KEY') || '',
          }
          const fail = (e: any, fallbackStatus = 502) => {
            const isStock = e instanceof StockError
            const kind = isStock ? e.kind : 'provider'
            const status =
              kind === 'bad-request' || kind === 'expired'
                ? 400
                : kind === 'auth'
                  ? 401
                  : kind === 'too-large' || kind === 'unsupported-type'
                    ? 400
                    : kind === 'not-found'
                      ? 404
                      : fallbackStatus
            res.statusCode = status
            res.end(JSON.stringify({ ok: false, kind, message: sanitizeError(e) }))
          }

          try {
            if (url === '/api/stock/providers' && req.method === 'GET') {
              res.end(JSON.stringify({ ok: true, providers: describeStockProviders(stockSettings, stockEnv) }))
              return
            }

            if (url === '/api/stock/search' && req.method === 'GET') {
              const q = new URL(req.url || '', 'http://x').searchParams
              const result = await searchStockItems({
                provider: q.get('provider') || '',
                mediaType: q.get('type') || '',
                query: q.get('q') || '',
                page: q.get('page') ? Number(q.get('page')) : undefined,
                perPage: q.get('perPage') ? Number(q.get('perPage')) : undefined,
                orientation: q.get('orientation') || '',
                settings: stockSettings,
                env: stockEnv,
              })
              res.end(JSON.stringify({ ok: true, ...result }))
              return
            }

            if (url === '/api/stock/import' && req.method === 'POST') {
              const body = await readJson(req)
              // 只接受令牌；显式拒绝客户端提交的地址类参数，避免变成开放代理
              if (body?.url || body?.path || body?.downloadUrl || body?.sourceUrl) {
                res.statusCode = 400
                res.end(JSON.stringify({ ok: false, kind: 'bad-request', message: '导入只接受检索令牌，不接受下载地址' }))
                return
              }
              const project = safeProjectName(String(body?.project || '').trim())
              const dbRoot = resolveRoot(root)
              const result = await importStockItem({
                token: String(body?.token || ''),
                project,
                root: dbRoot,
                settings: stockSettings,
                env: stockEnv,
              })
              res.end(JSON.stringify({ ok: true, ...result }))
              return
            }

            if (url === '/api/stock/meta' && req.method === 'GET') {
              const q = new URL(req.url || '', 'http://x').searchParams
              const project = safeProjectName(String(q.get('project') || '').trim())
              const meta = stockMetaForUrl(resolveRoot(root), project, String(q.get('url') || ''))
              res.end(JSON.stringify({ ok: true, meta }))
              return
            }

            res.statusCode = 404
            res.end(JSON.stringify({ ok: false, kind: 'not-found', message: '未知的在线素材接口' }))
          } catch (e: any) {
            fail(e)
          }
          return
        }

        // ---- 项目可用素材（给素材卡选地址用，免手填）----
        if (url === '/api/media') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          try {
            const q = new URL(req.url || '', 'http://x').searchParams
            const name = q.get('name') || ''
            const scan = (dir: string, exts: RegExp, limit: number) => {
              const full = path.join(root, 'public', dir)
              if (!fs.existsSync(full)) return []
              return fs
                .readdirSync(full)
                .filter((f) => exts.test(f))
                .map((f) => {
                  const st = fs.statSync(path.join(full, f))
                  return { name: f, url: `/${dir}/${f}`, size: st.size, mtime: st.mtimeMs }
                })
                .sort((a, b) => b.mtime - a.mtime)
                .slice(0, limit)
            }
            let projectImages: ReturnType<typeof scan> = []
            if (name) {
              try {
                projectImages = listProjectImages(root, name, 120)
              } catch {
                projectImages = []
              }
            }
            const images = [...projectImages, ...scan('generated', /\.(png|jpe?g|webp)$/i, 120)]
              .sort((a, b) => b.mtime - a.mtime)
              .slice(0, 120)
            const videos = scan('videos', /\.(mp4|mov|webm)$/i, 60)
            let assets: unknown[] = []
            if (name) {
              try {
                const proj = readProject(resolveRoot(root), name)
                assets = proj.assets ?? []
              } catch {
                assets = []
              }
            }
            res.end(JSON.stringify({ ok: true, images, videos, assets }))
          } catch (e: any) {
            res.statusCode = 500
            res.end(JSON.stringify({ ok: false, message: e?.message || String(e), images: [], videos: [], assets: [] }))
          }
          return
        }

        // ---- 保存前端生成的图片（俯视调度图等 dataURL）----
        if (url === '/api/save-image') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          if (req.method !== 'POST') {
            res.statusCode = 405
            res.end(JSON.stringify({ ok: false, message: '只支持 POST' }))
            return
          }
          try {
            const body = await readJson(req)
            const dataUrl = String(body.dataUrl || '')
            const m = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/)
            if (!m) throw new Error('dataUrl 格式不对')
            const ext = m[1] === 'jpeg' ? 'jpg' : m[1]
            const prefix = String(body.prefix || 'sheet').replace(/[^a-z0-9-]/gi, '') || 'sheet'
            const bytes = Buffer.from(m[2], 'base64')
            if (bytes.length > MAX_REF_BYTES) throw new Error('图片超过 30MB，无法保存')
            const projectName = String(body.project || '').trim()
            if (projectName) {
              const saved = saveProjectImage(root, safeProjectName(projectName), bytes, ext, prefix)
              res.end(JSON.stringify({ ok: true, url: saved.url }))
              return
            }
            const dir = path.join(root, 'public', 'generated')
            fs.mkdirSync(dir, { recursive: true })
            const name = `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.${ext}`
            fs.writeFileSync(path.join(dir, name), bytes)
            res.end(JSON.stringify({ ok: true, url: `/generated/${name}` }))
          } catch (e: any) {
            res.statusCode = 400
            res.end(JSON.stringify({ ok: false, message: e?.message || String(e) }))
          }
          return
        }

        // ---- 已生成的视频列表（给「挂载已有视频」用）----
        if (url === '/api/videos') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          try {
            const dir = path.join(root, 'public', 'videos')
            const list = fs.existsSync(dir)
              ? fs
                  .readdirSync(dir)
                  .filter((f) => /\.(mp4|mov|webm)$/i.test(f))
                  .map((f) => {
                    const st = fs.statSync(path.join(dir, f))
                    return { name: f, url: `/videos/${f}`, size: st.size, mtime: st.mtimeMs }
                  })
                  .sort((a, b) => b.mtime - a.mtime)
                  .slice(0, 80)
              : []
            res.end(JSON.stringify({ ok: true, videos: list }))
          } catch (e: any) {
            res.statusCode = 500
            res.end(JSON.stringify({ ok: false, message: e?.message || String(e), videos: [] }))
          }
          return
        }

        // ---- 可用音色 ----
        if (url === '/api/voices') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          try {
            const q = new URL(req.url || '', 'http://x').searchParams
            const list = await listVoices(q.get('modelKey') || '', q.get('refresh') === '1')
            res.end(JSON.stringify({ ok: true, ...list }))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ ok: false, message: (e as Error).message, voices: [] }))
          }
          return
        }

        // ---- 台词配音 ----
        // provider 目前只有 macOS 内置 say（ElevenLabs 需要 belt CLI + 账号，当前环境没有）。
        // 换引擎只需重写 synthesize()：接 ElevenLabs 时改成
        //   belt app run elevenlabs/text-to-dialogue --input '{"segments":[{"text":...,"voice":...}]}'
        if (url === '/api/voice') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          if (req.method !== 'POST') {
            res.statusCode = 405
            res.end(JSON.stringify({ ok: false, message: '只支持 POST' }))
            return
          }
          try {
            const body = await readJson(req)
            const text = String(body.text || '').trim()
            const hasLines = Array.isArray(body.lines) && body.lines.length > 0
            if (!text && !hasLines) {
              res.statusCode = 400
              res.end(JSON.stringify({ ok: false, message: '台词为空' }))
              return
            }
            if (text.length > 400) {
              res.statusCode = 400
              res.end(JSON.stringify({ ok: false, message: '单句台词过长（上限 400 字）' }))
              return
            }
            const voiceKey = String(body.modelKey || '').trim()
            const voice = String(body.voice || 'Tingting')
            const rate = Math.min(260, Math.max(110, Number(body.rate) || 180))
            const stamp = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`
            const sampleProject = String(body.project || '').trim()
            const attachProjectAudio = async (url: string) => {
              if (!sampleProject) return url
              const source = path.join(root, 'public', url.replace(/^\//, '').split('?')[0])
              const ext = path.extname(source) || '.mp3'
              const copied = copyIntoProjectMedia(root, sampleProject, source, `voice-sample-${stamp}${ext}`)
              return copied.url
            }

            await ensureFf()
            const t0 = Date.now()
            const outDir = path.join(root, 'public', 'voices')
            fs.mkdirSync(outDir, { recursive: true })

            // 一镜多说话人：每行各自合成，再拼成一条音轨
            const lines = Array.isArray(body.lines) ? body.lines.slice(0, 12) : []
            if (lines.length > 0) {
              const parts: { file: string; seconds: number; engine: string }[] = []
              const applied = new Set<string>()
              const unsupported = new Set<string>()
              for (let i = 0; i < lines.length; i++) {
                const t = String(lines[i]?.text || '').trim()
                if (!t) continue
                if (t.length > 400) throw new Error(`第 ${i + 1} 句台词过长（上限 400 字）`)
                const v = String(lines[i]?.voice || voice)
                const r = Math.min(260, Math.max(110, Number(lines[i]?.rate) || rate))
                const one = await synthesize(t, v, r, outDir, `${stamp}-${i}`, voiceKey, lines[i], true)
                for (const k of one.applied ?? []) applied.add(k)
                for (const k of one.unsupported ?? []) unsupported.add(k)
                parts.push({
                  file: path.join(root, 'public', one.url.replace(/^\//, '')),
                  seconds: one.seconds,
                  engine: one.engine,
                })
              }
              if (parts.length === 0) throw new Error('没有可配音的台词')

              if (parts.length === 1) {
                const only = parts[0]
                res.end(
                  JSON.stringify({
                    ok: true,
                    url: `/${path.relative(path.join(root, 'public'), only.file).split(path.sep).join('/')}`,
                    engine: only.engine,
                    seconds: only.seconds,
                    lines: 1,
                    applied: [...applied],
                    unsupported: [...unsupported],
                    elapsed: Date.now() - t0,
                  }),
                )
                return
              }

              // 重编码拼接：不同 provider 的容器/编码可能不一样，直接 -c copy 会炸
              const merged = path.join(outDir, `${stamp}-mix.m4a`)
              const args: string[] = ['-y']
              for (const pt of parts) args.push('-i', pt.file)
              const streams = parts.map((_, i) => `[${i}:a]`).join('')
              args.push(
                '-filter_complex',
                `${streams}concat=n=${parts.length}:v=0:a=1[a]`,
                '-map', '[a]', '-c:a', 'aac', '-b:a', '128k', '-ar', '48000',
                merged,
              )
              await runFfmpeg(args)
              const total = await probeDuration(merged)
              res.end(
                JSON.stringify({
                  ok: true,
                  url: `/voices/${path.basename(merged)}`,
                  engine: parts[0].engine,
                  seconds: total,
                  lines: parts.length,
                  applied: [...applied],
                  unsupported: [...unsupported],
                  elapsed: Date.now() - t0,
                }),
              )
              return
            }

            const result = await synthesize(text, voice, rate, outDir, stamp, voiceKey, body.performance, true)
            const finalUrl = await attachProjectAudio(result.url)
            res.end(
              JSON.stringify({
                ok: true,
                url: finalUrl,
                engine: result.engine,
                seconds: result.seconds,
                applied: result.applied ?? [],
                unsupported: result.unsupported ?? [],
                elapsed: Date.now() - t0,
              }),
            )
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ ok: false, message: (e as Error).message }))
          }
          return
        }

        // ---- 口型：外部 provider + 本地抽帧验收 ----
        if (url === '/api/lipsync') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          if (req.method !== 'POST') {
            res.statusCode = 405
            res.end(JSON.stringify({ ok: false, message: '只支持 POST' }))
            return
          }
          try {
            const body = await readJson(req)
            const config = normalizeLipSyncSettings(getAppSettings().lipSync)
            if (config.provider !== 'sync-labs') {
              res.statusCode = 400
              res.end(JSON.stringify({ ok: false, message: '口型 provider 未配置' }))
              return
            }
            const apiKey = String(config.apiKey || '').trim() || readEnvKey('SYNC_LABS_API_KEY')
            if (!apiKey) throw new Error('Sync Labs Key 未配置，去设置页填写')
            const project = String(body.project || '').trim()
            if (!project) throw new Error('缺少项目名')
            const video = localMediaFile(root, String(body.video || ''))
            const audio = localMediaFile(root, String(body.audio || ''))
            const stamp = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`
            const tmp = path.join(root, 'public', 'videos', `lipsync-${stamp}.mp4`)
            const result = await runSyncLabs({
              baseUrl: config.baseUrl,
              apiKey,
              videoFile: video,
              audioFile: audio,
              outputFile: tmp,
              model: String(body.model || 'lipsync-2'),
            })
            const copied = copyIntoProjectMedia(root, project, result.outputFile, `lipsync-${stamp}.mp4`)
            try {
              fs.unlinkSync(tmp)
            } catch {
              /* 临时文件删不掉不影响结果 */
            }
            res.end(
              JSON.stringify({
                ok: true,
                provider: 'sync-labs',
                outputVideo: copied.url,
                jobId: result.jobId,
              }),
            )
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ ok: false, message: (e as Error).message }))
          }
          return
        }

        if (url === '/api/lipsync/qa') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          if (req.method !== 'POST') {
            res.statusCode = 405
            res.end(JSON.stringify({ ok: false, message: '只支持 POST' }))
            return
          }
          try {
            const body = await readJson(req)
            const video = localMediaFile(root, String(body.video || ''))
            const audio = body.audio ? localMediaFile(root, String(body.audio)) : undefined
            const stamp = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`
            const outDir = path.join(root, 'public', 'lipsync-qa', stamp)
            const ff = await ensureFf()
            const result = await analyzeLipSync({
              video,
              audio,
              outDir,
              ffmpeg: ff.bin,
              ffprobe: ffProbe(),
              noise: body.noise || '-35dB',
              minSilence: Number(body.minSilence) || 0.35,
            })
            const frames = result.frames.map((frame) => ({
              ...frame,
              path: `/lipsync-qa/${stamp}/${path.basename(frame.path)}`,
            }))
            res.end(JSON.stringify({ ok: true, ...result, frames }))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ ok: false, message: (e as Error).message }))
          }
          return
        }

        // ---- 发布：平台能力 / 健康 / 账号 / 预检 / 任务 / 发布包 ----
        if (url === '/api/publish' || url.startsWith('/api/publish/')) {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          const pubRoot = resolveRoot(root)
          const q = new URL(req.url || '', 'http://x')
          const tail = url.slice('/api/publish'.length).replace(/^\/+/, '')
          try {
            if (req.method === 'GET' && tail === 'platforms') {
              res.end(
                JSON.stringify({
                  ok: true,
                  platforms: listPlatforms(),
                  adapters: listAdapters(),
                  browserAvailable: chromeAvailable(),
                }),
              )
              return
            }

            if (req.method === 'GET' && tail === 'health') {
              const chromePath = resolveChrome()
              const ff = await ensureFf().catch(() => null)
              const adapterReady = listAdapters()
                .filter((a) => a.verified && !a.manualOnly)
                .map((a) => a.platform)
              res.end(
                JSON.stringify({
                  ok: true,
                  browserAvailable: Boolean(chromePath),
                  chromePath,
                  // 无桌面时浏览器只能无头跑：能校验会话、能上传草稿，但不能扫码登录
                  desktopAvailable: hasDisplay(),
                  loginHint: hasDisplay() ? '' : NO_DISPLAY_HINT,
                  ffmpegAvailable: Boolean(ff && fs.existsSync(ff.bin)),
                  ffmpegPath: ff?.bin || '',
                  adapterReady,
                  adapterUnverified: listAdapters().filter((a) => !a.verified).map((a) => a.platform),
                  profilesRoot: profilesRoot(pubRoot),
                  // 草稿/人工验证场景留给用户的窗口数量
                  keptOpenWindows: keptOpenWindowCount(),
                }),
              )
              return
            }

            // 关闭为人工确认留着的浏览器窗口
            if (req.method === 'POST' && tail === 'windows/close') {
              const closed = await closeKeptOpenWindows()
              res.end(JSON.stringify({ ok: true, closed }))
              return
            }

            if (tail === 'accounts') {
              if (req.method === 'GET') {
                res.end(JSON.stringify({ ok: true, accounts: listAccounts(pubRoot) }))
                return
              }
              if (req.method === 'POST') {
                const body = await readJson(req)
                const account = upsertAccount(pubRoot, body)
                res.end(JSON.stringify({ ok: true, account }))
                return
              }
            }

            if (req.method === 'POST' && tail === 'accounts/connect') {
              if (!chromeAvailable()) {
                res.statusCode = 400
                res.end(JSON.stringify({ ok: false, message: '本机没有可用的 Chrome，无法自动发布；请改用导出发布包' }))
                return
              }
              const body = await readJson(req)
              const platform = getPlatform(body.platform)
              // 已绑定的平台复用同一个账号与 profile；否则每次连接都新建空目录，
              // 上次的登录态就丢了（聊天里连接时尤其容易踩到）
              const existing = body.accountId
                ? getAccount(pubRoot, String(body.accountId))
                : findAccountByPlatform(pubRoot, platform.id)
              const account = upsertAccount(pubRoot, {
                id: existing?.id,
                platform: platform.id,
                label: body.label || existing?.label || platform.label,
                status: 'unknown',
                keepAutoDraft: existing?.autoDraft,
              })
              const job = startLogin({
                platform: platform.id,
                accountId: account!.id,
                profileDir: accountProfileDir(pubRoot, account!.id),
                url: body.url || platform.backendUrl,
                timeoutMs: Number(body.timeoutMs) || undefined,
                // 重新登录必须由用户点「我已完成登录」：已存在的 cookie 会让自动判定秒过
                requireConfirm: Boolean(existing),
                // 结果直接落库，不依赖谁在轮询——聊天发起的连接没人 GET 也要生效
                onResult: (result: { status: string; message: string }) => {
                  if (!account?.id) return
                  if (result.status === 'done') {
                    setAccountStatus(pubRoot, account.id, 'connected', result.message)
                  } else if (result.status === 'cancelled') {
                    setAccountStatus(pubRoot, account.id, 'unknown', '登录已取消')
                  }
                },
              })
              res.end(JSON.stringify({ ok: true, login: job, account }))
              return
            }

            if (req.method === 'GET' && tail.startsWith('accounts/connect/')) {
              const id = tail.slice('accounts/connect/'.length)
              const job = getSession(id)
              if (!job) {
                res.statusCode = 404
                res.end(JSON.stringify({ ok: false, message: '登录会话不存在或已过期' }))
                return
              }
              if (job.status === 'done' && job.accountId) {
                setAccountStatus(pubRoot, job.accountId, 'connected', job.message)
              } else if (job.status === 'cancelled' && job.accountId) {
                setAccountStatus(pubRoot, job.accountId, 'unknown', '登录已取消')
              }
              res.end(JSON.stringify({ ok: true, login: job, account: job.accountId ? getAccount(pubRoot, job.accountId) : null }))
              return
            }

            // 用户完成扫码后点「我已完成登录」：判定仍以平台会话为准
            if (req.method === 'POST' && /^accounts\/connect\/[^/]+\/confirm$/.test(tail)) {
              const id = tail.split('/')[2]
              const job = confirmLogin(id)
              if (!job) {
                res.statusCode = 404
                res.end(JSON.stringify({ ok: false, message: '登录会话不存在或已过期' }))
                return
              }
              res.end(JSON.stringify({ ok: true, login: job }))
              return
            }

            // 取消登录：用户关掉弹窗时不能把浏览器窗口和一个活跃会话留在后台
            if (req.method === 'DELETE' && tail.startsWith('accounts/connect/')) {
              const id = tail.slice('accounts/connect/'.length)
              const job = cancelLogin(id)
              if (!job) {
                res.statusCode = 404
                res.end(JSON.stringify({ ok: false, message: '登录会话不存在或已过期' }))
                return
              }
              res.end(JSON.stringify({ ok: true, login: job }))
              return
            }

            if (req.method === 'POST' && /^accounts\/[^/]+\/check$/.test(tail)) {
              const id = tail.split('/')[1]
              const account = getAccountInternal(pubRoot, id)
              if (!account) {
                res.statusCode = 404
                res.end(JSON.stringify({ ok: false, message: '账号不存在' }))
                return
              }
              if (!chromeAvailable()) {
                res.end(JSON.stringify({ ok: true, status: 'unknown', message: '本机没有可用的 Chrome' }))
                return
              }
              const platform = getPlatform(account.platform)
              // 先认会话 cookie 再退回 DOM 判定，避免「地址不含 login」被误判成已登录
              const result = await checkSession({
                profileDir: account.profileDir,
                url: platform.backendUrl,
                isLoggedIn: adapterLoginProbe(account.platform),
              })
              const updated = setAccountStatus(pubRoot, id, result.status as any, result.message)
              res.end(JSON.stringify({ ok: true, status: result.status, message: result.message, account: updated.account }))
              return
            }

            if (req.method === 'DELETE' && /^accounts\/[^/]+$/.test(tail)) {
              const id = tail.split('/')[1]
              const ok = deleteAccount(pubRoot, id)
              res.end(JSON.stringify({ ok, accounts: listAccounts(pubRoot) }))
              return
            }

            if (req.method === 'POST' && tail === 'preflight') {
              const body = await readJson(req)
              const deliverable = body.deliverableId
                ? getDeliverable(pubRoot, String(body.deliverableId))
                : null
              const accounts = new Map(listAccounts(pubRoot).map((a) => [a.id, a]))
              // 只取服务端自己的能力表，忽略请求里的 limits
              const config = normalizeDeliverableConfig(body.config || deliverable?.config || {})
              const result = runPreflight({
                appRoot: root,
                projectsRoot: pubRoot,
                deliverable,
                targets: Array.isArray(body.targets) ? body.targets : [],
                config,
                accounts,
              })
              res.end(JSON.stringify({ ...result, ok: true }))
              return
            }

            // ---- 提交意图：助手暂存，用户确认才建任务 ----
            if (req.method === 'POST' && tail === 'intents') {
              const body = await readJson(req)
              try {
                const intent = stageIntent(pubRoot, {
                  deliverableId: String(body.deliverableId || ''),
                  targets: Array.isArray(body.targets) ? body.targets : [],
                  config: body.config,
                  source: body.source === 'assistant' ? 'assistant' : 'manual',
                  appRoot: root,
                })
                res.end(JSON.stringify({ ok: true, intent }))
              } catch (e) {
                res.statusCode = 400
                res.end(
                  JSON.stringify({
                    ok: false,
                    code: (e as any)?.code || 'intent_stage_failed',
                    message: sanitizeError(e),
                  }),
                )
              }
              return
            }

            if (tail.startsWith('intents/')) {
              const rest = tail.slice('intents/'.length)
              const [id, sub] = rest.split('/')
              if (req.method === 'GET' && !sub) {
                const intent = getIntent(pubRoot, id)
                if (!intent) {
                  res.statusCode = 404
                  res.end(JSON.stringify({ ok: false, message: '提交意图不存在' }))
                  return
                }
                res.end(JSON.stringify({ ok: true, intent }))
                return
              }
              if (req.method === 'POST' && sub === 'confirm') {
                const body = await readJson(req)
                try {
                  // 只接受 intentId；请求里的 config 仅用于证明「不是旧快照」
                  const r = confirmIntent(pubRoot, id, {
                    appRoot: root,
                    ...(body.config ? { config: body.config } : {}),
                  })
                  for (const job of r.jobs) {
                    if (job.reused) continue
                    enqueue(String(job.id || ''), { root: pubRoot, appRoot: root, projectsRoot: pubRoot })
                  }
                  res.end(JSON.stringify({ ok: true, ...r }))
                } catch (e) {
                  res.statusCode = 400
                  res.end(
                    JSON.stringify({
                      ok: false,
                      code: (e as any)?.code || 'intent_confirm_failed',
                      message: sanitizeError(e),
                      ...((e as any)?.preflight ? { preflight: (e as any).preflight } : {}),
                    }),
                  )
                }
                return
              }
              if (req.method === 'POST' && sub === 'cancel') {
                const intent = cancelIntent(pubRoot, id)
                if (!intent) {
                  res.statusCode = 404
                  res.end(JSON.stringify({ ok: false, message: '提交意图不存在' }))
                  return
                }
                res.end(JSON.stringify({ ok: true, intent }))
                return
              }
            }

            if (req.method === 'POST' && tail === 'jobs') {
              const body = await readJson(req)
              const deliverable = getDeliverable(pubRoot, String(body.deliverableId || ''))
              if (!deliverable) {
                res.statusCode = 400
                res.end(JSON.stringify({ ok: false, message: '成片不存在' }))
                return
              }
              const config = normalizeDeliverableConfig(body.config || deliverable.config)
              const targets = Array.isArray(body.targets) ? body.targets : []
              const accounts = new Map(listAccounts(pubRoot).map((a) => [a.id, a]))
              const pre = runPreflight({
                appRoot: root,
                projectsRoot: pubRoot,
                deliverable,
                targets,
                config,
                accounts,
              })
              // 发布包不走任务，它由 /packages 直接生成
              const jobTargets = targets.filter((t: any) => (t.mode || 'draft') !== 'package')
              if (!pre.ok) {
                res.statusCode = 400
                res.end(JSON.stringify({ ok: false, message: '预检未通过', preflight: pre }))
                return
              }
              const created = []
              for (const t of jobTargets) {
                const r = createJob(pubRoot, {
                  deliverableId: deliverable.id,
                  project: deliverable.project,
                  episode: deliverable.episode,
                  platform: t.platform,
                  accountId: t.accountId || '',
                  mode: t.mode || 'draft',
                  deliverableUrl: deliverable.url,
                  payload: { auto: Boolean(body.auto), source: 'manual', aiGenerated: config.master.aiGenerated },
                  republish: Boolean(body.republish),
                })
                created.push({ ...r.job, reused: r.reused })
                if (!r.reused && r.job) {
                  if (body.auto) {
                    // 导出后自动触发只允许草稿
                    if ((t.mode || 'draft') !== 'draft') {
                      transitionJob(pubRoot, r.job.id, 'failed', {
                        stage: 'auto',
                        errorCode: 'auto_requires_draft',
                        errorMessage: '自动流程只能保存草稿',
                      })
                      continue
                    }
                  }
                  enqueue(r.job.id, { root: pubRoot, appRoot: root, projectsRoot: pubRoot })
                }
              }
              res.end(JSON.stringify({ ok: true, jobs: created }))
              return
            }

            if (req.method === 'GET' && tail === 'jobs') {
              const project = q.searchParams.get('project') || ''
              const episode = Number(q.searchParams.get('episode')) || 0
              const jobs = listJobs(pubRoot, {
                project,
                episode,
                deliverableId: q.searchParams.get('deliverableId') || '',
                active: q.searchParams.get('active') === '1',
              })
              res.end(JSON.stringify({ ok: true, jobs, summary: jobSummary(pubRoot, { project, episode }) }))
              return
            }

            if (tail.startsWith('jobs/')) {
              const rest = tail.slice('jobs/'.length)
              const [id, sub] = rest.split('/')
              if (req.method === 'GET' && !sub) {
                const job = getJobWithEvents(pubRoot, id)
                if (!job) {
                  res.statusCode = 404
                  res.end(JSON.stringify({ ok: false, message: '任务不存在' }))
                  return
                }
                res.end(JSON.stringify({ ok: true, job }))
                return
              }
              if (req.method === 'POST' && sub === 'cancel') {
                const r = cancel(id, pubRoot)
                res.end(JSON.stringify({ ok: true, ...r, job: getJob(pubRoot, id) }))
                return
              }
              if (req.method === 'POST' && sub === 'retry') {
                const cur = getJob(pubRoot, id)
                if (!cur) {
                  res.statusCode = 404
                  res.end(JSON.stringify({ ok: false, message: '任务不存在' }))
                  return
                }
                if (!RETRYABLE_STATES.includes(cur.state)) {
                  res.statusCode = 400
                  res.end(JSON.stringify({ ok: false, message: '当前状态不需要重试' }))
                  return
                }
                const r = createJob(pubRoot, {
                  deliverableId: cur.deliverableId,
                  project: cur.project,
                  episode: cur.episode,
                  platform: cur.platform,
                  accountId: cur.accountId,
                  mode: cur.mode,
                  deliverableUrl: cur.deliverableUrl,
                  payload: cur.payload,
                  republish: true,
                })
                if (r.job) enqueue(r.job.id, { root: pubRoot, appRoot: root, projectsRoot: pubRoot })
                res.end(JSON.stringify({ ok: true, job: r.job }))
                return
              }
              if (req.method === 'POST' && sub === 'mark-published') {
                const body = await readJson(req).catch(() => ({}))
                const job = markPublished(pubRoot, id, String(body.workUrl || ''))
                // 人工确认发布完成后，为人工操作留着的窗口就该收掉
                const closed = await closeKeptOpenWindows()
                res.end(JSON.stringify({ ok: true, job, windowsClosed: closed }))
                return
              }
              if (req.method === 'POST' && sub === 'continue') {
                // 人工完成验证后继续：重新入队
                const cur = getJob(pubRoot, id)
                if (!cur || cur.state !== 'awaiting_user') {
                  res.statusCode = 400
                  res.end(JSON.stringify({ ok: false, message: '只有等待人工验证的任务可以继续' }))
                  return
                }
                transitionJob(pubRoot, id, 'queued', { stage: 'queued', message: '用户已完成验证，重新排队' })
                enqueue(id, { root: pubRoot, appRoot: root, projectsRoot: pubRoot })
                res.end(JSON.stringify({ ok: true, job: getJob(pubRoot, id) }))
                return
              }
            }

            if (req.method === 'POST' && tail === 'packages') {
              const body = await readJson(req)
              const deliverable = getDeliverable(pubRoot, String(body.deliverableId || ''))
              if (!deliverable) {
                res.statusCode = 400
                res.end(JSON.stringify({ ok: false, message: '成片不存在' }))
                return
              }
              const result = await buildPublishPackage(root, {
                deliverable,
                config: normalizeDeliverableConfig(body.config || deliverable.config),
                platforms: Array.isArray(body.platforms) ? body.platforms : [],
                projectsRoot: pubRoot,
              })
              res.end(JSON.stringify({ ok: true, package: result }))
              return
            }

            res.statusCode = 404
            res.end(JSON.stringify({ ok: false, message: '未知发布接口' }))
          } catch (e: any) {
            res.statusCode = 400
            res.end(JSON.stringify({ ok: false, message: sanitizeError(e) }))
          }
          return
        }

        // ---- 成片版本：发布台的唯一发布对象 ----
        if (url === '/api/deliverables' || url.startsWith('/api/deliverables/')) {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          const tail = url.slice('/api/deliverables'.length).replace(/^\/+/, '')
          const q = new URL(req.url || '', 'http://x')
          const pubRoot = resolveRoot(root)
          try {
            if (req.method === 'GET' && !tail) {
              const project = q.searchParams.get('project') || ''
              if (!project) {
                res.statusCode = 400
                res.end(JSON.stringify({ ok: false, message: '缺少 project' }))
                return
              }
              const episode = Number(q.searchParams.get('episode')) || 0
              const deliverables = listDeliverables(pubRoot, { project, episode })
              res.end(JSON.stringify({ ok: true, deliverables }))
              return
            }

            if (req.method === 'POST' && tail === 'import') {
              const rawName = String(req.headers['x-file-name'] || 'import.mp4')
              const baseName = decodeURIComponent(rawName).replace(/^.*[\\/]/, '')
              const ext = path.extname(baseName).toLowerCase()
              if (ext !== '.mp4') {
                res.statusCode = 400
                res.end(JSON.stringify({ ok: false, message: '只支持导入 MP4' }))
                return
              }
              const project = String(q.searchParams.get('project') || '')
              if (!project) {
                res.statusCode = 400
                res.end(JSON.stringify({ ok: false, message: '缺少 project' }))
                return
              }
              const episode = Math.max(0, Math.floor(Number(q.searchParams.get('episode')) || 0))
              const importDir = path.join(root, 'public', 'exports', 'imports')
              fs.mkdirSync(importDir, { recursive: true })
              const stamp = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}.mp4`
              const outFile = path.join(importDir, stamp)
              const maxBytes = 2 * 1024 * 1024 * 1024

              const written = await new Promise<number>((resolve, reject) => {
                let bytes = 0
                const ws = fs.createWriteStream(outFile)
                req.on('data', (chunk: Buffer) => {
                  bytes += chunk.length
                  if (bytes > maxBytes) {
                    req.destroy()
                    ws.destroy()
                    reject(new Error('文件超过 2GB 上限'))
                    return
                  }
                  ws.write(chunk)
                })
                req.on('end', () => ws.end(() => resolve(bytes)))
                req.on('error', reject)
                ws.on('error', reject)
              }).catch((e) => {
                try { fs.rmSync(outFile, { force: true }) } catch { /* ignore */ }
                throw e
              })

              const probe = await probeMedia(outFile).catch(() => null)
              const probeDur = Number(probe?.duration)
              if (!probe || !(probeDur > 0)) {
                try { fs.rmSync(outFile, { force: true }) } catch { /* ignore */ }
                res.statusCode = 400
                res.end(JSON.stringify({ ok: false, message: '无法读取视频，文件可能已损坏' }))
                return
              }
              const rec = createDeliverable(pubRoot, {
                project,
                episode,
                title: baseName.replace(/\.mp4$/i, '').slice(0, 200),
                url: `/exports/imports/${stamp}`,
                width: probe.width,
                height: probe.height,
                duration: probeDur,
                bytes: written,
                source: 'import',
              })
              res.end(JSON.stringify({ ok: true, deliverable: rec }))
              return
            }

            if (tail) {
              const [id, sub] = tail.split('/')
              if (req.method === 'PATCH' && sub === 'config') {
                const body = await readJson(req)
                const rec = patchDeliverableConfig(pubRoot, id, body.config ?? body)
                if (!rec) {
                  res.statusCode = 404
                  res.end(JSON.stringify({ ok: false, message: '成片不存在' }))
                  return
                }
                res.end(JSON.stringify({ ok: true, deliverable: rec }))
                return
              }
              if (req.method === 'DELETE' && !sub) {
                const ok = deleteDeliverable(pubRoot, id)
                res.end(JSON.stringify({ ok }))
                return
              }
              if (req.method === 'GET' && !sub) {
                const rec = getDeliverable(pubRoot, id)
                if (!rec) {
                  res.statusCode = 404
                  res.end(JSON.stringify({ ok: false, message: '成片不存在' }))
                  return
                }
                res.end(JSON.stringify({ ok: true, deliverable: rec }))
                return
              }
            }

            res.statusCode = 405
            res.end(JSON.stringify({ ok: false, message: '不支持的方法或路径' }))
          } catch (e: any) {
            res.statusCode = 400
            res.end(JSON.stringify({ ok: false, message: e?.message || String(e) }))
          }
          return
        }

        // ---- animatic 合成：静帧 + 视频混编（同样走任务 + 轮询） ----
        if (url === '/api/assemble') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')

          if (req.method === 'GET') {
            const q = new URL(req.url || '', 'http://x').searchParams
            const job = exportJobs.get(q.get('id') || '')
            if (!job) {
              res.statusCode = 404
              res.end(JSON.stringify({ ok: false, message: '任务不存在', status: 'failed' }))
              return
            }
            res.end(JSON.stringify({ ok: true, ...job }))
            return
          }

          if (req.method !== 'POST') {
            res.statusCode = 405
            res.end(JSON.stringify({ ok: false, message: '只支持 POST / GET' }))
            return
          }
          const ff = await ensureFf()
          if (!fs.existsSync(ff.bin)) {
            res.statusCode = 500
            res.end(JSON.stringify({ ok: false, message: `未找到 ffmpeg：${ff.bin}` }))
            return
          }

          try {
            const body = await readJson(req)
            const segments = Array.isArray(body.segments) ? body.segments : []
            if (segments.length === 0) {
              res.statusCode = 400
              res.end(JSON.stringify({ ok: false, message: '没有镜头可合成' }))
              return
            }
            const resolution = ['480p', '720p', '1080p'].includes(String(body.resolution))
              ? (String(body.resolution) as '480p' | '720p' | '1080p')
              : '720p'
            const joins: ExportJoinInput[] = Array.isArray(body.joins)
              ? body.joins.map((j: any) =>
                  j?.mode === 'effect'
                    ? { mode: 'effect' as const, seconds: Number(j.seconds) || 0, xfade: String(j.xfade || 'fade') }
                    : { mode: 'cut' as const },
                )
              : []
            const captionStyle: CaptionStyleInput =
              body.captionStyle && typeof body.captionStyle === 'object' ? body.captionStyle : {}
            const captionMode: 'auto' | 'png' = body.captionMode === 'png' ? 'png' : 'auto'
            // 成片归属：缺项目或集时照常导出，只是不落成片记录（旧客户端兼容）
            let deliverableProject = ''
            try {
              if (body.project) deliverableProject = safeProjectName(String(body.project).trim())
            } catch {
              deliverableProject = ''
            }
            const deliverableEpisode = Math.max(0, Math.floor(Number(body.episode) || 0))
            const deliverableTitle = String(body.title || '').slice(0, 200)

            const id = `e-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`
            exportJobs.set(id, { status: 'running', startedAt: Date.now() })
            res.end(JSON.stringify({ ok: true, id }))

            ;(async () => {
              const t0 = Date.now()
              const exportRoot = resolveRoot(root)
              try {
                const outRoot = path.join(root, 'public', 'exports')
                fs.mkdirSync(outRoot, { recursive: true })
                const name = `animatic-${resolution}-${Date.now()}.mp4`
                const outFile = path.join(outRoot, name)
                const info = await buildAnimatic(
                  segments,
                  resolution,
                  root,
                  outFile,
                  joins,
                  captionStyle,
                  captionMode,
                )
                const [expW, expH] = EXPORT_SIZE[resolution]
                let deliverable: { id: string; version: number } | null = null
                if (deliverableProject && deliverableEpisode > 0) {
                  try {
                    const rec = createDeliverable(exportRoot, {
                      project: deliverableProject,
                      episode: deliverableEpisode,
                      title: deliverableTitle,
                      url: `/exports/${name}`,
                      srtUrl: info.srtFile ? `/exports/${path.basename(info.srtFile)}` : '',
                      width: expW,
                      height: expH,
                      duration: info.seconds,
                      bytes: fs.existsSync(outFile) ? fs.statSync(outFile).size : null,
                      source: 'export',
                    })
                    if (rec) {
                      deliverable = { id: rec.id, version: rec.version }
                      // 只有账号显式开启自动草稿才会排队；失败只写原因，不影响导出
                      try {
                        autoDraftOnExport({ dbRoot: exportRoot, appRoot: root, deliverable: rec })
                      } catch (err) {
                        console.warn('[publish] 自动草稿失败:', sanitizeError(err))
                      }
                    }
                  } catch (e) {
                    // 成片记录失败不影响导出结果本身
                    console.warn('[publish] 成片入库失败:', (e as Error).message)
                  }
                }
                exportJobs.set(id, {
                  status: 'succeeded',
                  url: `/exports/${name}`,
                  shots: info.shots,
                  transitions: info.transitions,
                  seconds: info.seconds,
                  voiced: info.voiced,
                  subbed: info.subbed,
                  captions: info.captions,
                  ...(info.srtFile ? { srtUrl: `/exports/${path.basename(info.srtFile)}` } : {}),
                  ...(deliverable ? { deliverable } : {}),
                  captionWarnings: info.captionWarnings,
                  overflows: info.overflows,
                  startedAt: t0,
                  elapsed: Date.now() - t0,
                })
              } catch (e) {
                exportJobs.set(id, {
                  status: 'failed',
                  message: (e as Error).message,
                  startedAt: t0,
                  elapsed: Date.now() - t0,
                })
              }
            })()
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ ok: false, message: (e as Error).message }))
          }
          return
        }

        // ---- 图生视频：提交方舟任务 + 服务端轮询 + 下载产物 ----
        if (url === '/api/seedance') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')

          if (req.method === 'GET') {
            const q = new URL(req.url || '', 'http://x').searchParams
            const id = q.get('id') || ''
            const job = videoJobs.get(id)
            if (!job) {
              res.statusCode = 404
              res.end(JSON.stringify({ ok: false, message: '任务不存在', status: 'failed' }))
              return
            }
            res.end(JSON.stringify({ ok: true, ...job }))
            return
          }

          if (req.method !== 'POST') {
            res.statusCode = 405
            res.end(JSON.stringify({ ok: false, message: '只支持 POST / GET' }))
            return
          }

          try {
            const body = await readJson(req)
            let image = String(body.image || '')
            // 参考图（reference_image）模式：1~4 张，多了截断（方舟上限）
            const refImages: string[] = Array.isArray(body.refImages)
              ? body.refImages.map((x: unknown) => String(x || '')).filter(Boolean).slice(0, 4)
              : []
            // 3D 调度视频参考（reference_video）：1~3 段
            const refVideos: string[] = Array.isArray(body.refVideos)
              ? body.refVideos.map((x: unknown) => String(x || '')).filter(Boolean).slice(0, 3)
              : []
            const generateAudio = Boolean(body.generateAudio)
            const audioRefInput = String(body.audioRef || '').trim()
            // 原生音频与首尾帧互斥：关键帧改走 reference_image，保持参考模式。
            if (generateAudio && image) {
              refImages.unshift(image)
              refImages.splice(4)
              image = ''
            }
            // 转场：关键帧是必填；边界帧由服务端按模型能力决定用不用
            const rawTransition = body.transition && typeof body.transition === 'object' ? body.transition : null
            const transition = rawTransition
              ? {
                  keyframe: String(rawTransition.keyframe || ''),
                  boundaryOut: String(rawTransition.boundaryOut || ''),
                  boundaryIn: String(rawTransition.boundaryIn || ''),
                }
              : null
            const transitionMode = Boolean(transition?.keyframe)
            if (generateAudio && transitionMode) {
              res.statusCode = 400
              res.end(JSON.stringify({ ok: false, message: '原生音频与首尾帧/生成转场互斥，请改用参考图模式或关闭原生音频', kind: 'bad-request' }))
              return
            }
            const videoRefMode = !transitionMode && refVideos.length > 0
            const refMode = !transitionMode && refImages.length > 0
            // 全模态参考（图 / 视频）与首帧互斥
            const referenceMode = refMode || videoRefMode
            if (rawTransition && !transitionMode) {
              res.statusCode = 400
              res.end(JSON.stringify({ ok: false, message: '生成转场视频前必须有已确认的关键帧', kind: 'bad-request' }))
              return
            }
            if (!image && !referenceMode && !transitionMode) {
              res.statusCode = 400
              res.end(JSON.stringify({ ok: false, message: '缺少首帧图片或参考图，请先生成画面或连线参考' }))
              return
            }

            const seconds = Math.min(12, Math.max(2, Math.round(Number(body.seconds) || 5)))
            const ratio = ['16:9', '9:16', '4:3', '1:1', '3:4', '21:9'].includes(String(body.ratio))
              ? String(body.ratio)
              : '16:9'
            const resolution = body.resolution === '720p' ? '720p' : '480p'
            const prompt = String(body.prompt || '').trim() || '镜头缓慢推进，环境细节自然流动，人物保持姿态'
            const cameraFixed = Boolean(body.cameraFixed)

            // 视频族解析：显式 key 在 video / videoRef 两族精确命中；视频参考必须由条目声明能力
            const wantKey = String(body.modelKey || '').trim()
            const pick = videoRefMode
              ? pickVideoModel(wantKey, { needVideoRef: true, refMode: true })
              : refMode
                ? pickVideoModel(wantKey, { refMode: true })
                : pickVideoModel(wantKey)
            if (pick.error) {
              res.statusCode = 400
              res.end(
                JSON.stringify({
                  ok: false,
                  kind: pick.error,
                  message:
                    pick.error === 'model-key-not-found'
                      ? `模型不存在：${wantKey || '（未选择）'}`
                      : `当前模型不支持视频参考，请选 Seedance 2.0/2.5（${pick.entry?.label || pick.entry?.model || '未命名'}）`,
                }),
              )
              return
            }
            const model = pick.entry?.model || (referenceMode ? effVideoRefModel() : effVideoModel())
            const provider = pick.provider
            const runKey = providerKey(provider)
            if (!runKey) {
              res.statusCode = 400
              res.end(
                JSON.stringify({
                  ok: false,
                  message: `渠道「${provider?.label || 'ark'}」没有 API Key，去设置页填一下`,
                  kind: 'no-key',
                }),
              )
              return
            }
            if (provider && provider.kind !== 'ark' && provider.kind !== 'apimart') {
              res.statusCode = 400
              res.end(
                JSON.stringify({
                  ok: false,
                  message: '视频出片目前只支持方舟或 APIMart 渠道，请在设置里选择对应渠道的视频模型',
                  kind: 'unsupported',
                }),
              )
              return
            }
            const base = String(provider?.baseUrl || 'https://ark.cn-beijing.volces.com/api/v3').replace(
              /\/+$/,
              '',
            )

            if (provider?.kind === 'apimart') {
              const family = videoFamilyFor(model)
              if (generateAudio && family !== 'seedance-2.5') {
                res.statusCode = 400
                res.end(JSON.stringify({ ok: false, message: '当前 APIMart 视频族未接入原生音频参考', kind: 'unsupported' }))
                return
              }
              if (generateAudio && seconds < 4) {
                res.statusCode = 400
                res.end(JSON.stringify({ ok: false, message: 'Seedance 2.5 原生音频最短 4 秒', kind: 'bad-request' }))
                return
              }
              if (generateAudio && !audioRefInput) {
                res.statusCode = 400
                res.end(JSON.stringify({ ok: false, message: '原生音频需要角色音色样本', kind: 'bad-request' }))
                return
              }
              if (!family) {
                res.statusCode = 400
                res.end(
                  JSON.stringify({
                    ok: false,
                    message: `视频模型「${model}」尚未接入 APIMart 运行时`,
                    kind: 'unsupported',
                  }),
                )
                return
              }

              const skipped: string[] = []
              const refUrls: string[] = []
              const refVideoUrls: string[] = []
              // 转场分流：关键帧永远作首帧；首尾帧模型再把 B 首帧当尾帧。
              // Seedance 2.5 上游禁止尾帧与 reference_image 混用，所以转场不送参考图。
              const tKeyframe = transition?.keyframe || ''
              const tIn = transition?.boundaryIn || ''
              const useLastFrame =
                Boolean(transition) &&
                (family === 'kling-v3' || family === 'seedance-2.5') &&
                Boolean(tIn)
              const firstSource = transition ? tKeyframe : image
              const lastSource = transition
                ? useLastFrame
                  ? tIn
                  : ''
                : String(body.lastFrame || '')
              const refSources = transition ? [] : refImages
              const effRefMode = transition ? false : refMode
              const effVideoRefMode = transition ? false : videoRefMode
              const effReferenceMode = effRefMode || effVideoRefMode
              const withFrames = transition ? true : !effReferenceMode
              const uploadApimartRef = async (ref: string, tag: string) => {
                const dataUrl = resolveRef(ref, root)
                if (/^https?:\/\//i.test(dataUrl)) return dataUrl
                const m = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/)
                if (!m) throw new ApimartError(`参考图格式不支持：${tag}`, { kind: 'bad-request' })
                const ext = /png/i.test(m[1]) ? 'png' : /webp/i.test(m[1]) ? 'webp' : 'jpg'
                const up = await uploadApimartImage({
                  baseUrl: base,
                  apiKey: runKey,
                  buffer: Buffer.from(m[2], 'base64'),
                  mime: m[1],
                  filename: `video-ref-${tag}.${ext}`,
                })
                return up.url
              }

              let firstFrame = ''
              let lastFrame = ''
              try {
                if (withFrames && firstSource) firstFrame = await uploadApimartRef(firstSource, 'first')
                if (withFrames && lastSource) lastFrame = await uploadApimartRef(lastSource, 'last')
                if (effRefMode) {
                  for (const r of refSources) {
                    try {
                      refUrls.push(await uploadApimartRef(r, `ref-${refUrls.length}`))
                    } catch {
                      skipped.push(r)
                    }
                  }
                  if (refUrls.length === 0) throw new ApimartError(`参考图都不可用：${skipped.join('、')}`, { kind: 'download' })
                }
                if (effVideoRefMode) {
                  for (const r of refVideos) {
                    const v = resolveVideoRef(r, root)
                    if (!v.external) {
                      throw new ApimartError('APIMart 视频参考只接受公网 URL；本地参考视频无法上传', { kind: 'unsupported' })
                    }
                    refVideoUrls.push(v.external)
                  }
                }
              } catch (e) {
                const err = e as ApimartError
                res.statusCode = 400
                res.end(
                  JSON.stringify({
                    ok: false,
                    message: err.message,
                    kind: err.kind || 'video-ref',
                  }),
                )
                return
              }

              let payload: Record<string, unknown>
              let nativeAudioUrl = ''
              try {
                if (generateAudio) nativeAudioUrl = await resolveApimartAudioRef(root, audioRefInput)
                payload = buildApimartVideoPayload({
                  family,
                  model,
                  prompt,
                  ratio,
                  seconds,
                  resolution,
                  firstFrame,
                  lastFrame,
                  referenceImages: refUrls,
                  referenceVideos: refVideoUrls,
                  audioUrl: nativeAudioUrl,
                  generateAudio,
                })
              } catch (e) {
                const err = e as ApimartError
                res.statusCode = 400
                res.end(JSON.stringify({ ok: false, message: err.message, kind: err.kind || 'bad-request' }))
                return
              }

              const mode = generateAudio ? 'native' : transitionMode ? 'transition' : videoRefMode ? 'video' : refMode ? 'ref' : 'first'
              if (body.dryRun) {
                res.end(
                  JSON.stringify({
                    ok: true,
                    id: 'dry-run',
                    mode,
                    family,
                    model,
                    skipped,
                    request: payload,
                  }),
                )
                return
              }

              const id = `v-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`
              const startedAt = Date.now()
              videoJobs.set(id, { status: 'running', startedAt })
              const outDir = path.join(root, 'public', 'videos')
              fs.mkdirSync(outDir, { recursive: true })
              res.end(JSON.stringify({ ok: true, id, mode, family, model, skipped, provider: provider.label }))

              ;(async () => {
                let taskId = ''
                try {
                  const submitted = await submitApimartVideo({ baseUrl: base, apiKey: runKey, payload })
                  taskId = submitted.taskId
                  const running = videoJobs.get(id)
                  if (running) running.taskId = taskId
                  const done = await pollApimartTask({ baseUrl: base, apiKey: runKey, taskId })
                  const videoUrl = videoUrlFromTask(done)
                  if (!videoUrl) throw new ApimartError('任务未返回视频地址', { kind: 'api' })
                  const dl = await downloadApimartResult({ url: videoUrl })
                  const name = `shot-vid-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.mp4`
                  fs.writeFileSync(path.join(outDir, name), dl.bytes)
                  videoJobs.set(id, {
                    status: 'succeeded',
                    url: `/videos/${name}`,
                    startedAt,
                    elapsed: Date.now() - startedAt,
                    taskId,
                  })
                } catch (e) {
                  videoJobs.set(id, {
                    status: 'failed',
                    message: (e as Error).message,
                    startedAt,
                    elapsed: Date.now() - startedAt,
                    ...(taskId ? { taskId } : {}),
                  })
                }
              })()
              return
            }

            // 本地图片转 data URL（方舟访问不到 127.0.0.1）；参考图个别失效不整单失败
            let firstUrl = ''
            let lastUrl = ''
            const refUrls: string[] = []
            const refVideoUrls: string[] = []
            const skipped: string[] = []
            const tempVideos: string[] = []
            // 方舟没有尾帧：转场用关键帧当首帧，生成后由成片裁到目标时长
            const arkImage = transition ? transition.keyframe : image
            try {
              if (refMode) {
                for (const r of refImages) {
                  try {
                    refUrls.push(resolveRef(r, root))
                  } catch {
                    skipped.push(r)
                  }
                }
                if (refUrls.length === 0) throw new Error(`参考图都不可用：${skipped.join('、')}`)
              } else if (!videoRefMode && arkImage) {
                firstUrl = resolveRef(arkImage, root)
              }

              if (videoRefMode) {
                // 2.5 的参考视频可到 30 秒；2.0 是 15 秒
                const maxDuration = pick.entry?.videoRefTaskType === 'reference' ? 30 : 15
                for (const r of refVideos) {
                  const v = resolveVideoRef(r, root)
                  if (v.external) {
                    refVideoUrls.push(v.external)
                    continue
                  }
                  const mp4 = await ensureMp4Video(v.local)
                  if (mp4.temp) tempVideos.push(mp4.file)
                  const dur = await probeDuration(mp4.file).catch(() => 0)
                  const uploaded = await ensureUploadedVideo({
                    baseUrl: base,
                    apiKey: runKey,
                    filePath: mp4.file,
                    seconds: dur,
                    maxDuration,
                  })
                  refVideoUrls.push(uploaded.downloadUrl)
                }
              }
            } catch (e) {
              res.statusCode = 400
              res.end(
                JSON.stringify({
                  ok: false,
                  message: (e as Error).message,
                  kind: e instanceof FileError ? e.kind : 'video-ref',
                }),
              )
              return
            } finally {
              for (const f of tempVideos) {
                try {
                  fs.unlinkSync(f)
                } catch {
                  /* 临时文件删不掉不影响结果 */
                }
              }
            }

            // 直接调 API 的调用方可能没写 @视频1；服务端补一句范围约束，避免白模风格被整段照搬
            const finalPrompt =
              videoRefMode && !prompt.includes('@视频1')
                ? `${prompt}\n\n参考 @视频1 的机位运动、人物走位与相对位置；只参考这些运动关系，不要照搬视频里的白模、网格、视锥、几何体材质与文字标签。`
                : prompt

            let payload: Record<string, unknown>
            try {
              payload = buildVideoPayload({
                model,
                prompt: finalPrompt,
                ratio,
                seconds,
                resolution,
                cameraFixed,
                firstFrame: firstUrl,
                referenceImages: refUrls,
                referenceVideos: refVideoUrls,
                videoRefTaskType: videoRefMode ? pick.entry?.videoRefTaskType || '' : '',
              })
            } catch (e) {
              if (!(e instanceof VideoParamError)) throw e
              res.statusCode = 400
              res.end(
                JSON.stringify({
                  ok: false,
                  message: e.message,
                  kind: e.kind,
                  ...(e.details || {}),
                }),
              )
              return
            }

            const mode = transitionMode ? 'transition' : videoRefMode ? 'video' : refMode ? 'ref' : 'first'
            // dryRun：只回显将要提交的请求体，不真的出片（调试 / 验证用）
            if (body.dryRun) {
              res.end(
                JSON.stringify({
                  ok: true,
                  id: 'dry-run',
                  mode,
                  model,
                  skipped,
                  request: payload,
                }),
              )
              return
            }

            const id = `v-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`
            const startedAt = Date.now()
            videoJobs.set(id, { status: 'running', startedAt })

            const outDir = path.join(root, 'public', 'videos')
            fs.mkdirSync(outDir, { recursive: true })

            res.end(JSON.stringify({ ok: true, id, mode, model, skipped }))

            // 提交后后台轮询，前端继续用本地 job id 查询
            ;(async () => {
              let taskId = ''
              try {
                const submitted = await submitVideoTask({ baseUrl: base, apiKey: runKey, payload })
                taskId = submitted.taskId
                const running = videoJobs.get(id)
                if (running) running.taskId = taskId

                const done = await pollVideoTask({ baseUrl: base, apiKey: runKey, taskId })
                const art = await downloadVideoArtifacts({
                  videoUrl: done.videoUrl,
                  videoDir: outDir,
                })
                videoJobs.set(id, {
                  status: 'succeeded',
                  url: art.url,
                  startedAt,
                  elapsed: Date.now() - startedAt,
                  taskId,
                })
              } catch (e) {
                const raw = String((e as Error)?.message || e)
                // 方舟的 Key 会过期/被删，但设置页里仍显示「已配置」。
                // 直接把上游原话抛给用户，他看不出该怎么处理，所以补一句可操作的出路。
                const hint =
                  /API key doesn't exist|AuthenticationError|InvalidApiKey|401/i.test(raw) &&
                  provider?.kind === 'ark'
                    ? '\n\n方舟这个 Key 已失效（服务端返回认证失败）。两条出路：' +
                      '① 到设置页「字节 · 火山方舟」换上有效的 ARK Key；' +
                      '② 把「视频」和「视频参考」默认模型改成 APIMart 的 Seedance 条目（已实测可出片）。'
                    : ''
                videoJobs.set(id, {
                  status: 'failed',
                  message: raw + hint,
                  startedAt,
                  elapsed: Date.now() - startedAt,
                  ...(taskId ? { taskId } : {}),
                })
              }
            })()
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ ok: false, message: (e as Error).message }))
          }
          return
        }

        if (url !== '/api/seedream') return next()

        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end(JSON.stringify({ ok: false, message: '只支持 POST' }))
          return
        }

        try {
          const body = await readJson(req)
          let mediaProject = ''
          if (body.project) {
            try {
              mediaProject = safeProjectName(String(body.project).trim())
            } catch (e) {
              res.statusCode = 400
              res.end(
                JSON.stringify({
                  ok: false,
                  message: (e as Error).message,
                  kind: 'bad-request',
                }),
              )
              return
            }
          }
          const prompt = String(body.prompt || '').trim()
          if (!prompt) {
            res.statusCode = 400
            res.end(JSON.stringify({ ok: false, message: '提示词为空', kind: 'bad-request' }))
            return
          }

          // 渠道分发：方舟 Seedream 支持参考图；第三方走 OpenAI 兼容 images/generations（纯文生图）
          const cap: Cap = body.cap === 'view' ? 'view' : 'image'
          const { entry: imgEntry, provider: imgProvider } = pickModel(cap, String(body.modelKey || ''))
          if (!imgEntry) {
            res.statusCode = 400
            res.end(JSON.stringify({ ok: false, message: `没有可用的${cap === 'view' ? '三视图' : '图像'}模型，请到设置页配置`, kind: 'no-image-model' }))
            return
          }
          if (!isRunnableModel(imgEntry)) {
            res.statusCode = 400
            res.end(JSON.stringify({ ok: false, message: `模型「${imgEntry.label}」尚未接入运行时`, kind: 'unsupported' }))
            return
          }
          const kind: ProviderKind = imgProvider?.kind || 'ark'
          const model = imgEntry?.model || effImageModel(cap)
          const imgKey = providerKey(imgProvider)
          if (!imgKey) {
            res.statusCode = 400
            res.end(
              JSON.stringify({
                ok: false,
                message: `渠道「${imgProvider?.label || 'ark'}」没有 API Key，去设置页填一下`,
                kind: 'no-key',
              }),
            )
            return
          }

          if (kind === 'apimart') {
            const base = String(imgProvider?.baseUrl || 'https://api.apimart.ai/v1').replace(/\/+$/, '')
            const ratio = String(body.ratio || '16:9')
            const n = Math.min(4, Math.max(1, Number(body.n) || 1))
            const featureRef = imgEntry.features?.imageRef
            const rawRefs = [body.refImage, ...(Array.isArray(body.refImages) ? body.refImages : [])]
              .filter(Boolean)
              .map(String)
              .filter((r) => !r.startsWith('data:image/svg'))
            if (featureRef === 'none' && rawRefs.length) {
              res.statusCode = 400
              res.end(JSON.stringify({ ok: false, message: `模型「${imgEntry.label}」不支持参考图`, kind: 'unsupported' }))
              return
            }

            const t0 = Date.now()
            const routeAbort = new AbortController()
            const onClientClose = () => {
              if (!res.writableEnded) routeAbort.abort()
            }
            res.on('close', onClientClose)
            req.on('aborted', onClientClose)
            res.socket?.on('close', onClientClose)

            const refUrls: string[] = []
            const dropped: string[] = []
            const maxRefs = featureRef === 'single' ? 1 : 10
            for (const ref of rawRefs) {
              if (refUrls.length >= maxRefs) {
                dropped.push(ref)
                continue
              }
              try {
                if (/^https?:\/\//i.test(ref)) {
                  refUrls.push(ref)
                  continue
                }
                const dataUrl = resolveRef(ref, root)
                const m = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/)
                if (!m) {
                  dropped.push(ref)
                  continue
                }
                const ext = /png/i.test(m[1]) ? 'png' : /webp/i.test(m[1]) ? 'webp' : 'jpg'
                const up = await uploadApimartImage({
                  baseUrl: base,
                  apiKey: imgKey,
                  buffer: Buffer.from(m[2], 'base64'),
                  mime: m[1],
                  filename: `ref-${refUrls.length}.${ext}`,
                  signal: routeAbort.signal,
                })
                refUrls.push(up.url)
              } catch {
                dropped.push(ref)
              }
            }
            if (rawRefs.length && refUrls.length === 0) {
              res.statusCode = 400
              res.end(JSON.stringify({ ok: false, message: '参考图全部不可用，请重新选择', kind: 'download', droppedRefs: dropped.length }))
              return
            }

            const callApimart = async () => {
              const payload = buildApimartImagePayload({ model, prompt, ratio, refUrls, n: 1 })
              const submitted = await submitApimartImage({
                baseUrl: base,
                apiKey: imgKey,
                payload,
                signal: routeAbort.signal,
              })
              const taskData = submitted.url
                ? { result: { images: [{ url: [submitted.url] }] } }
                : await pollApimartTask({
                    baseUrl: base,
                    apiKey: imgKey,
                    taskId: submitted.taskId || '',
                    signal: routeAbort.signal,
                  })
              const urls = imageUrlsFromTask(taskData)
              if (!urls.length) throw new ApimartError('任务未返回图片', { kind: 'api' })
              const files: { bytes: Buffer; contentType: string }[] = []
              for (const u of urls) {
                files.push(await downloadApimartResult({ url: u, signal: routeAbort.signal }))
              }
              return files
            }

            const settled = await Promise.allSettled(Array.from({ length: n }, () => callApimart()))
            if (routeAbort.signal.aborted) {
              if (!res.writableEnded) {
                res.statusCode = 499
                res.end(JSON.stringify({ ok: false, message: '请求已取消', kind: 'aborted' }))
              }
              return
            }
            const fulfilled = settled.filter((s): s is PromiseFulfilledResult<any> => s.status === 'fulfilled')
            const timedOut = settled.filter(
              (s) => s.status === 'rejected' && (s.reason as Error & { kind?: string })?.kind === 'timeout',
            ).length
            const failed = settled.length - fulfilled.length - timedOut
            if (fulfilled.length === 0) {
              const first = settled.find((s) => s.status === 'rejected') as PromiseRejectedResult | undefined
              const e = first?.reason as (Error & { kind?: string; status?: number }) | undefined
              res.statusCode = timedOut > 0 ? 504 : e?.status || 500
              res.end(
                JSON.stringify({
                  ok: false,
                  message: timedOut > 0 ? '生成超时，可重试' : e?.message || '生成失败，可重试',
                  kind: timedOut > 0 ? 'timeout' : e?.kind ?? 'api',
                  timedOut,
                }),
              )
              return
            }

            fs.mkdirSync(outDir, { recursive: true })
            const urls: string[] = []
            for (const item of fulfilled.flatMap((s) => s.value as { bytes: Buffer; contentType: string }[])) {
              const ext = /jpeg|jpg/i.test(item.contentType)
                ? 'jpg'
                : /webp/i.test(item.contentType)
                  ? 'webp'
                  : 'png'
              if (mediaProject) {
                const saved = saveProjectImage(root, mediaProject, item.bytes, ext, cap === 'view' ? 'char' : 'design')
                urls.push(saved.url)
              } else {
                const name = `shot-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.${ext}`
                fs.writeFileSync(path.join(outDir, name), item.bytes)
                urls.push(`/generated/${name}`)
              }
            }
            if (urls.length === 0) {
              res.statusCode = 502
              res.end(JSON.stringify({ ok: false, message: '候选图片下载失败，请重试', kind: 'download' }))
              return
            }
            const warnings = [
              dropped.length ? `${dropped.length} 张参考图未使用` : '',
              timedOut ? `${timedOut} 个候选超时` : '',
              failed ? `${failed} 个候选失败` : '',
            ].filter(Boolean)
            res.end(
              JSON.stringify({
                ok: true,
                urls,
                url: urls[0],
                size: RATIO_SIZE[ratio] || RATIO_SIZE['16:9'],
                model,
                provider: imgProvider?.label || 'APIMart',
                ...(warnings.length ? { warning: warnings.join('，') + '，已使用成功结果', timedOut, failed } : {}),
                elapsed: Date.now() - t0,
              }),
            )
            return
          }

          const base = String(imgProvider?.baseUrl || 'https://ark.cn-beijing.volces.com/api/v3').replace(
            /\/+$/,
            '',
          )
          const imgEndpoint = `${base}/images/generations`
          const refSupported = kind === 'ark' || kind === 'ark-plan'

          const ratio = String(body.ratio || '16:9')
          const size = RATIO_SIZE[ratio] || RATIO_SIZE['16:9']
          const n = Math.min(4, Math.max(1, Number(body.n) || 1))
          const payload: Record<string, unknown> = {
            model,
            prompt,
            size,
            response_format: 'url',
            ...(refSupported ? { watermark: false } : {}),
          }
          const dropRefs: string[] = []
          if (refSupported && body.refImage) {
            const ref = String(body.refImage)
            // 方舟不接受 svg 参考图；示例占位图是 svg，直接跳过
            if (!ref.startsWith('data:image/svg')) payload.image = resolveRef(ref, root)
          }
          // 多参考图（角色三视图 / 场景图 / 道具图）：Seedream 4.5 的 image 字段收数组，上限 10 张。
          const multiRefs: string[] = Array.isArray(body.refImages) ? body.refImages.map(String) : []
          if (refSupported && multiRefs.length) {
            const single = payload.image ? [payload.image as string] : []
            const resolved = multiRefs
              .filter((r) => r && !r.startsWith('data:image/svg'))
              .map((r) => resolveRef(r, root))
            payload.image = [...single, ...resolved].slice(0, 10)
          }
          if (!refSupported) dropRefs.push(...[body.refImage, ...multiRefs].filter(Boolean).map(String))

          const t0 = Date.now()
          const routeAbort = new AbortController()
          const onClientClose = () => {
            if (!res.writableEnded) routeAbort.abort()
          }
          res.on('close', onClientClose)
          req.on('aborted', onClientClose)
          res.socket?.on('close', onClientClose)

          // n 张 = n 次独立请求（不是 sequential 组图：组图出的是一组连贯故事板，
          // 不是同一提示词的多个变体，做"候选选优"语义不对）
          const callArk = async (pl: Record<string, unknown>) => {
            const lt = linkedTimeout(routeAbort.signal, SEEDREAM_TIMEOUT_MS)
            try {
              const r = await fetch(imgEndpoint, {
                method: 'POST',
                headers: { Authorization: `Bearer ${imgKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(pl),
                signal: lt.signal,
              })
              const text = await r.text()
              if (!r.ok) {
                let msg = text.slice(0, 300)
                try {
                  const j = JSON.parse(text)
                  msg = `${j?.error?.code ?? ''} — ${j?.error?.message ?? msg}`
                } catch {
                  /* 保持原文 */
                }
                const kind = /overdue|arrear|balance|insufficient|欠费/.test(text.toLowerCase())
                  ? 'billing'
                  : r.status === 401
                    ? 'auth'
                    : 'api'
                const err = new Error(msg) as Error & { kind?: string; status?: number }
                err.kind = kind
                err.status = r.status
                throw err
              }
              return JSON.parse(text)
            } catch (e) {
              if ((e as Error)?.name === 'AbortError') {
                const err = new Error(lt.timedOut() ? '候选生成超时' : '请求已取消') as Error & { kind?: string }
                err.kind = lt.timedOut() ? 'timeout' : 'aborted'
                throw err
              }
              throw e
            } finally {
              lt.dispose()
            }
          }

          const settled = await Promise.allSettled(
            Array.from({ length: n }, () => callArk(payload)),
          )
          if (routeAbort.signal.aborted) {
            if (!res.writableEnded) {
              res.statusCode = 499
              res.end(JSON.stringify({ ok: false, message: '请求已取消', kind: 'aborted' }))
            }
            return
          }
          const fulfilled = settled.filter(
            (s): s is PromiseFulfilledResult<any> => s.status === 'fulfilled',
          )
          const timedOut = settled.filter(
            (s) => s.status === 'rejected' && (s.reason as Error & { kind?: string })?.kind === 'timeout',
          ).length
          const failed = settled.length - fulfilled.length - timedOut

          if (fulfilled.length === 0) {
            const first = settled.find((s) => s.status === 'rejected') as
              | PromiseRejectedResult
              | undefined
            const e = first?.reason as (Error & { kind?: string; status?: number }) | undefined
            res.statusCode = timedOut > 0 ? 504 : e?.status || 500
            res.end(
              JSON.stringify({
                ok: false,
                message: timedOut > 0 ? '生成超时，可重试' : e?.message || '生成失败，可重试',
                kind: timedOut > 0 ? 'timeout' : e?.kind ?? 'api',
                timedOut,
              }),
            )
            return
          }

          const items: any[] = fulfilled
            .flatMap((s) => s.value?.data ?? [])
            .filter((it: any) => it?.url || it?.b64_json)
          if (items.length === 0) {
            res.statusCode = 502
            res.end(JSON.stringify({ ok: false, message: '接口未返回图片', kind: 'api' }))
            return
          }

          fs.mkdirSync(outDir, { recursive: true })
          const urls: string[] = []

          let downloadFailed = 0
          for (const item of items) {
            let ext = 'png'
            let bytes: Buffer
            if (item.url) {
              const lt = linkedTimeout(routeAbort.signal, SEEDREAM_DOWNLOAD_TIMEOUT_MS)
              try {
                const ir = await fetch(item.url, { signal: lt.signal })
                if (!ir.ok) throw new Error(`下载生成的图片失败 HTTP ${ir.status}`)
                const ct = ir.headers.get('content-type') || ''
                ext =
                  ct.includes('jpeg') || ct.includes('jpg') ? 'jpg' : ct.includes('webp') ? 'webp' : 'png'
                bytes = Buffer.from(await ir.arrayBuffer())
              } catch {
                downloadFailed++
                continue
              } finally {
                lt.dispose()
              }
            } else {
              bytes = Buffer.from(item.b64_json, 'base64')
            }
            if (mediaProject) {
              // 角色三视图 / 场景道具设定图：跟随项目目录
              const saved = saveProjectImage(
                root,
                mediaProject,
                bytes,
                ext,
                cap === 'view' ? 'char' : 'design',
              )
              urls.push(saved.url)
            } else {
              const name = `shot-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.${ext}`
              fs.writeFileSync(path.join(outDir, name), bytes)
              urls.push(`/generated/${name}`)
            }
          }

          if (urls.length === 0) {
            res.statusCode = 502
            res.end(JSON.stringify({ ok: false, message: '候选图片下载失败，请重试', kind: 'download' }))
            return
          }
          const warnings = [
            timedOut ? `${timedOut} 个候选超时` : '',
            failed ? `${failed} 个候选失败` : '',
            downloadFailed ? `${downloadFailed} 张候选下载失败` : '',
          ].filter(Boolean)
          res.end(
            JSON.stringify({
              ok: true,
              urls,
              url: urls[0],
              size,
              model,
              provider: imgProvider?.label || kind,
              ...(dropRefs.length ? { warning: '该渠道不支持参考图，已按纯文生图处理', droppedRefs: dropRefs.length } : {}),
              ...(warnings.length ? { warning: warnings.join('，') + '，已使用成功结果', timedOut, failed } : {}),
              elapsed: Date.now() - t0,
            }),
          )
        } catch (e) {
          if (res.writableEnded || res.destroyed) return
          const err = e as Error & { kind?: string; status?: number }
          res.statusCode = err.status || (err.kind === 'timeout' ? 504 : 500)
          res.end(
            JSON.stringify({
              ok: false,
              message: err.message,
              kind: err.kind || 'network',
            }),
          )
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), seedreamProxy()],
  resolve: {
    alias: { '@': path.resolve(process.cwd(), 'src') },
  },
  server: {
    port: 5273,
    host: '127.0.0.1',
    // ngrok / 反代 / 局域网访问时 Vite 默认按 Host 头拦请求（403 text/plain）。
    // 这里显式放开，否则公网只能通 /api/*，页面和模块全被挡。
    allowedHosts: true,
    watch: {
      // 验收脚本、OpenSpec 产物、渲染作业与项目数据不属于前端模块；
      // 监听它们会在生成/渲染过程中触发整页刷新，把 agent 运行和 Playwright 流程打断。
      ignored: [
        '**/openspec/**',
        '**/verify-*.mjs',
        '**/.blender-jobs/**',
        '**/.scene-drafts/**',
        '**/fixtures/**',
        '**/projects/**',
        '**/public/videos/**',
        '**/public/generated/**',
        '**/public/voices/**',
        '**/public/exports/**',
      ],
    },
  },
})
