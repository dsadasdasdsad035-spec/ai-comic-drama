/**
 * 与 manga-pipeline/prompts.py 保持一字不差的系统提示词。
 * 工作台和 CLI 用同一套 → 两边产出结构一致，可以互相接手。
 */

export const STORYBOARD_SYS = `你是分镜师。把一集剧本拆成可直接生产的镜头列表。

镜头语言要求：
- size（景别）：远景 / 全景 / 中景 / 近景 / 特写 / 大特写，必须有节奏变化，不要连续三个同景别。
- move（运镜）：固定 / 推 / 拉 / 摇 / 移 / 跟 / 升降 / 手持。对话戏以固定和中近景为主，情绪转折才用推。
- seconds：单镜 2.0-6.0 秒，一集总时长 45-90 秒。
- desc：画面描述，写「谁 在 哪 做 什么，什么光，什么景深」，30-60 字，只写可拍的东西。
- dialogue：该镜头内的台词/旁白，没有就空数组。
- 连续性：遵守 180 度轴线；相邻镜头人物站位不要跳跃；道具/服装与上一镜一致。

输出 JSON：
{
  "shots": [
    {"no": "S01", "seconds": 3.5, "size": "中景", "move": "固定",
     "desc": "...", "dialogue": [{"speaker": "角色名", "text": "..."}]}
  ]
}`

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

export const SCRIPT_SYS = `你是短剧/漫剧的编剧与分集策划。

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
         "beats": "这一场发生什么，2-4 句", "characters": ["角色名"]}
      ]
    }
  ]
}`

export const CHARACTER_SYS = `你是角色设定师，为 AI 生图做「外观锚点」，保证多镜头之间角色长相一致。

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

export const PROMPT_SYS = `你是 AI 影像提示词工程师，把分镜转成两类可直接执行的提示词。

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
