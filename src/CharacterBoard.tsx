import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getProject, type AppSettings, type ProjectData, type Stage } from './api'
import { uploadImageFile } from './mediaUpload'
import { generateImage } from './api'
import { TURNAROUND_SUFFIX } from './characters'
import { imageCost } from './pricing'
import { endTask, startTask } from './tasks'
import type { Pricing } from './pricing'
import { REFERENCE_LIMIT, type CharacterSheet } from './characters'
import { CHAT_ATTACHMENT_LIMIT } from './agent/chatAttachments'
import MediaPicker from './MediaPicker'
import type { PickItem } from './mediaPick'
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
  /** 「从项目选」的弹窗状态与 resolver；用 ref 保存避免 setState 竞态 */
  const [pickerOpen, setPickerOpen] = useState(false)
  const [picking, setPicking] = useState(false)
  const pickResolveRef = useRef<((item: PickItem | null) => void) | null>(null)

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

  /**
   * 回执上的「用它生成三视图」：由用户点击触发，聊天不自作主张生图。
   * 逻辑与 CharacterCard 里的一致（锚点 + 三视图尾巴、cap:'view'、n:2、参考图作身份输入），
   * 但这里要按名字定位角色，因为回执只带了名字。
   */
  const renderTurnaround = useCallback(
    async (names: string[]) => {
      if (!projectName) throw new Error('先选择项目')
      const targets = liveRef.current.filter((c) => names.includes(c.name) || names.includes(c.id))
      const usable = targets.filter((c) => c.lookEn.trim())
      if (!usable.length) {
        throw new Error('这些角色还没有英文外观锚点，先生成锚点再出三视图')
      }
      for (const c of usable) {
        const tid = startTask('image', `三视图 ${c.name}`, {
          cost: price ? imageCost(price, 2) : undefined,
        })
        try {
          const refs = c.referenceImages ?? []
          const res = await generateImage({
            prompt: `${c.lookEn}, ${TURNAROUND_SUFFIX}`,
            ratio: '16:9',
            n: 2,
            cap: 'view',
            modelKey: viewModel,
            project: projectName,
            ...(refs.length ? { refImages: refs } : {}),
          })
          const urls = res.urls?.length ? res.urls : [res.url]
          const next = patch(c.id, {
            candidates: urls,
            activeIdx: 0,
            image: urls[0],
            state: 'idle',
            error: undefined,
          })
          onPersist(next)
          endTask(tid)
        } catch (e) {
          patch(c.id, { state: 'error', error: (e as Error).message })
          endTask(tid, (e as Error).message)
          throw e
        }
      }
    },
    [projectName, viewModel, price, patch, onPersist],
  )

  const chatAdapter = useMemo<WorkbenchChatAdapter>(
    () => ({
      surface: 'characters',
      skillId: 'character',
      stage: 'character',
      artifact: 'characters',
      writeTool: 'submit_characters',
      writeContract: 'characters-v1',
      // 聊天以整板为范围：附件是过程输入，不绑定某个角色，也就不按角色分会话
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
        const { next, added, filled, skipped, updated } = mergeCharacters(liveRef.current, list)
        liveRef.current = next
        onReplace(next)
        // 覆盖要单独点名：用户看到「改写了谁」才知道图和文字冲突时被改了哪些角色
        const overwritten = updated.length ? ` / 覆盖 ${updated.join('、')}` : ''
        return {
          ok: true,
          summary: `已写入角色草稿：${next.length} 个（新增 ${added.length} / 补空 ${filled.length} / 跳过 ${skipped.length}${overwritten}）`,
          counts: {
            total: next.length,
            added: added.length,
            filled: filled.length,
            skipped: skipped.length,
            ...(updated.length ? { updated: updated.length } : {}),
          },
          // 供回执上的「用它生成三视图」定位目标：本次新增与被覆盖的角色
          subjects: [...added, ...updated],
        }
      },
      /**
       * 图片附件是「生成角色的过程输入」：任何时候都能加图，不绑定角色。
       * 上传与选图都只进本次对话，不写任何角色的 referenceImages；
       * 角色参考图仍然只在角色卡上维护，两者互不影响。
       */
      attachments: {
        available: () => [],
        limit: CHAT_ATTACHMENT_LIMIT,
        kinds: ['image'],
        persist: 'thread',
        hint: '图只用于本次对话，不会存进角色卡',
        upload: async (file: File) => {
          const url = await uploadImageFile(file, { project: projectName, prefix: 'chat-ref' })
          return { key: url, kind: 'image' as const, label: file.name || '上传的图片', url }
        },
        pick: async () => {
          // MediaPicker 只列图片：不可选类型在入口就被排除，不会让用户选完再被拒绝
          setPicking(true)
          try {
            const item = await new Promise<PickItem | null>((resolve) => {
              pickResolveRef.current = resolve
              setPickerOpen(true)
            })
            if (!item) return null
            return {
              key: item.url,
              kind: 'image' as const,
              label: item.title || item.name || '项目图片',
              url: item.url,
            }
          } finally {
            setPicking(false)
          }
        },
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
    // 附件来源与项目图片无关角色选择，依赖里不再需要选中态
    [projectName, epNo, project, onReplace, onExtract, extracting, settings, patch, onPersist, toast],
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
            settings={settings}
            onDelete={() => onDelete(c.id)}
            onRename={(name) => onRename(c.id, name)}
            viewModel={viewModel}
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
              onRenderTurnaround={async (names) => {
                try {
                  await renderTurnaround(names)
                  toast(`已为 ${names.join('、')} 生成三视图候选`)
                } catch (e) {
                  toast((e as Error).message || '生成三视图失败')
                }
              }}
              turnaroundCost={price ? imageCost(price, 2) : undefined}
            />
          </Suspense>
        ) : (
          <div className="sb-chat-placeholder">先选择项目，再打开聊天。</div>
        )}
      </WorkbenchChatAside>
      {pickerOpen ? (
        <MediaPicker
          projectName={projectName}
          currentKind="image"
          accept={['image']}
          onConfirm={(item) => {
            const resolve = pickResolveRef.current
            pickResolveRef.current = null
            setPickerOpen(false)
            resolve?.(item)
          }}
          onClose={() => {
            const resolve = pickResolveRef.current
            pickResolveRef.current = null
            setPickerOpen(false)
            resolve?.(null)
          }}
        />
      ) : null}
    </div>
  )
}
