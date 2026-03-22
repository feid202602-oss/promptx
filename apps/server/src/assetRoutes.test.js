import assert from 'node:assert/strict'
import Fastify from 'fastify'
import multipart from '@fastify/multipart'
import test from 'node:test'

import { registerAssetRoutes } from './assetRoutes.js'

test('asset routes reject missing upload file', async () => {
  const app = Fastify()
  await app.register(multipart)
  registerAssetRoutes(app, {
    createTempFilePath: () => '',
    importPdfBlocks: async () => ({ blocks: [] }),
    normalizeUploadFileName: (name) => name,
    removeAssetFiles: () => {},
    tmpDir: 'tmp',
    uploadsDir: 'uploads',
  })
  await app.ready()

  try {
    const uploadResponse = await app.inject({
      method: 'POST',
      url: '/api/uploads',
    })
    assert.equal(uploadResponse.statusCode, 406)

    const pdfResponse = await app.inject({
      method: 'POST',
      url: '/api/imports/pdf',
    })
    assert.equal(pdfResponse.statusCode, 406)
  } finally {
    await app.close()
  }
})
