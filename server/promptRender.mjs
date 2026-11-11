/** Seedance 2.5 九段模板渲染：系统提示与 JSON 解析 */

export const PROMPT_RENDER_TEMPLATE_VERSION = 'seedance-2.5-cn-9'

export const SEEDANCE_RULES_DIGEST = `遵循 Seedance 2.5：先写资产映射（@图像N/@视频N/@音频N），再写连续时间轴（0–Xs），最后写全局约束（无字幕、无水印、身份连续）。
参考视频只继承运动/机位/节奏；参考图严格继承主体外观与场景；音频参考只继承音色与说话风格。`

/** 与 skills/seedance-prompt-render/SKILL.md 同步；权威来源为设置页技能 */
export const SEEDANCE_NINE_SECTION_TEMPLATE = `# Seedance 2.5 专业视频生成提示词
外四段：素材映射 → 一句话方向 → 连续时间轴 → 音频与约束。
内九节：§1 基本信息 · §2 参考素材 · §3 角色场景 · §4 镜头计划 · §5 环境 · §6 光影 · §7 音频（<> {} ()）· §8 约束 · §9 结束帧。
转场追加：退出 → 桥接 → 进入。`

/** @deprecated 客户端使用 `resolveVideoPromptRenderPrompt`（设置页技能 seedance-prompt-render） */
export function buildPromptRenderSystem() {
  return [
    '【已废弃】请使用设置页技能 seedance-prompt-render 的 role/task。',
    SEEDANCE_NINE_SECTION_TEMPLATE,
    SEEDANCE_RULES_DIGEST,
    '额外输出 JSON（放在正文之后，用 ```json 围栏）：',
    '{ "rendered_prompt": "…", "warnings": ["…"] }',
    'rendered_prompt 必须与正文一致。',
  ].join('\n\n')
}

/** 从模型回复抽出 rendered_prompt */
export function parsePromptRenderResponse(text) {
  const raw = String(text || '').trim()
  if (!raw) return { rendered_prompt: '', warnings: ['空响应'] }
  const fence = raw.match(/```json\s*([\s\S]*?)```/i)
  if (fence) {
    try {
      const j = JSON.parse(fence[1])
      const rp = String(j.rendered_prompt || '').trim()
      if (rp) {
        return {
          rendered_prompt: rp,
          warnings: Array.isArray(j.warnings) ? j.warnings.map(String) : [],
        }
      }
    } catch {
      /* fall through */
    }
  }
  try {
    const j = JSON.parse(raw)
    if (j.rendered_prompt) {
      return {
        rendered_prompt: String(j.rendered_prompt).trim(),
        warnings: Array.isArray(j.warnings) ? j.warnings.map(String) : [],
      }
    }
  } catch {
    /* whole text as prompt */
  }
  return { rendered_prompt: raw, warnings: [] }
}
