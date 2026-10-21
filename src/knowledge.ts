/**
 * 从技能库摘录的拍摄守则 —— 只取「可直接约束模型输出」的硬规则，不搬整篇方法论。
 *
 * 来源：~/.workbuddy/skills/script-to-manga（跟镜头几何 / 预兆性引入 / 视线匹配）
 *       ~/.workbuddy/skills/video-prompting-guide（景别运镜词汇 / 禁抽象词）
 *
 * 为什么是摘录不是整份注入：原文 SKILL.md + references 合计约 60KB（≈3 万 token），
 * 每镜一次调用会成倍放大成本，且长上下文会稀释对输出格式的遵循度。
 * 这里只保留与「拆镜」「写提示词」直接相关的条款，总量控制在 2KB 内。
 */

/** 拆镜守则：挂在 STORYBOARD_SYS 后面 */
export const SHOT_LANGUAGE_RULES = `

【转接与运镜硬规则】
1. 相邻镜头必须能接上，默认两种转接之一，并在 desc 里体现：
   - 视线匹配：上镜人物视线投向画外 → 下镜切到他看的目标，方向守恒（看上镜看画左，下镜目标就在画左）
   - 主体交接：上镜背景/边缘的次要元素 → 下镜放大成画面主体，完成焦点转移
2. 用「跟」镜时四要素齐全：几何模式（尾随/前导/侧随平行/弧线/环绕/渐近/渐远/穿越/升降）
   + 机位方位 + 主体朝向 + 距离策略。禁止只写「镜头跟随人物」。
3. 新角色首次登场用预兆式引入：预兆信号（局部特写/阴影/倒影/他人反应/物件/声音）
   → 视线匹配或主体交接 → 揭示镜给全貌。第二次登场起直接用正常景别。
4. 运镜条数按冲突强度：对话/日常 1 条；动作/追逐 2 条；高潮/爆发 3 条（组合运镜）。
5. 单镜只允许一个主运镜，不要在同一镜里叠加互相冲突的运镜。
6. 禁止抽象词（氛围感/高级感/电影感/质感超强），一律换成可见物理量：
   「镜头前推 20 厘米」「雨丝斜切画面」「色温 4500K 冷青」。`

/** 提示词守则：挂在 PROMPT_SYS 后面 */
export const PROMPT_WRITING_RULES = `

【词汇与参数规范】
景别（照抄英文进 keyframe_prompt）：远景 establishing wide shot / 全景 full shot /
中景 medium shot / 近景 medium close-up / 特写 close-up / 大特写 extreme close-up。

运镜（照抄英文进 video_prompt）：推 dolly in / 拉 dolly out / 摇 pan / 移 truck /
跟 tracking shot（须带几何限定，如 tracking shot from behind, 2m fixed distance）/
环绕 orbit / 穿越 fly-through / 升降 crane up-down / 手持 handheld（幅度写「±2px 呼吸抖动」）。

机位与光：低角度 low angle / 平视 eye level / 俯拍 high angle / 荷兰角 dutch angle；
伦勃朗侧逆光 Rembrandt rim light / 霓虹色彩分级 neon color grading / 雨夜低照度 low-key rainy night。

每条 video_prompt 必带三项硬参数：色调（冷青 / 暖橙 / 中性灰）、帧率（24fps 标准 /
60fps 流畅 / 120fps 升格）、画质（no overexposure, no noise, clean lines）。

禁止把「电影感」「氛围感」「高级感」写进提示词 —— 这三个词对模型没有约束力，
必须替换成具体运镜、光源方向或色温数值。`
