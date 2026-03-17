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
    <div class="theme-divider border-b px-4 py-3">
      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="tool-button inline-flex items-center gap-2 px-3 py-2 text-xs"
          :class="diffScope === 'workspace' ? 'theme-filter-active' : ''"
          @click="diffScope = 'workspace'"
        >
          <span>当前变更</span>
        </button>
        <button
          type="button"
          class="tool-button inline-flex items-center gap-2 px-3 py-2 text-xs"
          :class="diffScope === 'task' ? 'theme-filter-active' : ''"
          @click="diffScope = 'task'"
        >
          <span>任务累计</span>
        </button>
        <button
          type="button"
          class="tool-button inline-flex items-center gap-2 px-3 py-2 text-xs"
          :class="diffScope === 'run' ? 'theme-filter-active' : ''"
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
            <div class="truncate text-xs text-[var(--theme-textPrimary)]">
              {{ selectedOption ? formatRunOptionLabel(selectedOption) : '请选择历史执行' }}
            </div>
          </template>

          <template #header>
            <div class="theme-divider theme-muted-text border-b border-dashed px-3 py-2 text-[11px]">
              共 {{ terminalRuns.length }} 条可审查执行
            </div>
          </template>

          <template #option="{ option, selected, select }">
            <button
              type="button"
              class="w-full rounded-sm border border-dashed px-3 py-2 text-left transition"
              :class="selected ? 'theme-filter-active' : 'theme-filter-idle'"
              @click="select"
            >
              <div class="flex items-start gap-3">
                <div class="min-w-0 flex-1">
                  <div class="truncate text-xs font-medium text-[var(--theme-textPrimary)]">
                    {{ new Date(option.startedAt || option.createdAt).toLocaleString('zh-CN') }}
                  </div>
                  <div class="theme-muted-text mt-1 text-[11px]">
                    {{ getRunStatusLabel(option) }}
                  </div>
                </div>

                <Check
                  v-if="selected"
                  class="mt-0.5 h-4 w-4 shrink-0 text-[var(--theme-textSecondary)]"
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

    <div v-if="error" class="theme-divider theme-danger-text border-b px-4 py-3 text-sm">
      <div class="inline-flex items-start gap-2">
        <CircleAlert class="mt-0.5 h-4 w-4 shrink-0" />
        <span class="break-all">{{ error }}</span>
      </div>
    </div>

    <div v-if="loading && !diffPayload" class="theme-muted-text flex flex-1 items-center justify-center px-5 text-sm">
      正在读取代码变更...
    </div>

    <div v-else-if="diffPayload && !diffPayload.supported" class="flex flex-1 items-center justify-center px-5">
      <div class="theme-empty-state w-full max-w-xl px-4 py-5 text-sm text-[var(--theme-textSecondary)]">
        <div class="theme-heading inline-flex items-center gap-2 font-medium">
          <FileDiff class="h-4 w-4" />
          <span>暂时无法查看代码变更</span>
        </div>
        <p class="mt-2 break-all leading-7">{{ diffPayload.reason || '当前没有可展示的代码变更。' }}</p>
        <div v-if="diffPayload.repoRoot" class="mt-3 flex flex-wrap gap-2 text-xs">
          <div class="theme-status-neutral inline-flex items-center gap-2 rounded-sm border border-dashed px-2.5 py-1.5">
            <FolderOpen class="h-3.5 w-3.5 shrink-0" />
            <span class="break-all">{{ diffPayload.repoRoot }}</span>
          </div>
          <div
            v-if="diffPayload.branch"
            class="theme-status-success inline-flex items-center gap-2 rounded-sm border border-dashed px-2.5 py-1.5"
          >
            <GitBranch class="h-3.5 w-3.5 shrink-0" />
            <span>{{ diffPayload.branch }}</span>
          </div>
        </div>
      </div>
    </div>

    <div v-else-if="diffPayload" class="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div class="theme-divider theme-secondary-text border-b px-4 py-3 text-xs">
        <div class="flex flex-wrap items-center gap-2">
          <div
            v-if="diffPayload.repoRoot"
            class="theme-status-info inline-flex min-w-0 items-center gap-2 rounded-sm border border-dashed px-2.5 py-1.5"
          >
            <FolderOpen class="h-3.5 w-3.5 shrink-0" />
            <span class="min-w-0 break-all">{{ diffPayload.repoRoot }}</span>
          </div>
          <div
            class="theme-status-success inline-flex items-center gap-2 rounded-sm border border-dashed px-2.5 py-1.5"
          >
            <GitBranch class="h-3.5 w-3.5 shrink-0" />
            <span>{{ diffPayload.branch || '未识别分支' }}</span>
            <span class="opacity-50">•</span>
            <span class="text-[var(--theme-textPrimary)]">{{ diffPayload.summary?.fileCount || 0 }} 个文件</span>
            <template v-if="diffPayload.summary?.statsComplete">
              <span class="opacity-50">•</span>
              <span class="font-medium text-[var(--theme-success)]">+{{ diffPayload.summary?.additions || 0 }}</span>
              <span class="font-medium text-[var(--theme-danger)]">-{{ diffPayload.summary?.deletions || 0 }}</span>
            </template>
            <template v-else-if="showSummarySkeleton">
              <span class="opacity-50">•</span>
              <span class="h-3 w-10 animate-pulse rounded bg-[var(--theme-successSoft)]" />
              <span class="h-3 w-10 animate-pulse rounded bg-[var(--theme-dangerSoft)]" />
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
            class="text-[11px] text-[var(--theme-warningText)]"
          >
            {{ warning }}
          </p>
        </div>
      </div>

      <div class="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)] overflow-hidden">
        <div class="theme-divider min-h-0 overflow-y-auto border-r bg-[var(--theme-appPanelMuted)] p-3">
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

          <label class="mb-3 flex items-center gap-2 rounded-sm border border-[var(--theme-inputBorder)] bg-[var(--theme-inputBg)] px-3 py-2 text-xs text-[var(--theme-textMuted)]">
            <Search class="h-3.5 w-3.5 shrink-0" />
            <input
              v-model="fileSearch"
              type="text"
              placeholder="搜索文件路径"
              class="min-w-0 flex-1 bg-transparent text-xs text-[var(--theme-textPrimary)] outline-none placeholder:text-[var(--theme-textMuted)]"
            >
          </label>

          <div
            v-if="showSummarySkeleton"
            class="theme-empty-state mb-3 bg-[var(--theme-appPanelStrong)] px-3 py-2 text-[11px]"
          >
            已先展示文件列表，整体增删行数正在后台统计...
          </div>

          <div v-if="!diffPayload.files.length" class="theme-empty-state px-3 py-4 text-xs">
            当前范围内还没有检测到代码变更。
          </div>
          <div v-else-if="!filteredFiles.length" class="theme-empty-state px-3 py-4 text-xs">
            当前筛选或搜索条件下没有匹配文件。
          </div>

          <div v-else class="space-y-2">
            <button
              v-for="file in filteredFiles"
              :key="file.path"
              type="button"
              class="w-full rounded-sm border px-3 py-2 text-left transition"
              :class="file.path === selectedFilePath ? 'theme-filter-active' : 'theme-filter-idle'"
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

        <div class="min-h-0 overflow-hidden bg-[var(--theme-appPanelStrong)]">
          <div v-if="selectedFile" class="flex h-full min-h-0 flex-col overflow-hidden">
            <div class="theme-divider theme-secondary-text border-b px-4 py-3 text-xs">
              <div class="flex items-center gap-3">
                <div class="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  <span class="inline-flex rounded-sm border px-1.5 py-0.5 text-[10px]" :class="getStatusClass(selectedFile.status)">
                    {{ getStatusLabel(selectedFile.status) }}
                  </span>
                  <span class="break-all font-medium text-[var(--theme-textPrimary)]">{{ selectedFile.path }}</span>
                  <span class="opacity-75">
                    {{ selectedFile.statsLoaded ? `+${selectedFile.additions} / -${selectedFile.deletions}` : '行数按需统计' }}
                  </span>
                </div>
                <div
                  class="inline-flex h-8 w-[132px] shrink-0 items-center gap-1 rounded-sm border px-1.5 py-1"
                  :class="selectedPatchHunks.length
                    ? 'border-[var(--theme-borderDefault)] bg-[var(--theme-appPanelMuted)]'
                    : 'pointer-events-none invisible border-transparent'"
                >
                  <button
                    type="button"
                    class="theme-icon-button h-6 w-6 disabled:opacity-50"
                    :disabled="activeHunkIndex <= 0"
                    @click="jumpToAdjacentHunk(-1)"
                  >
                    <ChevronUp class="h-4 w-4" />
                  </button>
                  <span class="min-w-[64px] text-center text-[11px] text-[var(--theme-textSecondary)]">
                    改动 {{ Math.min(activeHunkIndex + 1, selectedPatchHunks.length) }}/{{ selectedPatchHunks.length }}
                  </span>
                  <button
                    type="button"
                    class="theme-icon-button h-6 w-6 disabled:opacity-50"
                    :disabled="activeHunkIndex >= selectedPatchHunks.length - 1"
                    @click="jumpToAdjacentHunk(1)"
                  >
                    <ChevronDown class="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>

            <div v-if="selectedFile.message" class="theme-secondary-text flex-1 overflow-y-auto px-4 py-4 text-sm">
              <div class="theme-empty-state px-4 py-4">
                {{ selectedFile.message }}
              </div>
            </div>
            <div v-else-if="patchLoading && !selectedFile.patchLoaded" class="theme-muted-text flex-1 overflow-y-auto px-4 py-4 text-sm">
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
                      ? 'ring-1 ring-inset ring-[var(--theme-warning)]'
                      : '',
                  ]"
                >
                  <span class="select-none border-r border-[var(--theme-borderMuted)] px-2 py-0.5 text-right opacity-60">
                    {{ line.oldNumber }}
                  </span>
                  <span class="select-none border-r border-[var(--theme-borderMuted)] px-2 py-0.5 text-right opacity-60">
                    {{ line.newNumber }}
                  </span>
                  <pre class="overflow-visible whitespace-pre px-3 py-0.5">{{ line.content }}</pre>
                </div>
              </div>
            </div>
            <div v-else class="theme-secondary-text flex-1 overflow-y-auto px-4 py-4 text-sm">
              <div class="theme-empty-state px-4 py-4">
                当前文件没有可展示的 diff 内容。
              </div>
            </div>
          </div>

          <div v-else class="theme-muted-text flex h-full items-center justify-center px-5 text-sm">
            请选择一个文件查看 diff。
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
