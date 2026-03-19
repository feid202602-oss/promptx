import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { WebSocketServer } from 'ws'

import { serverRootDir } from './appPaths.js'
import {
  chunkBuffer,
  constantTimeEqual,
  createRelayRequestId,
  decodeChunk,
  encodeChunk,
  parseCookieHeader,
  sanitizeProxyHeaders,
} from './relayProtocol.js'

const DEFAULT_RELAY_PORT = 3030
const DEFAULT_RELAY_HOST = '0.0.0.0'
const DEFAULT_COOKIE_NAME = 'promptx_relay_access'
const DEVICE_AUTH_TIMEOUT_MS = 5_000

function readRelayServerConfig() {
  return {
    host: String(process.env.PROMPTX_RELAY_HOST || process.env.HOST || DEFAULT_RELAY_HOST).trim() || DEFAULT_RELAY_HOST,
    port: Math.max(1, Number(process.env.PROMPTX_RELAY_PORT || process.env.PORT) || DEFAULT_RELAY_PORT),
    publicUrl: String(process.env.PROMPTX_RELAY_PUBLIC_URL || '').trim(),
    expectedDeviceId: String(process.env.PROMPTX_RELAY_DEVICE_ID || '').trim(),
    deviceToken: String(process.env.PROMPTX_RELAY_DEVICE_TOKEN || '').trim(),
    accessToken: String(process.env.PROMPTX_RELAY_ACCESS_TOKEN || '').trim(),
    accessCookieName: String(process.env.PROMPTX_RELAY_ACCESS_COOKIE || DEFAULT_COOKIE_NAME).trim() || DEFAULT_COOKIE_NAME,
  }
}

function getWebDistRoot() {
  return path.resolve(serverRootDir, '..', 'web', 'dist')
}

function buildLoginPage({
  errorMessage = '',
  redirectPath = '/',
} = {}) {
  const escapedError = String(errorMessage || '').replace(/[<>&"]/g, '')
  const escapedRedirect = String(redirectPath || '/').replace(/"/g, '&quot;')

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>PromptX Relay 登录</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f5f5f4; color: #1c1917; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    .card { width: min(92vw, 420px); border: 1px solid #d6d3d1; background: #fffbeb; box-shadow: 8px 8px 0 rgba(28,25,23,.06); padding: 24px; }
    h1 { margin: 0 0 10px; font-size: 22px; }
    p { margin: 0 0 16px; line-height: 1.6; color: #57534e; }
    label { display: block; margin-bottom: 8px; font-size: 13px; color: #44403c; }
    input { box-sizing: border-box; width: 100%; border: 1px solid #a8a29e; padding: 10px 12px; background: white; }
    button { margin-top: 14px; width: 100%; border: 1px solid #166534; background: #16a34a; color: white; padding: 10px 12px; cursor: pointer; }
    .error { margin-bottom: 12px; color: #b91c1c; font-size: 13px; }
  </style>
</head>
<body>
  <form class="card" action="/relay/login" method="get">
    <h1>PromptX Relay</h1>
    <p>请输入远程访问令牌，进入你自己的 PromptX 工作台。</p>
    ${escapedError ? `<div class="error">${escapedError}</div>` : ''}
    <input type="hidden" name="redirect" value="${escapedRedirect}" />
    <label for="token">访问令牌</label>
    <input id="token" name="token" type="password" autocomplete="current-password" required />
    <button type="submit">进入 PromptX</button>
  </form>
</body>
</html>`
}

function getRequestPath(request) {
  return String(request.raw.url || '/').split('?')[0] || '/'
}

function isHtmlRequest(request) {
  const accept = String(request.headers.accept || '').toLowerCase()
  return accept.includes('text/html')
}

function normalizeRedirectPath(value = '/') {
  const raw = String(value || '/').trim()
  if (!raw.startsWith('/')) {
    return '/'
  }
  if (raw.startsWith('//') || raw.startsWith('/relay/login')) {
    return '/'
  }
  return raw
}

function createCookieValue(name, value, secure = false) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure ? '; Secure' : ''}`
}

async function startRelayServer() {
  const config = readRelayServerConfig()
  const webDistDir = getWebDistRoot()
  const webIndexPath = path.join(webDistDir, 'index.html')
  if (!fs.existsSync(webIndexPath)) {
    throw new Error('没有找到前端构建产物，请先运行 `pnpm build`。')
  }
  if (!config.deviceToken) {
    throw new Error('缺少 PROMPTX_RELAY_DEVICE_TOKEN，无法启动 relay。')
  }

  const app = Fastify({ logger: true, bodyLimit: 35 * 1024 * 1024 })
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (request, body, done) => {
    done(null, body)
  })

  await app.register(fastifyStatic, {
    root: webDistDir,
    prefix: '/',
    wildcard: false,
    index: false,
  })

  const wsServer = new WebSocketServer({ noServer: true })
  const deviceState = {
    socket: null,
    deviceId: '',
    connectedAt: '',
    version: '',
  }
  const requestMap = new Map()

  function isAuthorizedRequest(request) {
    if (!config.accessToken) {
      return true
    }

    const bearerToken = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
    if (bearerToken && constantTimeEqual(bearerToken, config.accessToken)) {
      return true
    }

    const cookies = parseCookieHeader(request.headers.cookie)
    return constantTimeEqual(cookies[config.accessCookieName] || '', config.accessToken)
  }

  function ensureAuthorized(request, reply) {
    if (isAuthorizedRequest(request)) {
      return true
    }

    if (isHtmlRequest(request)) {
      return reply
        .code(401)
        .type('text/html; charset=utf-8')
        .send(buildLoginPage({
          redirectPath: getRequestPath(request),
        }))
    }

    return reply.code(401).send({ message: '未通过 relay 访问验证。' })
  }

  function getActiveDeviceSocket() {
    if (!deviceState.socket || deviceState.socket.readyState !== 1) {
      return null
    }
    return deviceState.socket
  }

  function clearPendingRequest(requestId, reason = 'request_closed') {
    const record = requestMap.get(requestId)
    if (!record) {
      return
    }
    requestMap.delete(requestId)
    try {
      getActiveDeviceSocket()?.send(JSON.stringify({
        type: 'request.cancel',
        requestId,
        reason,
      }))
    } catch {
      // Ignore send failures after disconnect.
    }
  }

  function writeRelayResponseStart(record, payload) {
    if (record.started) {
      return
    }
    record.started = true
    record.reply.raw.writeHead(payload.status || 200, sanitizeProxyHeaders(payload.headers, ['content-encoding']))
  }

  function writeRelayResponseBody(record, payload) {
    if (!record.started) {
      writeRelayResponseStart(record, { status: 200, headers: {} })
    }
    const chunk = decodeChunk(payload.chunk)
    if (chunk.length) {
      record.reply.raw.write(chunk)
    }
  }

  function finalizeRelayResponse(record) {
    if (!record.reply.raw.writableEnded) {
      record.reply.raw.end()
    }
  }

  function failRelayRequest(record, statusCode = 502, message = 'Relay 请求失败。') {
    if (!record.reply.raw.writableEnded) {
      if (!record.started) {
        record.reply.raw.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' })
      }
      record.reply.raw.end(JSON.stringify({ message }))
    }
  }

  function sendRequestToDevice(socket, requestId, request) {
    const requestPath = String(request.raw.url || '/')
    const bodyBuffer = Buffer.isBuffer(request.body) ? request.body : Buffer.from(request.body || '')

    socket.send(JSON.stringify({
      type: 'request.start',
      requestId,
      method: String(request.method || 'GET').toUpperCase(),
      path: requestPath,
      headers: sanitizeProxyHeaders(request.headers, ['cookie']),
    }))

    chunkBuffer(bodyBuffer).forEach((chunk) => {
      socket.send(JSON.stringify({
        type: 'request.body',
        requestId,
        chunk: encodeChunk(chunk),
      }))
    })

    socket.send(JSON.stringify({
      type: 'request.end',
      requestId,
    }))
  }

  function handleProxyRequest(request, reply) {
    if (ensureAuthorized(request, reply) !== true) {
      return
    }

    const deviceSocket = getActiveDeviceSocket()
    if (!deviceSocket) {
      return reply.code(503).send({ message: 'PromptX 本地设备暂未连接到 relay。' })
    }

    const requestId = createRelayRequestId()
    reply.hijack()
    requestMap.set(requestId, {
      requestId,
      request,
      reply,
      started: false,
    })

    reply.raw.on('close', () => {
      clearPendingRequest(requestId, 'browser_closed')
    })

    try {
      sendRequestToDevice(deviceSocket, requestId, request)
    } catch (error) {
      const record = requestMap.get(requestId)
      requestMap.delete(requestId)
      if (record) {
        failRelayRequest(record, 502, error?.message || '发送 relay 请求失败。')
      }
    }
  }

  app.get('/health', async () => ({
    ok: true,
    deviceOnline: Boolean(getActiveDeviceSocket()),
  }))

  app.get('/relay/device-status', async (request, reply) => {
    if (ensureAuthorized(request, reply) !== true) {
      return
    }

    return {
      ok: true,
      deviceOnline: Boolean(getActiveDeviceSocket()),
      deviceId: deviceState.deviceId,
      connectedAt: deviceState.connectedAt,
      version: deviceState.version,
    }
  })

  app.get('/relay/login', async (request, reply) => {
    if (!config.accessToken) {
      return reply.redirect('/')
    }

    const token = String(request.query?.token || '').trim()
    const redirectPath = normalizeRedirectPath(request.query?.redirect)
    if (token && constantTimeEqual(token, config.accessToken)) {
      const shouldUseSecureCookie = config.publicUrl.startsWith('https://')
      reply.header('Set-Cookie', createCookieValue(config.accessCookieName, config.accessToken, shouldUseSecureCookie))
      return reply.redirect(redirectPath)
    }

    return reply
      .code(token ? 401 : 200)
      .type('text/html; charset=utf-8')
      .send(buildLoginPage({
        errorMessage: token ? '访问令牌不正确。' : '',
        redirectPath,
      }))
  })

  app.route({
    method: ['DELETE', 'GET', 'HEAD', 'PATCH', 'POST', 'PUT'],
    url: '/api/*',
    handler: handleProxyRequest,
  })

  app.route({
    method: ['DELETE', 'GET', 'HEAD', 'PATCH', 'POST', 'PUT'],
    url: '/uploads/*',
    handler: handleProxyRequest,
  })

  app.get('/', async (request, reply) => {
    if (ensureAuthorized(request, reply) !== true) {
      return
    }
    return reply.type('text/html; charset=utf-8').send(fs.createReadStream(webIndexPath))
  })

  app.get('/*', async (request, reply) => {
    if (getRequestPath(request).startsWith('/relay/')) {
      return reply.code(404).send({ message: '资源不存在。' })
    }

    if (ensureAuthorized(request, reply) !== true) {
      return
    }
    return reply.type('text/html; charset=utf-8').send(fs.createReadStream(webIndexPath))
  })

  wsServer.on('connection', (socket) => {
    let authenticated = false
    const authTimer = setTimeout(() => {
      if (!authenticated) {
        app.log.warn('[relay] 设备认证超时，连接将被关闭')
        socket.close(1008, 'missing_auth')
      }
    }, DEVICE_AUTH_TIMEOUT_MS)

    socket.on('message', (payload, isBinary) => {
      if (isBinary) {
        return
      }

      let message
      try {
        message = JSON.parse(payload.toString('utf8'))
      } catch {
        return
      }

      if (!authenticated) {
        if (message.type !== 'hello') {
          app.log.warn('[relay] 收到未认证设备的非法首包，连接将被关闭')
          socket.close(1008, 'missing_hello')
          return
        }

        const providedToken = String(message.deviceToken || '').trim()
        const providedDeviceId = String(message.deviceId || '').trim()
        if (!constantTimeEqual(providedToken, config.deviceToken)) {
          app.log.warn({
            deviceId: providedDeviceId || 'unknown-device',
          }, '[relay] 设备令牌不匹配，连接将被拒绝')
          socket.close(1008, 'invalid_token')
          return
        }
        if (config.expectedDeviceId && providedDeviceId !== config.expectedDeviceId) {
          app.log.warn({
            expectedDeviceId: config.expectedDeviceId,
            providedDeviceId: providedDeviceId || 'unknown-device',
          }, '[relay] 设备 ID 不匹配，连接将被拒绝')
          socket.close(1008, 'invalid_device')
          return
        }

        authenticated = true
        clearTimeout(authTimer)

        if (deviceState.socket && deviceState.socket !== socket) {
          app.log.warn({
            deviceId: providedDeviceId || 'unknown-device',
          }, '[relay] 已有旧设备连接，将被新连接替换')
          deviceState.socket.close(1012, 'replaced_by_new_connection')
        }

        deviceState.socket = socket
        deviceState.deviceId = providedDeviceId
        deviceState.connectedAt = new Date().toISOString()
        deviceState.version = String(message.version || '').trim()
        socket.send(JSON.stringify({
          type: 'hello.ack',
          ok: true,
          deviceId: deviceState.deviceId,
        }))
        app.log.info(`[relay] 设备已连接：${deviceState.deviceId || 'unknown-device'}`)
        return
      }

      const record = requestMap.get(String(message.requestId || ''))
      if (!record) {
        return
      }

      if (message.type === 'response.start') {
        writeRelayResponseStart(record, message)
        return
      }

      if (message.type === 'response.body') {
        writeRelayResponseBody(record, message)
        return
      }

      if (message.type === 'response.end') {
        requestMap.delete(record.requestId)
        finalizeRelayResponse(record)
        return
      }

      if (message.type === 'response.error') {
        requestMap.delete(record.requestId)
        failRelayRequest(record, 502, message.message || '本地 PromptX 响应失败。')
      }
    })

    socket.on('close', (code, reason) => {
      const closeReason = reason?.toString('utf8') || ''
      clearTimeout(authTimer)
      if (deviceState.socket === socket) {
        const disconnectedRequestIds = [...requestMap.keys()]
        disconnectedRequestIds.forEach((requestId) => {
          const record = requestMap.get(requestId)
          requestMap.delete(requestId)
          if (record) {
            failRelayRequest(record, 503, 'PromptX 本地设备已断开。')
          }
        })
        deviceState.socket = null
        deviceState.connectedAt = ''
        app.log.warn({
          deviceId: deviceState.deviceId || 'unknown-device',
          code: Number(code || 0),
          reason: closeReason || 'none',
        }, '[relay] 设备已断开')
      } else if (!authenticated) {
        app.log.warn({
          code: Number(code || 0),
          reason: closeReason || 'none',
        }, '[relay] 未认证设备连接已关闭')
      }
    })
  })

  app.server.on('upgrade', (request, socket, head) => {
    const pathname = String(request.url || '').split('?')[0]
    if (pathname !== '/relay/connect') {
      socket.destroy()
      return
    }

    wsServer.handleUpgrade(request, socket, head, (ws) => {
      wsServer.emit('connection', ws, request)
    })
  })

  await app.listen({ host: config.host, port: config.port })

  const accessUrl = config.publicUrl || `http://${config.host === '0.0.0.0' ? '127.0.0.1' : config.host}:${config.port}`
  app.log.info(`promptx relay running at ${accessUrl}`)
  app.log.info('等待本地 PromptX 主动接入...')
}

export {
  readRelayServerConfig,
  startRelayServer,
}
