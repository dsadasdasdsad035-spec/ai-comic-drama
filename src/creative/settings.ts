import type { Cap } from '../api'

/** 摄取适配器配置：yt-dlp 与 DTK 都必须显式启用 */
export type CreativeIngestSettings = {
  ytdlp?: { enabled?: boolean; bin?: string; cookiesFromBrowser?: string; cookiesFile?: string }
  dtk?: { enabled?: boolean; baseUrl?: string; apiKey?: string }
}

export type CreativeAnalysisDepth = 'quick' | 'standard' | 'deep'

export type CreativeAnalysisSettings = {
  depth?: CreativeAnalysisDepth
  /** 场景变化阈值 0–1，越大越不敏感 */
  threshold?: number
  minShotSeconds?: number
  /** 每镜证据帧数量 */
  framesPerShot?: number
}

export type CreativeLimits = {
  maxShots?: number
  maxFramesPerShot?: number
  maxPaidCallsPerTurn?: number
}

/** 创意会话的配置：缺省即默认；不写回就不影响旧设置 */
export type CreativeSettings = {
  ingest?: CreativeIngestSettings
  /** 能力 → 模型键；未设置的按该能力的全局默认解析 */
  models?: Partial<Record<Cap, string>>
  analysis?: CreativeAnalysisSettings
  /** 付费调用前是否需要确认；默认 true */
  confirmCost?: boolean
  limits?: CreativeLimits
}

/** 设置页回读用的展示态：DTK Key 只给「有没有」 */
export type CreativeSettingsView = Omit<CreativeSettings, 'ingest'> & {
  ingest?: {
    ytdlp?: { enabled?: boolean; bin?: string; cookiesFromBrowser?: string; cookiesFile?: string }
    dtk?: { enabled?: boolean; baseUrl?: string; apiKey?: string; hasApiKey?: boolean }
  }
}

export const CREATIVE_ANALYSIS_DEPTHS: CreativeAnalysisDepth[] = ['quick', 'standard', 'deep']

export const CREATIVE_DEFAULTS = {
  analysis: { depth: 'quick' as CreativeAnalysisDepth, threshold: 0.3, minShotSeconds: 0.8, framesPerShot: 1 },
  confirmCost: true,
  limits: { maxShots: 40, maxFramesPerShot: 3, maxPaidCallsPerTurn: 8 },
}

const CAPS: Cap[] = ['text', 'textPro', 'vision', 'videoVision', 'image', 'view', 'video', 'videoRef', 'audio']

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

function num(v: unknown, fallback: number, min: number, max: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

/**
 * 归一化创意配置：只保留已知字段，非法值回落默认。
 * 空对象等价于缺省，调用方据此判断「用户是否配置过」。
 */
export function normalizeCreativeSettings(raw: unknown): CreativeSettings {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const ingestRaw = o.ingest && typeof o.ingest === 'object' ? (o.ingest as Record<string, unknown>) : {}
  const ytdlpRaw =
    ingestRaw.ytdlp && typeof ingestRaw.ytdlp === 'object' ? (ingestRaw.ytdlp as Record<string, unknown>) : {}
  const dtkRaw =
    ingestRaw.dtk && typeof ingestRaw.dtk === 'object' ? (ingestRaw.dtk as Record<string, unknown>) : {}

  const modelsRaw = o.models && typeof o.models === 'object' ? (o.models as Record<string, unknown>) : {}
  const models: Partial<Record<Cap, string>> = {}
  for (const cap of CAPS) {
    const key = str(modelsRaw[cap])
    if (key) models[cap] = key
  }

  const analysisRaw =
    o.analysis && typeof o.analysis === 'object' ? (o.analysis as Record<string, unknown>) : {}
  const depth = CREATIVE_ANALYSIS_DEPTHS.includes(analysisRaw.depth as CreativeAnalysisDepth)
    ? (analysisRaw.depth as CreativeAnalysisDepth)
    : CREATIVE_DEFAULTS.analysis.depth

  const limitsRaw = o.limits && typeof o.limits === 'object' ? (o.limits as Record<string, unknown>) : {}

  return {
    ingest: {
      ytdlp: {
        enabled: bool(ytdlpRaw.enabled, false),
        bin: str(ytdlpRaw.bin),
        cookiesFromBrowser: str(ytdlpRaw.cookiesFromBrowser),
        cookiesFile: str(ytdlpRaw.cookiesFile),
      },
      dtk: {
        enabled: bool(dtkRaw.enabled, false),
        baseUrl: str(dtkRaw.baseUrl),
        apiKey: str(dtkRaw.apiKey),
      },
    },
    ...(Object.keys(models).length ? { models } : { models: {} }),
    analysis: {
      depth,
      threshold: num(analysisRaw.threshold, CREATIVE_DEFAULTS.analysis.threshold, 0.05, 0.95),
      minShotSeconds: num(analysisRaw.minShotSeconds, CREATIVE_DEFAULTS.analysis.minShotSeconds, 0.2, 5),
      framesPerShot: Math.round(num(analysisRaw.framesPerShot, CREATIVE_DEFAULTS.analysis.framesPerShot, 1, 3)),
    },
    confirmCost: bool(o.confirmCost, CREATIVE_DEFAULTS.confirmCost),
    limits: {
      maxShots: Math.round(num(limitsRaw.maxShots, CREATIVE_DEFAULTS.limits.maxShots, 1, 200)),
      maxFramesPerShot: Math.round(
        num(limitsRaw.maxFramesPerShot, CREATIVE_DEFAULTS.limits.maxFramesPerShot, 1, 6),
      ),
      maxPaidCallsPerTurn: Math.round(
        num(limitsRaw.maxPaidCallsPerTurn, CREATIVE_DEFAULTS.limits.maxPaidCallsPerTurn, 1, 50),
      ),
    },
  }
}

export function creativeSettings(input: { creative?: unknown } | null | undefined): CreativeSettings {
  return normalizeCreativeSettings(input?.creative)
}

/**
 * 环境变量兜底：容器部署时 DTK / yt-dlp 的地址与凭据从环境注入，
 * 不必手工在设置页填一遍。设置库里的值优先，环境只补空位。
 */
export function applyCreativeEnvDefaults(
  s: CreativeSettings,
  env: Record<string, string | undefined> = {},
): { settings: CreativeSettings; fromEnv: { dtk: boolean; ytdlp: boolean } } {
  const base = normalizeCreativeSettings(s)
  const ytdlp = base.ingest?.ytdlp || {}
  const dtk = base.ingest?.dtk || {}

  const envDtkUrl = str(env.DTK_BASE_URL)
  const envDtkKey = str(env.DTK_API_KEY)
  const envYtdlpBin = str(env.YTDLP_BIN)
  const envYtdlpCookies = str(env.YTDLP_COOKIES_FROM_BROWSER)

  const dtkFromEnv = !dtk.baseUrl && (Boolean(envDtkUrl) || Boolean(envDtkKey))
  const ytdlpFromEnv = !ytdlp.bin && Boolean(envYtdlpBin)

  return {
    settings: normalizeCreativeSettings({
      ...base,
      ingest: {
        ytdlp: {
          ...ytdlp,
          enabled: ytdlp.enabled || ytdlpFromEnv,
          bin: ytdlp.bin || envYtdlpBin,
          cookiesFromBrowser: ytdlp.cookiesFromBrowser || envYtdlpCookies,
        },
        dtk: {
          ...dtk,
          enabled: dtk.enabled || dtkFromEnv,
          baseUrl: dtk.baseUrl || envDtkUrl,
          apiKey: dtk.apiKey || envDtkKey,
        },
      },
    }),
    fromEnv: { dtk: dtkFromEnv, ytdlp: ytdlpFromEnv },
  }
}

/**
 * 给前端展示的配置：DTK Key 只回报「有没有」，不回传原文。
 * 与渠道 Key 的处理保持一致，避免把密钥写进页面或日志。
 */
export function redactCreativeSettings(s: CreativeSettings): CreativeSettingsView {
  const key = s.ingest?.dtk?.apiKey || ''
  return {
    ...s,
    ingest: {
      ytdlp: s.ingest?.ytdlp,
      dtk: { ...s.ingest?.dtk, apiKey: '', hasApiKey: Boolean(key) },
    },
  }
}
