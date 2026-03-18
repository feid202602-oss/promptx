import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

import { resolvePromptxPaths } from '../apps/server/src/appPaths.js'

const DEFAULT_PORT = 3000
const DEFAULT_HOST = '127.0.0.1'
const STARTUP_TIMEOUT_MS = 15_000
const STOP_TIMEOUT_MS = 8_000
const POLL_INTERVAL_MS = 250

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const webDistDir = path.join(rootDir, 'apps', 'web', 'dist')
const webIndexPath = path.join(webDistDir, 'index.html')
const serverEntryPath = path.join(rootDir, 'apps', 'server', 'src', 'index.js')

function ensureRuntimeDir() {
  const { promptxHomeDir } = resolvePromptxPaths()
  const runtimeDir = path.join(promptxHomeDir, 'run')
  fs.mkdirSync(runtimeDir, { recursive: true })
  return runtimeDir
}

function getRuntimePaths() {
  const runtimeDir = ensureRuntimeDir()
  return {
    runtimeDir,
    pidFile: path.join(runtimeDir, 'service.pid'),
    stateFile: path.join(runtimeDir, 'service.json'),
    logFile: path.join(runtimeDir, 'service.log'),
  }
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

function readPid(filePath) {
  try {
    const value = fs.readFileSync(filePath, 'utf8').trim()
    const pid = Number(value)
    return Number.isInteger(pid) && pid > 0 ? pid : 0
  } catch {
    return 0
  }
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false
  }

  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

function removeRuntimeFiles() {
  const { pidFile, stateFile } = getRuntimePaths()
  fs.rmSync(pidFile, { force: true })
  fs.rmSync(stateFile, { force: true })
}

function getServiceState() {
  const { pidFile, stateFile, logFile } = getRuntimePaths()
  const pid = readPid(pidFile)
  const state = readJsonFile(stateFile) || {}

  if (!isProcessAlive(pid)) {
    removeRuntimeFiles()
    return {
      running: false,
      pid: 0,
      state: null,
      logFile,
    }
  }

  return {
    running: true,
    pid,
    state,
    logFile,
  }
}

function getBaseUrl(host, port) {
  return `http://${host}:${port}`
}

async function waitForHealth(baseUrl, pid) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS
  const healthUrl = `${baseUrl}/health`

  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      throw new Error('服务进程启动后很快退出。')
    }

    try {
      const response = await fetch(healthUrl)
      if (response.ok) {
        return
      }
    } catch {
      // Ignore until timeout.
    }

    await delay(POLL_INTERVAL_MS)
  }

  throw new Error('等待服务启动超时。')
}

async function checkHealth(baseUrl) {
  try {
    const response = await fetch(`${baseUrl}/health`)
    return response.ok
  } catch {
    return false
  }
}

function tailLog(filePath, maxLines = 30) {
  try {
    const lines = fs.readFileSync(filePath, 'utf8').trim().split(/\r?\n/)
    return lines.slice(-maxLines).join('\n').trim()
  } catch {
    return ''
  }
}

async function startService() {
  if (!fs.existsSync(webIndexPath)) {
    throw new Error('没有找到前端构建产物，请先运行 `pnpm build`。')
  }

  const existing = getServiceState()
  if (existing.running) {
    const host = String(existing.state?.host || DEFAULT_HOST)
    const port = Number(existing.state?.port || DEFAULT_PORT)
    console.log(`[promptx] 已在运行：${getBaseUrl(host, port)}（PID ${existing.pid}）`)
    return
  }

  const { pidFile, stateFile, logFile } = getRuntimePaths()
  const host = String(process.env.HOST || DEFAULT_HOST).trim() || DEFAULT_HOST
  const port = Math.max(1, Number(process.env.PORT || process.env.PROMPTX_SERVER_PORT) || DEFAULT_PORT)
  const baseUrl = getBaseUrl(host, port)
  const startedAt = new Date().toISOString()

  if (await checkHealth(baseUrl)) {
    throw new Error(`检测到 ${baseUrl} 已有服务在运行，请先释放端口或改用其他端口。`)
  }

  const logFd = fs.openSync(logFile, 'a')

  const child = spawn(process.execPath, [serverEntryPath], {
    cwd: rootDir,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: {
      ...process.env,
      HOST: host,
      PORT: String(port),
    },
  })

  fs.closeSync(logFd)
  child.unref()

  fs.writeFileSync(pidFile, `${child.pid}\n`, 'utf8')
  fs.writeFileSync(stateFile, JSON.stringify({
    pid: child.pid,
    host,
    port,
    startedAt,
    logFile,
  }, null, 2))

  try {
    await waitForHealth(baseUrl, child.pid)
    await delay(300)
    if (!isProcessAlive(child.pid)) {
      throw new Error(`服务进程已退出，通常是端口 ${port} 被占用或启动参数冲突。`)
    }
  } catch (error) {
    if (isProcessAlive(child.pid)) {
      try {
        process.kill(child.pid, 'SIGTERM')
      } catch {
        // Ignore shutdown failure.
      }
    }

    removeRuntimeFiles()
    const recentLog = tailLog(logFile)
    throw new Error([
      error.message || '服务启动失败。',
      recentLog ? `最近日志：\n${recentLog}` : '',
    ].filter(Boolean).join('\n\n'))
  }

  console.log(`[promptx] 已后台启动：${baseUrl}`)
  console.log(`[promptx] 日志文件：${logFile}`)
}

async function stopService() {
  const current = getServiceState()
  if (!current.running) {
    console.log('[promptx] 当前没有运行中的服务。')
    return
  }

  const pid = current.pid

  try {
    process.kill(pid, 'SIGTERM')
  } catch (error) {
    if (error?.code !== 'ESRCH') {
      throw error
    }
  }

  const deadline = Date.now() + STOP_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      removeRuntimeFiles()
      console.log(`[promptx] 已停止服务（PID ${pid}）。`)
      return
    }
    await delay(POLL_INTERVAL_MS)
  }

  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // Ignore when process already exited.
  }

  removeRuntimeFiles()
  console.log(`[promptx] 已强制停止服务（PID ${pid}）。`)
}

function printStatus() {
  const current = getServiceState()
  if (!current.running) {
    console.log('[promptx] 服务未运行。')
    return
  }

  const host = String(current.state?.host || DEFAULT_HOST)
  const port = Number(current.state?.port || DEFAULT_PORT)
  const startedAt = current.state?.startedAt || ''
  console.log(`[promptx] 运行中：${getBaseUrl(host, port)}`)
  console.log(`[promptx] PID：${current.pid}`)
  if (startedAt) {
    console.log(`[promptx] 启动时间：${startedAt}`)
  }
  console.log(`[promptx] 日志文件：${current.logFile}`)
}

async function main() {
  const command = String(process.argv[2] || 'status').trim()

  if (command === 'start') {
    await startService()
    return
  }

  if (command === 'stop') {
    await stopService()
    return
  }

  if (command === 'status') {
    printStatus()
    return
  }

  throw new Error(`不支持的命令：${command}`)
}

main().catch((error) => {
  console.error(`[promptx] ${error.message || error}`)
  process.exitCode = 1
})
