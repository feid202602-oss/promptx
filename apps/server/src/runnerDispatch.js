import { getCodexRunById, updateCodexRunFromRunnerStatus } from './codexRuns.js'

function pickFirstNonEmptyString(...values) {
  for (const value of values) {
    const normalized = String(value || '').trim()
    if (normalized) {
      return normalized
    }
  }

  return ''
}

function copyKnownRunField(target, source, key) {
  if (!source || typeof source !== 'object') {
    return
  }

  if (!Object.prototype.hasOwnProperty.call(source, key)) {
    return
  }

  target[key] = source[key]
}

export function extractRunnerDispatchPatch(payload = {}, fallbackStatus = 'queued') {
  const runnerRun = payload?.run && typeof payload.run === 'object' ? payload.run : {}
  const patch = {
    status: pickFirstNonEmptyString(runnerRun.status, payload.status, fallbackStatus) || fallbackStatus,
  }

  copyKnownRunField(patch, payload, 'responseMessage')
  copyKnownRunField(patch, runnerRun, 'responseMessage')
  copyKnownRunField(patch, payload, 'errorMessage')
  copyKnownRunField(patch, runnerRun, 'errorMessage')
  copyKnownRunField(patch, payload, 'startedAt')
  copyKnownRunField(patch, runnerRun, 'startedAt')
  copyKnownRunField(patch, payload, 'finishedAt')
  copyKnownRunField(patch, runnerRun, 'finishedAt')

  return patch
}

export function shouldKeepRunNonTerminalOnRunnerDispatchError(error, options = {}) {
  const statusCode = Number(error?.statusCode) || 0
  if (statusCode === 503 || statusCode === 504) {
    return true
  }

  if (options.allowNotFound && statusCode === 404) {
    return true
  }

  return false
}

export async function reconcileRunAfterRunnerDispatchError(options = {}) {
  const runId = String(options.runId || '').trim()
  if (!runId) {
    return {
      run: null,
      pending: false,
      syncedFromRunner: false,
    }
  }

  const logger = options.logger || console
  const fallbackStatus = String(options.fallbackStatus || '').trim()
  const runnerClient = options.runnerClient
  const preserveRun = shouldKeepRunNonTerminalOnRunnerDispatchError(options.error, {
    allowNotFound: Boolean(options.allowNotFound),
  })

  if (runnerClient?.getRun) {
    try {
      const payload = await runnerClient.getRun(runId)
      const run = updateCodexRunFromRunnerStatus(runId, {
        ...extractRunnerDispatchPatch(payload, fallbackStatus || 'queued'),
        updatedAt: new Date().toISOString(),
      })

      return {
        run,
        pending: false,
        syncedFromRunner: true,
      }
    } catch (lookupError) {
      logger.warn?.(lookupError, 'runner dispatch reconciliation lookup failed')
    }
  }

  if (!preserveRun) {
    return {
      run: null,
      pending: false,
      syncedFromRunner: false,
    }
  }

  return {
    run: fallbackStatus
      ? updateCodexRunFromRunnerStatus(runId, {
          status: fallbackStatus,
          updatedAt: new Date().toISOString(),
        })
      : getCodexRunById(runId),
    pending: true,
    syncedFromRunner: false,
  }
}
