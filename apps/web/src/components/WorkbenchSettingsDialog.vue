<script setup>
import { onBeforeUnmount, watch } from 'vue'
import { Settings2, X } from 'lucide-vue-next'
import ThemeToggle from './ThemeToggle.vue'

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['close'])

function handleKeydown(event) {
  if (!props.open) {
    return
  }

  if (event.key === 'Escape') {
    emit('close')
  }
}

watch(
  () => props.open,
  (open) => {
    document.body.classList.toggle('overflow-hidden', open)
    if (open) {
      window.addEventListener('keydown', handleKeydown)
      return
    }

    window.removeEventListener('keydown', handleKeydown)
  }
)

onBeforeUnmount(() => {
  document.body.classList.remove('overflow-hidden')
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm"
      @click.self="emit('close')"
    >
      <section class="panel flex w-full max-w-xl flex-col overflow-hidden">
        <div class="theme-divider flex items-start justify-between gap-4 border-b px-5 py-4">
          <div>
            <div class="theme-heading inline-flex items-center gap-2 text-sm font-medium">
              <Settings2 class="h-4 w-4" />
              <span>设置</span>
            </div>
            <p class="theme-muted-text mt-1 text-xs leading-5">先把界面主题收到这里，后面其他偏好也可以继续往里放。</p>
          </div>

          <button
            type="button"
            class="theme-icon-button h-8 w-8 shrink-0"
            @click="emit('close')"
          >
            <X class="h-4 w-4" />
          </button>
        </div>

        <div class="space-y-6 px-5 py-5">
          <section class="rounded-sm border border-dashed border-[var(--theme-borderDefault)] bg-[var(--theme-appPanelMuted)] px-4 py-4">
            <ThemeToggle />
          </section>
        </div>
      </section>
    </div>
  </Teleport>
</template>
