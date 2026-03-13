<script setup>
import { Sparkles } from 'lucide-vue-next'
import ThemeToggle from './components/ThemeToggle.vue'
</script>

<template>
  <div class="min-h-full bg-stone-100 text-stone-900 transition-colors dark:bg-stone-950 dark:text-stone-100">
    <header class="border-b border-stone-300 bg-stone-100/90 backdrop-blur dark:border-stone-800 dark:bg-stone-950/90">
      <div class="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <RouterLink to="/" class="inline-flex items-center gap-2 font-mono text-sm font-medium uppercase tracking-[0.2em] text-stone-600 dark:text-stone-400">
          <span class="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-dashed border-stone-300 bg-stone-50 text-stone-700 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200">
            <Sparkles class="h-4 w-4" />
          </span>
          <span>PromptX</span>
        </RouterLink>
        <ThemeToggle />
      </div>
    </header>

    <main class="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <RouterView />
    </main>
  </div>
</template>
