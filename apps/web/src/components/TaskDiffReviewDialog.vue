<script setup>
import { computed } from 'vue'
import { FileDiff } from 'lucide-vue-next'
import { useI18n } from '../composables/useI18n.js'
import DialogShell from './DialogShell.vue'
import TaskDiffReviewPanel from './TaskDiffReviewPanel.vue'

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  taskSlug: {
    type: String,
    default: '',
  },
  taskTitle: {
    type: String,
    default: '',
  },
  preferredScope: {
    type: String,
    default: 'task',
  },
  preferredRunId: {
    type: String,
    default: '',
  },
  focusToken: {
    type: Number,
    default: 0,
  },
})

const emit = defineEmits(['close'])
const { t } = useI18n()

const titleText = computed(() => {
  const taskTitle = String(props.taskTitle || '').trim()
  return taskTitle ? t('diffReview.dialogTitleWithTask', { title: taskTitle }) : t('diffReview.dialogTitle')
})
</script>

<template>
  <DialogShell
    :open="open"
    panel-class="h-full sm:h-[min(90vh,960px)] sm:max-w-[min(96vw,1560px)]"
    body-class="min-h-0 flex-1 overflow-hidden p-3 sm:p-4"
    @close="emit('close')"
  >
    <template #title>
      <div class="theme-heading inline-flex items-center gap-2 text-sm font-medium">
        <FileDiff class="h-4 w-4" />
        <span>{{ titleText }}</span>
      </div>
    </template>

    <TaskDiffReviewPanel
      :task-slug="taskSlug"
      :active="open"
      :preferred-scope="preferredScope"
      :preferred-run-id="preferredRunId"
      :focus-token="focusToken"
    />
  </DialogShell>
</template>
