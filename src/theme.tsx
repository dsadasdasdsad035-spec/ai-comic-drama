import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

export type ThemeMode = 'day' | 'night'

export const THEME_KEY = 'storyboard-theme'

export type ThemeColors = {
  canvasDot: string
  minimapBg: string
  minimapNode: string
  minimapMask: string
  konvaBlank: string
  konvaGuide: string
  edgeCut: string
  edgeTransition: string
  edgeFlashback: string
  edgeBranch: string
}

/** React Flow / Konva 不解析 CSS 变量，这些颜色必须给出具体值 */
export const THEME_COLORS: Record<ThemeMode, ThemeColors> = {
  night: {
    canvasDot: '#1e2a38',
    minimapBg: '#0b1220',
    minimapNode: '#1f3b52',
    minimapMask: 'rgba(6, 10, 16, 0.72)',
    konvaBlank: '#0b1220',
    konvaGuide: '#ffffff',
    edgeCut: '#38bdf8',
    edgeTransition: '#a3e635',
    edgeFlashback: '#c084fc',
    edgeBranch: '#fbbf24',
  },
  day: {
    canvasDot: '#cfc6b8',
    minimapBg: '#fffdf8',
    minimapNode: '#c3b8a8',
    minimapMask: 'rgba(244, 241, 234, 0.72)',
    konvaBlank: '#e4ddd1',
    konvaGuide: 'rgba(29, 39, 51, 0.55)',
    edgeCut: '#0e7490',
    edgeTransition: '#4d7c0f',
    edgeFlashback: '#7e22ce',
    edgeBranch: '#b45309',
  },
}

export function applyTheme(mode: ThemeMode) {
  document.documentElement.dataset.theme = mode
  document.documentElement.style.colorScheme = mode === 'day' ? 'light' : 'dark'
}

function readStoredTheme(): ThemeMode | null {
  try {
    const v = localStorage.getItem(THEME_KEY)
    return v === 'day' || v === 'night' ? v : null
  } catch {
    return null
  }
}

function systemTheme(): ThemeMode {
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'day' : 'night'
  } catch {
    return 'night'
  }
}

function readInitialTheme(): ThemeMode {
  const root = document.documentElement.dataset.theme
  if (root === 'day' || root === 'night') return root
  return readStoredTheme() ?? systemTheme()
}

type ThemeContextValue = {
  theme: ThemeMode
  colors: ThemeColors
  setTheme: (mode: ThemeMode) => void
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'night',
  colors: THEME_COLORS.night,
  setTheme: () => {},
})

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(readInitialTheme)
  const [followSystem, setFollowSystem] = useState(() => readStoredTheme() === null)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    if (!followSystem) return
    let mq: MediaQueryList
    try {
      mq = window.matchMedia('(prefers-color-scheme: light)')
    } catch {
      return
    }
    const onChange = () => setThemeState(mq.matches ? 'day' : 'night')
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [followSystem])

  const setTheme = useCallback((mode: ThemeMode) => {
    setThemeState(mode)
    setFollowSystem(false)
    applyTheme(mode)
    try {
      localStorage.setItem(THEME_KEY, mode)
    } catch {
      /* 本地存储不可用时当前会话仍然有效 */
    }
  }, [])

  const value = useMemo(
    () => ({ theme, colors: THEME_COLORS[theme], setTheme }),
    [theme, setTheme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  return useContext(ThemeContext)
}
