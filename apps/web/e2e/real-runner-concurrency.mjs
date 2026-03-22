import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const webBaseUrl = process.env.PROMPTX_WEB_BASE_URL || 'http://127.0.0.1:5174'
const apiBaseUrl = process.env.PROMPTX_API_BASE_URL || 'http://127.0.0.1:3001'
const promptText = process.env.PROMPTX_PROMPT_TEXT || '伊朗局势目前什么情况？'
const taskCount = Number(process.env.PROMPTX_TASK_COUNT || 3)
const timeoutMs = Number(process.env.PROMPTX_TIMEOUT_MS || 12 * 60 * 1000)
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
      const browser = await chromium.launch({
        headless,
        executablePath,
      })
      return { browser, strategy: `executablePath=${executablePath}` }
    } catch (error) {
      attempts.push(`executablePath=${executablePath}: ${error.message || error}`)
    }
  }

  if (preferredChannel) {
    try {
      const browser = await chromium.launch({
        headless,
        channel: preferredChannel,
      })
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
      const browser = await chromium.launch({
        headless,
        channel,
      })
      return { browser, strategy: `channel=${channel}` }
    } catch (error) {
      attempts.push(`channel=${channel}: ${error.message || error}`)
    }
  }

  throw new Error(
    [
      '无法启动 Playwright Chromium 浏览器。',
      '可选修复：',
      '1. 运行 `pnpm --filter @promptx/web exec playwright install chromium` 安装 Playwright 浏览器',
      '2. 或设置 `PROMPTX_PLAYWRIGHT_CHANNEL=chrome` / `msedge`',
      '3. 或设置 `PROMPTX_BROWSER_EXECUTABLE_PATH` 指向本机浏览器',
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

function createWorkspace(index) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `promptx-real-${Date.now()}-${index}-`))
  fs.writeFileSync(path.join(dir, 'README.md'), '# real browser repro\n')
  return dir
}

async function createTaskAndSession(index) {
  const stamp = `${Date.now()}-${index}`
  const title = `真实并发回归-${stamp}`

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
      cwd: createWorkspace(index),
      engine: 'codex',
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

async function clickTaskCard(page, title) {
  const card = page.locator('article.workbench-task-card').filter({ hasText: title }).first()
  await card.waitFor({ state: 'visible', timeout: 30000 })
  await card.click()
}

async function clickSend(page) {
  const button = page.getByRole('button', { name: '发送' }).last()
  await button.waitFor({ state: 'visible', timeout: 30000 })
  await button.click()
}

async function collectUiCards(page, titles) {
  return page.evaluate((taskTitles) => {
    const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim()
    const cards = Array.from(document.querySelectorAll('article.workbench-task-card'))
    const result = {}
    for (const title of taskTitles) {
      const card = cards.find((node) => normalize(node.textContent).includes(title))
      result[title] = card ? normalize(card.textContent) : ''
    }
    return result
  }, titles)
}

async function main() {
  const created = []
  const initialDiagnostics = await requestJson(`${apiBaseUrl}/api/diagnostics/runtime`)
  console.log('INITIAL ' + JSON.stringify({
    runnerStartedAt: initialDiagnostics.runner?.runner?.startedAt,
    recoveryRecovered: initialDiagnostics.recovery?.metrics?.totalRecovered,
    active: initialDiagnostics.runner?.runner?.activeRunCount,
    tracked: initialDiagnostics.runner?.runner?.trackedRunCount,
    queued: initialDiagnostics.runner?.runner?.queuedRunCount,
  }))

  for (let index = 1; index <= taskCount; index += 1) {
    created.push(await createTaskAndSession(index))
    await sleep(150)
  }

  const { browser, strategy } = await launchBrowser()
  console.log(`BROWSER ${strategy}`)
  const page = await browser.newPage()
  page.on('console', (msg) => console.log(`BROWSER_${msg.type().toUpperCase()} ${msg.text()}`))
  page.on('pageerror', (error) => console.log(`BROWSER_PAGEERROR ${error.message}`))

  try {
    await page.goto(`${webBaseUrl}/?task=${encodeURIComponent(created[0].task.slug)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    })
    await page.waitForTimeout(2500)

    for (const item of created) {
      await clickTaskCard(page, item.task.title)
      await page.waitForTimeout(800)
      await clickSend(page)
      console.log('SENT ' + item.task.slug)
      await page.waitForTimeout(1000)
    }

    const startedAt = Date.now()
    let finalSnapshot = null
    while (Date.now() - startedAt < timeoutMs) {
      const [tasksPayload, runtimePayload, runs, uiCards] = await Promise.all([
        requestJson(`${apiBaseUrl}/api/tasks`),
        requestJson(`${apiBaseUrl}/api/diagnostics/runtime`),
        Promise.all(created.map((item) => fetchLatestRun(item.task.slug))),
        collectUiCards(page, created.map((item) => item.task.title)),
      ])

      const taskRunning = Object.fromEntries(created.map((item) => {
        const match = tasksPayload.items.find((task) => task.slug === item.task.slug)
        return [item.task.slug, Boolean(match?.running)]
      }))

      const runSummary = runs.map((run, index) => ({
        slug: created[index].task.slug,
        runId: run?.id || '',
        status: run?.status || 'missing',
        errorMessage: run?.errorMessage || '',
        responseLength: String(run?.responseMessage || '').length,
      }))

      const snapshot = {
        elapsedSec: Math.round((Date.now() - startedAt) / 1000),
        runnerStartedAt: runtimePayload.runner?.runner?.startedAt,
        recoveryRecovered: runtimePayload.recovery?.metrics?.totalRecovered,
        runnerActive: runtimePayload.runner?.runner?.activeRunCount,
        runnerTracked: runtimePayload.runner?.runner?.trackedRunCount,
        runnerQueued: runtimePayload.runner?.runner?.queuedRunCount,
        taskRunning,
        runSummary,
        uiCards,
      }

      console.log('SNAPSHOT ' + JSON.stringify(snapshot))

      const allTerminal = runSummary.every((item) => !['queued', 'starting', 'running', 'stopping', 'missing'].includes(item.status))
      if (allTerminal) {
        finalSnapshot = snapshot
        break
      }

      await sleep(3000)
    }

    if (!finalSnapshot) {
      throw new Error('等待真实并发测试结束超时')
    }

    const lost = finalSnapshot.runSummary.filter((item) => String(item.errorMessage || '').includes('Runner 已失联'))
    if (lost.length > 0) {
      throw new Error(`出现 Runner 已失联: ${JSON.stringify(lost)}`)
    }

    console.log('FINAL ' + JSON.stringify(finalSnapshot))
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error('FAIL ' + (error?.stack || error?.message || String(error)))
  process.exitCode = 1
})
