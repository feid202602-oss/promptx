<script setup>
import { computed, onBeforeUnmount, watch } from 'vue'
import { ArrowUpLeft, Clock3, FileText, Image as ImageIcon, List, Trash2, X } from 'lucide-vue-next'

const props = defineProps({
  items: {
    type: Array,
    default: () => [],
  },
  open: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['close', 'delete', 'use'])

const formattedItems = computed(() => (
  (props.items || []).map((item) => {
    const blocks = Array.isArray(item?.blocks) ? item.blocks : []
    const textPreview = blocks
      .find((block) => ['text', 'imported_text'].includes(String(block?.type || '')) && String(block?.content || '').trim())
      ?.content || ''
    const preview = String(textPreview || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120)
    const imageCount = blocks.filter((block) => String(block?.type || '') === 'image').length
    const importedCount = blocks.filter((block) => String(block?.type || '') === 'imported_text').length
    const textCount = blocks.filter((block) => String(block?.type || '') === 'text' && String(block?.content || '').trim()).length

    return {
      ...item,
      blockCount: blocks.length,
      imageCount,
      importedCount,
      preview: preview || (imageCount ? `包含 ${imageCount} 张图片` : '暂时没有可预览的文本内容'),
      textCount,
      timeLabel: formatCreatedAt(item?.createdAt),
    }
  })
))

function formatCreatedAt(value = '') {
  const timestamp = Date.parse(String(value || ''))
  if (!timestamp) {
    return '刚刚添加'
  }

  try {
    return new Intl.DateTimeFormat('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(timestamp))
  } catch {
    return String(value || '')
  }
}

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
  },
  { immediate: true }
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
      class="theme-modal-backdrop fixed inset-0 z-[70] flex items-center justify-center px-4 py-6"
      @click.self="emit('close')"
    >
      <section class="panel flex h-full w-full max-w-3xl flex-col overflow-hidden sm:h-[40rem] sm:max-h-[86vh]">
        <div class="theme-divider flex items-start justify-between gap-4 border-b px-5 py-4">
          <div class="min-w-0">
            <div class="theme-heading inline-flex items-center gap-2 text-sm font-medium">
              <List class="h-4 w-4" />
              <span>管理代办</span>
            </div>
            <p class="theme-muted-text mt-1 text-xs leading-5">
              把临时想法先挂在当前任务下，需要时再取回编辑区继续整理。
            </p>
          </div>

          <button
            type="button"
            class="theme-icon-button h-8 w-8 shrink-0"
            @click="emit('close')"
          >
            <X class="h-4 w-4" />
          </button>
        </div>

        <div class="theme-divider flex items-center justify-between gap-3 border-b border-dashed px-5 py-3 text-xs">
          <span class="theme-muted-text">当前任务共 {{ formattedItems.length }} 条代办</span>
          <span class="theme-status-neutral inline-flex items-center rounded-sm border border-dashed px-2 py-1">
            使用后会回填到编辑区并从列表移除
          </span>
        </div>

        <div v-if="formattedItems.length" class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div class="space-y-3">
            <article
              v-for="item in formattedItems"
              :key="item.id"
              class="theme-card-idle-muted rounded-sm border border-dashed p-4"
            >
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="min-w-0 flex-1">
                  <div class="theme-heading flex flex-wrap items-center gap-2 text-sm font-medium">
                    <span>代办</span>
                    <span class="theme-status-neutral inline-flex items-center gap-1 rounded-sm border border-dashed px-2 py-0.5 text-[11px]">
                      <Clock3 class="h-3.5 w-3.5" />
                      {{ item.timeLabel }}
                    </span>
                  </div>
                  <p class="mt-2 whitespace-pre-wrap break-words text-sm leading-6">
                    {{ item.preview }}
                  </p>
                  <div class="theme-muted-text mt-3 flex flex-wrap items-center gap-2 text-[11px]">
                    <span class="rounded-sm border border-dashed px-2 py-1">
                      共 {{ item.blockCount }} 个块
                    </span>
                    <span
                      v-if="item.textCount"
                      class="inline-flex items-center gap-1 rounded-sm border border-dashed px-2 py-1"
                    >
                      <FileText class="h-3.5 w-3.5" />
                      文本 {{ item.textCount }}
                    </span>
                    <span
                      v-if="item.importedCount"
                      class="inline-flex items-center gap-1 rounded-sm border border-dashed px-2 py-1"
                    >
                      <FileText class="h-3.5 w-3.5" />
                      导入 {{ item.importedCount }}
                    </span>
                    <span
                      v-if="item.imageCount"
                      class="inline-flex items-center gap-1 rounded-sm border border-dashed px-2 py-1"
                    >
                      <ImageIcon class="h-3.5 w-3.5" />
                      图片 {{ item.imageCount }}
                    </span>
                  </div>
                </div>

                <div class="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    class="tool-button inline-flex items-center gap-2 px-3 py-2 text-xs"
                    @click="emit('use', item.id)"
                  >
                    <ArrowUpLeft class="h-4 w-4" />
                    <span>使用</span>
                  </button>
                  <button
                    type="button"
                    class="tool-button tool-button-danger-subtle inline-flex items-center gap-2 px-3 py-2 text-xs"
                    @click="emit('delete', item.id)"
                  >
                    <Trash2 class="h-4 w-4" />
                    <span>删除</span>
                  </button>
                </div>
              </div>
            </article>
          </div>
        </div>

        <div v-else class="theme-empty-state flex min-h-0 flex-1 items-center justify-center px-6 py-10 text-sm">
          还没有代办，先把编辑区里的临时想法收进来吧。
        </div>
      </section>
    </div>
  </Teleport>
</template>
