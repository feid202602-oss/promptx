import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import test from 'node:test'

function git(cwd, args = []) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim()
}

test('git diff review returns task and run scoped file changes for git workspaces', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptx-git-diff-'))
  const repoDir = path.join(tempDir, 'repo')
  fs.mkdirSync(repoDir, { recursive: true })

  git(repoDir, ['init'])
  git(repoDir, ['config', 'user.email', 'promptx@example.com'])
  git(repoDir, ['config', 'user.name', 'PromptX'])

  fs.writeFileSync(path.join(repoDir, 'tracked.txt'), 'base\n')
  git(repoDir, ['add', 'tracked.txt'])
  git(repoDir, ['commit', '-m', 'init'])
  const branchName = git(repoDir, ['symbolic-ref', '--short', 'HEAD'])

  const originalCwd = process.cwd()
  process.chdir(tempDir)

  try {
    const { run } = await import('./db.js')
    const { captureRunGitBaseline, captureTaskGitBaseline, getTaskGitDiffReview } = await import(`./gitDiff.js?test=${Date.now()}`)

    const now = new Date().toISOString()
    run(
      `INSERT INTO tasks (slug, edit_token, title, auto_title, last_prompt_preview, codex_session_id, visibility, expires_at, created_at, updated_at)
       VALUES (?, ?, '', '', '', ?, 'private', NULL, ?, ?)`,
      ['task-1', 'token-1', 'session-1', now, now]
    )
    run(
      `INSERT INTO codex_sessions (id, title, cwd, codex_thread_id, created_at, updated_at)
       VALUES (?, ?, ?, '', ?, ?)`,
      ['session-1', 'Repo Session', repoDir, now, now]
    )
    run(
      `INSERT INTO codex_runs (id, task_slug, session_id, prompt, status, response_message, error_message, created_at, updated_at, started_at, finished_at)
       VALUES (?, ?, ?, '', 'running', '', '', ?, ?, ?, NULL)`,
      ['run-1', 'task-1', 'session-1', now, now, now]
    )

    captureTaskGitBaseline('task-1', repoDir)
    captureRunGitBaseline('run-1', repoDir)

    fs.writeFileSync(path.join(repoDir, 'tracked.txt'), 'after\n')
    fs.writeFileSync(path.join(repoDir, 'new-file.txt'), 'hello\n')

    const workspaceDiff = getTaskGitDiffReview('task-1', { scope: 'workspace' })
    const taskDiff = getTaskGitDiffReview('task-1', { scope: 'task' })
    const taskTrackedDetail = getTaskGitDiffReview('task-1', { scope: 'task', filePath: 'tracked.txt' })
    const taskNewFileDetail = getTaskGitDiffReview('task-1', { scope: 'task', filePath: 'new-file.txt' })
    const runDiff = getTaskGitDiffReview('task-1', { scope: 'run', runId: 'run-1' })

    assert.equal(workspaceDiff.supported, true)
    assert.equal(workspaceDiff.branch, branchName)
    assert.deepEqual(workspaceDiff.summary, { fileCount: 2, additions: 2, deletions: 1 })
    assert.deepEqual(workspaceDiff.files.map((file) => `${file.status}:${file.path}`), ['A:new-file.txt', 'M:tracked.txt'])

    assert.equal(taskDiff.supported, true)
    assert.equal(taskDiff.branch, branchName)
    assert.equal(taskDiff.summary.fileCount, 2)
    assert.deepEqual(taskDiff.summary, { fileCount: 2, additions: 2, deletions: 1 })
    assert.deepEqual(taskDiff.files.map((file) => `${file.status}:${file.path}`), ['A:new-file.txt', 'M:tracked.txt'])
    assert.equal(taskDiff.baseline?.branch, branchName)
    assert.equal(taskDiff.baseline?.headShort, taskDiff.baseline?.headOid.slice(0, 7))
    assert.deepEqual(taskDiff.warnings, [])
    assert.equal(taskDiff.files.find((file) => file.path === 'tracked.txt')?.patchLoaded, false)
    assert.deepEqual(taskTrackedDetail.files.map((file) => file.path), ['tracked.txt'])
    assert.match(taskTrackedDetail.files.find((file) => file.path === 'tracked.txt')?.patch || '', /--- a\/tracked\.txt/)
    assert.match(taskTrackedDetail.files.find((file) => file.path === 'tracked.txt')?.patch || '', /\+\+\+ b\/tracked\.txt/)
    assert.deepEqual(taskNewFileDetail.files.map((file) => file.path), ['new-file.txt'])
    assert.match(taskNewFileDetail.files.find((file) => file.path === 'new-file.txt')?.patch || '', /hello/)
    assert.deepEqual(
      taskDiff.files.find((file) => file.path === 'tracked.txt')
        ? {
            additions: taskDiff.files.find((file) => file.path === 'tracked.txt').additions,
            deletions: taskDiff.files.find((file) => file.path === 'tracked.txt').deletions,
          }
        : null,
      { additions: 1, deletions: 1 }
    )

    assert.equal(runDiff.supported, true)
    assert.equal(runDiff.branch, branchName)
    assert.equal(runDiff.summary.fileCount, 2)
    assert.deepEqual(runDiff.summary, { fileCount: 2, additions: 2, deletions: 1 })
    assert.deepEqual(runDiff.files.map((file) => `${file.status}:${file.path}`), ['A:new-file.txt', 'M:tracked.txt'])

    git(repoDir, ['add', 'tracked.txt', 'new-file.txt'])
    git(repoDir, ['commit', '-m', 'persist tracked and new file changes'])

    const committedWorkspaceDiff = getTaskGitDiffReview('task-1', { scope: 'workspace' })
    const committedTaskDiff = getTaskGitDiffReview('task-1', { scope: 'task' })
    const committedTaskTrackedDetail = getTaskGitDiffReview('task-1', { scope: 'task', filePath: 'tracked.txt' })
    assert.equal(committedWorkspaceDiff.supported, true)
    assert.deepEqual(committedWorkspaceDiff.summary, { fileCount: 0, additions: 0, deletions: 0 })
    assert.deepEqual(committedWorkspaceDiff.files, [])
    assert.equal(committedTaskDiff.supported, true)
    assert.deepEqual(committedTaskDiff.summary, { fileCount: 2, additions: 2, deletions: 1 })
    assert.deepEqual(committedTaskDiff.files.map((file) => `${file.status}:${file.path}`), ['A:new-file.txt', 'M:tracked.txt'])
    assert.equal(committedTaskDiff.files.find((file) => file.path === 'tracked.txt')?.patchLoaded, false)
    assert.deepEqual(committedTaskTrackedDetail.files.map((file) => file.path), ['tracked.txt'])
    assert.match(committedTaskTrackedDetail.files.find((file) => file.path === 'tracked.txt')?.patch || '', /--- a\/tracked\.txt/)
    assert.match(committedTaskTrackedDetail.files.find((file) => file.path === 'tracked.txt')?.patch || '', /\+\+\+ b\/tracked\.txt/)
    assert.match(committedTaskTrackedDetail.files.find((file) => file.path === 'tracked.txt')?.patch || '', /after/)
  } finally {
    process.chdir(originalCwd)
  }
})
