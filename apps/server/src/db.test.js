import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'

test('db module backs up legacy schema and initializes the latest schema', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptx-db-legacy-'))
  const dataDir = path.join(tempDir, 'data')
  const legacyDbPath = path.join(dataDir, 'promptx.sqlite')
  fs.mkdirSync(dataDir, { recursive: true })

  const legacyDb = new Database(legacyDbPath)
  legacyDb.exec(`
    CREATE TABLE documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT ''
    );
  `)
  legacyDb.close()

  const originalCwd = process.cwd()
  const originalDataDir = process.env.PROMPTX_DATA_DIR
  process.chdir(tempDir)
  process.env.PROMPTX_DATA_DIR = dataDir

  try {
    const dbModule = await import(`./db.js?test=${Date.now()}`)
    const schemaVersionRow = dbModule.get(
      'SELECT value FROM schema_meta WHERE key = ?',
      ['schema_version']
    )
    const tasksTable = dbModule.get(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      ['tasks']
    )

    assert.equal(schemaVersionRow?.value, '1')
    assert.equal(tasksTable?.name, 'tasks')

    const backupFiles = fs.readdirSync(dataDir).filter((fileName) => fileName.includes('.legacy-') && fileName.endsWith('.bak'))
    assert.equal(backupFiles.length, 1)
  } finally {
    process.chdir(originalCwd)
    if (typeof originalDataDir === 'string') {
      process.env.PROMPTX_DATA_DIR = originalDataDir
    } else {
      delete process.env.PROMPTX_DATA_DIR
    }
  }
})

test('db module reads latest disk data even when another connection writes to the same sqlite file', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptx-db-shared-'))
  const dataDir = path.join(tempDir, 'data')
  fs.mkdirSync(dataDir, { recursive: true })

  const originalCwd = process.cwd()
  const originalDataDir = process.env.PROMPTX_DATA_DIR
  process.chdir(tempDir)
  process.env.PROMPTX_DATA_DIR = dataDir

  try {
    const dbModule = await import(`./db.js?test=${Date.now()}`)
    const now = new Date().toISOString()

    dbModule.run(
      `INSERT INTO tasks (slug, edit_token, title, auto_title, last_prompt_preview, codex_session_id, visibility, expires_at, created_at, updated_at)
       VALUES (?, ?, '', '', '', '', 'private', NULL, ?, ?)`,
      ['task-from-module', 'token-module', now, now]
    )

    const dbPath = path.join(dataDir, 'promptx.sqlite')
    const externalDb = new Database(dbPath)
    externalDb.pragma('foreign_keys = ON')
    externalDb.prepare(
      `INSERT INTO tasks (slug, edit_token, title, auto_title, last_prompt_preview, codex_session_id, visibility, expires_at, created_at, updated_at)
       VALUES (?, ?, '', '', '', '', 'private', NULL, ?, ?)`
    ).run('task-from-external', 'token-external', now, now)
    externalDb.close()

    const rows = dbModule.all('SELECT slug FROM tasks ORDER BY slug ASC')
    assert.deepEqual(rows.map((row) => row.slug), ['task-from-external', 'task-from-module'])
  } finally {
    process.chdir(originalCwd)
    if (typeof originalDataDir === 'string') {
      process.env.PROMPTX_DATA_DIR = originalDataDir
    } else {
      delete process.env.PROMPTX_DATA_DIR
    }
  }
})
