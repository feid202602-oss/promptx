<script setup>
import { computed, onMounted, ref } from 'vue'
import {
  ArrowUpRight,
  Clock3,
  FileClock,
  Plus,
  RefreshCw,
  SquarePen,
} from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import { createDocument, listDocuments } from '../lib/api.js'
import { getEditToken, setEditToken } from '../lib/tokens.js'

const router = useRouter()
const form = ref({
  title: '',
})
const items = ref([])
const busy = ref(false)
const loading = ref(false)
const error = ref('')

const recentItems = computed(() => items.value.slice(0, 10))

async function loadDocuments() {
  loading.value = true
  error.value = ''
  try {
    const payload = await listDocuments()
    items.value = payload.items
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

async function handleCreate() {
  busy.value = true
  error.value = ''
  try {
    const document = await createDocument({
      title: form.value.title,
      expiry: '24h',
      visibility: 'listed',
    })
    setEditToken(document.slug, document.editToken)
    router.push(`/edit/${document.slug}`)
  } catch (err) {
    error.value = err.message
  } finally {
    busy.value = false
  }
}

onMounted(loadDocuments)
</script>

<template>
  <div class="flex flex-col gap-5">
    <section class="panel flex flex-col gap-4 p-5">
      <div>
        <div class="inline-flex items-center gap-2 rounded-sm border border-dashed border-stone-300 px-3 py-2 text-xs text-stone-600 dark:border-stone-700 dark:text-stone-400">
          <SquarePen class="h-4 w-4" />
          <span>临时需求页</span>
        </div>
        <h1 class="mt-3 text-2xl font-semibold">快速建一个临时页</h1>
        <p class="mt-2 text-sm text-stone-600 dark:text-stone-400">输入标题后开始写。默认公开展示，24 小时后自动过期。</p>
      </div>

      <div class="flex flex-col gap-3 lg:flex-row">
        <input v-model="form.title" class="tool-input flex-1" placeholder="比如：支付页重构需求" @keydown.enter="handleCreate" />
        <button type="button" class="tool-button tool-button-primary inline-flex items-center justify-center gap-2 px-4 py-2 text-sm lg:w-32" :disabled="busy" @click="handleCreate">
          <Plus class="h-4 w-4" />
          <span>{{ busy ? '创建中...' : '新建' }}</span>
        </button>
      </div>

      <p v-if="error" class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
    </section>

    <section class="panel p-0">
      <div class="flex items-center justify-between gap-3 border-b border-stone-200 px-5 py-3 dark:border-stone-800">
        <h2 class="inline-flex items-center gap-2 text-sm font-medium text-stone-600 dark:text-stone-400">
          <FileClock class="h-4 w-4" />
          <span>最近文档</span>
        </h2>
        <button type="button" class="tool-button inline-flex items-center gap-2 px-3 py-2 text-xs" @click="loadDocuments">
          <RefreshCw class="h-4 w-4" />
          <span>{{ loading ? '刷新中...' : '刷新' }}</span>
        </button>
      </div>

      <div v-if="loading && !recentItems.length" class="px-5 py-5 text-sm text-stone-600 dark:text-stone-400">
        正在加载...
      </div>

      <div v-else-if="!recentItems.length" class="px-5 py-5 text-sm text-stone-600 dark:text-stone-400">
        <div class="flex items-center gap-2">
          <SquarePen class="h-4 w-4" />
          <span>还没有文档，先新建一个。</span>
        </div>
      </div>

      <div v-else class="divide-y divide-stone-200 dark:divide-stone-800">
        <article v-for="item in recentItems" :key="item.slug" class="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div class="min-w-0 flex-1">
            <RouterLink :to="`/p/${item.slug}`" class="inline-flex max-w-full items-center gap-2 truncate text-sm font-medium text-stone-900 hover:underline dark:text-stone-100">
              <ArrowUpRight class="h-4 w-4 shrink-0 text-stone-500 dark:text-stone-400" />
              <span class="truncate">{{ item.title || '未命名文档' }}</span>
            </RouterLink>
            <p class="mt-1 truncate text-xs text-stone-500 dark:text-stone-400">{{ item.preview || `/${item.slug}` }}</p>
          </div>

          <div class="flex flex-wrap items-center gap-2 text-xs text-stone-500 dark:text-stone-400 sm:justify-end">
            <span class="inline-flex items-center gap-1">
              <Clock3 class="h-3.5 w-3.5" />
              <span>{{ new Date(item.updatedAt).toLocaleString('zh-CN') }}</span>
            </span>
            <RouterLink v-if="Boolean(getEditToken(item.slug))" :to="`/edit/${item.slug}`" class="tool-button inline-flex items-center gap-2 px-3 py-2 text-xs">
              <SquarePen class="h-4 w-4" />
              <span>编辑</span>
            </RouterLink>
          </div>
        </article>
      </div>
    </section>
  </div>
</template>
