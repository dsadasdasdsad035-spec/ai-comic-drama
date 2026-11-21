import type { ProjectEpisode, ProjectShot } from './api'
import type { CharacterSheet } from './characters'
import { auditVideoPrompt } from './promptAudit'

type Props = {
  shot: ProjectShot
  episodeShots: ProjectShot[]
  episodes: ProjectEpisode[]
  chars: CharacterSheet[]
  /** 已解析的参考集摘要 */
  refs?: Array<{ kind?: string; name?: string }>
  castSceneNames?: string[]
  propNames?: string[]
}

/**
 * 视频提示词审计的只读展示。
 *
 * 与 Agent 写回共用同一个审计核（`auditVideoPrompt`），所以两边结论一致。
 * 不适用项折叠为一行计数，避免把「本镜不需要」渲染成问题。
 */
export default function VideoPromptAuditPanel({
  shot,
  episodeShots,
  episodes,
  chars,
  refs,
  castSceneNames,
  propNames,
}: Props) {
  const audit = auditVideoPrompt({
    shot,
    episodeShots,
    episodes,
    chars,
    refs,
    castSceneNames,
    propNames,
  })

  const issues = [...audit.blockers, ...audit.warnings]
  const skipped = audit.checks.filter((c) => !c.applicable).length
  const state = audit.blockers.length > 0 ? 'block' : audit.warnings.length > 0 ? 'warn' : 'pass'

  return (
    <div className="vp-audit" data-video-prompt-audit={state}>
      <div className="vp-audit-head">
        <span className="vp-audit-title">提示词合规</span>
        <span className={`vp-audit-badge ${state}`}>
          {state === 'block'
            ? `${audit.blockers.length} 项硬问题`
            : state === 'warn'
              ? `${audit.warnings.length} 项提示`
              : '通过'}
        </span>
        {skipped > 0 ? <span className="vp-audit-skipped">本镜不涉及 {skipped} 项</span> : null}
      </div>

      {issues.length > 0 ? (
        <ul className="vp-audit-list">
          {issues.map((c) => (
            <li key={c.id} className={c.level === 'error' ? 'is-error' : 'is-warn'} data-audit-id={c.id}>
              <span className="vp-audit-id">{c.id}</span>
              <span className="vp-audit-evidence">{c.evidence}</span>
              {c.hint ? <span className="vp-audit-hint">{c.hint}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="vp-audit-ok">正文已覆盖本镜涉及的检查项。</p>
      )}
    </div>
  )
}
