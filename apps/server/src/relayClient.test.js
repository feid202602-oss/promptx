import assert from 'node:assert/strict'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { WebSocketServer } from 'ws'

import { createRelayClient } from './relayClient.js'

async function withRelayServer(handler, run) {
  const server = new WebSocketServer({ port: 0 })

  server.on('connection', (socket) => {
    socket.on('message', (payload, isBinary) => {
      if (isBinary) {
        return
      }

      let message = null
      try {
        message = JSON.parse(payload.toString('utf8'))
      } catch {
        return
      }

      handler(socket, message)
    })
  })

  await new Promise((resolve) => server.once('listening', resolve))
  const { port } = server.address()

  try {
    await run(`ws://127.0.0.1:${port}`)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

async function waitFor(check, timeoutMs = 1_500) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const value = check()
    if (value) {
      return value
    }
    await delay(20)
  }
  throw new Error('waitFor timeout')
}

test('relay client becomes connected only after hello ack', async () => {
  await withRelayServer((socket, message) => {
    if (message?.type === 'hello') {
      socket.send(JSON.stringify({
        type: 'hello.ack',
        ok: true,
        deviceId: message.deviceId,
      }))
    }
  }, async (relayWsUrl) => {
    const logs = []
    const client = createRelayClient({
      relayUrl: relayWsUrl.replace(/^ws/, 'http'),
      deviceId: 'my-device',
      deviceToken: 'secret',
      logger: {
        info(...args) {
          logs.push(['info', args])
        },
        warn(...args) {
          logs.push(['warn', args])
        },
      },
    })

    client.start()

    await waitFor(() => client.getStatus().connected === true)

    const status = client.getStatus()
    assert.equal(status.connected, true)
    assert.equal(status.lastError, '')
    assert.equal(Boolean(status.lastConnectedAt), true)
    assert.equal(Boolean(status.lastHeartbeatAt), true)
    assert.equal(status.lastCloseReason, '')
    assert.equal(status.pendingRequestCount, 0)
    assert.equal(status.socketReadyState, 1)
    assert.equal(status.recentEvents.some((event) => event.type === 'auth_ok'), true)
    assert.equal(logs.some(([level, args]) => level === 'info' && String(args.at(-1)).includes('连接已就绪')), true)

    client.stop()
  })
})

test('relay client records heartbeat timestamp after server ping', async () => {
  await withRelayServer((socket, message) => {
    if (message?.type === 'hello') {
      socket.send(JSON.stringify({
        type: 'hello.ack',
        ok: true,
        deviceId: message.deviceId,
      }))

      setTimeout(() => {
        if (socket.readyState === 1) {
          socket.ping()
        }
      }, 40)
    }
  }, async (relayWsUrl) => {
    const client = createRelayClient({
      relayUrl: relayWsUrl.replace(/^ws/, 'http'),
      deviceId: 'my-device',
      deviceToken: 'secret',
      logger: {
        info() {},
        warn() {},
        error() {},
      },
    })

    client.start()

    await waitFor(() => client.getStatus().connected === true)
    const initialHeartbeatAt = client.getStatus().lastHeartbeatAt
    await waitFor(() => client.getStatus().lastHeartbeatAt && client.getStatus().lastHeartbeatAt !== initialHeartbeatAt)

    assert.equal(Boolean(client.getStatus().lastHeartbeatAt), true)

    client.stop()
  })
})

test('relay client records reject reason when relay closes before auth ack', async () => {
  await withRelayServer((socket, message) => {
    if (message?.type === 'hello') {
      socket.close(1008, 'invalid_device')
    }
  }, async (relayWsUrl) => {
    const client = createRelayClient({
      relayUrl: relayWsUrl.replace(/^ws/, 'http'),
      deviceId: 'my-device',
      deviceToken: 'secret',
      logger: {
        info() {},
        warn() {},
        error() {},
      },
    })

    client.start()

    await waitFor(() => client.getStatus().lastCloseReason !== '')

    const status = client.getStatus()
    assert.equal(status.connected, false)
    assert.equal(status.lastCloseCode, 1008)
    assert.equal(status.lastCloseReason, '设备 ID 不匹配')
    assert.match(status.lastError, /设备 ID 不匹配/)
    assert.equal(status.recentEvents.some((event) => event.type === 'close'), true)

    client.stop()
  })
})
