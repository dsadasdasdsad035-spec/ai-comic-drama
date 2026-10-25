import { ASSET_RULES, CHARACTER_RULES, PROMPT_WRITING_RULES, SCRIPT_RULES, SHOT_LANGUAGE_RULES } from './legacyRules'
import type { RulePack } from '../api'

/**
 * 旧规则包的冻结快照，只用于一次性迁移 AppSettings.rules。
 * 运行时的生成和聊天只读 skills/<id>/SKILL.md；不要从这里引用提示词。
 */
export const STORYBOARD_BASE = `你是分镜师。把一集剧本拆成可直接生产的镜头列表。

镜头语言要求：
- size（景别）：远景 / 全景 / 中景 / 近景 / 特写 / 大特写，必须有节奏变化，不要连续三个同景别。
- move（运镜）：固定 / 推 / 拉 / 摇 / 移 / 跟 / 升降 / 手持。对话戏以固定和中近景为主，情绪转折才用推。
- seconds：单镜 2.0-6.0 秒，一集总时长 45-90 秒。
- desc：画面描述，写「谁 在 哪 做 什么，什么光，什么景深」，30-60 字，只写可拍的东西。
- dialogue：该镜头内的台词/旁白，没有就空数组。
- 连续性：遵守 180 度轴线；相邻镜头人物站位不要跳跃；道具/服装与上一镜一致。
- 场次归属：每镜必须带 scene_no 与 scene_slug，照抄输入场次的编号和简称；不同场次不能合并。
- cast：只写画面内真正出现的角色名，不要写画外音或只被提到的角色。

输出 JSON：
{
  "shots": [
    {"no": "S01", "scene_no": 1, "scene_slug": "场景简称",
     "seconds": 3.5, "size": "中景", "move": "固定",
     "desc": "...", "dialogue": [{"speaker": "角色名", "text": "..."}],
     "cast": ["角色名"]}
  ]
}`

export const STORYBOARD_SYS = STORYBOARD_BASE + SHOT_LANGUAGE_RULES

/** 规则包拼接：停用 → 只出基础段；启用 → 基础 + 规则文本 */
export function withRule(base: string, pack?: RulePack): string {
  if (!pack || pack.enabled === false) return base
  return base + (pack.text || '')
}

/** 默认规则包（来自技能库摘录），设置页首次展示/重置用 */
export const DEFAULT_RULES: Record<'script' | 'character' | 'asset' | 'shot' | 'prompt', RulePack> = {
  script: { enabled: true, text: SCRIPT_RULES },
  character: { enabled: true, text: CHARACTER_RULES },
  asset: { enabled: true, text: ASSET_RULES },
  shot: { enabled: true, text: SHOT_LANGUAGE_RULES },
  prompt: { enabled: true, text: PROMPT_WRITING_RULES },
}

/** 设置里可能缺 rules（老数据），补齐默认值 */
export function normalizeRules(rules?: Record<string, RulePack>): Record<string, RulePack> {
  return { ...DEFAULT_RULES, ...(rules || {}) }
}

export const scriptSys = (rules?: Record<string, RulePack>) =>
  withRule(SCRIPT_BASE, normalizeRules(rules).script)
export const storyboardSys = (rules?: Record<string, RulePack>) =>
  withRule(STORYBOARD_BASE, normalizeRules(rules).shot)
export const promptSys = (rules?: Record<string, RulePack>) =>
  withRule(PROMPT_BASE, normalizeRules(rules).prompt)
export const characterSys = (rules?: Record<string, RulePack>) =>
  withRule(CHARACTER_BASE, normalizeRules(rules).character)
export const assetSys = (rules?: Record<string, RulePack>) =>
  withRule(ASSET_BASE, normalizeRules(rules).asset)

/**
 * 与 manga-pipeline/prompts.py 保持一字不差的系统提示词。
 * 工作台和 CLI 用同一套 → 两边产出结构一致，可以互相接手。
 */


/** 台词数组 ⇄ 表格里的多行文本 */
export function dialogueToText(d: unknown): string {
  if (!d) return ''
  if (typeof d === 'string') return d
  if (!Array.isArray(d)) return ''
  return d
    .map((x: any) => (x && x.speaker ? `${x.speaker}：${x.text ?? ''}` : String(x?.text ?? '')))
    .join('\n')
}

export function parseDialogue(text: string): { speaker: string; text: string }[] {
  return String(text || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^([^：:]{1,12})[：:]\s*(.+)$/)
      return m ? { speaker: m[1].trim(), text: m[2].trim() } : { speaker: '', text: line }
    })
}


// ---- 以下两段同样取自 manga-pipeline/prompts.py ----

export const SCRIPT_BASE = `你是短剧/漫剧的编剧与分集策划。

任务：把用户给的原著/故事，改编成适合 AI 生成的多集短剧剧本。

要求：
1. 结构：每集 45-90 秒，结尾留钩子（悬念/反转/情绪爆点）。
2. 分场：每集拆 2-5 个场景，每个场景写清楚时空、在场人物、发生了什么。
3. 台词：必须短、口语、有冲突；单句不超过 18 字，便于配音与字幕。
4. 忠于原著的核心冲突，但不要求逐字复述；可压缩、可合并次要角色。
5. 画面可拍性：只写 AI 能画出来的东西（具体环境、天气、光线、动作），不写内心独白式抽象描述。

输出 JSON：
{
  "logline": "一句话故事",
  "episodes": [
    {
      "no": 1,
      "title": "集标题",
      "hook": "本集结尾钩子",
      "scenes": [
        {"no": 1, "slug": "场景简称", "place": "地点", "time": "时间/光线",
         "beats": "这一场发生什么，2-4 句", "characters": ["角色名"],
         "intensity": 6, "tone": "悬疑"}
      ]
    }
  ]
}`
export const SCRIPT_SYS = SCRIPT_BASE + SCRIPT_RULES

export const CHARACTER_BASE = `你是角色设定师，为 AI 生图做「外观锚点」，保证多镜头之间角色长相一致。

对每个主要角色，提取/设计一套**不可变的外观锚点**。锚点必须是视觉可描述的，不能写性格形容词。

每个角色输出：
- name：角色名
- role：主角/反派/配角
- age：年龄段（如「30 岁上下」）
- look_cn：中文外观锚点，按「性别年龄 · 脸型五官 · 发型发色 · 体型 · 服装 · 标志性配饰」顺序，一段话，60-100 字
- look_en：同一套锚点的英文版，用于生图（80-120 词，逗号分隔短语）
- palette：主色调，如「暗红 + 铁灰」
- keywords：3-5 个辨识度关键词（如「左眉疤」「银色义肢左手」）

铁律：所有角色必须有明确区分度（轮廓/配色/配饰不能撞）；同一角色在不同镜头复用同一段 look_en。

输出 JSON：{"characters": [ ... ]}`
export const CHARACTER_SYS = CHARACTER_BASE + CHARACTER_RULES

export const ASSET_BASE = `你是场景与道具设定师。从剧本场次和分镜里拆出可复用的场景与关键道具，供后续 AI 生图做参考。

只做两类：
- scenes：可复用的地点/空间，用于空镜设定，不是单个镜头的构图。
- props：剧情关键道具，不是背景杂物或临时陈设。

要求：
- 合并同一地点/同一道具的多次出现；name 用稳定的中文名，不要按镜头重复起名。
- refs 记录出现过的镜号（如 E01-S03）或分集场次；同一张卡的 refs 取并集。
- summary_cn 写中文设定摘要（60-100 字）；prompt_en 写可直接生图的英文锚点（80-120 词，逗号分隔短语）。
- keywords 给 3-5 个辨识度关键词。
- 场景 prompt_en 不写人物和具体镜头；道具 prompt_en 不写手、人物和具体镜头。
- 只输出 JSON，不要解释。

输出 JSON：
{
  "scenes": [
    {"name": "地下井道", "refs": ["E01-S13", "E01-S14"],
     "summary_cn": "...", "prompt_en": "...", "keywords": ["..."]}
  ],
  "props": [
    {"name": "机械义体手臂", "refs": ["E01-S03", "E01-S14"],
     "summary_cn": "...", "prompt_en": "...", "keywords": ["..."]}
  ]
}`

export const ASSET_SYS = ASSET_BASE + ASSET_RULES

export const PROMPT_BASE = `你是 AI 影像提示词工程师，把分镜转成两类可直接执行的提示词。

【A. keyframe_prompt —— 给文生图模型（Seedream）】
结构固定：主体与外观锚点 + 动作姿态 + 环境 + 景别与镜头 + 光影 + 画风 + 画质
- 必须内嵌角色的 look_en 原文，一字不改，保证一致性。
- 写清景别（wide shot / medium shot / close-up）、机位（low angle / eye level）、景深。
- 结尾统一加画风锁。
- 不要写运镜（静态图）。

【B. video_prompt —— 给图生视频模型（Seedance）】
结构固定：主体动作（现在进行时）+ 运镜 + 速度节奏 + 光影变化
- 只描述「运动」，不重复静态外观（首帧图已经定了长相）。
- 一个镜头只给一个主要动作 + 一个运镜，不要叠加多个动作。
- 禁止抽象词（"电影感""氛围感"），改成可见的物理描述（"镜头缓慢前推 20 厘米""雨丝斜向划过画面"）。

输出 JSON：
{
  "shots": [
    {"no": "S01", "keyframe_prompt": "...", "video_prompt": "..."}
  ]
}`
export const PROMPT_SYS = PROMPT_BASE + PROMPT_WRITING_RULES

/**
 * 把 {{角色名}} 占位符替换回角色的 look_en 原文。
 *
 * 为什么要有这个：实测 15 镜的 keyframe_prompt 里 80% 的字符是同一段 look_en 被重复输出
 * （9974 字符里有 7996 是锚点原文），而生成速度受输出长度主导（约 40 字符/秒）。
 * 让模型只写占位符、由我们替换回来，输出量掉到 1/3，落盘结果与原文逐字一致。
 */
export function expandAnchors(text: string, chars: { name: string; lookEn: string }[]): string {
  let out = String(text || '')
  if (!out.includes('{{')) return out
  for (const c of chars) {
    if (!c.name || !c.lookEn) continue
    const keys = [`{{${c.name}}}`, `{{${c.name}.look_en}}`, `{{${c.name}.lookEn}}`, `{{${c.name} look_en}}`]
    for (const k of keys) out = out.split(k).join(c.lookEn)
  }
  return out
}

/** 是否还有没替换掉的占位符（模型写错了名字时会残留） */
export function hasUnresolvedAnchor(text: string): boolean {
  return /\{\{[^}]{1,20}\}\}/.test(text || '')
}

/** 按 max 个元素切成若干批 */
export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}
