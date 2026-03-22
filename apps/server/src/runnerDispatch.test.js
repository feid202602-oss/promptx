import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const sharedTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptx-runner-dispatch-'))
const originalCwd = process.cwd()
const originalDataDir = process.env.PROMPTX_DATA_DIR
const sharedDataDir = path.join(sharedTempDir, 'data')
fs.mkdirSync(sharedDataDir, { recursive: true })
process.chdir(sharedTempDir)
process.env.PROMPTX_DATA_DIR = sharedDataDir

test.after(() => {
  process.chdir(originalCwd)
  if (typeof originalDataDir === 'string') {
    process.env.PROMPTX_DATA_DIR = originalDataDir
  } else {
    delete process.env.PROMPTX_DATA_DIR
  }
})

test('extractRunnerDispatchPatch prefers runner payload status and timestamps', async () => {
  const { extractRunnerDispatchPatch } = await import(`./runnerDispatch.js?test=${Date.now()}`)

  const patch = extractRunnerDispatchPatch({
    status: 'starting',
    startedAt: 'outer-start',
    run: {
      status: 'queued',
      startedAt: 'inner-start',
      finishedAt: 'inner-finish',
    },
  }, 'queued')

  assert.deepEqual(patch, {
    status: 'queued',
    startedAt: 'inner-start',
    finishedAt: 'inner-finish',
  })
})

test('reconcileRunAfterRunnerDispatchError syncs run state from runner lookup', async () => {
  const suffix = `test=${Date.now()}`
  const { run } = await import(`./db.js?${suffix}`)
  const { getCodexRunById } = await import(`./codexRuns.js?${suffix}`)
  const { reconcileRunAfterRunnerDispatchError } = await import(`./runnerDispatch.js?${suffix}`)

  const now = new Date().toISOString()
  run(
    `INSERT INTO tasks (slug, edit_token, title, auto_title, last_prompt_preview, codex_session_id, visibility, expires_at, created_at, updated_at)
     VALUES (?, ?, '', '', '', ?, 'private', NULL, ?, ?)`,
    ['task-1', 'token-1', 'session-1', now, now]
  )
  run(
    `INSERT INTO codex_sessions (id, title, engine, cwd, codex_thread_id, engine_session_id, engine_thread_id, engine_meta_json, created_at, updated_at)
     VALUES (?, ?, 'codex', ?, '', '', '', '{}', ?, ?)`,
    ['session-1', 'Session 1', sharedTempDir, now, now]
  )
  run(
    `INSERT INTO codex_runs (id, task_slug, session_id, engine, prompt, prompt_blocks_json, status, response_message, error_message, created_at, updated_at, started_at, finished_at)
     VALUES (?, ?, ?, 'codex', ?, '[]', 'queued', '', '', ?, ?, NULL, NULL)`,
    ['run-1', 'task-1', 'session-1', 'hello', now, now]
  )

  const reconciled = await reconcileRunAfterRunnerDispatchError({
    runId: 'run-1',
    error: Object.assign(new Error('runner request timed out after 5000ms'), { statusCode: 504 }),
    runnerClient: {
      async getRun() {
        return {
          run: {
            runId: 'run-1',
            status: 'running',
            startedAt: now,
          },
        }
      },
    },
    fallbackStatus: 'queued',
    logger: {
      warn() {},
    },
  })

  assert.equal(reconciled.pending, false)
  assert.equal(reconciled.syncedFromRunner, true)
  assert.equal(reconciled.run?.status, 'running')
  assert.equal(getCodexRunById('run-1')?.status, 'running')
})

test('reconcileRunAfterRunnerDispatchError keeps run queued on timeout when runner lookup is unavailable', async () => {
  const suffix = `test=${Date.now()}`
  const { run } = await import(`./db.js?${suffix}`)
  const { getCodexRunById } = await import(`./codexRuns.js?${suffix}`)
  const { reconcileRunAfterRunnerDispatchError } = await import(`./runnerDispatch.js?${suffix}`)

  const now = new Date().toISOString()
  run(
    `INSERT INTO tasks (slug, edit_token, title, auto_title, last_prompt_preview, codex_session_id, visibility, expires_at, created_at, updated_at)
     VALUES (?, ?, '', '', '', ?, 'private', NULL, ?, ?)`,
    ['task-2', 'token-2', 'session-2', now, now]
  )
  run(
    `INSERT INTO codex_sessions (id, title, engine, cwd, codex_thread_id, engine_session_id, engine_thread_id, engine_meta_json, created_at, updated_at)
     VALUES (?, ?, 'codex', ?, '', '', '', '{}', ?, ?)`,
    ['session-2', 'Session 2', sharedTempDir, now, now]
  )
  run(
    `INSERT INTO codex_runs (id, task_slug, session_id, engine, prompt, prompt_blocks_json, status, response_message, error_message, created_at, updated_at, started_at, finished_at)
     VALUES (?, ?, ?, 'codex', ?, '[]', 'queued', '', '', ?, ?, NULL, NULL)`,
    ['run-2', 'task-2', 'session-2', 'hello', now, now]
  )

  const reconciled = await reconcileRunAfterRunnerDispatchError({
    runId: 'run-2',
    error: Object.assign(new Error('runner request timed out after 5000ms'), { statusCode: 504 }),
    runnerClient: {
      async getRun() {
        const lookupError = new Error('runner lookup failed')
        lookupError.statusCode = 503
        throw lookupError
      },
    },
    fallbackStatus: 'queued',
    logger: {
      warn() {},
    },
  })

  assert.equal(reconciled.pending, true)
  assert.equal(reconciled.syncedFromRunner, false)
  assert.equal(reconciled.run?.status, 'queued')
  assert.equal(getCodexRunById('run-2')?.status, 'queued')
})
