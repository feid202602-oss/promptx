<script setup>
import { MoonStar, SunMedium } from 'lucide-vue-next'
import { useTheme } from '../composables/useTheme.js'

const { isDark, toggleTheme } = useTheme()
</script>

<template>
  <button class="tool-button inline-flex items-center gap-2 px-3 py-2 text-xs" type="button" @click="toggleTheme">
    <SunMedium v-if="isDark" class="h-4 w-4" />
    <MoonStar v-else class="h-4 w-4" />
    <span>{{ isDark ? '浅色模式' : '深色模式' }}</span>
  </button>
</template>
