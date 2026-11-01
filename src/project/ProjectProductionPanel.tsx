import { useCallback, useEffect, useState } from 'react'
import { getProject, patchProject } from '../api'

type Props = {
  projectName: string
  onSaved?: () => void
}

const ASPECT_OPTIONS = ['16:9', '9:16', '4:3', '3:4', '1:1'] as const

/**
 * 当前项目的制作参数：画风与画幅。全站 Agent 与生图只读此处写入的值。
 */
export default function ProjectProductionPanel({ projectName, onSaved }: Props) {
  const [style, setStyle] = useState('')
  const [aspect, setAspect] = useState('16:9')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')

  const load = useCallback(async () => {
    if (!projectName) return
    setLoading(true)
    setError('')
    setOk('')
    try {
      const p = await getProject(projectName)
      setStyle(p.style ?? '')
      setAspect(p.aspect ?? '16:9')
    } catch (e: unknown) {
      setError((e as Error).message || '读取项目失败')
    } finally {
      setLoading(false)
    }
  }, [projectName])

  useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    if (!projectName) return
    setSaving(true)
    setError('')
    setOk('')
    try {
      await patchProject(projectName, { style: style.trim(), aspect: aspect || '16:9' })
      setOk('已保存制作参数')
      onSaved?.()
    } catch (e: unknown) {
      setError((e as Error).message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  if (!projectName) {
    return <p className="st-hint">请先在顶栏选择项目，再编辑制作参数。</p>
  }

  return (
    <div className="proj-production" data-project-production>
      <h4 className="proj-production-title">制作参数 · {projectName}</h4>
      {loading ? (
        <p className="st-hint">正在加载…</p>
      ) : (
        <>
          <label className="proj-field">
            <span>画风（全片画风锁）</span>
            <input
              data-project-style
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              placeholder="例如：近未来科幻写实"
            />
          </label>
          <label className="proj-field">
            <span>画幅</span>
            <select data-project-aspect value={aspect} onChange={(e) => setAspect(e.target.value)}>
              {ASPECT_OPTIONS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
          <div className="proj-production-actions">
            <button type="button" className="btn primary" data-project-production-save disabled={saving} onClick={() => void save()}>
              {saving ? '保存中…' : '保存制作参数'}
            </button>
          </div>
        </>
      )}
      {error && <p className="proj-error">{error}</p>}
      {ok && <p className="proj-ok">{ok}</p>}
      <p className="st-hint">每集目标时长在剧本分集与镜头表按集编辑；Agent 未设画风时将无法发送。</p>
    </div>
  )
}
