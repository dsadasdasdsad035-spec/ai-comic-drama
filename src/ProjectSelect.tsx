import type { ProjectSummary } from './api'

/** 顶栏全局项目选择：所有视图共享同一个项目上下文 */
export default function ProjectSelect({
  projects,
  value,
  onChange,
}: {
  projects: ProjectSummary[]
  value: string
  onChange: (name: string) => void
}) {
  return (
    <label className="topbar-project" title="所有数据按项目隔离；切换项目会重新加载剧本、镜头、角色和画布">
      <span>项目</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {projects.length === 0 && <option value="">（无项目）</option>}
        {projects.map((p) => (
          <option key={p.name} value={p.name}>
            {p.title || p.name} · {p.shots} 镜
          </option>
        ))}
      </select>
    </label>
  )
}
