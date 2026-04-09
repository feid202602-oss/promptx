import assert from 'node:assert/strict'
import test from 'node:test'

import { createRunDispatchService } from './runDispatchService.js'

test('runDispatchService keeps queued status when runner accepts queued run', async () => {
  const broadcasts = []
  const service = createRunDispatchService({
    broadcastServerEvent(type, payload = {}) {
      broadcasts.push({ type, ...payload })
    },
    createCodexRun(payload = {}) {
      return {
        id: 'run-1',
        status: payload.status || 'queued',
      }
    },
    decorateCodexSession(session) {
      return {
        ...session,
        running: false,
      }
    },
    getCodexRunById() {
      return {
        id: 'run-1',
        status: 'queued',
      }
    },
    getPromptxCodexSessionById() {
      return {
        id: 'session-1',
        engine: 'codex',
        cwd: '/tmp/demo',
        title: 'Demo',
        codexThreadId: '',
        engineSessionId: '',
        engineThreadId: '',
        engineMeta: {},
        createdAt: '2026-03-22T00:00:00.000Z',
        updatedAt: '2026-03-22T00:00:00.000Z',
      }
    },
    getRunningCodexRunBySessionId() {
      return null
    },
    getTaskBySlug() {
      return {
        slug: 'task-1',
        expired: false,
      }
    },
    logger: {
      warn() {},
    },
    runnerClient: {
      async startRun() {
        return {
          status: 'queued',
        }
      },
    },
    updateCodexRunFromRunnerStatus(_runId, patch = {}) {
      return {
        id: 'run-1',
        status: patch.status || 'queued',
      }
    },
    updateTaskCodexSession() {},
  })

  const result = await service.startTaskRunForTask({
    taskSlug: 'task-1',
    sessionId: 'session-1',
    prompt: 'hello',
    promptBlocks: [],
  })

  assert.equal(result.runnerDispatchPending, false)
  assert.equal(result.run?.status, 'queued')
  assert.ok(broadcasts.some((item) => item.type === 'runs.changed' && item.status === 'queued'))
})

test('runDispatchService marks stop request as stopping and returns accepted result', async () => {
  const broadcasts = []
  let currentStatus = 'running'
  const service = createRunDispatchService({
    broadcastServerEvent(type, payload = {}) {
      broadcasts.push({ type, ...payload })
    },
    getCodexRunById(runId) {
      return {
        id: runId,
        taskSlug: 'task-1',
        sessionId: 'session-1',
        status: currentStatus,
      }
    },
    logger: {
      warn() {},
    },
    runnerClient: {
      stopRun() {
        return Promise.resolve({ accepted: true })
      },
    },
    updateCodexRunFromRunnerStatus(runId, patch = {}) {
      currentStatus = patch.status || currentStatus
      return {
        id: runId,
        taskSlug: 'task-1',
        sessionId: 'session-1',
        status: currentStatus,
      }
    },
  })

  const result = await service.requestRunStop('run-1', {
    isActiveRunStatus(status) {
      return ['queued', 'starting', 'running', 'stopping'].includes(status)
    },
    reason: 'user_requested',
  })

  assert.equal(result?.accepted, true)
  assert.equal(result?.run?.status, 'stopping')
  assert.ok(broadcasts.some((item) => item.type === 'runs.changed' && item.status === 'stopping'))
  assert.ok(broadcasts.some((item) => item.type === 'sessions.changed' && item.sessionId === 'session-1'))
})

test('runDispatchService rewrites codex image urls to local server for runner payload only', async () => {
  let createdRunPayload = null
  let runnerPayload = null
  const service = createRunDispatchService({
    createCodexRun(payload = {}) {
      createdRunPayload = payload
      return {
        id: 'run-1',
        status: payload.status || 'queued',
      }
    },
    decorateCodexSession(session) {
      return {
        ...session,
        running: false,
      }
    },
    getCodexRunById() {
      return {
        id: 'run-1',
        status: 'queued',
      }
    },
    getPromptxCodexSessionById() {
      return {
        id: 'session-1',
        engine: 'codex',
        cwd: '/tmp/demo',
        title: 'Demo',
        codexThreadId: '',
        engineSessionId: '',
        engineThreadId: '',
        engineMeta: {},
        createdAt: '2026-03-22T00:00:00.000Z',
        updatedAt: '2026-03-22T00:00:00.000Z',
      }
    },
    getRunningCodexRunBySessionId() {
      return null
    },
    getTaskBySlug() {
      return {
        slug: 'task-1',
        expired: false,
      }
    },
    localServerBaseUrl: 'http://127.0.0.1:3000',
    publicServerBaseUrl: 'https://dongdong.promptx.mushayu.com',
    relayUrl: 'https://dongdong.promptx.mushayu.com',
    logger: {
      warn() {},
    },
    runnerClient: {
      async startRun(payload = {}) {
        runnerPayload = payload
        return {
          status: 'queued',
        }
      },
    },
    updateCodexRunFromRunnerStatus(_runId, patch = {}) {
      return {
        id: 'run-1',
        status: patch.status || 'queued',
      }
    },
    updateTaskCodexSession() {},
  })

  await service.startTaskRunForTask({
    taskSlug: 'task-1',
    sessionId: 'session-1',
    prompt: '看图：https://dongdong.promptx.mushayu.com/uploads/demo.png',
    promptBlocks: [
      {
        type: 'image',
        content: '/uploads/demo.png',
        meta: {},
      },
    ],
  })

  assert.equal(createdRunPayload?.prompt, '看图：https://dongdong.promptx.mushayu.com/uploads/demo.png')
  assert.equal(createdRunPayload?.promptBlocks?.[0]?.content, '/uploads/demo.png')
  assert.equal(runnerPayload?.prompt, '看图：http://127.0.0.1:3000/uploads/demo.png')
  assert.equal(runnerPayload?.promptBlocks?.[0]?.content, 'http://127.0.0.1:3000/uploads/demo.png')
})

test('runDispatchService adapts local image base url for claude dev server port', async () => {
  let runnerPayload = null
  const service = createRunDispatchService({
    createCodexRun(payload = {}) {
      return {
        id: 'run-2',
        status: payload.status || 'queued',
      }
    },
    decorateCodexSession(session) {
      return {
        ...session,
        running: false,
      }
    },
    getCodexRunById() {
      return {
        id: 'run-2',
        status: 'queued',
      }
    },
    getPromptxCodexSessionById() {
      return {
        id: 'session-2',
        engine: 'claude-code',
        cwd: '/tmp/demo',
        title: 'Demo',
        codexThreadId: '',
        engineSessionId: '',
        engineThreadId: '',
        engineMeta: {},
        createdAt: '2026-03-22T00:00:00.000Z',
        updatedAt: '2026-03-22T00:00:00.000Z',
      }
    },
    getRunningCodexRunBySessionId() {
      return null
    },
    getTaskBySlug() {
      return {
        slug: 'task-2',
        expired: false,
      }
    },
    localServerBaseUrl: 'http://127.0.0.1:3001',
    publicServerBaseUrl: 'https://dongdong.promptx.mushayu.com',
    relayUrl: 'https://dongdong.promptx.mushayu.com',
    logger: {
      warn() {},
    },
    runnerClient: {
      async startRun(payload = {}) {
        runnerPayload = payload
        return {
          status: 'queued',
        }
      },
    },
    updateCodexRunFromRunnerStatus(_runId, patch = {}) {
      return {
        id: 'run-2',
        status: patch.status || 'queued',
      }
    },
    updateTaskCodexSession() {},
  })

  await service.startTaskRunForTask({
    taskSlug: 'task-2',
    sessionId: 'session-2',
    prompt: '看图：https://dongdong.promptx.mushayu.com/uploads/demo-2.png',
    promptBlocks: [
      {
        type: 'image',
        content: 'https://dongdong.promptx.mushayu.com/uploads/demo-2.png',
        meta: {},
      },
    ],
  })

  assert.equal(runnerPayload?.prompt, '看图：http://127.0.0.1:3001/uploads/demo-2.png')
  assert.equal(runnerPayload?.promptBlocks?.[0]?.content, 'http://127.0.0.1:3001/uploads/demo-2.png')
})
