import assert from 'node:assert/strict'
import Fastify from 'fastify'
import test from 'node:test'

import { registerWebAppRoutes } from './webAppRoutes.js'

test('web app routes do nothing when disabled', async () => {
  const app = Fastify()
  registerWebAppRoutes(app, {
    enabled: false,
    webDistDir: 'dist',
  })
  await app.ready()

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/',
    })
    assert.equal(response.statusCode, 404)
  } finally {
    await app.close()
  }
})

test('web app routes keep api and uploads paths as 404 under catchall', async () => {
  const app = Fastify()
  app.decorateReply('sendFile', function sendFile(fileName, rootDir) {
    return this.send({ fileName, rootDir })
  })

  registerWebAppRoutes(app, {
    enabled: true,
    webDistDir: 'dist',
  })
  await app.ready()

  try {
    const rootResponse = await app.inject({
      method: 'GET',
      url: '/',
    })
    assert.equal(rootResponse.statusCode, 200)
    assert.deepEqual(rootResponse.json(), {
      fileName: 'index.html',
      rootDir: 'dist',
    })

    const apiResponse = await app.inject({
      method: 'GET',
      url: '/api/tasks',
    })
    assert.equal(apiResponse.statusCode, 404)

    const appResponse = await app.inject({
      method: 'GET',
      url: '/workspace/demo',
    })
    assert.equal(appResponse.statusCode, 200)
    assert.deepEqual(appResponse.json(), {
      fileName: 'index.html',
      rootDir: 'dist',
    })
  } finally {
    await app.close()
  }
})
