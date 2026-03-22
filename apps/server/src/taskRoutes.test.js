import assert from 'node:assert/strict'
import Fastify from 'fastify'
import test from 'node:test'

import {
  createEmptyWorkspaceDiffSummary,
  createTaskWorkspaceDiffSummaryService,
  registerTaskRoutes,
} from './taskRoutes.js'

test('task workspace diff summary service normalizes and reuses workspace summaries', () => {
  const lookups = []
  const service = createTaskWorkspaceDiffSummaryService({
    getPromptxCodexSessionById(sessionId) {
      return {
        s1: { id: 's1', cwd: '/repo/a' },
        s2: { id: 's2', cwd: '/repo/a' },
      }[sessionId] || null
    },
    getWorkspaceGitDiffStatusSummaryByCwd(cwd) {
      lookups.push(cwd)
      return {
        supported: true,
        summary: {
          fileCount: 3,
          additions: 8,
          deletions: 2,
          statsComplete: true,
        },
      }
    },
    listTasks() {
      return [
        { slug: 'a', codexSessionId: 's1' },
        { slug: 'b', codexSessionId: 's2' },
        { slug: 'c', codexSessionId: '' },
      ]
    },
  })

  const items = service.listTaskWorkspaceDiffSummaries()
  assert.deepEqual(lookups, ['/repo/a'])
  assert.deepEqual(items, [
    {
      slug: 'a',
      workspaceDiffSummary: {
        supported: true,
        fileCount: 3,
        additions: 8,
        deletions: 2,
        statsComplete: true,
      },
    },
    {
      slug: 'b',
      workspaceDiffSummary: {
        supported: true,
        fileCount: 3,
        additions: 8,
        deletions: 2,
        statsComplete: true,
      },
    },
    {
      slug: 'c',
      workspaceDiffSummary: createEmptyWorkspaceDiffSummary(),
    },
  ])
})

test('task routes return 202 when runner dispatch remains pending', async () => {
  const app = Fastify()
  registerTaskRoutes(app, {
    broadcastServerEvent: () => {},
    buildTaskExports: () => ({ raw: '' }),
    canEditTask: () => true,
    createTask: () => null,
    decorateTask: (task) => task,
    decorateTaskList: (items) => items,
    deleteTask: () => ({ error: 'not_found' }),
    deleteTaskCodexRuns: () => {},
    getPromptxCodexSessionById: () => ({ id: 'session-1' }),
    getRunningCodexRunByTaskSlug: () => null,
    getTaskBySlug: (slug) => ({ slug, expired: false }),
    getTaskGitDiffReviewInSubprocess: async () => ({}),
    listTaskCodexRunsWithOptions: () => [],
    listTaskWorkspaceDiffSummaries: () => [],
    listTasks: () => [],
    purgeExpiredContent: () => {},
    removeAssetFiles: () => {},
    runDispatchService: {
      async startTaskRunForTask() {
        return {
          run: { id: 'run-1', status: 'queued' },
          runnerDispatchPending: true,
        }
      },
    },
    updateTask: () => null,
    updateTaskCodexSession: () => null,
  })
  await app.ready()

  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/tasks/task-1/codex-runs',
      payload: {
        sessionId: 'session-1',
        prompt: 'hello',
      },
    })

    assert.equal(response.statusCode, 202)
    assert.equal(response.json().run.id, 'run-1')
  } finally {
    await app.close()
  }
})

test('task routes block clearing runs while task is active', async () => {
  const app = Fastify()
  registerTaskRoutes(app, {
    broadcastServerEvent: () => {},
    buildTaskExports: () => ({ raw: '' }),
    canEditTask: () => true,
    createTask: () => null,
    decorateTask: (task) => task,
    decorateTaskList: (items) => items,
    deleteTask: () => ({ error: 'not_found' }),
    deleteTaskCodexRuns: () => {},
    getPromptxCodexSessionById: () => null,
    getRunningCodexRunByTaskSlug: () => ({ id: 'run-1', status: 'running' }),
    getTaskBySlug: (slug) => ({ slug, expired: false }),
    getTaskGitDiffReviewInSubprocess: async () => ({}),
    listTaskCodexRunsWithOptions: () => [],
    listTaskWorkspaceDiffSummaries: () => [],
    listTasks: () => [],
    purgeExpiredContent: () => {},
    removeAssetFiles: () => {},
    runDispatchService: {
      async startTaskRunForTask() {
        return null
      },
    },
    updateTask: () => null,
    updateTaskCodexSession: () => null,
  })
  await app.ready()

  try {
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/tasks/task-1/codex-runs',
    })

    assert.equal(response.statusCode, 409)
    assert.match(response.json().message, /正在执行/)
  } finally {
    await app.close()
  }
})
