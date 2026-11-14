import { useEffect, useState } from 'react'
import type { CreativeToolParamConfirmRequest } from './creativeToolParamGate'

export type ToolParamPrompt = CreativeToolParamConfirmRequest & {
  resolve: (ok: boolean, episode?: number) => void
}

/**
 * 平台分镜类工具执行前的集号确认。
 * 用户可改集号；取消则工具返回「用户取消了工具调用」。
 */
export function ToolParamConfirmDialog({ prompt, onResolve }: { prompt: ToolParamPrompt; onResolve: (ok: boolean, episode?: number) => void }) {
  const [episode, setEpisode] = useState(String(prompt.episode))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onResolve(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onResolve])

  const projectLine = prompt.projectName.trim() ? `项目「${prompt.projectName.trim()}」` : '未选项目'

  return (
    <div data-tool-param-dialog className="creative-dialog-scrim" role="dialog" aria-modal="true" aria-label="确认工具参数">
      <div className="creative-dialog">
        <h3>确认调用：{prompt.toolLabel}</h3>
        <dl className="creative-dialog-rows">
          <div>
            <dt>范围</dt>
            <dd>{projectLine}</dd>
          </div>
          <div>
            <dt>工具</dt>
            <dd>
              <code>{prompt.toolName}</code>
            </dd>
          </div>
          {prompt.modelEpisode !== undefined && prompt.modelEpisode !== prompt.episode ? (
            <div>
              <dt>模型提议集号</dt>
              <dd>第 {prompt.modelEpisode} 集</dd>
            </div>
          ) : null}
        </dl>
        <label className="creative-dialog-field">
          <span>操作集号</span>
          <input
            type="number"
            min={1}
            step={1}
            value={episode}
            onChange={(e) => setEpisode(e.target.value)}
            data-tool-param-episode
          />
        </label>
        <p className="creative-dialog-note">读分镜类工具将把所选集号写入请求；写回类工具将把草稿合并到该集。</p>
        <div className="creative-dialog-actions">
          <button type="button" className="btn" onClick={() => onResolve(false)}>
            取消
          </button>
          <button
            type="button"
            className="btn primary"
            data-tool-param-confirm
            onClick={() => {
              const n = Math.max(1, Math.floor(Number(episode) || prompt.episode))
              onResolve(true, n)
            }}
          >
            确认执行
          </button>
        </div>
      </div>
    </div>
  )
}