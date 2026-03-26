import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

test('listTasks uses stable created-at order instead of updated-at order', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptx-repository-'))
  const originalCwd = process.cwd()
  const originalDataDir = process.env.PROMPTX_DATA_DIR
  const dataDir = path.join(tempDir, 'data')

  fs.mkdirSync(dataDir, { recursive: true })
  process.chdir(tempDir)
  process.env.PROMPTX_DATA_DIR = dataDir

  try {
    const repository = await import(`./repository.js?test=${Date.now()}`)
    const { createTask, listTasks, updateTask } = repository

    const olderTask = createTask({
      title: 'older',
      visibility: 'private',
      expiry: 'none',
    })

    await new Promise((resolve) => setTimeout(resolve, 10))

    const newerTask = createTask({
      title: 'newer',
      visibility: 'private',
      expiry: 'none',
    })

    updateTask(olderTask.slug, {
      title: 'older updated',
      visibility: 'private',
      expiry: 'none',
      blocks: [{ type: 'text', content: 'changed' }],
    })

    const items = listTasks()
    assert.deepEqual(
      items.map((item) => item.slug),
      [newerTask.slug, olderTask.slug]
    )
  } finally {
    process.chdir(originalCwd)
    if (typeof originalDataDir === 'string') {
      process.env.PROMPTX_DATA_DIR = originalDataDir
    } else {
      delete process.env.PROMPTX_DATA_DIR
    }
  }
})

test('updateTask skips touching updatedAt when payload is unchanged', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptx-repository-'))
  const originalCwd = process.cwd()
  const originalDataDir = process.env.PROMPTX_DATA_DIR
  const dataDir = path.join(tempDir, 'data')

  fs.mkdirSync(dataDir, { recursive: true })
  process.chdir(tempDir)
  process.env.PROMPTX_DATA_DIR = dataDir

  try {
    const repository = await import(`./repository.js?test=${Date.now()}`)
    const { createTask, getTaskBySlug, updateTask } = repository

    const task = createTask({
      title: 'same task',
      autoTitle: 'same auto',
      lastPromptPreview: 'same preview',
      visibility: 'private',
      expiry: 'none',
      codexSessionId: 'session-a',
      todoItems: [
        {
          id: 'todo-1',
          createdAt: '2026-03-26T00:00:00.000Z',
          blocks: [{ type: 'text', content: 'todo text' }],
        },
      ],
      blocks: [
        { type: 'text', content: 'hello' },
      ],
    })

    const before = getTaskBySlug(task.slug)
    await new Promise((resolve) => setTimeout(resolve, 10))

    const result = updateTask(task.slug, {
      title: before.title,
      autoTitle: before.autoTitle,
      lastPromptPreview: before.lastPromptPreview,
      visibility: before.visibility,
      expiry: before.expiry,
      codexSessionId: before.codexSessionId,
      todoItems: before.todoItems,
      blocks: before.blocks,
    })

    const after = getTaskBySlug(task.slug)
    assert.equal(result.changed, false)
    assert.equal(after.updatedAt, before.updatedAt)
  } finally {
    process.chdir(originalCwd)
    if (typeof originalDataDir === 'string') {
      process.env.PROMPTX_DATA_DIR = originalDataDir
    } else {
      delete process.env.PROMPTX_DATA_DIR
    }
  }
})
