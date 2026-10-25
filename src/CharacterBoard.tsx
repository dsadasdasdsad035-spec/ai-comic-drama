import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { getProject, type AppSettings, type ProjectData, type Stage, type VoiceOption } from './api'
import type { Pricing } from './pricing'
import type { CharacterSheet } from './characters'
import CharacterCard from './CharacterCard'
import { CapModelSelect, hasTextModels, StageModelSelect, type StagePick } from './ModelSelect'
import { digestEpisodes, digestShots, mergeCharacters, pickExtracted } from './charExtract'
import { dialogueToText } from './prompts'
import {
  type BuiltinResult,
  WORKBENCH_BUILTINS,
  type WorkbenchChatAdapter,
} from './agent/workbenchChat'
import { AgentButton } from './agent/AgentButton'
import { WorkbenchChatAside } from './agent/WorkbenchChatAside'
import { useWorkbenchChatOpen } from './agent/chatPanel'
import WorkbenchBar from './WorkbenchBar'

const LazySkillChat = lazy(() => import('./agent/SkillChat'))

type Props = {
  characters: CharacterSheet[]
  patch: (id: string, p: Partial<CharacterSheet>) => CharacterSheet[]
  selectedShot: { id: string; no: string } | null
  selectedShotBudget?: { used: number; max: number; expression: boolean; omitted: number } | null
  onInject: (charId: string) => void
  /** 可用音色（一镜多说话人时按角色取） */
  voices: VoiceOption[]
  onAdd: () => void
  onDelete: (charId: string) => void
  /** 改名 = 换 id，需要同步连线与布局 */
  onRename: (oldId: string, name: string) => void
  /** 大模型拆角色：本集剧本+分镜 / 全剧素材 */
  onExtract: (scope: 'episode' | 'script', signal?: AbortSignal) => Promise<BuiltinResult>
  extracting: '' | 'episode' | 'script'
  /** 三视图用的图像模型（设置页 view 能力的默认或手选） */
  viewModel?: string
  onPickViewModel: (key: string) => void
  /** App 统一加载的设置；拆角色/三视图的默认都从这里取 */
  settings: AppSettings | null
  stagePick: StagePick
  onPickStage: (stage: Stage, key: string) => void
  /** 计价单价 */
  price?: Pricing
  /** 当前项目：生成的图写入项目媒体目录 */
  projectName: string
  /** 图片/候选变更后立即落库，不等防抖 */
  onPersist: (next: CharacterSheet[]) => void
  /** 将角色表情总图发布/更新为画布素材卡 */
  onPublishSheet: (charId: string) => void
  /** 聊天提交角色草稿：整表替换（合并由聊天 adapter 完成） */
  onReplace: (next: CharacterSheet[]) => void
  /** 当前集，用于角色聊天的本集上下文 */
  epNo: number
  /** App 的短提示 */
  toast: (message: string) => void
  /** 服务端报告的缺失图片引用 */
  missing: Set<string>
  /** 图片加载失败时补记缺失 */
  onImageMissing: (ref: string) => void
  /** 角色卡是否已显示在画布上 */
  charsOn: boolean
  onToggleChars: () => void
}

export default function CharacterBoard({
  characters,
  patch,
  selectedShot,
  selectedShotBudget,
  onInject,
  voices,
  onAdd,
  onDelete,
  onRename,
  onExtract,
  extracting,
  viewModel,
  onPickViewModel,
  settings,
  stagePick,
  onPickStage,
  price,
  projectName,
  onPersist,
  onPublishSheet,
  onReplace,
  epNo,
  toast,
  missing,
  onImageMissing,
  charsOn,
  onToggleChars,
}: Props) {
  const [project, setProject] = useState<ProjectData | null>(null)
  const [chatRunning, setChatRunning] = useState(false)
  /** 空板起始提示：本次会话关掉就不再出现 */
  const [tipOpen, setTipOpen] = useState(true)
  const { open: chatOpen, setOpen: setChatOpen } = useWorkbenchChatOpen('characters')
  const chatVisible = chatOpen && Boolean(projectName)
  const liveRef = useRef(characters)
  liveRef.current = characters

  useEffect(() => {
    let alive = true
    if (!projectName) {
      setProject(null)
      return
    }
    getProject(projectName)
      .then((p) => {
        if (alive) setProject(p)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [projectName])

  const chatAdapter = useMemo<WorkbenchChatAdapter>(
    () => ({
      surface: 'characters',
      skillId: 'character',
      stage: 'character',
      artifact: 'characters',
      writeTool: 'submit_characters',
      writeContract: 'characters-v1',
      threadKey: { project: projectName, surface: 'characters' },
      scope: () => '本集',
      inputs: () => {
        const ep = project?.episodes?.find((x) => Number(x.no) === epNo)
        const shots = (project?.shots ?? []).filter((s) => (Number(s.episode) || 1) === epNo)
        return {
          scopeLabel: `第 ${epNo} 集的剧本场次与分镜`,
          sceneText: ep ? digestEpisodes([ep]) : '',
          shotBlock: shots.length
            ? `\n\n【本集分镜出场与台词】\n${digestShots(
                shots.map((s) => ({
                  no: s.no,
                  cast: s.cast,
                  dialogue: dialogueToText(s.dialogue),
                  prompt: s.keyframe_prompt || s.desc,
                })),
              )}`
            : '',
        }
      },
      ownDraft: () => liveRef.current,
      projectSnapshot: () => getProject(projectName),
      applyDraft: (payload) => {
        const list = pickExtracted(payload)
        if (list.length === 0) return { ok: false, summary: '', error: '没有可写入的角色' }
        const { next, added, filled, skipped } = mergeCharacters(liveRef.current, list)
        liveRef.current = next
        onReplace(next)
        return {
          ok: true,
          summary: `已写入角色草稿：${next.length} 个（新增 ${added.length} / 补空 ${filled.length} / 跳过 ${skipped.length}）`,
          counts: { total: next.length, added: added.length, filled: filled.length, skipped: skipped.length },
        }
      },
      builtins: [
        {
          ...WORKBENCH_BUILTINS.extract_characters_episode,
          disabled: () => {
            if (!projectName) return { disabled: true, reason: '先选择项目' }
            if (extracting) return { disabled: true, reason: '正在拆角色' }
            if (!hasTextModels(settings)) return { disabled: true, reason: '设置页还没有可用的文本模型' }
            return { disabled: false }
          },
          run: (signal) => onExtract('episode', signal),
        },
        {
          ...WORKBENCH_BUILTINS.extract_characters_script,
          disabled: () => {
            if (!projectName) return { disabled: true, reason: '先选择项目' }
            if (extracting) return { disabled: true, reason: '正在拆角色' }
            if (!hasTextModels(settings)) return { disabled: true, reason: '设置页还没有可用的文本模型' }
            return { disabled: false }
          },
          run: (signal) => onExtract('script', signal),
        },
      ],
    }),
    [projectName, epNo, project, onReplace, onExtract, extracting, settings],
  )

  const runExtract = async (scope: 'episode' | 'script') => {
    const r = await onExtract(scope)
    if (!r.ok) {
      if (!r.cancelled) toast(r.error || '拆角色失败')
      return
    }
    toast(r.summary)
  }

  return (
    <div className="board-with-chat">
      <div className="board">
      <WorkbenchBar
        scope={<span className="wb-bar-title">角色</span>}
        scopeDetail={
          <span className="board-hint">
            E{String(epNo).padStart(2, '0')} · {characters.length} 个角色 ·{' '}
            {selectedShot ? `当前镜头 ${selectedShot.no}` : '未选镜头'}
          </span>
        }
        settings={
          <>
            <StageModelSelect
              stage="character"
              label="拆角色模型"
              settings={settings}
              pick={stagePick}
              onChange={onPickStage}
              compact
            />
            <CapModelSelect
              cap="view"
              label="三视图模型"
              settings={settings}
              value={viewModel}
              onChange={onPickViewModel}
              className="wb-field"
            />
          </>
        }
        actions={
          <>
            <AgentButton
              open={chatVisible}
              onToggle={() => setChatOpen((v) => !v)}
              disabled={!projectName}
              running={chatRunning}
              controlsId="workbench-chat-characters"
            />
            <button
              className="btn-ghost"
              disabled={!!extracting}
              onClick={() => void runExtract('script')}
              title="用大模型从全剧原文梗概与分集场次里拆出角色"
            >
              {extracting === 'script' ? '拆解中…' : '从全剧拆'}
            </button>
            <button
              className={characters.length === 0 ? 'btn primary' : 'btn-ghost'}
              disabled={!!extracting}
              onClick={() => void runExtract('episode')}
              title="用大模型从本集剧本场次 + 本集分镜里拆出角色，自动写外观锚点"
            >
              {extracting === 'episode' ? '拆解中…' : '从本集拆角色'}
            </button>
            <button className="btn" onClick={onAdd} title="新建一张角色卡">
              + 新建角色
            </button>
            {characters.length > 0 && (
              <button
                className={charsOn ? 'btn-ghost' : 'btn primary'}
                onClick={onToggleChars}
                title="把角色卡显示到画布上（画布视图可见，可拖到分镜旁）"
              >
                {charsOn ? '角色已在画布' : '全部上画布'}
              </button>
            )}
          </>
        }
      />

      <div className="char-grid">
        {characters.map((c) => (
          <CharacterCard
            key={c.id}
            c={c}
            patch={patch}
            canInject={Boolean(selectedShot)}
            onInject={() => onInject(c.id)}
            voices={voices}
            onDelete={() => onDelete(c.id)}
            onRename={(name) => onRename(c.id, name)}
            viewModel={viewModel}
            audioModelKey={settings?.defaults?.audio}
            price={price}
            projectName={projectName}
            onPersist={onPersist}
            onPublishSheet={() => onPublishSheet(c.id)}
            selectedShot={selectedShot}
            selectedBudget={selectedShotBudget}
            missing={missing}
            onImageMissing={onImageMissing}
          />
        ))}
        {characters.length === 0 && (
          <div className="char-empty-board">
            {tipOpen ? (
              <>
                <span>还没有角色。三视图锁定外观，lookEn 会原样注入到每个镜头的提示词，保证多镜头长相一致。</span>
                <button className="btn-mini ghost" onClick={() => setTipOpen(false)}>
                  知道了
                </button>
              </>
            ) : (
              '还没有角色，点右上角「+ 新建角色」开始'
            )}
          </div>
        )}
      </div>
      </div>
      <WorkbenchChatAside
        surface="characters"
        open={chatVisible}
        onClose={() => setChatOpen(false)}
      >
        {projectName ? (
          <Suspense fallback={<div className="sb-chat-placeholder">正在加载聊天…</div>}>
            <LazySkillChat
              adapter={chatAdapter}
              settings={settings}
              stagePick={stagePick}
              onToast={toast}
              onRunningChange={setChatRunning}
              onClose={() => setChatOpen(false)}
            />
          </Suspense>
        ) : (
          <div className="sb-chat-placeholder">先选择项目，再打开聊天。</div>
        )}
      </WorkbenchChatAside>
    </div>
  )
}
