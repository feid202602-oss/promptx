<script setup>
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { Bell, Clock3, LoaderCircle, PencilLine, Save, X } from 'lucide-vue-next'
import {
  TASK_AUTOMATION_CONCURRENCY_POLICY_OPTIONS,
  TASK_AUTOMATION_TIMEZONE_OPTIONS,
  TASK_NOTIFICATION_CHANNEL_OPTIONS,
  TASK_NOTIFICATION_MESSAGE_MODE_OPTIONS,
  TASK_NOTIFICATION_TRIGGER_OPTIONS,
} from '@promptx/shared'
import DialogSideNav from './DialogSideNav.vue'
import WorkbenchSelect from './WorkbenchSelect.vue'
import { getTask, updateTask } from '../lib/api.js'

const DEFAULT_AUTOMATION_CRON = '0 9 * * 1-5'
const DEFAULT_AUTOMATION_MODE = 'weekdays'
const DEFAULT_AUTOMATION_TIME = '09:00'
const DEFAULT_AUTOMATION_WEEKDAY = '1'

const AUTOMATION_MODE_OPTIONS = [
  { value: 'daily', label: '每天' },
  { value: 'weekdays', label: '工作日' },
  { value: 'weekly', label: '每周' },
]

const WEEKDAY_OPTIONS = [
  { value: '1', label: '周一' },
  { value: '2', label: '周二' },
  { value: '3', label: '周三' },
  { value: '4', label: '周四' },
  { value: '5', label: '周五' },
  { value: '6', label: '周六' },
  { value: '0', label: '周日' },
]

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
})

const emit = defineEmits(['close', 'saved'])

const loading = ref(false)
const saving = ref(false)
const error = ref('')
const activeSection = ref('basic')
const form = reactive({
  title: '',
  automationEnabled: false,
  automationMode: DEFAULT_AUTOMATION_MODE,
  automationTime: DEFAULT_AUTOMATION_TIME,
  automationWeekday: DEFAULT_AUTOMATION_WEEKDAY,
  automationTimezone: 'local',
  automationConcurrencyPolicy: 'skip',
  automationLastTriggeredAt: '',
  automationNextTriggerAt: '',
  notificationEnabled: false,
  notificationChannelType: 'dingtalk',
  notificationWebhookUrl: '',
  notificationSecret: '',
  notificationTriggerOn: 'completed',
  notificationMessageMode: 'summary',
  notificationLastStatus: '',
  notificationLastError: '',
  notificationLastSentAt: '',
})

const normalizedTaskTitle = computed(() => String(props.taskTitle || '').trim() || '未命名任务')
const taskSections = [
  {
    id: 'basic',
    label: '基础',
    description: '标题与任务信息',
    icon: PencilLine,
  },
  {
    id: 'automation',
    label: '定时',
    description: '自动运行设置',
    icon: Clock3,
  },
  {
    id: 'notification',
    label: '通知',
    description: '运行结束通知',
    icon: Bell,
  },
]
const notificationStatusText = computed(() => {
  if (!form.notificationEnabled) {
    return '未启用'
  }
  if (form.notificationLastStatus === 'success') {
    return '最近发送成功'
  }
  if (form.notificationLastStatus === 'error') {
    return '最近发送失败'
  }
  return '等待首次发送'
})

function resetForm() {
  form.title = ''
  form.automationEnabled = false
  form.automationMode = DEFAULT_AUTOMATION_MODE
  form.automationTime = DEFAULT_AUTOMATION_TIME
  form.automationWeekday = DEFAULT_AUTOMATION_WEEKDAY
  form.automationTimezone = 'local'
  form.automationConcurrencyPolicy = 'skip'
  form.automationLastTriggeredAt = ''
  form.automationNextTriggerAt = ''
  form.notificationEnabled = false
  form.notificationChannelType = 'dingtalk'
  form.notificationWebhookUrl = ''
  form.notificationSecret = ''
  form.notificationTriggerOn = 'completed'
  form.notificationMessageMode = 'summary'
  form.notificationLastStatus = ''
  form.notificationLastError = ''
  form.notificationLastSentAt = ''
}

function padTimePart(value = 0) {
  return String(value).padStart(2, '0')
}

function parseAutomationCron(cron = '') {
  const normalized = String(cron || '').trim().replace(/\s+/g, ' ')

  let match = normalized.match(/^(\d{1,2}) (\d{1,2}) \* \* 1-5$/)
  if (match) {
    return {
      mode: 'weekdays',
      time: `${padTimePart(match[2])}:${padTimePart(match[1])}`,
      weekday: DEFAULT_AUTOMATION_WEEKDAY,
    }
  }

  match = normalized.match(/^(\d{1,2}) (\d{1,2}) \* \* \*$/)
  if (match) {
    return {
      mode: 'daily',
      time: `${padTimePart(match[2])}:${padTimePart(match[1])}`,
      weekday: DEFAULT_AUTOMATION_WEEKDAY,
    }
  }

  match = normalized.match(/^(\d{1,2}) (\d{1,2}) \* \* ([0-6])$/)
  if (match) {
    return {
      mode: 'weekly',
      time: `${padTimePart(match[2])}:${padTimePart(match[1])}`,
      weekday: String(match[3]),
    }
  }

  return {
    mode: DEFAULT_AUTOMATION_MODE,
    time: DEFAULT_AUTOMATION_TIME,
    weekday: DEFAULT_AUTOMATION_WEEKDAY,
  }
}

function normalizeAutomationTime(value = '') {
  const normalized = String(value || '').trim()
  const match = normalized.match(/^(\d{1,2}):(\d{2})$/)
  if (!match) {
    return DEFAULT_AUTOMATION_TIME
  }

  const hour = Number(match[1])
  const minute = Number(match[2])
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return DEFAULT_AUTOMATION_TIME
  }

  return `${padTimePart(hour)}:${padTimePart(minute)}`
}

function buildAutomationCron() {
  const time = normalizeAutomationTime(form.automationTime)
  const [hourText, minuteText] = time.split(':')
  const hour = Number(hourText)
  const minute = Number(minuteText)

  if (form.automationMode === 'daily') {
    return `${minute} ${hour} * * *`
  }

  if (form.automationMode === 'weekly') {
    const weekday = WEEKDAY_OPTIONS.find((item) => item.value === String(form.automationWeekday || ''))?.value || DEFAULT_AUTOMATION_WEEKDAY
    return `${minute} ${hour} * * ${weekday}`
  }

  return `${minute} ${hour} * * 1-5`
}

function applyTaskToForm(task = {}) {
  form.title = String(task.title || '')
  form.automationEnabled = Boolean(task.automation?.enabled)
  const parsedAutomation = parseAutomationCron(task.automation?.cron || DEFAULT_AUTOMATION_CRON)
  form.automationMode = parsedAutomation.mode
  form.automationTime = parsedAutomation.time
  form.automationWeekday = parsedAutomation.weekday
  form.automationTimezone = String(task.automation?.timezone || 'local')
  form.automationConcurrencyPolicy = String(task.automation?.concurrencyPolicy || 'skip')
  form.automationLastTriggeredAt = String(task.automation?.lastTriggeredAt || '')
  form.automationNextTriggerAt = String(task.automation?.nextTriggerAt || '')
  form.notificationEnabled = Boolean(task.notification?.enabled)
  form.notificationChannelType = String(task.notification?.channelType || 'dingtalk')
  form.notificationWebhookUrl = String(task.notification?.webhookUrl || '')
  form.notificationSecret = String(task.notification?.secret || '')
  form.notificationTriggerOn = String(task.notification?.triggerOn || 'completed')
  form.notificationMessageMode = String(task.notification?.messageMode || 'summary')
  form.notificationLastStatus = String(task.notification?.lastStatus || '')
  form.notificationLastError = String(task.notification?.lastError || '')
  form.notificationLastSentAt = String(task.notification?.lastSentAt || '')
}

async function loadTaskSettings() {
  const taskSlug = String(props.taskSlug || '').trim()
  if (!taskSlug) {
    resetForm()
    return
  }

  loading.value = true
  error.value = ''

  try {
    const task = await getTask(taskSlug)
    applyTaskToForm(task)
  } catch (nextError) {
    error.value = nextError?.message || '任务配置读取失败。'
  } finally {
    loading.value = false
  }
}

function buildUpdatePayload() {
  return {
    title: form.title,
    automation: {
      enabled: form.automationEnabled,
      cron: buildAutomationCron(),
      timezone: form.automationTimezone,
      concurrencyPolicy: form.automationConcurrencyPolicy,
    },
    notification: {
      enabled: form.notificationEnabled,
      channelType: form.notificationChannelType,
      webhookUrl: form.notificationWebhookUrl,
      secret: form.notificationSecret,
      triggerOn: form.notificationTriggerOn,
      messageMode: form.notificationMessageMode,
    },
  }
}

async function handleSave() {
  const taskSlug = String(props.taskSlug || '').trim()
  if (!taskSlug || loading.value || saving.value) {
    return
  }

  saving.value = true
  error.value = ''

  try {
    const task = await updateTask(taskSlug, buildUpdatePayload())
    applyTaskToForm(task)
    emit('saved', task)
    emit('close')
  } catch (nextError) {
    error.value = nextError?.message || '任务配置保存失败。'
  } finally {
    saving.value = false
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

function formatTime(value = '') {
  if (!value) {
    return '暂无'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return '暂无'
  }

  return date.toLocaleString('zh-CN')
}

watch(
  () => props.open,
  (open) => {
    document.body.classList.toggle('overflow-hidden', open)
    if (open) {
      window.addEventListener('keydown', handleKeydown)
      activeSection.value = 'basic'
      loadTaskSettings()
      return
    }

    window.removeEventListener('keydown', handleKeydown)
  },
  { immediate: true }
)

watch(
  () => props.taskSlug,
  () => {
    if (props.open) {
      loadTaskSettings()
    }
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
      class="theme-modal-backdrop fixed inset-0 z-[75] flex items-center justify-center px-4 py-6"
      @click.self="emit('close')"
    >
      <section class="panel settings-dialog-panel flex h-full w-full max-w-5xl flex-col overflow-hidden sm:h-[42rem] sm:max-h-[88vh]">
        <div class="theme-divider settings-dialog-header flex items-start justify-between gap-4 border-b px-5 py-4">
          <div>
            <div class="theme-heading inline-flex items-center gap-2 text-sm font-medium">
              <PencilLine class="h-4 w-4" />
              <span>编辑任务</span>
            </div>
            <p class="theme-muted-text mt-1 text-xs">当前任务：{{ normalizedTaskTitle }}</p>
          </div>

          <button
            type="button"
            class="theme-icon-button h-8 w-8 shrink-0"
            @click="emit('close')"
          >
            <X class="h-4 w-4" />
          </button>
        </div>

        <div class="settings-dialog-body min-h-0 flex flex-1 flex-col sm:flex-row">
          <DialogSideNav
            v-model="activeSection"
            :sections="taskSections"
          />

          <div class="settings-dialog-content min-h-0 flex-1 overflow-y-auto px-5 py-5">
            <div v-if="loading" class="theme-muted-text flex items-center gap-2 py-4 text-sm">
              <LoaderCircle class="h-4 w-4 animate-spin" />
              <span>正在读取任务配置...</span>
            </div>

            <div v-else class="space-y-4">
              <section v-if="activeSection === 'basic'" class="space-y-4">
                <div>
                  <div class="theme-heading text-base font-medium">基础信息</div>
                  <p class="theme-muted-text mt-1 text-xs leading-5">这里维护任务标题，留空时继续使用自动标题。</p>
                </div>

                <section class="settings-section-card px-4 py-4">
                  <label class="block space-y-1.5">
                    <span class="theme-muted-text text-xs">任务标题</span>
                    <input
                      v-model="form.title"
                      type="text"
                      maxlength="140"
                      class="tool-input"
                      placeholder="留空则继续使用自动标题"
                    />
                  </label>
                </section>
              </section>

              <section v-else-if="activeSection === 'automation'" class="space-y-4">
                <div class="flex items-start justify-between gap-3">
                  <div>
                    <div class="theme-heading inline-flex items-center gap-2 text-base font-medium">
                      <Clock3 class="h-4 w-4" />
                      <span>定时运行</span>
                    </div>
                    <p class="theme-muted-text mt-1 text-xs leading-5">用可视化方式设置自动运行时间，不需要手填 Cron。</p>
                  </div>

                  <label class="inline-flex items-center gap-2 text-sm text-[var(--theme-textPrimary)]">
                    <input v-model="form.automationEnabled" type="checkbox" class="h-4 w-4" />
                    <span>启用</span>
                  </label>
                </div>

                <section class="settings-section-card px-4 py-4">
                  <div class="grid gap-4 sm:grid-cols-2">
                    <label class="space-y-1.5 sm:col-span-2">
                      <span class="theme-muted-text text-xs">运行周期</span>
                      <WorkbenchSelect
                        v-model="form.automationMode"
                        :options="AUTOMATION_MODE_OPTIONS"
                        :disabled="!form.automationEnabled"
                        :get-option-value="(option) => option.value"
                      >
                        <template #trigger="{ selectedOption }">
                          <div class="truncate text-sm text-[var(--theme-textPrimary)]">
                            {{ selectedOption?.label || '请选择' }}
                          </div>
                        </template>
                      </WorkbenchSelect>
                    </label>

                    <label class="space-y-1.5">
                      <span class="theme-muted-text text-xs">运行时间</span>
                      <input
                        v-model="form.automationTime"
                        type="time"
                        class="tool-input"
                        :disabled="!form.automationEnabled"
                      />
                    </label>

                    <label
                      v-if="form.automationMode === 'weekly'"
                      class="space-y-1.5"
                    >
                      <span class="theme-muted-text text-xs">每周日期</span>
                      <WorkbenchSelect
                        v-model="form.automationWeekday"
                        :options="WEEKDAY_OPTIONS"
                        :disabled="!form.automationEnabled"
                        :get-option-value="(option) => option.value"
                      >
                        <template #trigger="{ selectedOption }">
                          <div class="truncate text-sm text-[var(--theme-textPrimary)]">
                            {{ selectedOption?.label || '请选择' }}
                          </div>
                        </template>
                      </WorkbenchSelect>
                    </label>

                    <label class="space-y-1.5">
                      <span class="theme-muted-text text-xs">时区</span>
                      <WorkbenchSelect
                        v-model="form.automationTimezone"
                        :options="TASK_AUTOMATION_TIMEZONE_OPTIONS"
                        :disabled="!form.automationEnabled"
                        :get-option-value="(option) => option.value"
                      >
                        <template #trigger="{ selectedOption }">
                          <div class="truncate text-sm text-[var(--theme-textPrimary)]">
                            {{ selectedOption?.label || '请选择' }}
                          </div>
                        </template>
                      </WorkbenchSelect>
                    </label>

                    <label class="space-y-1.5" :class="form.automationMode === 'weekly' ? '' : 'sm:col-span-2'">
                      <span class="theme-muted-text text-xs">并发策略</span>
                      <WorkbenchSelect
                        v-model="form.automationConcurrencyPolicy"
                        :options="TASK_AUTOMATION_CONCURRENCY_POLICY_OPTIONS"
                        :disabled="!form.automationEnabled"
                        :get-option-value="(option) => option.value"
                      >
                        <template #trigger="{ selectedOption }">
                          <div class="truncate text-sm text-[var(--theme-textPrimary)]">
                            {{ selectedOption?.label || '请选择' }}
                          </div>
                        </template>
                      </WorkbenchSelect>
                    </label>
                  </div>

                  <div class="theme-muted-text mt-3 space-y-1 text-xs leading-6">
                    <p>最近触发：{{ formatTime(form.automationLastTriggeredAt) }}</p>
                    <p>下次触发：{{ formatTime(form.automationNextTriggerAt) }}</p>
                  </div>
                </section>
              </section>

              <section v-else class="space-y-4">
                <div class="flex items-start justify-between gap-3">
                  <div>
                    <div class="theme-heading inline-flex items-center gap-2 text-base font-medium">
                      <Bell class="h-4 w-4" />
                      <span>运行通知</span>
                    </div>
                    <p class="theme-muted-text mt-1 text-xs leading-5">run 结束后按规则把结果推送到群机器人。</p>
                  </div>

                  <label class="inline-flex items-center gap-2 text-sm text-[var(--theme-textPrimary)]">
                    <input v-model="form.notificationEnabled" type="checkbox" class="h-4 w-4" />
                    <span>启用</span>
                  </label>
                </div>

                <section class="settings-section-card px-4 py-4">
                  <div class="grid gap-4 sm:grid-cols-2">
                    <label class="space-y-1.5">
                      <span class="theme-muted-text text-xs">渠道类型</span>
                      <WorkbenchSelect
                        v-model="form.notificationChannelType"
                        :options="TASK_NOTIFICATION_CHANNEL_OPTIONS"
                        :disabled="!form.notificationEnabled"
                        :get-option-value="(option) => option.value"
                      >
                        <template #trigger="{ selectedOption }">
                          <div class="truncate text-sm text-[var(--theme-textPrimary)]">
                            {{ selectedOption?.label || '请选择' }}
                          </div>
                        </template>
                      </WorkbenchSelect>
                    </label>

                    <label class="space-y-1.5">
                      <span class="theme-muted-text text-xs">触发时机</span>
                      <WorkbenchSelect
                        v-model="form.notificationTriggerOn"
                        :options="TASK_NOTIFICATION_TRIGGER_OPTIONS"
                        :disabled="!form.notificationEnabled"
                        :get-option-value="(option) => option.value"
                      >
                        <template #trigger="{ selectedOption }">
                          <div class="truncate text-sm text-[var(--theme-textPrimary)]">
                            {{ selectedOption?.label || '请选择' }}
                          </div>
                        </template>
                      </WorkbenchSelect>
                    </label>

                    <label class="space-y-1.5 sm:col-span-2">
                      <span class="theme-muted-text text-xs">Webhook 地址</span>
                      <input
                        v-model="form.notificationWebhookUrl"
                        type="text"
                        class="tool-input"
                        placeholder="请输入群机器人 Webhook 地址"
                        :disabled="!form.notificationEnabled"
                      />
                    </label>

                    <label class="space-y-1.5">
                      <span class="theme-muted-text text-xs">签名密钥（可选）</span>
                      <input
                        v-model="form.notificationSecret"
                        type="text"
                        class="tool-input"
                        placeholder="开启签名时再填写"
                        :disabled="!form.notificationEnabled"
                      />
                    </label>

                    <label class="space-y-1.5">
                      <span class="theme-muted-text text-xs">消息模式</span>
                      <WorkbenchSelect
                        v-model="form.notificationMessageMode"
                        :options="TASK_NOTIFICATION_MESSAGE_MODE_OPTIONS"
                        :disabled="!form.notificationEnabled"
                        :get-option-value="(option) => option.value"
                      >
                        <template #trigger="{ selectedOption }">
                          <div class="truncate text-sm text-[var(--theme-textPrimary)]">
                            {{ selectedOption?.label || '请选择' }}
                          </div>
                        </template>
                      </WorkbenchSelect>
                    </label>
                  </div>

                  <div class="theme-muted-text mt-3 space-y-1 text-xs leading-6">
                    <p>通知状态：{{ notificationStatusText }}</p>
                    <p>最近发送：{{ formatTime(form.notificationLastSentAt) }}</p>
                    <p v-if="form.notificationLastError" class="theme-danger-text">
                      最近错误：{{ form.notificationLastError }}
                    </p>
                  </div>
                </section>
              </section>

              <p v-if="error" class="theme-danger-text text-sm">{{ error }}</p>
            </div>
          </div>
        </div>

        <div class="theme-divider flex flex-col gap-3 border-t px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p class="theme-muted-text theme-note-text">
            定时运行会按 Cron 创建新的 run；运行通知会在本次 run 结束后按规则发送到群机器人。
          </p>

          <div class="flex items-center justify-end gap-2">
            <button
              type="button"
              class="tool-button px-3 py-2 text-sm"
              :disabled="saving"
              @click="emit('close')"
            >
              取消
            </button>
            <button
              type="button"
              class="tool-button tool-button-primary inline-flex items-center gap-2 px-3 py-2 text-sm"
              :disabled="saving || loading"
              @click="handleSave"
            >
              <LoaderCircle v-if="saving" class="h-4 w-4 animate-spin" />
              <Save v-else class="h-4 w-4" />
              <span>{{ saving ? '保存中...' : '保存任务配置' }}</span>
            </button>
          </div>
        </div>
      </section>
    </div>
  </Teleport>
</template>
