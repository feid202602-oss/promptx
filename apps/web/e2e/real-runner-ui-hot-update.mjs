import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { execSync, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import {
  createRunnerSplitHarness,
  getFreePort,
  getRun,
  killProcessTree,
  requestJson,
  sleep,
  waitFor,
} from '../../../scripts/lib/runnerSplitHarness.mjs'

const HOST = '127.0.0.1'
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const DEFAULT_ENGINE_BINS = {
  codex: process.env.CODEX_BIN || 'codex',
  opencode: process.env.OPENCODE_BIN || 'opencode',
}
const REQUESTED_ENGINES = String(process.env.PROMPTX_UI_HOT_UPDATE_ENGINES || '').trim()
const START_TIMEOUT_MS = Math.max(60_000, Number(process.env.PROMPTX_UI_HOT_UPDATE_START_TIMEOUT_MS) || 240_000)
const UPDATE_TIMEOUT_MS = Math.max(15_000, Number(process.env.PROMPTX_UI_HOT_UPDATE_UPDATE_TIMEOUT_MS) || 90_000)
const STOP_TIMEOUT_MS = Math.max(10_000, Number(process.env.PROMPTX_UI_HOT_UPDATE_STOP_TIMEOUT_MS) || 60_000)
const HEADLESS = !/^(0|false|no)$/i.test(String(process.env.PROMPTX_HEADLESS || 'true').trim())

process.chdir(ROOT_DIR)

function probeCommandVersion(command) {
  try {
    return execSync(`${command} --version`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: true,
    }).trim().split(/\r?\n/g).find(Boolean) || 'unknown'
  } catch {
    return ''
  }
}

function resolveEngines() {
  if (REQUESTED_ENGINES) {
    return REQUESTED_ENGINES
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  }

  return Object.entries(DEFAULT_ENGINE_BINS)
    .filter(([, command]) => Boolean(probeCommandVersion(command)))
    .map(([engine]) => engine)
}

function getDefaultBrowserChannels() {
  if (process.platform === 'win32') {
    return ['msedge', 'chrome']
  }
  return ['chrome', 'msedge']
}

function getPreferredBrowserChannels() {
  const raw = String(process.env.PROMPTX_BROWSER_CHANNELS || '').trim()
  if (!raw) {
    return getDefaultBrowserChannels()
  }

  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

async function launchBrowser() {
  const executablePath = String(process.env.PROMPTX_BROWSER_EXECUTABLE_PATH || '').trim()
  const preferredChannel = String(process.env.PROMPTX_PLAYWRIGHT_CHANNEL || '').trim()
  const attempts = []

  if (executablePath) {
    try {
      const browser = await chromium.launch({ headless: HEADLESS, executablePath })
      return { browser, strategy: `executablePath=${executablePath}` }
    } catch (error) {
      attempts.push(`executablePath=${executablePath}: ${error.message || error}`)
    }
  }

  if (preferredChannel) {
    try {
      const browser = await chromium.launch({ headless: HEADLESS, channel: preferredChannel })
      return { browser, strategy: `channel=${preferredChannel}` }
    } catch (error) {
      attempts.push(`channel=${preferredChannel}: ${error.message || error}`)
    }
  }

  try {
    const browser = await chromium.launch({ headless: HEADLESS })
    return { browser, strategy: 'bundled-chromium' }
  } catch (error) {
    attempts.push(`bundled-chromium: ${error.message || error}`)
  }

  for (const channel of getPreferredBrowserChannels()) {
    if (channel === preferredChannel) {
      continue
    }
    try {
      const browser = await chromium.launch({ headless: HEADLESS, channel })
      return { browser, strategy: `channel=${channel}` }
    } catch (error) {
      attempts.push(`channel=${channel}: ${error.message || error}`)
    }
  }

  throw new Error([
    '无法启动 Playwright Chromium 浏览器。',
    '1. 运行 `pnpm --filter @promptx/web exec playwright install chromium`',
    '2. 或设置 `PROMPTX_PLAYWRIGHT_CHANNEL=chrome` / `msedge`',
    '3. 或设置 `PROMPTX_BROWSER_EXECUTABLE_PATH`',
    '',
    '尝试记录：',
    ...attempts.map((item) => `- ${item}`),
  ].join('\n'))
}

function waitForWebReady(baseUrl, timeoutMs = 30_000) {
  return waitFor(async () => {
    try {
      const response = await fetch(baseUrl)
      if (response.ok) {
        return true
      }
    } catch {
      return false
    }
    return false
  }, timeoutMs, `web 启动超时: ${baseUrl}`)
}

async function startWebServer(apiBaseUrl) {
  const port = await getFreePort(HOST)
  const webBaseUrl = `http://${HOST}:${port}`
  const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  const stdout = []
  const stderr = []
  const child = spawn(command, ['--filter', '@promptx/web', 'dev', '--host', HOST, '--port', String(port)], {
    cwd: process.cwd(),
    windowsHide: true,
    detached: process.platform !== 'win32',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      VITE_API_BASE_URL: apiBaseUrl,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  child.stdout.on('data', (chunk) => {
    stdout.push(chunk.toString())
    if (stdout.length > 80) {
      stdout.shift()
    }
  })
  child.stderr.on('data', (chunk) => {
    stderr.push(chunk.toString())
    if (stderr.length > 80) {
      stderr.shift()
    }
  })

  try {
    await waitForWebReady(webBaseUrl)
  } catch (error) {
    killProcessTree(child.pid)
    throw new Error([
      error.message || 'web 启动失败',
      stdout.length ? `web stdout:\n${stdout.join('')}` : '',
      stderr.length ? `web stderr:\n${stderr.join('')}` : '',
    ].filter(Boolean).join('\n\n'))
  }

  return {
    baseUrl: webBaseUrl,
    child,
    async cleanup() {
      killProcessTree(child.pid)
      await sleep(300)
    },
  }
}

function createLongTaskWorkspace(rootDir, engine, index) {
  const workspaceDir = path.join(rootDir, `${engine}-ui-hot-update-${index}`)
  fs.mkdirSync(workspaceDir, { recursive: true })

  const script = [
    "const fs = require('node:fs')",
    "const path = require('node:path')",
    "const pidFile = path.join(process.cwd(), 'long-runner.pid')",
    "const exitFile = path.join(process.cwd(), 'long-runner.exit.json')",
    "fs.writeFileSync(pidFile, String(process.pid))",
    'let count = 0',
    "console.log(`LONG_RUNNER_PID_${process.pid}`)",
    "console.log('LONG_RUNNER_START')",
    "const timer = setInterval(() => {",
    '  count += 1',
    "  console.log(`LONG_RUNNER_TICK_${count}`)",
    '}, 1000)',
    'function cleanup(reason) {',
    '  try {',
    "    fs.writeFileSync(exitFile, JSON.stringify({ pid: process.pid, reason, count, at: new Date().toISOString() }, null, 2))",
    '  } catch {}',
    '  clearInterval(timer)',
    '}',
    "process.on('SIGTERM', () => { cleanup('sigterm'); process.exit(0) })",
    "process.on('SIGINT', () => { cleanup('sigint'); process.exit(0) })",
    "setTimeout(() => { cleanup('completed'); console.log('LONG_RUNNER_DONE'); process.exit(0) }, 120000)",
  ].join('\n')

  fs.writeFileSync(path.join(workspaceDir, 'long-runner.js'), script)
  fs.writeFileSync(path.join(workspaceDir, 'README.md'), `engine=${engine}\nscenario=ui-hot-update\nindex=${index}\n`)
  return workspaceDir
}

function buildLongRunPrompt(engine = 'codex') {
  if (engine === 'opencode') {
    return [
      'You are running a PromptX browser UI concurrency hot-update integration test.',
      'You must use the bash tool immediately.',
      'Run exactly this command and nothing else: node long-runner.js',
      'Do not read, summarize, or edit any file before running the command.',
      'Do not send any assistant text before the command exits naturally.',
      'After the command exits naturally, reply with exactly: LONG_RUNNER_DONE_ACK',
    ].join('\n')
  }

  return [
    '你正在执行 PromptX 的浏览器 UI 并发热更新集成测试。',
    '不要先读文件，也不要先总结。',
    '你的第一步且唯一工具操作必须是执行：node long-runner.js',
    '启动后保持等待，不要主动停止它。',
    '不要修改任何文件。',
    '只有在命令自然结束后再回复。',
  ].join('\n')
}

async function createTaskAndSession(baseUrl, engine, cwd, index) {
  const stamp = `${Date.now()}-${index}`
  const title = `ui-hot-update-${engine}-${stamp}`

  const task = await requestJson(baseUrl, '/api/tasks', {
    method: 'POST',
    body: JSON.stringify({
      title,
      expiry: 'none',
      visibility: 'private',
    }),
  })

  const session = await requestJson(baseUrl, '/api/codex/sessions', {
    method: 'POST',
    body: JSON.stringify({
      title,
      cwd,
      engine,
    }),
  })

  await requestJson(baseUrl, `/api/tasks/${encodeURIComponent(task.slug)}`, {
    method: 'PUT',
    body: JSON.stringify({
      title: task.title,
      autoTitle: '',
      lastPromptPreview: '',
      todoItems: [],
      codexSessionId: session.id,
      expiry: 'none',
      visibility: 'private',
      blocks: [
        { type: 'text', content: buildLongRunPrompt(engine), meta: {} },
      ],
    }),
  })

  return { task, session }
}

async function fetchLatestRun(baseUrl, taskSlug) {
  const payload = await requestJson(baseUrl, `/api/tasks/${encodeURIComponent(taskSlug)}/codex-runs?limit=20&events=latest`)
  return payload.items?.[0] || null
}

async function clickTaskCard(page, title) {
  const card = page.locator('article.workbench-task-card').filter({ hasText: title }).first()
  await card.waitFor({ state: 'visible', timeout: 30_000 })
  await card.click()
}

async function clickSend(page) {
  const button = page.getByRole('button', { name: '发送' }).last()
  await button.waitFor({ state: 'visible', timeout: 30_000 })
  await button.click()
}

function isTerminalStatus(status = '') {
  return ['completed', 'stopped', 'error', 'stop_timeout'].includes(String(status || '').trim())
}

async function runScenario(engine) {
  const harness = await createRunnerSplitHarness({
    tempPrefix: `promptx-ui-hot-update-${engine}-`,
    useFakeCodexBin: false,
  })
  let webServer = null
  let browser = null

  try {
    await requestJson(harness.serverBaseUrl, '/api/system/config', {
      method: 'PUT',
      body: JSON.stringify({
        runner: {
          maxConcurrentRuns: 2,
        },
      }),
    })

    webServer = await startWebServer(harness.serverBaseUrl)
    const workspacesRoot = fs.mkdtempSync(path.join(os.tmpdir(), `promptx-ui-hot-update-${engine}-`))
    const created = []
    for (let index = 1; index <= 3; index += 1) {
      created.push(await createTaskAndSession(
        harness.serverBaseUrl,
        engine,
        createLongTaskWorkspace(workspacesRoot, engine, index),
        index,
      ))
    }

    const launched = await launchBrowser()
    browser = launched.browser
    console.log(`BROWSER ${engine} ${launched.strategy}`)
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
    page.on('console', (msg) => console.log(`BROWSER_${engine}_${msg.type().toUpperCase()} ${msg.text()}`))
    page.on('pageerror', (error) => console.log(`BROWSER_${engine}_PAGEERROR ${error.message}`))

    await page.goto(`${webServer.baseUrl}/?task=${encodeURIComponent(created[0].task.slug)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    })
    await page.waitForTimeout(2500)

    const runIds = []
    for (const item of created) {
      await clickTaskCard(page, item.task.title)
      await page.waitForTimeout(700)
      await clickSend(page)
      const run = await waitFor(
        async () => {
          const latest = await fetchLatestRun(harness.serverBaseUrl, item.task.slug)
          return latest?.id ? latest : null
        },
        30_000,
        `${engine} ${item.task.slug} 发送后未找到 run`
      )
      runIds.push(run.id)
      console.log(`SENT ${engine} ${item.task.slug} ${run.id}`)
      await page.waitForTimeout(900)
    }

    const queuedSnapshot = await waitFor(async () => {
      const runtime = await requestJson(harness.serverBaseUrl, '/api/diagnostics/runtime')
      const runs = await Promise.all(created.map((item, index) => getRun(
        harness.serverBaseUrl,
        item.task.slug,
        runIds[index],
      )))
      const statuses = runs.map((run) => String(run?.status || ''))
      if (
        Number(runtime.runner?.runner?.activeRunCount || 0) === 2
        && Number(runtime.runner?.runner?.queuedRunCount || 0) >= 1
        && statuses.filter((status) => status === 'queued').length >= 1
      ) {
        return { runtime, runs, statuses }
      }
      return null
    }, START_TIMEOUT_MS, `${engine} 未形成 2 active + 1 queued`)

    const queuedRunIndex = queuedSnapshot.statuses.findIndex((status) => status === 'queued')
    if (queuedRunIndex < 0) {
      throw new Error(`${engine} 未找到 queued run`)
    }

    await page.getByRole('button', { name: '设置' }).first().click()
    await page.locator('.settings-dialog-panel').waitFor({ state: 'visible', timeout: 30_000 })
    await page.getByRole('button', { name: '系统' }).click()

    const maxConcurrentInput = page.locator('section').filter({ hasText: '真实 agent 最大并发数' }).locator('input[type="number"]').first()
    await maxConcurrentInput.waitFor({ state: 'visible', timeout: 30_000 })
    const beforeValue = await maxConcurrentInput.inputValue()
    if (beforeValue !== '2') {
      throw new Error(`${engine} UI 中当前并发值不是 2，而是 ${beforeValue}`)
    }

    const hotUpdateStartedAt = Date.now()
    await maxConcurrentInput.fill('3')
    await page.getByRole('button', { name: '保存系统配置' }).click()
    await page.getByText('系统配置已保存，runner 并发上限已更新。').waitFor({ state: 'visible', timeout: 30_000 })

    const hotUpdateSnapshot = await waitFor(async () => {
      const runtime = await requestJson(harness.serverBaseUrl, '/api/diagnostics/runtime')
      const runs = await Promise.all(created.map((item, index) => getRun(
        harness.serverBaseUrl,
        item.task.slug,
        runIds[index],
      )))
      const targetRun = runs[queuedRunIndex]
      if (
        ['starting', 'running'].includes(String(targetRun?.status || ''))
        && Number(runtime.runner?.runner?.activeRunCount || 0) >= 3
        && Number(runtime.runner?.runner?.queuedRunCount || 0) === 0
      ) {
        return { runtime, runs }
      }
      return null
    }, UPDATE_TIMEOUT_MS, `${engine} 通过 UI 调大并发后 queued run 没有启动`)

    const afterValue = await maxConcurrentInput.inputValue()
    if (afterValue !== '3') {
      throw new Error(`${engine} UI 保存后并发值不是 3，而是 ${afterValue}`)
    }

    const stopAccepted = []
    for (const runId of runIds) {
      const response = await requestJson(harness.serverBaseUrl, `/api/codex/runs/${encodeURIComponent(runId)}/stop`, {
        method: 'POST',
        body: JSON.stringify({
          reason: 'user_requested',
          forceAfterMs: 1500,
        }),
      })
      stopAccepted.push(response?.run?.id || runId)
    }

    const finalRuns = await waitFor(async () => {
      const runs = await Promise.all(created.map((item, index) => getRun(
        harness.serverBaseUrl,
        item.task.slug,
        runIds[index],
      )))
      if (runs.every((run) => isTerminalStatus(run?.status))) {
        return runs
      }
      return null
    }, STOP_TIMEOUT_MS, `${engine} 停止后未全部进入终态`)

    const finalRuntime = await requestJson(harness.serverBaseUrl, '/api/diagnostics/runtime')
    const hotUpdateDelayMs = Date.now() - hotUpdateStartedAt

    return {
      engine,
      beforeValue,
      afterValue,
      hotUpdateDelayMs,
      queuedRunId: runIds[queuedRunIndex],
      queuedBeforeUpdate: queuedSnapshot.statuses,
      statusesAfterUpdate: hotUpdateSnapshot.runs.map((run) => run?.status || ''),
      runtimeBeforeUpdate: {
        active: queuedSnapshot.runtime.runner?.runner?.activeRunCount,
        tracked: queuedSnapshot.runtime.runner?.runner?.trackedRunCount,
        queued: queuedSnapshot.runtime.runner?.runner?.queuedRunCount,
      },
      runtimeAfterUpdate: {
        active: hotUpdateSnapshot.runtime.runner?.runner?.activeRunCount,
        tracked: hotUpdateSnapshot.runtime.runner?.runner?.trackedRunCount,
        queued: hotUpdateSnapshot.runtime.runner?.runner?.queuedRunCount,
      },
      finalStatuses: finalRuns.map((run) => run?.status || ''),
      finalRuntime: {
        active: finalRuntime.runner?.runner?.activeRunCount,
        tracked: finalRuntime.runner?.runner?.trackedRunCount,
        queued: finalRuntime.runner?.runner?.queuedRunCount,
      },
      stopAccepted: stopAccepted.length,
    }
  } finally {
    await browser?.close().catch(() => {})
    await webServer?.cleanup().catch(() => {})
    await harness.cleanup().catch(() => {})
  }
}

const engines = resolveEngines()
if (!engines.length) {
  throw new Error('没有发现可用的真实 agent，可通过 PROMPTX_UI_HOT_UPDATE_ENGINES 指定。')
}

const results = []
for (const engine of engines) {
  console.log(`START ${engine}`)
  const result = await runScenario(engine)
  results.push(result)
  console.log(`PASS ${engine} ${JSON.stringify(result)}`)
}

console.log(`DONE ${JSON.stringify(results)}`)
