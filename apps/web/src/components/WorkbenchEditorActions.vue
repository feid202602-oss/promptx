<script setup>
import { List, Plus, SendHorizontal, Upload, WandSparkles } from 'lucide-vue-next'

defineProps({
  canAddTodo: {
    type: Boolean,
    default: false,
  },
  isCurrentTaskSending: {
    type: Boolean,
    default: false,
  },
  todoCount: {
    type: Number,
    default: 0,
  },
})

const emit = defineEmits([
  'add-todo',
  'open-file-picker',
  'clear-request',
  'copy-request',
  'manage-todo',
  'send-request',
])
</script>

<template>
  <button
    type="button"
    class="tool-button inline-flex w-full items-center justify-center gap-1.5 px-2 py-2 text-xs sm:w-auto sm:gap-2 sm:px-3"
    @click="emit('open-file-picker')"
  >
    <Upload class="h-4 w-4" />
    <span>选文件</span>
  </button>
  <button
    type="button"
    class="tool-button inline-flex w-full items-center justify-center gap-1.5 px-2 py-2 text-xs sm:w-auto sm:gap-2 sm:px-3"
    @click="emit('clear-request')"
  >
    <WandSparkles class="h-4 w-4" />
    <span>清空</span>
  </button>
  <button
    type="button"
    class="tool-button inline-flex w-full items-center justify-center gap-1.5 px-2 py-2 text-xs sm:w-auto sm:gap-2 sm:px-3"
    :disabled="!canAddTodo"
    @click="emit('add-todo')"
  >
    <Plus class="h-4 w-4" />
    <span>代办</span>
  </button>
  <button
    type="button"
    class="tool-button inline-flex w-full items-center justify-center gap-1.5 px-2 py-2 text-xs sm:w-auto sm:gap-2 sm:px-3"
    @click="emit('manage-todo')"
  >
    <List class="h-4 w-4" />
    <span>{{ todoCount > 0 ? `代办 (${todoCount})` : '代办' }}</span>
  </button>
  <button
    type="button"
    class="tool-button inline-flex w-full items-center justify-center gap-1.5 px-2 py-2 text-xs sm:w-auto sm:gap-2 sm:px-3"
    :disabled="isCurrentTaskSending"
    @click="emit('send-request')"
  >
    <SendHorizontal class="h-4 w-4" />
    <span>发送</span>
  </button>
</template>
