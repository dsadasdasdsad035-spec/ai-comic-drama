import type { ProjectData, Stage } from '../api'
import type { SkillInputs, SkillReference, SkillSource } from '../skills/types'
import type { ChatThreadKey } from './threads'

export type WorkbenchSurface = 'script' | 'characters' | 'assets' | 'shots' | 'prompts'
export type WorkbenchSaveMode = 'explicit' | 'auto' | 'immediate'
export type WorkbenchBuiltinScope = 'episode' | 'script'

/**
 * 工作台内置动作的结果：聊天回执与顶部按钮共用。
 * 只带摘要/数量，不携带整份产物，避免线程和下一轮上下文膨胀。
 */
export type BuiltinResult = {
  ok: boolean
  action: string
  label?: string
  scope?: WorkbenchBuiltinScope
  summary: string
  counts?: Record<string, number>
  modelLabel?: string
  elapsedMs?: number
  saveMode?: WorkbenchSaveMode
  error?: string
  cancelled?: boolean
}

export type BuiltinAvailability = { disabled: boolean; reason?: string }

/**
 * 聊天里的显式内置动作：用户点击运行，走工作台自己的宿主函数。
 * 它不是模型工具；run 由宿主提供，聊天壳只负责入口、状态和回执。
 */
export type BuiltinAction = {
  key: string
  label: string | (() => string)
  hint?: string
  scope?: WorkbenchBuiltinScope
  disabled?: () => BuiltinAvailability
  run: (signal?: AbortSignal) => Promise<BuiltinResult>
}

export function builtinLabel(action: BuiltinAction): string {
  try {
    return typeof action.label === 'function' ? action.label() : action.label
  } catch {
    return action.key
  }
}

export function builtinAvailability(action: BuiltinAction): BuiltinAvailability {
  try {
    return action.disabled?.() ?? { disabled: false }
  } catch {
    return { disabled: false }
  }
}

export function builtinFailure(
  action: string,
  message: string,
  opts: {
    label?: string
    scope?: WorkbenchBuiltinScope
    saveMode?: WorkbenchSaveMode
    cancelled?: boolean
  } = {},
): BuiltinResult {
  return {
    ok: false,
    action,
    summary: message,
    error: message,
    ...opts,
  }
}

/** 五个工作台内置动作的单一清单；board 只补充 disabled/run 与动态 label。 */
export const WORKBENCH_BUILTINS = {
  generate_episodes: {
    key: 'generate_episodes',
    label: '生成分集',
    hint: '全剧；会替换当前分集草稿，保存前不动项目',
    scope: 'script',
  },
  extract_characters_episode: {
    key: 'extract_characters_episode',
    label: '从本集拆角色',
    hint: '用当前集的剧本场次与分镜；约 1 秒后自动落库',
    scope: 'episode',
  },
  extract_characters_script: {
    key: 'extract_characters_script',
    label: '从全剧拆角色',
    hint: '从全剧原文梗概与分集场次拆；约 1 秒后自动落库',
    scope: 'script',
  },
  extract_designs_episode: {
    key: 'extract_designs_episode',
    label: '从本集拆',
    hint: '用当前集的剧本场次与分镜；写入后立即保存',
    scope: 'episode',
  },
  extract_designs_script: {
    key: 'extract_designs_script',
    label: '从全剧拆',
    hint: '从全剧原著梗概、分集场次与分镜拆；写入后立即保存',
    scope: 'script',
  },
  split_shots: {
    key: 'split_shots',
    label: '拆镜',
    hint: '用当前集内容/梗概；只改当前集镜头草稿',
    scope: 'episode',
  },
  generate_prompts: {
    key: 'generate_prompts',
    label: '生成提示词',
    hint: '当前集；分批并行，只改提示词草稿',
    scope: 'episode',
  },
} as const

export const WORKBENCH_BUILTIN_KEYS: Record<
  WorkbenchSurface,
  (keyof typeof WORKBENCH_BUILTINS)[]
> = {
  script: ['generate_episodes'],
  characters: ['extract_characters_episode', 'extract_characters_script'],
  assets: ['extract_designs_episode', 'extract_designs_script'],
  shots: [],
  prompts: ['generate_prompts'],
}

/** 每个工作台的首屏文案与保存语义；不扩技能 frontmatter。 */
export type WorkbenchProfile = {
  title: string
  emptyTitle: string
  emptyBody: string
  suggestions: string[]
  placeholder: string
  saveMode: WorkbenchSaveMode
  inputLabels: Record<string, string>
}

export const WORKBENCH_PROFILES: Record<WorkbenchSurface, WorkbenchProfile> = {
  script: {
    title: '剧本助手',
    emptyTitle: '改这一版剧本',
    emptyBody: '按你的要求改分集、场次和钩子；也可点「生成分集」从零拆集（需项目里已有原著，或在对话里贴全文）。只改草稿，保存前不动项目。',
    suggestions: ['把节奏改紧一点', '第 3 集结尾留一个反转', '只重写第 5–8 集'],
    placeholder: '例如：把第 3 集节奏改快，结尾留一个反转钩子…',
    saveMode: 'explicit',
    inputLabels: { source: '原著', epCount: '集数', targetSeconds: '每集时长', style: '画风' },
  },
  characters: {
    title: '角色助手',
    emptyTitle: '补齐这一集的角色',
    emptyBody: '从本集场次和分镜补角色、合并重复、补外观锚点；也可以直接点下面的「从本集拆角色」或「从全剧拆角色」。只改角色草稿。',
    suggestions: ['补全所有 lookEn', '合并同名角色', '只保留有台词的角色'],
    placeholder: '例如：补全所有角色的 lookEn，别改已经手写的外观…',
    saveMode: 'auto',
    inputLabels: { scopeLabel: '范围', sceneText: '剧本场次', shotBlock: '分镜摘要' },
  },
  assets: {
    title: '素材助手',
    emptyTitle: '拆这一集的场景和道具',
    emptyBody: '拆场景和剧情道具，补可复用的生图锚点；也可以直接点下面的「从本集拆」或「从全剧拆」。写入后立即保存。',
    suggestions: ['只拆出现两次以上的场景', '补道具的多角度描述', '场景图里不要出现人物'],
    placeholder: '例如：只拆出现两次以上的场景，道具补多角度…',
    saveMode: 'immediate',
    inputLabels: { scopeLabel: '范围', sceneText: '剧本场次', shotBlock: '分镜摘要' },
  },
  shots: {
    title: '分镜助手',
    emptyTitle: '把这一集拆成可拍镜头',
    emptyBody:
      '在对话里说明如何拆镜或改某一镜；模型会读本集场次并写入左侧镜头草稿。左侧表格可手改字段，保存前不会落库。',
    suggestions: ['拆成 12 个 3 秒镜头', '加两个反应镜', '把 S03 改成近景'],
    placeholder: '例如：拆成 12 个 3 秒镜头，结尾加一个反应镜…',
    saveMode: 'explicit',
    inputLabels: { style: '画风', aspect: '画幅', brief: '本集摘要', target: '目标时长' },
  },
  prompts: {
    title: '提示词助手',
    emptyTitle: '给这一集写提示词',
    emptyBody: '给每镜写首帧和运动提示词，统一风格与角色锚点；也可以直接点下面的「生成提示词」。只改提示词草稿。',
    suggestions: ['统一成夜景霓虹', '补齐缺失的镜头', '只改第 3、7 镜'],
    placeholder: '例如：统一成夜景霓虹，角色锚点不要丢…',
    saveMode: 'explicit',
    inputLabels: { style: '画风', bible: '角色锚点', briefJson: '镜头摘要' },
  },
}

export type WorkbenchTaskView = {
  system: string
  task: string
  inputs: Record<string, unknown>
  references: SkillReference[]
  missing: string[]
  modelLabel: string
  skillId: string
  skillTitle: string
  skillSource: SkillSource
  skillVersion: number
  readonly: { id: string; version: number }[]
  readTools: string[]
  saveMode: WorkbenchSaveMode
}
export type WriteArtifact = 'script' | 'characters' | 'designs' | 'shots' | 'prompts'
export type WriteTool =
  | 'submit_script'
  | 'submit_characters'
  | 'submit_designs'
  | 'submit_shots'
  | 'submit_prompts'

export type DraftApplyResult = {
  ok: boolean
  summary: string
  counts?: Record<string, number>
  hash?: string
  error?: string
  /**
   * 本次草稿里需要后续动作的条目名（如刚写入的角色）。
   * 回执上的「用它生成三视图」靠它知道给谁出图，不靠解析文本。
   */
  subjects?: string[]
}

/**
 * 工作台聊天适配器：宿主只实现取输入、读活草稿、读已保存项目、合并草稿四件事。
 * 工具和运行器共用这个接口，不直接写项目。
 */
/**
 * 聊天里的附件来源声明。
 * 只有声明了它的工作台才显示附件入口；其余工作台界面零变化。
 * available 返回「可选什么」，kinds 声明「能收哪些类型」——
 * 两者分开：一个面可以只收图片但列出视频候选（候选会被过滤掉），
 * 也可以两者一致。不接受某类型时必须在入口就排除，不能选完再拒绝。
 */
export type WorkbenchAttachmentSource = {
  /** 当前可供选择的图片 */
  available: () => { key: string; label: string; url: string }[]
  /** 单次上限；所有类型共享同一计数 */
  limit: number
  /** 这个面接受的附件类型；不声明时按只收图片处理 */
  kinds?: ('image' | 'video' | 'doc' | 'text')[]
  /**
   * 附件去向的说明，仅用于文档与诊断。
   * 切片 1 里五个工作台都是 'thread'：附件只进本次对话，不写宿主数据。
   */
  persist?: 'thread' | 'host'
  /** 上传一张本地文件到项目媒体并返回新条目；不提供时不显示上传入口 */
  upload?: (file: File) => Promise<WorkbenchAttachmentItem>
  /** 从项目素材里挑一条；返回 null 表示用户取消。不提供时不显示「从素材选」 */
  pick?: () => Promise<WorkbenchAttachmentItem | null>
  /** 附件来源的说明，用于 UI 提示（不要写成「某个角色的参考图」——附件属于本次对话） */
  hint?: string
}

/** 上传/选择返回的附件条目；kind 省略时按图片处理 */
export type WorkbenchAttachmentItem = {
  key: string
  label: string
  url: string
  kind?: 'image' | 'video' | 'doc' | 'text'
}

export type WorkbenchChatAdapter = {
  surface: WorkbenchSurface
  skillId: string
  stage: Stage
  artifact: WriteArtifact
  writeTool: WriteTool
  writeContract: string
  threadKey: ChatThreadKey
  /** 聊天头部显示的编辑范围，例如“全剧 · 8 集”或“第 3 集”。 */
  scope?: () => string
  inputs: () => SkillInputs
  ownDraft: () => unknown
  projectSnapshot: () => Promise<ProjectData>
  applyDraft: (payload: unknown) => DraftApplyResult
  /** 显式保存的工作台把保存函数交给写回执，自动保存/立即落库的工作台不提供。 */
  saveDraft?: () => Promise<void> | void
  onDraftChanged?: () => void
  /** 聊天里的显式内置动作；不提供时聊天与改动前一致。 */
  builtins?: BuiltinAction[]
  /** 图片附件来源；不提供时不显示附件入口。 */
  attachments?: WorkbenchAttachmentSource
}

/** 读工具结果上限：超出的返回摘要，避免把整份产物塞进下一轮上下文。 */
export function boundJson(value: unknown, max = 8000): unknown {
  try {
    const text = JSON.stringify(value)
    if (text.length <= max) return value
    return { truncated: true, chars: text.length, preview: text.slice(0, max) }
  } catch {
    return String(value).slice(0, max)
  }
}

export function textOfSource(value: unknown): string {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return ''
  const source = (value as Record<string, unknown>).source
  return typeof source === 'string' ? source : ''
}
