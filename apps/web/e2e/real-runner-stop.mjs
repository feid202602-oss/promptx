import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const webBaseUrl = process.env.PROMPTX_WEB_BASE_URL || 'http://127.0.0.1:5174'
const apiBaseUrl = process.env.PROMPTX_API_BASE_URL || 'http://127.0.0.1:3001'
const engine = String(process.env.PROMPTX_ENGINE || 'codex').trim() || 'codex'
const promptText = process.env.PROMPTX_PROMPT_TEXT || '请详细整理 2000 年到 2024 年国际局势中的伊朗相关关键事件，按年份分段，尽量完整，并给出结构化总结。'
const timeoutMs = Number(process.env.PROMPTX_TIMEOUT_MS || 8 * 60 * 1000)
const headless = !/^(0|false|no)$/i.test(String(process.env.PROMPTX_HEADLESS || 'true').trim())

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
      const browser = await chromium.launch({ headless, executablePath })
      return { browser, strategy: `executablePath=${executablePath}` }
    } catch (error) {
      attempts.push(`executablePath=${executablePath}: ${error.message || error}`)
    }
  }

  if (preferredChannel) {
    try {
      const browser = await chromium.launch({ headless, channel: preferredChannel })
      return { browser, strategy: `channel=${preferredChannel}` }
    } catch (error) {
      attempts.push(`channel=${preferredChannel}: ${error.message || error}`)
    }
  }

  try {
    const browser = await chromium.launch({ headless })
    return { browser, strategy: 'bundled-chromium' }
  } catch (error) {
    attempts.push(`bundled-chromium: ${error.message || error}`)
  }

  for (const channel of getPreferredBrowserChannels()) {
    if (channel === preferredChannel) {
      continue
    }
    try {
      const browser = await chromium.launch({ headless, channel })
      return { browser, strategy: `channel=${channel}` }
    } catch (error) {
      attempts.push(`channel=${channel}: ${error.message || error}`)
    }
  }

  throw new Error(
    [
      '无法启动 Playwright Chromium 浏览器。',
      '1. 运行 `pnpm --filter @promptx/web exec playwright install chromium`',
      '2. 或设置 `PROMPTX_PLAYWRIGHT_CHANNEL=chrome` / `msedge`',
      '3. 或设置 `PROMPTX_BROWSER_EXECUTABLE_PATH`',
      '',
      '尝试记录：',
      ...attempts.map((item) => `- ${item}`),
    ].join('\n')
  )
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const text = await response.text()
  const payload = text ? JSON.parse(text) : null
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text}`)
  }
  return payload
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function createWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `promptx-real-stop-${Date.now()}-`))
  fs.writeFileSync(path.join(dir, 'README.md'), '# real runner stop repro\n')
  return dir
}

async function createTaskAndSession() {
  const stamp = `${Date.now()}`
  const title = `真实停止回归-${stamp}`

  const task = await requestJson(`${apiBaseUrl}/api/tasks`, {
    method: 'POST',
    body: JSON.stringify({
      title,
      expiry: 'none',
      visibility: 'private',
    }),
  })

  const session = await requestJson(`${apiBaseUrl}/api/codex/sessions`, {
    method: 'POST',
    body: JSON.stringify({
      title,
      cwd: createWorkspace(),
      engine,
    }),
  })

  await requestJson(`${apiBaseUrl}/api/tasks/${encodeURIComponent(task.slug)}`, {
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
        { type: 'text', content: promptText, meta: {} },
      ],
    }),
  })

  return { task, session }
}

async function fetchLatestRun(taskSlug) {
  const payload = await requestJson(`${apiBaseUrl}/api/tasks/${encodeURIComponent(taskSlug)}/codex-runs?limit=20&events=latest`)
  return payload.items?.[0] || null
}

async function waitForRun(taskSlug, predicate, deadlineMs) {
  while (Date.now() < deadlineMs) {
    const run = await fetchLatestRun(taskSlug)
    if (predicate(run)) {
      return run
    }
    await sleep(1500)
  }

  return await fetchLatestRun(taskSlug)
}

async function main() {
  const created = await createTaskAndSession()
  const deadlineMs = Date.now() + timeoutMs
  const initialDiagnostics = await requestJson(`${apiBaseUrl}/api/diagnostics/runtime`)
  console.log('INITIAL ' + JSON.stringify({
    runnerStartedAt: initialDiagnostics.runner?.runner?.startedAt,
    recoveryRecovered: initialDiagnostics.recovery?.metrics?.totalRecovered,
    active: initialDiagnostics.runner?.runner?.activeRunCount,
    tracked: initialDiagnostics.runner?.runner?.trackedRunCount,
    queued: initialDiagnostics.runner?.runner?.queuedRunCount,
  }))

  const { browser, strategy } = await launchBrowser()
  console.log(`BROWSER ${strategy}`)
  const page = await browser.newPage()
  page.on('console', (msg) => console.log(`BROWSER_${msg.type().toUpperCase()} ${msg.text()}`))
  page.on('pageerror', (error) => console.log(`BROWSER_PAGEERROR ${error.message}`))

  try {
    await page.goto(`${webBaseUrl}/?task=${encodeURIComponent(created.task.slug)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    })
    await page.waitForTimeout(2500)

    const sendButton = page.getByRole('button', { name: '发送' }).last()
    await sendButton.waitFor({ state: 'visible', timeout: 30000 })
    await sendButton.click()
    console.log(`SENT ${created.task.slug}`)

    const activeRun = await waitForRun(
      created.task.slug,
      (run) => ['queued', 'starting', 'running'].includes(String(run?.status || '')),
      deadlineMs
    )
    if (!activeRun?.id) {
      throw new Error('发送后没有观察到活动 run')
    }
    console.log('ACTIVE ' + JSON.stringify({
      runId: activeRun.id,
      status: activeRun.status,
    }))

    const runningRun = await waitForRun(
      created.task.slug,
      (run) => String(run?.status || '') === 'running',
      Math.min(deadlineMs, Date.now() + 90_000)
    )
    console.log('RUNNING ' + JSON.stringify({
      runId: runningRun?.id || activeRun.id,
      status: runningRun?.status || activeRun.status,
    }))

    const stopButton = page.getByRole('button', { name: '停止' }).last()
    await stopButton.waitFor({ state: 'visible', timeout: 30000 })
    await stopButton.click()
    console.log(`STOP_CLICKED ${created.task.slug}`)

    const terminalRun = await waitForRun(
      created.task.slug,
      (run) => ['stopped', 'stop_timeout', 'error', 'completed'].includes(String(run?.status || '')),
      deadlineMs
    )
    if (!terminalRun?.id) {
      throw new Error('停止后没有观察到终态 run')
    }

    const tasksPayload = await requestJson(`${apiBaseUrl}/api/tasks`)
    const runtimePayload = await requestJson(`${apiBaseUrl}/api/diagnostics/runtime`)
    const taskRecord = tasksPayload.items.find((task) => task.slug === created.task.slug)
    const snapshot = {
      taskSlug: created.task.slug,
      runId: terminalRun.id,
      status: terminalRun.status,
      errorMessage: terminalRun.errorMessage || '',
      responseLength: String(terminalRun.responseMessage || '').length,
      taskRunning: Boolean(taskRecord?.running),
      runnerActive: runtimePayload.runner?.runner?.activeRunCount,
      runnerTracked: runtimePayload.runner?.runner?.trackedRunCount,
      runnerQueued: runtimePayload.runner?.runner?.queuedRunCount,
      recoveryRecovered: runtimePayload.recovery?.metrics?.totalRecovered,
    }

    console.log('FINAL ' + JSON.stringify(snapshot))

    if (!['stopped', 'stop_timeout'].includes(String(terminalRun.status || ''))) {
      throw new Error(`停止回归未落到预期终态: ${JSON.stringify(snapshot)}`)
    }
    if (String(terminalRun.errorMessage || '').includes('Runner 已失联')) {
      throw new Error(`停止回归出现 Runner 已失联: ${JSON.stringify(snapshot)}`)
    }
    if (snapshot.taskRunning) {
      throw new Error(`停止后任务仍显示 running: ${JSON.stringify(snapshot)}`)
    }
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error('FAIL ' + (error?.stack || error?.message || String(error)))
  process.exitCode = 1
})
