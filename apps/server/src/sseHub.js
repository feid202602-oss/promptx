export function createSseHub(options = {}) {
  const clients = new Set()
  const pingIntervalMs = Math.max(1000, Number(options.pingIntervalMs) || 15000)
  let nextEventId = 0

  function createSseMessage(payload) {
    return `id: ${++nextEventId}\ndata: ${JSON.stringify(payload)}\n\n`
  }

  function write(target, payload) {
    if (!target || target.destroyed || target.writableEnded) {
      return false
    }

    try {
      target.write(createSseMessage(payload))
      return true
    } catch {
      return false
    }
  }

  function broadcast(type, payload = {}) {
    const message = {
      type: String(type || '').trim(),
      sentAt: new Date().toISOString(),
      ...payload,
    }

    for (const client of [...clients]) {
      if (!write(client, message)) {
        clients.delete(client)
      }
    }
  }

  function addClient(target) {
    if (!target) {
      return () => {}
    }

    clients.add(target)
    return () => {
      clients.delete(target)
    }
  }

  const pingTimer = setInterval(() => {
    for (const client of [...clients]) {
      if (!client || client.destroyed || client.writableEnded) {
        clients.delete(client)
        continue
      }

      try {
        client.write(': ping\n\n')
      } catch {
        clients.delete(client)
      }
    }
  }, pingIntervalMs)
  pingTimer.unref?.()

  return {
    addClient,
    broadcast,
    write,
  }
}
