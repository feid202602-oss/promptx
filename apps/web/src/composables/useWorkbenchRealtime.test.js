import assert from 'node:assert/strict'
import test from 'node:test'

import { getRealtimeEventSyncFlags } from './useWorkbenchRealtime.js'

test('getRealtimeEventSyncFlags avoids diff and run refresh for ordinary task edits', () => {
  const flags = getRealtimeEventSyncFlags({
    type: 'tasks.changed',
    taskSlug: 'demo-task',
    reason: 'updated',
  })

  assert.equal(flags.updatesTaskList, true)
  assert.equal(flags.updatesSessions, false)
  assert.equal(flags.updatesTaskRuns, false)
  assert.equal(flags.updatesTaskDiff, false)
})

test('getRealtimeEventSyncFlags keeps diff refresh for session binding changes', () => {
  const flags = getRealtimeEventSyncFlags({
    type: 'tasks.changed',
    taskSlug: 'demo-task',
    reason: 'session-linked',
  })

  assert.equal(flags.updatesTaskList, true)
  assert.equal(flags.updatesTaskDiff, true)
})

test('getRealtimeEventSyncFlags marks run changes for runs sessions and diff', () => {
  const flags = getRealtimeEventSyncFlags({
    type: 'runs.changed',
    taskSlug: 'demo-task',
  })

  assert.equal(flags.updatesTaskList, true)
  assert.equal(flags.updatesSessions, true)
  assert.equal(flags.updatesTaskRuns, true)
  assert.equal(flags.updatesTaskDiff, true)
})
