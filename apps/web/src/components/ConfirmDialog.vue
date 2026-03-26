<script setup>
import { computed } from 'vue'
import { TriangleAlert } from 'lucide-vue-next'
import DialogShell from './DialogShell.vue'
import { useI18n } from '../composables/useI18n.js'

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  title: {
    type: String,
    default: '',
  },
  description: {
    type: String,
    default: '',
  },
  confirmText: {
    type: String,
    default: '',
  },
  cancelText: {
    type: String,
    default: '',
  },
  loading: {
    type: Boolean,
    default: false,
  },
  danger: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['cancel', 'confirm'])
const { t } = useI18n()

const resolvedTitle = computed(() => props.title || t('common.confirm'))
const resolvedConfirmText = computed(() => props.confirmText || t('common.confirm'))
const resolvedCancelText = computed(() => props.cancelText || t('common.cancel'))

</script>

<template>
  <DialogShell
    :open="open"
    backdrop-class="z-[90] items-center justify-center px-4"
    panel-class="max-w-md"
    header-class="px-5 py-4"
    body-class="flex flex-col"
    :close-disabled="loading"
    :close-on-backdrop="!loading"
    :close-on-escape="!loading"
    @close="emit('cancel')"
  >
    <template #title>
      <div class="flex items-start gap-3">
        <span
          class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-sm border border-dashed"
          :class="danger ? 'theme-status-danger' : 'theme-status-neutral'"
        >
          <TriangleAlert class="h-4 w-4" />
        </span>
        <div>
          <h2 class="theme-heading text-base font-semibold">{{ resolvedTitle }}</h2>
          <p v-if="description" class="theme-muted-text mt-1 text-sm leading-6">{{ description }}</p>
        </div>
      </div>
    </template>

    <div class="flex justify-end gap-2 px-5 py-4">
      <button type="button" class="tool-button px-4 py-2 text-sm" :disabled="loading" @click="emit('cancel')">
        {{ resolvedCancelText }}
      </button>
      <button
        type="button"
        class="tool-button px-4 py-2 text-sm"
        :class="danger ? 'tool-button-danger' : 'tool-button-primary'"
        :disabled="loading"
        @click="emit('confirm')"
      >
        {{ loading ? t('common.processing') : resolvedConfirmText }}
      </button>
    </div>
  </DialogShell>
</template>
