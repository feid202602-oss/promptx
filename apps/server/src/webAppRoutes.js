function registerWebAppRoutes(app, options = {}) {
  const {
    enabled = false,
    webDistDir,
  } = options

  if (!enabled) {
    return
  }

  app.get('/', async (request, reply) => reply.sendFile('index.html', webDistDir))
  app.get('/*', async (request, reply) => {
    const requestPath = String(request.raw.url || '').split('?')[0]
    if (requestPath.startsWith('/api/') || requestPath.startsWith('/uploads/')) {
      return reply.code(404).send({ message: '资源不存在。' })
    }
    return reply.sendFile('index.html', webDistDir)
  })
}

export {
  registerWebAppRoutes,
}
