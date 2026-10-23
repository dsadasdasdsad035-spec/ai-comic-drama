import { useTheme } from './theme'

/**
 * 顶栏日间/夜间切换。
 * 两个选项都保留可见文字；aria-pressed 表达状态，不做纯图标/纯颜色切换。
 */
export default function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  return (
    <div className="theme-toggle" role="group" aria-label="显示模式">
      <button
        type="button"
        data-theme-mode="day"
        className={theme === 'day' ? 'on' : ''}
        aria-pressed={theme === 'day'}
        onClick={() => setTheme('day')}
      >
        <span className="theme-orb sun" aria-hidden="true" />
        日间
      </button>
      <button
        type="button"
        data-theme-mode="night"
        className={theme === 'night' ? 'on' : ''}
        aria-pressed={theme === 'night'}
        onClick={() => setTheme('night')}
      >
        <span className="theme-orb moon" aria-hidden="true" />
        夜间
      </button>
    </div>
  )
}
