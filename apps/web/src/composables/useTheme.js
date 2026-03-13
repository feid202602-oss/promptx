import { computed, ref } from 'vue'

const STORAGE_KEY = 'promptx:theme'
const theme = ref(window.localStorage.getItem(STORAGE_KEY) || 'light')

document.documentElement.classList.toggle('dark', theme.value === 'dark')

export function useTheme() {
  const isDark = computed(() => theme.value === 'dark')

  function toggleTheme() {
    theme.value = theme.value === 'dark' ? 'light' : 'dark'
    window.localStorage.setItem(STORAGE_KEY, theme.value)
    document.documentElement.classList.toggle('dark', theme.value === 'dark')
  }

  return { isDark, toggleTheme }
}
