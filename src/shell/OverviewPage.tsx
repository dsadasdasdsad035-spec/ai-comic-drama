import { useMemo } from 'react'
import { ArrowRight, Clapperboard, Sparkles } from 'lucide-react'
import type { ProjectShot, ProjectSummary } from '../api'
import type { ViewId } from './nav'

export type OverviewPageProps = {
  project: ProjectSummary
  shots: ProjectShot[]
  episodes: Array<{ no: number; title?: string; targetSeconds?: number }>
  charactersCount: number
  onNavigate: (view: ViewId) => void
  onIntake: () => void
  /** 点集行：切到该集并打开画布 */
  onOpenEpisode?: (no: number) => void
}

type Step = { title: string; detail: string; label: string; run: () => void }

/**
 * 项目概览：一屏说完「这是什么项目、现在卡在哪、下一步点哪里」。
 *
 * 下一步只给一个动作，按「有没有镜头 → 有没有角色 → 缺不缺首帧 → 缺不缺锚点 →
 * 可以出片」的顺序判定；同时把其余动作降级成次要按钮，避免决策瘫痪。
 */
export default function OverviewPage({
  project,
  shots,
  episodes,
  charactersCount,
  onNavigate,
  onIntake,
  onOpenEpisode,
}: OverviewPageProps) {
  const stats = useMemo(() => {
    const eps = new Set<number>()
    for (const s of shots) eps.add(Number(s.episode) || 1)
    const seconds = shots.reduce((acc, s) => acc + (Number(s.seconds) || 0), 0)
    return { episodes: Math.max(eps.size, episodes.length), shots: shots.length, seconds }
  }, [shots, episodes.length])

  const perEpisode = useMemo(() => {
    const map = new Map<number, number>()
    for (const s of shots) {
      const n = Number(s.episode) || 1
      map.set(n, (map.get(n) ?? 0) + 1)
    }
    const declared = episodes.map((e) => Number(e.no) || 1)
    const all = [...new Set([...declared, ...map.keys()])].sort((a, b) => a - b)
    return all.map((no) => ({
      no,
      title: episodes.find((e) => Number(e.no) === no)?.title || '',
      target: episodes.find((e) => Number(e.no) === no)?.targetSeconds,
      shots: map.get(no) ?? 0,
    }))
  }, [shots, episodes])

  const health = project.health
  const next: Step = useMemo(() => {
    if (stats.shots === 0) {
      return {
        title: '先有镜头',
        detail: '导入一份分镜表，或者让创意工作室从一句想法开始拆。',
        label: '导入分镜表',
        run: onIntake,
      }
    }
    if (charactersCount === 0) {
      return {
        title: '补齐角色',
        detail: '角色卡决定首帧提示词里的外观锚点，先拆角色再出图。',
        label: '去创意拆角色',
        run: () => onNavigate('creative'),
      }
    }
    if (health && health.missing_keyframe > 0) {
      return {
        title: `还有 ${health.missing_keyframe} 镜没有首帧`,
        detail: '在画布上按集出首帧；批量出图会先补锚点再请求模型。',
        label: '去画布出首帧',
        run: () => onNavigate('board'),
      }
    }
    if (health && health.missing_anchor > 0) {
      return {
        title: `还有 ${health.missing_anchor} 镜的首帧提示词缺锚点`,
        detail: '画布工具条上的「补齐锚点」可以一次修完当前集。',
        label: '去画布补齐锚点',
        run: () => onNavigate('board'),
      }
    }
    return {
      title: '画面齐了，可以出片',
      detail: '到画布预览成片，或导出 JSON 交给外部流程。',
      label: '打开画布',
      run: () => onNavigate('board'),
    }
  }, [stats.shots, charactersCount, health, onNavigate, onIntake])

  return (
    <div className="ov">
      <header className="ov-head">
        <div className="ov-title">
          <span className="ov-eyebrow">项目概览</span>
          <h1>{project.title || project.name}</h1>
          <p className="ov-sub">
            {project.style || '未写风格'} · {project.aspect} · 更新于{' '}
            {project.updated_at ? new Date(project.updated_at).toLocaleString('zh-CN') : '未保存'}
          </p>
        </div>
        {/* 主操作只有一个：这里保持次级样式，避免和「下一步」抢强调色 */}
        <button type="button" className="btn-ghost" onClick={() => onNavigate('board')}>
          <Clapperboard size={14} aria-hidden /> 打开画布
        </button>
      </header>

      <div className="ov-stats">
        <div className="ov-stat">
          <span>集数</span>
          <b>{stats.episodes}</b>
        </div>
        <div className="ov-stat">
          <span>镜头</span>
          <b>{stats.shots}</b>
        </div>
        <div className="ov-stat">
          <span>总时长</span>
          <b>{Math.round(stats.seconds)}s</b>
        </div>
        <div className="ov-stat">
          <span>角色</span>
          <b>{charactersCount}</b>
        </div>
        <div className={health && health.missing_keyframe > 0 ? 'ov-stat is-warn' : 'ov-stat'}>
          <span>缺首帧</span>
          <b data-ov-missing-keyframe>{health ? health.missing_keyframe : 0}</b>
        </div>
        <div className={health && health.missing_anchor > 0 ? 'ov-stat is-warn' : 'ov-stat'}>
          <span>缺锚点</span>
          <b data-ov-missing-anchor>{health ? health.missing_anchor : 0}</b>
        </div>
      </div>

      <section className={`ov-next ${health?.empty ? 'is-empty' : ''}`} aria-labelledby="ov-next-title">
        <div className="ov-next-copy">
          <span className="ov-eyebrow">下一步</span>
          <h2 id="ov-next-title">{next.title}</h2>
          <p>{next.detail}</p>
        </div>
        <button type="button" className="btn ov-next-cta" onClick={next.run}>
          {next.label} <ArrowRight size={14} aria-hidden />
        </button>
      </section>

      <div className="ov-cols">
        <section className="ov-panel" aria-labelledby="ov-eps-title">
          <h3 id="ov-eps-title">分集</h3>
          {perEpisode.length === 0 ? (
            <p className="ov-muted">还没有分集。导入分镜表后会自动出现。</p>
          ) : (
            <ul className="ov-eps">
              {perEpisode.slice(0, 8).map((e) => (
                <li key={e.no}>
                  <button
                    type="button"
                    className="ov-ep-open"
                    data-ov-ep={e.no}
                    onClick={() => (onOpenEpisode ? onOpenEpisode(e.no) : onNavigate('board'))}
                    title={`打开第 ${e.no} 集画布`}
                  >
                    <span className="ov-ep-no">E{String(e.no).padStart(2, '0')}</span>
                    <span className="ov-ep-title">{e.title || '未命名'}</span>
                    <span className="ov-ep-count">
                      {e.shots} 镜{e.target ? ` · 目标 ${e.target}s` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="ov-panel" aria-labelledby="ov-quick-title">
          <h3 id="ov-quick-title">快捷入口</h3>
          <div className="ov-quick">
            <button type="button" className="ov-quick-btn" onClick={() => onNavigate('creative')}>
              <Sparkles size={15} aria-hidden />
              <b>创意</b>
              <small>从想法拆剧本与分镜</small>
            </button>
            <button type="button" className="ov-quick-btn" onClick={() => onNavigate('chars')}>
              <b>角色</b>
              <small>{charactersCount} 个角色卡</small>
            </button>
            <button type="button" className="ov-quick-btn" onClick={() => onNavigate('assets')}>
              <b>素材</b>
              <small>场景图、参考图与白模</small>
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
