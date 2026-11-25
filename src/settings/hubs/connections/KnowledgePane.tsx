import { useEffect } from 'react'
import type { SettingsWorkbench } from '../../useSettingsWorkbench'

type Props = { wb: SettingsWorkbench }

/**
 * 知识库连接配置。
 *
 * 挂在「连接与模型」枢纽下，与渠道 Key、DTK 同类：它配的是一个外部服务的地址与凭据。
 * Key 回读永远只有「已配置」状态，没有回显原文的路径。
 *
 * 上游还需要它自己的 LLM 与 embedder 才能回答问题，这不是本应用能替它配的，
 * 所以这里给一份检查清单而不是假装一步到位。
 */
export function KnowledgePane({ wb }: Props) {
  const { knowledge, knowledgeKeyInput, setKnowledgeKeyInput } = wb
  const fromEnv = knowledge.compact || { baseUrlFromEnv: false, apiKeyFromEnv: false }

  // 面板打开时重拉一次：别的入口（知识库页的引导态）可能刚保存过配置
  useEffect(() => {
    void wb.refreshKnowledgeSettings()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <section className="st-sec" data-settings-pane="knowledge">
      <header className="st-sec-head">
        <h3>知识库</h3>
        <span className="st-hint">
          连接一个外部文档知识服务（AnythingLLM）。未配置时知识库视图只显示引导，其它功能不受影响。
        </span>
      </header>

      {knowledge.builtin ? (
        <div className="st-hint" data-knowledge-builtin style={{ marginBottom: 10 }}>
          <p style={{ margin: 0 }}>
            <strong>桌面版已内置知识库</strong>，随应用启动，地址与 Key 由应用自动管理。
            下面的地址与 Key 输入框在内置模式下<b>不生效</b> —— 内置实例每次启动端口都不同，
            手填的地址会被覆盖。
          </p>
          <p style={{ margin: '6px 0 0' }}>
            想改用你自己的 AnythingLLM：设置环境变量 <code>SB_DISABLE_BUILTIN_KNOWLEDGE=1</code>
            启动应用，再在这里手填地址与 Key。
          </p>
        </div>
      ) : null}

      <div className="st-grid">
        <label className="st-field">
          <span>
            服务地址
            {fromEnv.baseUrlFromEnv ? <em className="st-env-tag">来自环境变量</em> : null}
          </span>
          <input
            className="input"
            data-knowledge-base-url
            readOnly={Boolean(knowledge.builtin)}
            value={knowledge.baseUrl}
            placeholder={knowledge.defaultBaseUrl || 'http://127.0.0.1:3001'}
            onChange={(e) => wb.setKnowledge((prev) => ({ ...prev, baseUrl: e.target.value.trim() }))}
          />
          <small className="st-hint">
            只填到端口，不要带 <code>/api</code>。本机服务会直连，不走系统代理。
          </small>
        </label>

        <label className="st-field">
          <span>上游对话模型</span>
          <input
            className="input"
            data-knowledge-llm-model
            value={knowledge.llmModel || ''}
            placeholder="MiniMax-M3.1-Flash"
            onChange={(e) => wb.setKnowledge((prev) => ({ ...prev, llmModel: e.target.value.trim() }))}
          />
          <small className="st-hint">
            点「保存并测试连接」时，会把本应用已配好的 MiniMax 渠道连同这个模型名推给上游，
            不需要再去 AnythingLLM 界面手填一遍。留空用默认值。
          </small>
        </label>

        <label className="st-field">
          <span>
            API Key
            {fromEnv.apiKeyFromEnv ? <em className="st-env-tag">来自环境变量</em> : null}
          </span>
          <input
            className="input"
            type="password"
            data-knowledge-api-key
            readOnly={Boolean(knowledge.builtin)}
            value={knowledgeKeyInput}
            placeholder={knowledge.hasApiKey ? '已配置（留空则保持不变）' : '在 AnythingLLM 设置 → API Keys 生成'}
            onChange={(e) => setKnowledgeKeyInput(e.target.value)}
          />
          <small className="st-hint">
            {knowledge.hasApiKey
              ? '已保存的 Key 不会回显；要更换直接输入新的。'
              : 'Key 只存在服务端，浏览器永远拿不到原文。'}
          </small>
        </label>
      </div>

      <div className="st-actions" style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn"
          data-knowledge-test
          disabled={wb.knowledgeTesting || !knowledge.baseUrl}
          onClick={() => void wb.testKnowledgeConnection()}
        >
          {wb.knowledgeTesting ? '检测中…' : '保存并测试连接'}
        </button>
        <button
          type="button"
          className="btn-ghost"
          data-knowledge-clear-key
          disabled={!knowledge.hasApiKey}
          onClick={() => {
            wb.setKnowledge((prev) => ({ ...prev, hasApiKey: false }))
            wb.setKnowledgeKeyInput('')
            // 走完整保存：服务端 mergeKbSettings 的 clearApiKey 是显式清空语义
            void wb.saveWithKnowledge({ clearApiKey: true })
          }}
        >
          清除已保存的 Key
        </button>
      </div>

      {wb.knowledgeTestResult ? (
        <div className="st-ok" data-knowledge-test-ok style={{ marginTop: 12 }}>
          <div>
            连接成功：{wb.knowledgeTestResult.baseUrl}，上游有{' '}
            {wb.knowledgeTestResult.workspaceCount} 个知识库。
          </div>
          {wb.knowledgeTestResult.llm ? (
            wb.knowledgeTestResult.llm.ok ? (
              <div data-knowledge-llm-ok style={{ marginTop: 4 }}>
                已把对话模型推给上游（{wb.knowledgeTestResult.llmSource || '本应用渠道'} ·{' '}
                {wb.knowledgeTestResult.llm.written?.length || 0} 项）。
              </div>
            ) : (
              <div data-knowledge-llm-fail style={{ marginTop: 4, color: 'var(--muted)' }}>
                连接正常，但自动配置对话模型失败：{wb.knowledgeTestResult.llm.error}
                <br />
                请到 AnythingLLM 界面手工选 generic-openai 并填 MiniMax 的地址与 Key。
              </div>
            )
          ) : (
            <div data-knowledge-llm-none style={{ marginTop: 4, color: 'var(--muted)' }}>
              本应用还没有可用的 MiniMax 渠道，未自动配置上游模型。请先到「渠道」页配置 MiniMax。
            </div>
          )}
        </div>
      ) : null}
      {wb.knowledgeTestError ? (
        <div className="st-err" data-knowledge-test-error style={{ marginTop: 12 }}>
          {wb.knowledgeTestError}
        </div>
      ) : null}

      <div className="st-hint" data-knowledge-checklist style={{ marginTop: 16 }}>
        <p style={{ margin: '0 0 8px' }}>
          <strong>上游还需要配两样东西</strong>——它们属于 AnythingLLM，不归本应用管：
        </p>
        <ol style={{ margin: 0, paddingLeft: '1.25rem' }}>
          <li>
            一个<strong>对话模型</strong>（LLM）：没有它，上传能成功但问答会失败。
          </li>
          <li>
            一个<strong>向量化模型</strong>（embedder）：Keep default 即可，开源内置，不需要额外 Key。
          </li>
          <li>
            在它的界面里生成 <strong>API Key</strong> 并填回上一栏。
          </li>
        </ol>
        <p style={{ margin: '8px 0 0' }}>
          知识库问答消耗的是上游模型额度，不计入本应用的计费与钱包。
        </p>
      </div>
    </section>
  )
}
