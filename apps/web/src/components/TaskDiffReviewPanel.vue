<script setup>
import { Check, ChevronDown, ChevronUp, CircleAlert, FileDiff, FolderOpen, GitBranch, RefreshCw, Search } from 'lucide-vue-next'
import { useTaskDiffReviewData } from '../composables/useTaskDiffReviewData.js'
import WorkbenchSelect from './WorkbenchSelect.vue'

const props = defineProps({
  taskSlug: {
    type: String,
    default: '',
  },
  preferredScope: {
    type: String,
    default: 'workspace',
  },
  preferredRunId: {
    type: String,
    default: '',
  },
  focusToken: {
    type: Number,
    default: 0,
  },
  active: {
    type: Boolean,
    default: false,
  },
})

const {
  activeHunkIndex,
  baselineMetaText,
  diffPayload,
  diffScope,
  error,
  fileSearch,
  filteredFiles,
  formatRunOptionLabel,
  getFilterButtonClass,
  getFilterLabel,
  getPatchLineClass,
  getRunStatusLabel,
  getStatusClass,
  getStatusLabel,
  jumpToAdjacentHunk,
  loadDiff,
  loading,
  normalizeFileStatus,
  patchLoading,
  patchViewportRef,
  selectedFile,
  selectedFilePath,
  selectedPatchHunks,
  selectedPatchLines,
  selectedRunId,
  setPatchLineRef,
  showSummarySkeleton,
  statsLoading,
  statusCounts,
  statusFilter,
  terminalRuns,
} = useTaskDiffReviewData(props)
</script>

<template>
  <section class="panel flex h-full min-h-0 flex-col overflow-hidden">
    <div class="border-b border-stone-200 px-4 py-3 dark:border-[#39312c]">
      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="tool-button inline-flex items-center gap-2 px-3 py-2 text-xs"
          :class="diffScope === 'workspace' ? 'border-stone-500 bg-stone-100 text-stone-900 dark:border-[#73665c] dark:bg-[#332c27] dark:text-stone-100' : ''"
          @click="diffScope = 'workspace'"
        >
          <span>当前变更</span>
        </button>
        <button
          type="button"
          class="tool-button inline-flex items-center gap-2 px-3 py-2 text-xs"
          :class="diffScope === 'task' ? 'border-stone-500 bg-stone-100 text-stone-900 dark:border-[#73665c] dark:bg-[#332c27] dark:text-stone-100' : ''"
          @click="diffScope = 'task'"
        >
          <span>任务累计</span>
        </button>
        <button
          type="button"
          class="tool-button inline-flex items-center gap-2 px-3 py-2 text-xs"
          :class="diffScope === 'run' ? 'border-stone-500 bg-stone-100 text-stone-900 dark:border-[#73665c] dark:bg-[#332c27] dark:text-stone-100' : ''"
          @click="diffScope = 'run'"
        >
          <span>本轮</span>
        </button>

        <WorkbenchSelect
          v-if="diffScope === 'run'"
          v-model="selectedRunId"
          class="min-w-0 flex-1 sm:max-w-[360px]"
          :options="terminalRuns"
          :loading="loading"
          :get-option-value="(run) => run?.id || ''"
          placeholder="请选择历史执行"
          empty-text="暂无可查看的历史执行"
        >
          <template #trigger="{ selectedOption }">
            <div class="truncate text-xs text-stone-700 dark:text-stone-200">
              {{ selectedOption ? formatRunOptionLabel(selectedOption) : '请选择历史执行' }}
            </div>
          </template>

          <template #header>
            <div class="border-b border-dashed border-stone-300 px-3 py-2 text-[11px] text-stone-500 dark:border-[#544941] dark:text-stone-400">
              共 {{ terminalRuns.length }} 条可审查执行
            </div>
          </template>

          <template #option="{ option, selected, select }">
            <button
              type="button"
              class="w-full rounded-sm border border-dashed px-3 py-2 text-left transition"
              :class="selected
                ? 'border-stone-500 bg-stone-50 dark:border-[#73665c] dark:bg-[#332c27]'
                : 'border-stone-300 bg-white hover:border-stone-500 dark:border-[#453c36] dark:bg-[#26211d] dark:hover:border-[#73665c]'"
              @click="select"
            >
              <div class="flex items-start gap-3">
                <div class="min-w-0 flex-1">
                  <div class="truncate text-xs font-medium text-stone-900 dark:text-stone-100">
                    {{ new Date(option.startedAt || option.createdAt).toLocaleString('zh-CN') }}
                  </div>
                  <div class="mt-1 text-[11px] text-stone-500 dark:text-stone-400">
                    {{ getRunStatusLabel(option) }}
                  </div>
                </div>

                <Check
                  v-if="selected"
                  class="mt-0.5 h-4 w-4 shrink-0 text-stone-700 dark:text-stone-200"
                />
              </div>
            </button>
          </template>
        </WorkbenchSelect>

        <button
          type="button"
          class="tool-button ml-auto inline-flex items-center gap-2 px-3 py-2 text-xs"
          :disabled="loading || statsLoading"
          @click="loadDiff"
        >
          <RefreshCw class="h-3.5 w-3.5" :class="loading ? 'animate-spin' : ''" />
          <span>{{ loading ? '刷新中...' : statsLoading ? '统计中...' : '刷新' }}</span>
        </button>
      </div>
    </div>

    <div v-if="error" class="border-b border-stone-200 px-4 py-3 text-sm text-red-700 dark:border-[#39312c] dark:text-red-300">
      <div class="inline-flex items-start gap-2">
        <CircleAlert class="mt-0.5 h-4 w-4 shrink-0" />
        <span class="break-all">{{ error }}</span>
      </div>
    </div>

    <div v-if="loading && !diffPayload" class="flex flex-1 items-center justify-center px-5 text-sm text-stone-500 dark:text-stone-400">
      正在读取代码变更...
    </div>

    <div v-else-if="diffPayload && !diffPayload.supported" class="flex flex-1 items-center justify-center px-5">
      <div class="w-full max-w-xl rounded-sm border border-dashed border-stone-300 bg-stone-50 px-4 py-5 text-sm text-stone-600 dark:border-[#544941] dark:bg-[#2d2723] dark:text-stone-300">
        <div class="inline-flex items-center gap-2 font-medium text-stone-900 dark:text-stone-100">
          <FileDiff class="h-4 w-4" />
          <span>暂时无法查看代码变更</span>
        </div>
        <p class="mt-2 break-all leading-7">{{ diffPayload.reason || '当前没有可展示的代码变更。' }}</p>
        <div v-if="diffPayload.repoRoot" class="mt-3 flex flex-wrap gap-2 text-xs">
          <div class="inline-flex items-center gap-2 rounded-sm border border-dashed border-stone-300 bg-white/80 px-2.5 py-1.5 text-stone-700 dark:border-[#544941] dark:bg-[#26211d] dark:text-stone-300">
            <FolderOpen class="h-3.5 w-3.5 shrink-0" />
            <span class="break-all">{{ diffPayload.repoRoot }}</span>
          </div>
          <div
            v-if="diffPayload.branch"
            class="inline-flex items-center gap-2 rounded-sm border border-dashed border-emerald-300 bg-emerald-50/90 px-2.5 py-1.5 text-emerald-800 dark:border-[#5b7562] dark:bg-[#243228] dark:text-[#cfe7d5]"
          >
            <GitBranch class="h-3.5 w-3.5 shrink-0" />
            <span>{{ diffPayload.branch }}</span>
          </div>
        </div>
      </div>
    </div>

    <div v-else-if="diffPayload" class="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div class="border-b border-stone-200 px-4 py-3 text-xs text-stone-600 dark:border-[#39312c] dark:text-stone-400">
        <div class="flex flex-wrap items-center gap-2">
          <div
            v-if="diffPayload.repoRoot"
            class="inline-flex min-w-0 items-center gap-2 rounded-sm border border-dashed border-sky-300 bg-sky-50 px-2.5 py-1.5 text-sky-900 dark:border-[#4b6773] dark:bg-[#1f2c33] dark:text-[#cfe7f0]"
          >
            <FolderOpen class="h-3.5 w-3.5 shrink-0" />
            <span class="min-w-0 break-all">{{ diffPayload.repoRoot }}</span>
          </div>
          <div
            class="inline-flex items-center gap-2 rounded-sm border border-dashed border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-emerald-900 dark:border-[#5b7562] dark:bg-[#243228] dark:text-[#deecdf]"
          >
            <GitBranch class="h-3.5 w-3.5 shrink-0" />
            <span>{{ diffPayload.branch || '未识别分支' }}</span>
            <span class="opacity-50">•</span>
            <span class="text-stone-700 dark:text-stone-200">{{ diffPayload.summary?.fileCount || 0 }} 个文件</span>
            <template v-if="diffPayload.summary?.statsComplete">
              <span class="opacity-50">•</span>
              <span class="font-medium text-emerald-700 dark:text-emerald-300">+{{ diffPayload.summary?.additions || 0 }}</span>
              <span class="font-medium text-red-700 dark:text-red-300">-{{ diffPayload.summary?.deletions || 0 }}</span>
            </template>
            <template v-else-if="showSummarySkeleton">
              <span class="opacity-50">•</span>
              <span class="h-3 w-10 animate-pulse rounded bg-emerald-200/80 dark:bg-emerald-900/60" />
              <span class="h-3 w-10 animate-pulse rounded bg-red-200/80 dark:bg-red-900/60" />
            </template>
            <span v-else class="opacity-75">等待统计</span>
          </div>
        </div>
        <p v-if="baselineMetaText" class="mt-2 break-all text-[11px] opacity-75">
          {{ baselineMetaText }}
        </p>
        <div v-if="diffPayload.warnings?.length" class="mt-2 flex flex-col gap-1">
          <p
            v-for="warning in diffPayload.warnings"
            :key="warning"
            class="text-[11px] text-amber-700 dark:text-amber-300"
          >
            {{ warning }}
          </p>
        </div>
      </div>

      <div class="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)] overflow-hidden">
        <div class="min-h-0 overflow-y-auto border-r border-stone-200 bg-stone-50/70 p-3 dark:border-[#39312c] dark:bg-[#221d1a]">
          <div class="mb-3 flex flex-wrap gap-2">
            <button
              v-for="filter in ['all', 'A', 'M', 'D']"
              :key="filter"
              type="button"
              class="rounded-sm border px-2 py-1 text-[11px] transition"
              :class="getFilterButtonClass(filter)"
              @click="statusFilter = filter"
            >
              {{ getFilterLabel(filter) }} {{ statusCounts[filter] || 0 }}
            </button>
          </div>

          <label class="mb-3 flex items-center gap-2 rounded-sm border border-stone-300 bg-white px-3 py-2 text-xs text-stone-500 dark:border-[#453c36] dark:bg-[#26211d] dark:text-stone-400">
            <Search class="h-3.5 w-3.5 shrink-0" />
            <input
              v-model="fileSearch"
              type="text"
              placeholder="搜索文件路径"
              class="min-w-0 flex-1 bg-transparent text-xs text-stone-700 outline-none placeholder:text-stone-400 dark:text-stone-200 dark:placeholder:text-stone-500"
            >
          </label>

          <div
            v-if="showSummarySkeleton"
            class="mb-3 rounded-sm border border-dashed border-stone-300 bg-white/80 px-3 py-2 text-[11px] text-stone-500 dark:border-[#544941] dark:bg-[#26211d] dark:text-stone-400"
          >
            已先展示文件列表，整体增删行数正在后台统计...
          </div>

          <div v-if="!diffPayload.files.length" class="rounded-sm border border-dashed border-stone-300 px-3 py-4 text-xs text-stone-500 dark:border-[#544941] dark:text-stone-400">
            当前范围内还没有检测到代码变更。
          </div>
          <div v-else-if="!filteredFiles.length" class="rounded-sm border border-dashed border-stone-300 px-3 py-4 text-xs text-stone-500 dark:border-[#544941] dark:text-stone-400">
            当前筛选或搜索条件下没有匹配文件。
          </div>

          <div v-else class="space-y-2">
            <button
              v-for="file in filteredFiles"
              :key="file.path"
              type="button"
              class="w-full rounded-sm border px-3 py-2 text-left transition"
              :class="file.path === selectedFilePath
                ? 'border-stone-500 bg-stone-100 text-stone-900 dark:border-[#73665c] dark:bg-[#332c27] dark:text-stone-100'
                : 'border-stone-300 bg-white hover:bg-stone-100 dark:border-[#453c36] dark:bg-[#26211d] dark:text-stone-200 dark:hover:bg-[#2f2924]'"
              @click="selectedFilePath = file.path"
            >
              <div class="flex items-start gap-2">
                <span class="inline-flex shrink-0 rounded-sm border px-1.5 py-0.5 text-[10px]" :class="getStatusClass(file.status)">
                  {{ getStatusLabel(file.status) }}
                </span>
                <div class="min-w-0 flex-1">
                  <div class="break-all text-xs font-medium">{{ file.path }}</div>
                  <div class="mt-1 text-[11px] opacity-75">
                    {{ file.statsLoaded ? `+${file.additions} / -${file.deletions}` : '行数按需统计' }}
                  </div>
                </div>
              </div>
            </button>
          </div>
        </div>

        <div class="min-h-0 overflow-hidden bg-white dark:bg-[#1f1a17]">
          <div v-if="selectedFile" class="flex h-full min-h-0 flex-col overflow-hidden">
            <div class="border-b border-stone-200 px-4 py-3 text-xs text-stone-600 dark:border-[#39312c] dark:text-stone-400">
              <div class="flex items-center gap-3">
                <div class="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  <span class="inline-flex rounded-sm border px-1.5 py-0.5 text-[10px]" :class="getStatusClass(selectedFile.status)">
                    {{ getStatusLabel(selectedFile.status) }}
                  </span>
                  <span class="break-all font-medium text-stone-900 dark:text-stone-100">{{ selectedFile.path }}</span>
                  <span class="opacity-75">
                    {{ selectedFile.statsLoaded ? `+${selectedFile.additions} / -${selectedFile.deletions}` : '行数按需统计' }}
                  </span>
                </div>
                <div
                  class="inline-flex h-8 w-[132px] shrink-0 items-center gap-1 rounded-sm border px-1.5 py-1"
                  :class="selectedPatchHunks.length
                    ? 'border-stone-300 bg-stone-50 dark:border-[#453c36] dark:bg-[#26211d]'
                    : 'pointer-events-none invisible border-transparent'"
                >
                  <button
                    type="button"
                    class="inline-flex h-6 w-6 items-center justify-center rounded-sm text-stone-500 transition hover:bg-stone-200 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-50 dark:text-stone-400 dark:hover:bg-[#332c27] dark:hover:text-stone-100"
                    :disabled="activeHunkIndex <= 0"
                    @click="jumpToAdjacentHunk(-1)"
                  >
                    <ChevronUp class="h-4 w-4" />
                  </button>
                  <span class="min-w-[64px] text-center text-[11px] text-stone-600 dark:text-stone-300">
                    改动 {{ Math.min(activeHunkIndex + 1, selectedPatchHunks.length) }}/{{ selectedPatchHunks.length }}
                  </span>
                  <button
                    type="button"
                    class="inline-flex h-6 w-6 items-center justify-center rounded-sm text-stone-500 transition hover:bg-stone-200 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-50 dark:text-stone-400 dark:hover:bg-[#332c27] dark:hover:text-stone-100"
                    :disabled="activeHunkIndex >= selectedPatchHunks.length - 1"
                    @click="jumpToAdjacentHunk(1)"
                  >
                    <ChevronDown class="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>

            <div v-if="selectedFile.message" class="flex-1 overflow-y-auto px-4 py-4 text-sm text-stone-600 dark:text-stone-300">
              <div class="rounded-sm border border-dashed border-stone-300 bg-stone-50 px-4 py-4 dark:border-[#544941] dark:bg-[#2d2723]">
                {{ selectedFile.message }}
              </div>
            </div>
            <div v-else-if="patchLoading && !selectedFile.patchLoaded" class="flex-1 overflow-y-auto px-4 py-4 text-sm text-stone-500 dark:text-stone-400">
              正在加载该文件的 diff...
            </div>
            <div v-else-if="selectedPatchLines.length" ref="patchViewportRef" class="flex-1 overflow-auto">
              <div class="min-w-max px-4 py-4 font-mono text-[11px] leading-5">
                <div
                  v-for="line in selectedPatchLines"
                  :key="line.id"
                  :ref="(element) => setPatchLineRef(line.id, element)"
                  class="grid grid-cols-[56px_56px_minmax(0,1fr)]"
                  :class="[
                    getPatchLineClass(line.kind),
                    line.kind === 'hunk' && selectedPatchHunks[activeHunkIndex]?.id === line.id
                      ? 'ring-1 ring-inset ring-amber-300 dark:ring-[#b38a4a]'
                      : '',
                  ]"
                >
                  <span class="select-none border-r border-stone-200/70 px-2 py-0.5 text-right opacity-60 dark:border-[#39312c]">
                    {{ line.oldNumber }}
                  </span>
                  <span class="select-none border-r border-stone-200/70 px-2 py-0.5 text-right opacity-60 dark:border-[#39312c]">
                    {{ line.newNumber }}
                  </span>
                  <pre class="overflow-visible whitespace-pre px-3 py-0.5">{{ line.content }}</pre>
                </div>
              </div>
            </div>
            <div v-else class="flex-1 overflow-y-auto px-4 py-4 text-sm text-stone-600 dark:text-stone-300">
              <div class="rounded-sm border border-dashed border-stone-300 bg-stone-50 px-4 py-4 dark:border-[#544941] dark:bg-[#2d2723]">
                当前文件没有可展示的 diff 内容。
              </div>
            </div>
          </div>

          <div v-else class="flex h-full items-center justify-center px-5 text-sm text-stone-500 dark:text-stone-400">
            请选择一个文件查看 diff。
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
