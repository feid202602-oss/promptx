import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { all, get, run, transaction } from './db.js'
import { getPromptxCodexSessionById } from './codexSessions.js'
import { getTaskBySlug } from './repository.js'

const MAX_SNAPSHOT_TEXT_BYTES = 220_000
const MAX_PATCH_TEXT_BYTES = 260_000

function runGit(repoRoot = '', args = [], options = {}) {
  const result = spawnSync('git', ['-C', repoRoot, ...args], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    ...options,
  })

  return {
    status: typeof result.status === 'number' ? result.status : 1,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
  }
}

function runGitBuffer(repoRoot = '', args = [], options = {}) {
  const result = spawnSync('git', ['-C', repoRoot, ...args], {
    encoding: 'buffer',
    maxBuffer: 8 * 1024 * 1024,
    ...options,
  })

  return {
    status: typeof result.status === 'number' ? result.status : 1,
    stdout: Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout || ''),
    stderr: Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.from(result.stderr || ''),
  }
}

function splitNullText(value = '') {
  return String(value || '').split('\0').filter(Boolean)
}

function createHash(value) {
  return crypto.createHash('sha1').update(value).digest('hex')
}

function normalizeDiffStatus(value = '') {
  const status = String(value || '').trim().charAt(0).toUpperCase()
  if (status === 'A' || status === 'D') {
    return status
  }
  return 'M'
}

function parseTrackedDiffEntries(output = '') {
  const parts = splitNullText(output)
  const entries = new Map()

  for (let index = 0; index < parts.length; index += 1) {
    const rawStatus = String(parts[index] || '').trim()
    if (!rawStatus) {
      continue
    }
    const rawPath = String(parts[index + 1] || '').trim()
    if (!rawPath) {
      continue
    }

    let nextPath = rawPath
    if (rawStatus.startsWith('R') || rawStatus.startsWith('C')) {
      nextPath = String(parts[index + 2] || rawPath).trim() || rawPath
      index += 2
    } else {
      index += 1
    }

    entries.set(nextPath, {
      path: nextPath,
      status: normalizeDiffStatus(rawStatus),
    })
  }

  return entries
}

function resolveGitRepoRoot(cwd = '') {
  const targetCwd = String(cwd || '').trim()
  if (!targetCwd) {
    return ''
  }

  const result = runGit(targetCwd, ['rev-parse', '--show-toplevel'])
  if (result.status !== 0) {
    return ''
  }

  return result.stdout.trim()
}

function resolveGitHeadOid(repoRoot = '') {
  const result = runGit(repoRoot, ['rev-parse', '--verify', 'HEAD'])
  if (result.status !== 0) {
    return ''
  }
  return result.stdout.trim()
}

function resolveGitBranchLabel(repoRoot = '') {
  const branchResult = runGit(repoRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
  const branchName = branchResult.stdout.trim()
  if (branchResult.status === 0 && branchName) {
    return branchName
  }

  const headShort = runGit(repoRoot, ['rev-parse', '--short', 'HEAD']).stdout.trim()
  if (headShort) {
    return `detached@${headShort}`
  }

  return ''
}

function resolveShortOid(value = '') {
  const text = String(value || '').trim()
  return text ? text.slice(0, 7) : ''
}

function commitExists(repoRoot = '', oid = '') {
  const normalizedOid = String(oid || '').trim()
  if (!repoRoot || !normalizedOid) {
    return false
  }

  return runGit(repoRoot, ['cat-file', '-e', `${normalizedOid}^{commit}`]).status === 0
}

function isAncestorCommit(repoRoot = '', ancestorOid = '', descendantOid = '') {
  const normalizedAncestorOid = String(ancestorOid || '').trim()
  const normalizedDescendantOid = String(descendantOid || '').trim()
  if (!repoRoot || !normalizedAncestorOid || !normalizedDescendantOid) {
    return false
  }

  return runGit(repoRoot, ['merge-base', '--is-ancestor', normalizedAncestorOid, normalizedDescendantOid]).status === 0
}

function listGitChangeEntries(repoRoot = '') {
  const entries = new Map()
  const headOid = resolveGitHeadOid(repoRoot)

  if (headOid) {
    const trackedResult = runGit(repoRoot, ['diff', '--name-status', '-z', 'HEAD', '--'])
    parseTrackedDiffEntries(trackedResult.stdout).forEach((entry, filePath) => {
      entries.set(filePath, entry)
    })
  } else {
    splitNullText(runGit(repoRoot, ['ls-files', '-z']).stdout).forEach((filePath) => {
      entries.set(filePath, {
        path: filePath,
        status: 'A',
      })
    })
  }

  splitNullText(runGit(repoRoot, ['ls-files', '--others', '--exclude-standard', '-z']).stdout).forEach((filePath) => {
    if (!entries.has(filePath)) {
      entries.set(filePath, {
        path: filePath,
        status: 'A',
      })
    }
  })

  return {
    headOid,
    entries,
  }
}

function readFileState(repoRoot = '', filePath = '') {
  const absolutePath = path.resolve(repoRoot, filePath)
  if (!absolutePath.startsWith(path.resolve(repoRoot))) {
    return {
      exists: false,
      isBinary: false,
      tooLarge: false,
      size: 0,
      hash: '',
      text: '',
    }
  }

  try {
    const stats = fs.statSync(absolutePath)
    if (!stats.isFile()) {
      return {
        exists: false,
        isBinary: false,
        tooLarge: false,
        size: 0,
        hash: '',
        text: '',
      }
    }

    const buffer = fs.readFileSync(absolutePath)
    const isBinary = buffer.includes(0)
    const tooLarge = !isBinary && buffer.length > MAX_SNAPSHOT_TEXT_BYTES

    return {
      exists: true,
      isBinary,
      tooLarge,
      size: buffer.length,
      hash: createHash(buffer),
      text: !isBinary && !tooLarge ? buffer.toString('utf8') : '',
    }
  } catch {
    return {
      exists: false,
      isBinary: false,
      tooLarge: false,
      size: 0,
      hash: '',
      text: '',
    }
  }
}

function areFileStatesEqual(left, right) {
  const previous = left || null
  const next = right || null

  if (!previous && !next) {
    return true
  }

  if (!previous || !next) {
    return false
  }

  return (
    Boolean(previous.exists) === Boolean(next.exists)
    && Boolean(previous.isBinary) === Boolean(next.isBinary)
    && Boolean(previous.tooLarge) === Boolean(next.tooLarge)
    && String(previous.hash || '') === String(next.hash || '')
  )
}

function captureDirtySnapshots(repoRoot = '') {
  const { headOid, entries } = listGitChangeEntries(repoRoot)
  const snapshots = new Map()

  entries.forEach((entry, filePath) => {
    snapshots.set(filePath, readFileState(repoRoot, filePath))
  })

  return {
    headOid,
    snapshots,
  }
}

function readHeadFileState(repoRoot = '', headOid = '', filePath = '') {
  const normalizedHeadOid = String(headOid || '').trim()
  const normalizedPath = String(filePath || '').trim()
  if (!repoRoot || !normalizedHeadOid || !normalizedPath) {
    return null
  }

  const result = runGitBuffer(repoRoot, ['show', `${normalizedHeadOid}:${normalizedPath}`])
  if (result.status !== 0) {
    return null
  }

  const buffer = result.stdout
  const isBinary = buffer.includes(0)
  const tooLarge = !isBinary && buffer.length > MAX_SNAPSHOT_TEXT_BYTES

  return {
    exists: true,
    isBinary,
    tooLarge,
    size: buffer.length,
    hash: createHash(buffer),
    text: !isBinary && !tooLarge ? buffer.toString('utf8') : '',
  }
}

function createBaselineStateResolver(repoRoot = '', baseline = null) {
  const cache = new Map()

  return (filePath = '') => {
    const normalizedPath = String(filePath || '').trim()
    if (!normalizedPath) {
      return null
    }

    if (baseline?.entries?.has(normalizedPath)) {
      return baseline.entries.get(normalizedPath) || null
    }

    if (cache.has(normalizedPath)) {
      return cache.get(normalizedPath)
    }

    const state = readHeadFileState(repoRoot, baseline?.headOid, normalizedPath)
    cache.set(normalizedPath, state)
    return state
  }
}

function listCommittedChangeEntries(repoRoot = '', fromHeadOid = '', toHeadOid = '') {
  const normalizedFromHeadOid = String(fromHeadOid || '').trim()
  const normalizedToHeadOid = String(toHeadOid || '').trim()

  if (!repoRoot || !normalizedFromHeadOid || !normalizedToHeadOid || normalizedFromHeadOid === normalizedToHeadOid) {
    return new Map()
  }

  const result = runGit(repoRoot, ['diff', '--name-status', '-z', `${normalizedFromHeadOid}..${normalizedToHeadOid}`, '--'])
  return parseTrackedDiffEntries(result.stdout)
}

function serializeState(value = {}) {
  return JSON.stringify({
    exists: Boolean(value.exists),
    isBinary: Boolean(value.isBinary),
    tooLarge: Boolean(value.tooLarge),
    size: Math.max(0, Number(value.size) || 0),
    hash: String(value.hash || ''),
    text: String(value.text || ''),
  })
}

function parseState(value = '{}') {
  try {
    const payload = JSON.parse(value || '{}')
    return {
      exists: Boolean(payload.exists),
      isBinary: Boolean(payload.isBinary),
      tooLarge: Boolean(payload.tooLarge),
      size: Math.max(0, Number(payload.size) || 0),
      hash: String(payload.hash || ''),
      text: String(payload.text || ''),
    }
  } catch {
    return {
      exists: false,
      isBinary: false,
      tooLarge: false,
      size: 0,
      hash: '',
      text: '',
    }
  }
}

function loadTaskBaseline(taskSlug = '') {
  const row = get(
    `SELECT task_slug, repo_root, head_oid, branch_label, created_at, updated_at
     FROM task_git_baselines
     WHERE task_slug = ?`,
    [String(taskSlug || '').trim()]
  )

  if (!row) {
    return null
  }

  const entries = new Map()
  all(
    `SELECT path, state_json
     FROM task_git_baseline_entries
     WHERE task_slug = ?
     ORDER BY path ASC`,
    [row.task_slug]
  ).forEach((entry) => {
    entries.set(String(entry.path || '').trim(), parseState(entry.state_json))
  })

  return {
    taskSlug: row.task_slug,
    repoRoot: String(row.repo_root || ''),
    headOid: String(row.head_oid || ''),
    branchLabel: String(row.branch_label || ''),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    entries,
  }
}

function loadRunBaseline(runId = '') {
  const row = get(
    `SELECT run_id, repo_root, head_oid, branch_label, created_at
     FROM run_git_baselines
     WHERE run_id = ?`,
    [String(runId || '').trim()]
  )

  if (!row) {
    return null
  }

  const entries = new Map()
  all(
    `SELECT path, state_json
     FROM run_git_baseline_entries
     WHERE run_id = ?
     ORDER BY path ASC`,
    [row.run_id]
  ).forEach((entry) => {
    entries.set(String(entry.path || '').trim(), parseState(entry.state_json))
  })

  return {
    runId: row.run_id,
    repoRoot: String(row.repo_root || ''),
    headOid: String(row.head_oid || ''),
    branchLabel: String(row.branch_label || ''),
    createdAt: row.created_at,
    entries,
  }
}

function saveTaskBaseline(taskSlug = '', repoRoot = '', headOid = '', branchLabel = '', entries = new Map()) {
  const now = new Date().toISOString()
  const normalizedTaskSlug = String(taskSlug || '').trim()

  transaction(() => {
    run('DELETE FROM task_git_baseline_entries WHERE task_slug = ?', [normalizedTaskSlug])
    run('DELETE FROM task_git_baselines WHERE task_slug = ?', [normalizedTaskSlug])
    run(
      `INSERT INTO task_git_baselines (task_slug, repo_root, head_oid, branch_label, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [normalizedTaskSlug, repoRoot, headOid, branchLabel, now, now]
    )

    entries.forEach((state, filePath) => {
      run(
        `INSERT INTO task_git_baseline_entries (task_slug, path, state_json)
         VALUES (?, ?, ?)`,
        [normalizedTaskSlug, filePath, serializeState(state)]
      )
    })
  })

  return loadTaskBaseline(normalizedTaskSlug)
}

function saveRunBaseline(runId = '', repoRoot = '', headOid = '', branchLabel = '', entries = new Map()) {
  const now = new Date().toISOString()
  const normalizedRunId = String(runId || '').trim()

  transaction(() => {
    run('DELETE FROM run_git_baseline_entries WHERE run_id = ?', [normalizedRunId])
    run('DELETE FROM run_git_baselines WHERE run_id = ?', [normalizedRunId])
    run(
      `INSERT INTO run_git_baselines (run_id, repo_root, head_oid, branch_label, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [normalizedRunId, repoRoot, headOid, branchLabel, now]
    )

    entries.forEach((state, filePath) => {
      run(
        `INSERT INTO run_git_baseline_entries (run_id, path, state_json)
         VALUES (?, ?, ?)`,
        [normalizedRunId, filePath, serializeState(state)]
      )
    })
  })

  return loadRunBaseline(normalizedRunId)
}

function resolveTaskRepoRoot(taskSlug = '') {
  const task = getTaskBySlug(taskSlug)
  if (!task || task.expired) {
    return ''
  }

  const sessionId = String(task.codexSessionId || '').trim()
  if (!sessionId) {
    return ''
  }

  const session = getPromptxCodexSessionById(sessionId)
  if (!session) {
    return ''
  }

  return resolveGitRepoRoot(session.cwd)
}

function getRunTaskSlug(runId = '') {
  const row = get(
    `SELECT task_slug
     FROM codex_runs
     WHERE id = ?`,
    [String(runId || '').trim()]
  )

  return String(row?.task_slug || '').trim()
}

export function captureTaskGitBaseline(taskSlug = '', cwd = '') {
  const normalizedTaskSlug = String(taskSlug || '').trim()
  if (!normalizedTaskSlug) {
    return null
  }

  const repoRoot = resolveGitRepoRoot(cwd)
  if (!repoRoot) {
    return null
  }

  const existing = loadTaskBaseline(normalizedTaskSlug)
  if (existing?.repoRoot === repoRoot) {
    return existing
  }

  const { headOid, snapshots } = captureDirtySnapshots(repoRoot)
  return saveTaskBaseline(normalizedTaskSlug, repoRoot, headOid, resolveGitBranchLabel(repoRoot), snapshots)
}

export function captureRunGitBaseline(runId = '', cwd = '') {
  const normalizedRunId = String(runId || '').trim()
  if (!normalizedRunId) {
    return null
  }

  const repoRoot = resolveGitRepoRoot(cwd)
  if (!repoRoot) {
    return null
  }

  const { headOid, snapshots } = captureDirtySnapshots(repoRoot)
  return saveRunBaseline(normalizedRunId, repoRoot, headOid, resolveGitBranchLabel(repoRoot), snapshots)
}

function parsePatchStats(patch = '') {
  let additions = 0
  let deletions = 0

  String(patch || '').split('\n').forEach((line) => {
    if (!line || line.startsWith('+++') || line.startsWith('---')) {
      return
    }
    if (line.startsWith('+')) {
      additions += 1
      return
    }
    if (line.startsWith('-')) {
      deletions += 1
    }
  })

  return { additions, deletions }
}

function parseNumstat(output = '') {
  const line = String(output || '')
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean)[0] || ''

  if (!line) {
    return {
      additions: 0,
      deletions: 0,
    }
  }

  const [rawAdditions, rawDeletions] = line.split('\t')
  return {
    additions: rawAdditions === '-' ? 0 : Math.max(0, Number(rawAdditions) || 0),
    deletions: rawDeletions === '-' ? 0 : Math.max(0, Number(rawDeletions) || 0),
  }
}

function buildDiffPayloadForFile(filePath = '', previousState = null, nextState = null, options = {}) {
  const includePatch = Boolean(options.includePatch)

  if ((previousState?.isBinary || nextState?.isBinary)) {
    return {
      binary: true,
      tooLarge: false,
      patch: '',
      patchLoaded: true,
      additions: 0,
      deletions: 0,
      message: '二进制文件暂不支持在线 diff 预览。',
    }
  }

  if (previousState?.tooLarge || nextState?.tooLarge) {
    return {
      binary: false,
      tooLarge: true,
      patch: '',
      patchLoaded: true,
      additions: 0,
      deletions: 0,
      message: '文件内容较大，暂不展示具体 diff。',
    }
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptx-git-diff-'))
  const previousPath = path.join(tempDir, 'before')
  const nextPath = path.join(tempDir, 'after')
  const nullPath = process.platform === 'win32'
    ? path.join(tempDir, 'null')
    : '/dev/null'

  try {
    if (process.platform === 'win32') {
      fs.writeFileSync(nullPath, '', 'utf8')
    }

    if (previousState?.exists) {
      fs.writeFileSync(previousPath, previousState.text || '', 'utf8')
    }
    if (nextState?.exists) {
      fs.writeFileSync(nextPath, nextState.text || '', 'utf8')
    }

    const statsResult = runGit(tempDir, [
      'diff',
      '--no-index',
      '--numstat',
      previousState?.exists ? previousPath : nullPath,
      nextState?.exists ? nextPath : nullPath,
    ])
    const numstat = parseNumstat(statsResult.stdout)

    if (!includePatch) {
      return {
        binary: false,
        tooLarge: false,
        patch: '',
        patchLoaded: false,
        additions: numstat.additions,
        deletions: numstat.deletions,
        message: '',
      }
    }

    const result = runGit(tempDir, [
      'diff',
      '--no-index',
      '--no-color',
      '--unified=3',
      previousState?.exists ? previousPath : nullPath,
      nextState?.exists ? nextPath : nullPath,
    ])

    let patch = String(result.stdout || '').trim()
    if (patch) {
      patch = patch
        .replace(/^diff --git .*$|^diff --git[^\n]*$/m, `diff --git ${previousState?.exists ? `a/${filePath}` : '/dev/null'} ${nextState?.exists ? `b/${filePath}` : '/dev/null'}`)
        .replace(/^--- .*$/m, previousState?.exists ? `--- a/${filePath}` : '--- /dev/null')
        .replace(/^\+\+\+ .*$/m, nextState?.exists ? `+++ b/${filePath}` : '+++ /dev/null')
    }
    const stats = parsePatchStats(patch)

    if (!patch) {
      return {
        binary: false,
        tooLarge: false,
        patch: '',
        patchLoaded: true,
        additions: stats.additions,
        deletions: stats.deletions,
        message: '',
      }
    }

    if (patch.length > MAX_PATCH_TEXT_BYTES) {
      return {
        binary: false,
        tooLarge: true,
        patch: '',
        patchLoaded: true,
        additions: stats.additions,
        deletions: stats.deletions,
        message: 'diff 内容较长，暂不在页面内完整展示。',
      }
    }

    return {
      binary: false,
      tooLarge: false,
      patch,
      patchLoaded: true,
      additions: stats.additions,
      deletions: stats.deletions,
      message: '',
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

function deriveFileStatus(previousState, nextState) {
  if (!previousState?.exists && nextState?.exists) {
    return 'A'
  }
  if (previousState?.exists && !nextState?.exists) {
    return 'D'
  }
  return 'M'
}

function sortDiffFiles(items = []) {
  const weightMap = {
    A: 0,
    M: 1,
    D: 2,
  }

  return [...items].sort((left, right) => {
    const statusDiff = (weightMap[left.status] ?? 9) - (weightMap[right.status] ?? 9)
    if (statusDiff) {
      return statusDiff
    }
    return String(left.path || '').localeCompare(String(right.path || ''), 'zh-CN')
  })
}

function createDiffFileEntry(filePath = '', previousState = null, nextState = null, options = {}) {
  if (areFileStatesEqual(previousState, nextState)) {
    return null
  }

  const patchPayload = buildDiffPayloadForFile(filePath, previousState, nextState, options)
  return {
    path: filePath,
    status: deriveFileStatus(previousState, nextState),
    additions: patchPayload.additions,
    deletions: patchPayload.deletions,
    binary: patchPayload.binary,
    tooLarge: patchPayload.tooLarge,
    patch: patchPayload.patch,
    patchLoaded: patchPayload.patchLoaded,
    message: patchPayload.message,
  }
}

function createUnsupportedResult(reason = '', repoRoot = '', branch = '') {
  return {
    supported: false,
    reason,
    repoRoot,
    branch,
    baseline: null,
    warnings: [],
    summary: {
      fileCount: 0,
      additions: 0,
      deletions: 0,
    },
    files: [],
  }
}

export function getTaskGitDiffReview(taskSlug = '', options = {}) {
  const normalizedTaskSlug = String(taskSlug || '').trim()
  if (!normalizedTaskSlug) {
    return createUnsupportedResult('任务不存在。')
  }

  const rawScope = String(options.scope || 'workspace').trim()
  const scope = rawScope === 'run'
    ? 'run'
    : rawScope === 'task'
      ? 'task'
      : 'workspace'
  const runId = String(options.runId || '').trim()
  const targetFilePath = String(options.filePath || '').trim()

  if (scope === 'workspace') {
    const repoRoot = resolveTaskRepoRoot(normalizedTaskSlug)
    if (!repoRoot) {
      return createUnsupportedResult('当前工作目录不是 Git 仓库，暂不支持代码变更审查。')
    }

    const branch = resolveGitBranchLabel(repoRoot)
    const { headOid, entries: workingTreeEntries } = listGitChangeEntries(repoRoot)
    const baselineStateForPath = createBaselineStateResolver(repoRoot, {
      headOid,
      entries: new Map(),
    })
    const files = []
    let additions = 0
    let deletions = 0
    const candidatePaths = targetFilePath ? [targetFilePath] : [...workingTreeEntries.keys()]

    candidatePaths.forEach((filePath) => {
      const previousState = baselineStateForPath(filePath)
      const nextState = readFileState(repoRoot, filePath)
      const diffEntry = createDiffFileEntry(filePath, previousState, nextState, {
        includePatch: Boolean(targetFilePath),
      })
      if (!diffEntry) {
        return
      }

      additions += diffEntry.additions
      deletions += diffEntry.deletions
      files.push(diffEntry)
    })

    return {
      supported: true,
      scope,
      runId: '',
      repoRoot,
      branch,
      baseline: null,
      warnings: [],
      baselineCreatedAt: '',
      summary: {
        fileCount: files.length,
        additions,
        deletions,
      },
      files: sortDiffFiles(files),
    }
  }

  let baseline = null
  if (scope === 'run') {
    if (!runId) {
      return createUnsupportedResult('请选择一轮执行后再查看本轮代码变更。')
    }
    if (getRunTaskSlug(runId) !== normalizedTaskSlug) {
      return createUnsupportedResult('没有找到对应的执行记录。')
    }
    baseline = loadRunBaseline(runId)
  } else {
    baseline = loadTaskBaseline(normalizedTaskSlug)
  }

  if (!baseline) {
    const fallbackRepoRoot = resolveTaskRepoRoot(normalizedTaskSlug)
    if (!fallbackRepoRoot) {
      return createUnsupportedResult('当前工作目录不是 Git 仓库，暂不支持代码变更审查。')
    }

    return createUnsupportedResult(
      scope === 'run'
        ? '这轮执行还没有建立代码变更基线，暂时无法查看本轮 diff。'
        : '当前任务还没有建立代码变更基线，请先让 Codex 执行一轮。',
      fallbackRepoRoot,
      resolveGitBranchLabel(fallbackRepoRoot)
    )
  }

  const repoRoot = resolveGitRepoRoot(baseline.repoRoot)
  if (!repoRoot) {
    return createUnsupportedResult('原工作目录已不是有效的 Git 仓库，暂时无法读取代码变更。', baseline.repoRoot)
  }
  const branch = resolveGitBranchLabel(repoRoot)
  const currentHeadOid = resolveGitHeadOid(repoRoot)
  const warnings = []

  if (baseline.headOid) {
    if (!commitExists(repoRoot, baseline.headOid)) {
      return createUnsupportedResult(
        '基线对应的 commit 已不存在，仓库可能被 reset、rebase 或切换到无关历史，暂时无法准确读取该范围的代码变更。',
        repoRoot,
        branch
      )
    }

    if (baseline.branchLabel && branch && baseline.branchLabel !== branch) {
      warnings.push(`当前分支已从 ${baseline.branchLabel} 切换到 ${branch}`)
    }

    if (currentHeadOid && baseline.headOid !== currentHeadOid && !isAncestorCommit(repoRoot, baseline.headOid, currentHeadOid)) {
      warnings.push('当前 HEAD 已不在基线 commit 的后续历史中，仓库可能经历了 reset、rebase 或切分支')
    }
  }

  const { entries: workingTreeEntries } = listGitChangeEntries(repoRoot)
  const baselineStateForPath = createBaselineStateResolver(repoRoot, baseline)
  const files = []
  let additions = 0
  let deletions = 0

  const candidatePaths = targetFilePath
    ? [targetFilePath]
    : new Set([
      ...baseline.entries.keys(),
      ...listCommittedChangeEntries(repoRoot, baseline.headOid, currentHeadOid).keys(),
      ...workingTreeEntries.keys(),
    ])

  candidatePaths.forEach((filePath) => {
    const previousState = baselineStateForPath(filePath)
    const nextState = readFileState(repoRoot, filePath)
    const diffEntry = createDiffFileEntry(filePath, previousState, nextState, {
      includePatch: Boolean(targetFilePath),
    })
    if (!diffEntry) {
      return
    }

    additions += diffEntry.additions
    deletions += diffEntry.deletions
    files.push(diffEntry)
  })

  return {
    supported: true,
    scope,
    runId: scope === 'run' ? runId : '',
    repoRoot,
    branch,
    baseline: {
      createdAt: baseline.createdAt,
      headOid: baseline.headOid,
      headShort: resolveShortOid(baseline.headOid),
      branch: baseline.branchLabel || '',
      currentHeadOid,
      currentHeadShort: resolveShortOid(currentHeadOid),
    },
    warnings,
    baselineCreatedAt: baseline.createdAt,
    summary: {
      fileCount: files.length,
      additions,
      deletions,
    },
    files: sortDiffFiles(files),
  }
}
