import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildPromptPreview,
  deriveTaskPreview,
  isActiveRunStatus,
  isCurrentTaskSendingState,
  isTaskRunning,
  mergeTaskSummariesWithWorkspaceDiff,
  resolveTaskDisplayTitle,
  shouldRefreshWorkspaceDiffSummaries,
} from './useWorkbenchTasks.js'

test('resolveTaskDisplayTitle prefers manual title over auto title and preview', () => {
  const title = resolveTaskDisplayTitle({
    title: '手动标题',
    autoTitle: '自动标题',
    preview: '预览标题',
  }, [
    { type: 'text', content: '这是正文内容' },
  ])

  assert.equal(title, '手动标题')
})

test('resolveTaskDisplayTitle falls back to derived title from blocks', () => {
  const title = resolveTaskDisplayTitle({}, [
    { type: 'text', content: '这是一个很长很长的需求标题，应该被自动截断' },
  ])

  assert.equal(title, '这是一个很长很长的需求标题，应该')
})

test('deriveTaskPreview compacts whitespace and uses first text-like block', () => {
  const preview = deriveTaskPreview([
    { type: 'image', content: '/demo.png' },
    { type: 'imported_text', content: '  第一行\n\n第二行   第三行  ' },
  ], 20)

  assert.equal(preview, '第一行 第二行 第三行')
})

test('buildPromptPreview trims whitespace and limits length', () => {
  const preview = buildPromptPreview('  hello\n\nworld   from   promptx  ', 12)
  assert.equal(preview, 'hello world ')
})

test('isTaskRunning only trusts persisted task running state', () => {
  assert.equal(isTaskRunning({ running: true }), true)
  assert.equal(isTaskRunning({ running: false }), false)
  assert.equal(isTaskRunning({}), false)
})

test('isCurrentTaskSendingState keeps current task disabled during local optimistic send', () => {
  assert.equal(isCurrentTaskSendingState({ running: false }, true), true)
  assert.equal(isCurrentTaskSendingState({ running: true }, false), true)
  assert.equal(isCurrentTaskSendingState({ running: false }, false), false)
})

test('isActiveRunStatus matches queued through stopping only', () => {
  assert.equal(isActiveRunStatus('queued'), true)
  assert.equal(isActiveRunStatus('running'), true)
  assert.equal(isActiveRunStatus('stopping'), true)
  assert.equal(isActiveRunStatus('completed'), false)
  assert.equal(isActiveRunStatus('error'), false)
})

test('mergeTaskSummariesWithWorkspaceDiff preserves summary for same session', () => {
  const merged = mergeTaskSummariesWithWorkspaceDiff([
    {
      slug: 'task-1',
      codexSessionId: 'session-a',
      workspaceDiffSummary: {
        supported: true,
        fileCount: 3,
        additions: 10,
        deletions: 2,
        statsComplete: true,
      },
    },
  ], [
    {
      slug: 'task-1',
      codexSessionId: 'session-a',
    },
  ])

  assert.deepEqual(merged[0].workspaceDiffSummary, {
    supported: true,
    fileCount: 3,
    additions: 10,
    deletions: 2,
    statsComplete: true,
  })
})

test('mergeTaskSummariesWithWorkspaceDiff clears summary when session changes', () => {
  const merged = mergeTaskSummariesWithWorkspaceDiff([
    {
      slug: 'task-1',
      codexSessionId: 'session-a',
      workspaceDiffSummary: {
        supported: true,
        fileCount: 3,
        additions: 10,
        deletions: 2,
        statsComplete: true,
      },
    },
  ], [
    {
      slug: 'task-1',
      codexSessionId: 'session-b',
    },
  ])

  assert.equal(merged[0].workspaceDiffSummary, null)
})

test('mergeTaskSummariesWithWorkspaceDiff clears summary when session is removed', () => {
  const merged = mergeTaskSummariesWithWorkspaceDiff([
    {
      slug: 'task-1',
      codexSessionId: 'session-a',
      workspaceDiffSummary: {
        supported: true,
        fileCount: 3,
        additions: 10,
        deletions: 2,
        statsComplete: true,
      },
    },
  ], [
    {
      slug: 'task-1',
      codexSessionId: '',
    },
  ])

  assert.equal(merged[0].workspaceDiffSummary, null)
})

test('shouldRefreshWorkspaceDiffSummaries refreshes on initial load when session exists', () => {
  assert.equal(shouldRefreshWorkspaceDiffSummaries([], [
    {
      slug: 'task-1',
      codexSessionId: 'session-a',
      running: false,
      workspaceDiffSummary: null,
    },
  ]), true)
})

test('shouldRefreshWorkspaceDiffSummaries skips refresh when list shape and session state are stable', () => {
  assert.equal(shouldRefreshWorkspaceDiffSummaries([
    {
      slug: 'task-1',
      codexSessionId: 'session-a',
      running: false,
      workspaceDiffSummary: {
        supported: true,
        fileCount: 1,
      },
    },
  ], [
    {
      slug: 'task-1',
      codexSessionId: 'session-a',
      running: false,
      workspaceDiffSummary: {
        supported: true,
        fileCount: 1,
      },
    },
  ]), false)
})

test('shouldRefreshWorkspaceDiffSummaries refreshes when running state changes', () => {
  assert.equal(shouldRefreshWorkspaceDiffSummaries([
    {
      slug: 'task-1',
      codexSessionId: 'session-a',
      running: true,
      workspaceDiffSummary: {
        supported: true,
        fileCount: 1,
      },
    },
  ], [
    {
      slug: 'task-1',
      codexSessionId: 'session-a',
      running: false,
      workspaceDiffSummary: {
        supported: true,
        fileCount: 1,
      },
    },
  ]), true)
})
