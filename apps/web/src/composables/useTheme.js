import { computed, ref } from 'vue'
import { DEFAULT_THEME_ID, THEME_PRESET_MAP, THEME_PRESETS, THEME_STORAGE_KEY } from '../lib/themes.js'

const themeId = ref(DEFAULT_THEME_ID)
const themeReady = ref(false)
let mediaQuery = null

function getBrowserThemeFallback() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return DEFAULT_THEME_ID
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'promptx-stone-dark'
    : DEFAULT_THEME_ID
}

function resolveTheme(id = '') {
  return THEME_PRESET_MAP[String(id || '').trim()] || THEME_PRESET_MAP[DEFAULT_THEME_ID]
}

function applyThemeToDocument(nextTheme) {
  if (typeof document === 'undefined' || !nextTheme) {
    return
  }

  const root = document.documentElement
  root.dataset.theme = nextTheme.id
  root.classList.toggle('dark', nextTheme.mode === 'dark')
  root.style.colorScheme = nextTheme.mode

  Object.entries(nextTheme.colors || {}).forEach(([token, value]) => {
    root.style.setProperty(`--theme-${token}`, String(value))
  })
}

export function initializeTheme() {
  if (typeof window === 'undefined') {
    return resolveTheme(DEFAULT_THEME_ID)
  }

  const storedThemeId = window.localStorage.getItem(THEME_STORAGE_KEY)
  const nextTheme = resolveTheme(storedThemeId || getBrowserThemeFallback())
  themeId.value = nextTheme.id
  applyThemeToDocument(nextTheme)
  window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme.id)
  themeReady.value = true

  if (!mediaQuery && typeof window.matchMedia === 'function') {
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    mediaQuery.addEventListener?.('change', () => {
      if (window.localStorage.getItem(THEME_STORAGE_KEY)) {
        return
      }
      const fallbackTheme = resolveTheme(getBrowserThemeFallback())
      themeId.value = fallbackTheme.id
      applyThemeToDocument(fallbackTheme)
    })
  }

  return nextTheme
}

export function useTheme() {
  const currentTheme = computed(() => resolveTheme(themeId.value))
  const isDark = computed(() => currentTheme.value.mode === 'dark')

  function setTheme(nextThemeId) {
    const nextTheme = resolveTheme(nextThemeId)
    themeId.value = nextTheme.id

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme.id)
    }

    applyThemeToDocument(nextTheme)
    themeReady.value = true
  }

  return {
    currentTheme,
    isDark,
    setTheme,
    themeId,
    themeReady,
    themes: THEME_PRESETS,
  }
}
