import { reactive, ref } from 'vue'
import { subscribeServerEvents } from '../lib/serverEvents.js'

const readyVersion = ref(0)
const listSyncVersion = ref(0)
const listSyncTaskSlug = ref('')
const sessionsSyncVersion = ref(0)
const taskRunSyncVersionMap = reactive({})
const taskDiffSyncVersionMap = reactive({})
const runEventListenersByTaskSlug = new Map()

let started = false
let unsubscribeServerEvents = null

function bumpVersion(versionMap, taskSlug = '') {
  const normalizedTaskSlug = String(taskSlug || '').trim()
  if (!normalizedTaskSlug) {
    return
  }

  versionMap[normalizedTaskSlug] = Math.max(0, Number(versionMap[normalizedTaskSlug]) || 0) + 1
}

export function getRealtimeEventSyncFlags(event = {}) {
  const eventType = String(event.type || '').trim()
  const reason = String(event.reason || '').trim()

  return {
    updatesTaskList: eventType === 'ready' || eventType === 'tasks.changed' || eventType === 'runs.changed',
    updatesSessions: eventType === 'ready' || eventType === 'runs.changed' || eventType === 'sessions.changed',
    updatesTaskRuns: eventType === 'runs.changed',
    updatesTaskDiff: eventType === 'runs.changed' || (eventType === 'tasks.changed' && (reason === 'session-linked' || reason === 'session-cleared')),
  }
}

function dispatchTaskRunEvent(taskSlug = '', payload = {}) {
  const normalizedTaskSlug = String(taskSlug || '').trim()
  if (!normalizedTaskSlug) {
    return
  }

  const listeners = runEventListenersByTaskSlug.get(normalizedTaskSlug)
  if (!listeners?.size) {
    return
  }

  listeners.forEach((listener) => {
    try {
      listener(payload)
    } catch {
      // Ignore listener failures to avoid breaking the shared realtime dispatcher.
    }
  })
}

function handleServerEvent(event = {}) {
  const eventType = String(event.type || '').trim()
  const taskSlug = String(event.taskSlug || '').trim()
  const syncFlags = getRealtimeEventSyncFlags(event)

  if (!eventType) {
    return
  }

  if (eventType === 'ready') {
    readyVersion.value += 1
    listSyncTaskSlug.value = ''
    listSyncVersion.value += 1
    sessionsSyncVersion.value += 1
    return
  }

  if (eventType === 'tasks.changed') {
    listSyncTaskSlug.value = taskSlug
    if (syncFlags.updatesTaskList) {
      listSyncVersion.value += 1
    }
    if (syncFlags.updatesTaskDiff) {
      bumpVersion(taskDiffSyncVersionMap, taskSlug)
    }
    return
  }

  if (eventType === 'runs.changed') {
    listSyncTaskSlug.value = taskSlug
    if (syncFlags.updatesTaskList) {
      listSyncVersion.value += 1
    }
    if (syncFlags.updatesSessions) {
      sessionsSyncVersion.value += 1
    }
    if (syncFlags.updatesTaskRuns) {
      bumpVersion(taskRunSyncVersionMap, taskSlug)
    }
    if (syncFlags.updatesTaskDiff) {
      bumpVersion(taskDiffSyncVersionMap, taskSlug)
    }
    return
  }

  if (eventType === 'sessions.changed') {
    if (syncFlags.updatesSessions) {
      sessionsSyncVersion.value += 1
    }
    return
  }

  if (eventType === 'run.event') {
    dispatchTaskRunEvent(taskSlug, {
      taskSlug,
      runId: String(event.runId || '').trim(),
      event: event.event || null,
    })
  }
}

function ensureWorkbenchRealtimeStarted() {
  if (started || typeof window === 'undefined') {
    return
  }

  unsubscribeServerEvents = subscribeServerEvents((event) => {
    handleServerEvent(event)
  })
  started = true
}

export function getTaskRunSyncVersion(taskSlug = '') {
  const normalizedTaskSlug = String(taskSlug || '').trim()
  if (!normalizedTaskSlug) {
    return 0
  }

  return Math.max(0, Number(taskRunSyncVersionMap[normalizedTaskSlug]) || 0)
}

export function getTaskDiffSyncVersion(taskSlug = '') {
  const normalizedTaskSlug = String(taskSlug || '').trim()
  if (!normalizedTaskSlug) {
    return 0
  }

  return Math.max(0, Number(taskDiffSyncVersionMap[normalizedTaskSlug]) || 0)
}

export function subscribeTaskRunEvents(taskSlug = '', listener) {
  const normalizedTaskSlug = String(taskSlug || '').trim()
  if (!normalizedTaskSlug || typeof listener !== 'function') {
    return () => {}
  }

  ensureWorkbenchRealtimeStarted()

  const listeners = runEventListenersByTaskSlug.get(normalizedTaskSlug) || new Set()
  listeners.add(listener)
  runEventListenersByTaskSlug.set(normalizedTaskSlug, listeners)

  return () => {
    const currentListeners = runEventListenersByTaskSlug.get(normalizedTaskSlug)
    if (!currentListeners) {
      return
    }

    currentListeners.delete(listener)
    if (!currentListeners.size) {
      runEventListenersByTaskSlug.delete(normalizedTaskSlug)
    }
  }
}

export function useWorkbenchRealtime() {
  ensureWorkbenchRealtimeStarted()

  return {
    readyVersion,
    listSyncVersion,
    listSyncTaskSlug,
    sessionsSyncVersion,
    getTaskRunSyncVersion,
    getTaskDiffSyncVersion,
  }
}
