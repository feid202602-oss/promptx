<script setup>
defineProps({
  modelValue: {
    type: String,
    default: '',
  },
  sections: {
    type: Array,
    default: () => [],
  },
})

const emit = defineEmits(['update:modelValue'])

function selectSection(sectionId = '') {
  emit('update:modelValue', String(sectionId || ''))
}
</script>

<template>
  <aside class="theme-divider settings-dialog-nav border-b px-3 py-3 sm:w-60 sm:shrink-0 sm:border-b-0 sm:border-r sm:px-4 sm:py-4">
    <nav class="settings-nav flex gap-2 overflow-x-auto sm:flex-col sm:overflow-visible">
      <button
        v-for="section in sections"
        :key="section.id"
        type="button"
        class="settings-nav__item flex min-w-0 items-start gap-3 rounded-sm border px-3 py-3 text-left transition sm:w-full"
        :class="modelValue === section.id
          ? 'theme-card-selected'
          : 'theme-card-idle-muted border-dashed hover:border-[var(--theme-borderStrong)] hover:bg-[var(--theme-appPanelStrong)]'"
        @click="selectSection(section.id)"
      >
        <component :is="section.icon" class="mt-0.5 h-4 w-4 shrink-0" />
        <div class="min-w-0">
          <div class="text-sm font-medium">{{ section.label }}</div>
          <p class="theme-muted-text mt-1 hidden text-xs leading-5 sm:block">{{ section.description }}</p>
        </div>
      </button>
    </nav>
  </aside>
</template>
