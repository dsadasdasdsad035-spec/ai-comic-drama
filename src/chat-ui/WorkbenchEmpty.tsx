import {
  builtinAvailability,
  builtinLabel,
  type BuiltinAction,
  type WorkbenchProfile,
} from '../agent/workbenchChat'

/** 五个工作台各自的空态；不再复用 3D 聊天的“生成代码/抓帧验收”文案。 */
export function WorkbenchEmpty({
  profile,
  loading,
  actions,
  onRunAction,
  running,
}: {
  profile: WorkbenchProfile
  loading?: boolean
  actions?: BuiltinAction[]
  onRunAction?: (action: BuiltinAction) => void
  running?: boolean
}) {
  return (
    <div data-chat-empty className="px-3 py-4 text-[12px] leading-relaxed">
      <div className="text-[13px] font-semibold text-foreground">
        {loading ? '正在加载助手…' : profile.emptyTitle}
      </div>
      <p className="mt-1 text-muted-foreground">
        {loading ? '技能加载完成后就可以开始。' : profile.emptyBody}
      </p>
      {!loading && actions && actions.length > 0 ? (
        <div data-chat-builtins className="mt-3">
          <p className="text-[11px] text-muted-foreground">从零生成 / 拆解：</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {actions.map((action) => {
              const availability = builtinAvailability(action)
              return (
                <button
                  key={action.key}
                  type="button"
                  className="rounded border border-border bg-background px-2 py-1 text-[11px] text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={Boolean(running) || availability.disabled}
                  onClick={() => onRunAction?.(action)}
                  title={availability.reason || action.hint || builtinLabel(action)}
                >
                  {builtinLabel(action)}
                  {action.scope === 'script' ? ' · 全剧' : ''}
                </button>
              )
            })}
          </div>
          <p className="mt-1.5 text-[10px] text-muted-foreground">
            动作会直接写入工作台草稿，不会占用聊天轮次。
          </p>
        </div>
      ) : null}
      {!loading && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          点下面的示例只填入输入框，不会直接发送。
        </p>
      )}
    </div>
  )
}
