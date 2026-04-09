import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { loadImage } from '@napi-rs/canvas'
import { nanoid } from 'nanoid'
import { createApiError } from './apiErrors.js'

const IMAGE_EXTENSION_BY_MIME_TYPE = {
  'image/avif': '.avif',
  'image/bmp': '.bmp',
  'image/gif': '.gif',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/svg+xml': '.svg',
  'image/tiff': '.tiff',
  'image/webp': '.webp',
  'image/x-icon': '.ico',
}

function resolveImageExtension(fileName = '', mimeType = '') {
  const normalizedName = String(fileName || '').trim()
  const extension = path.extname(normalizedName).toLowerCase()
  if (/^\.[a-z0-9]{1,10}$/.test(extension)) {
    return extension
  }

  return IMAGE_EXTENSION_BY_MIME_TYPE[String(mimeType || '').toLowerCase()] || ''
}

async function readImageDimensions(filePath = '') {
  try {
    const source = await loadImage(filePath)
    return {
      width: Number.isFinite(Number(source.width)) ? Number(source.width) : null,
      height: Number.isFinite(Number(source.height)) ? Number(source.height) : null,
    }
  } catch {
    return {
      width: null,
      height: null,
    }
  }
}

function registerAssetRoutes(app, options = {}) {
  const {
    createTempFilePath,
    importPdfBlocks,
    normalizeUploadFileName,
    removeAssetFiles = () => {},
    tmpDir,
    uploadsDir,
  } = options

  app.post('/api/uploads', async (request, reply) => {
    const part = await request.file()
    if (!part) {
      return reply.code(400).send({ messageKey: 'errors.uploadFileMissing', message: '没有收到上传文件。' })
    }
    if (!String(part.mimetype || '').startsWith('image/')) {
      return reply.code(400).send({ messageKey: 'errors.uploadImageOnly', message: '只支持上传图片文件。' })
    }

    const tempPath = createTempFilePath(tmpDir, part.filename)
    let outputPath = ''
    let completed = false

    try {
      await pipeline(part.file, fs.createWriteStream(tempPath))

      const mimeType = String(part.mimetype || '').toLowerCase().trim()
      const outputExt = resolveImageExtension(normalizeUploadFileName(part.filename, 'image'), mimeType)
      const outputName = `${nanoid(16)}${outputExt}`
      outputPath = path.join(uploadsDir, outputName)
      fs.copyFileSync(tempPath, outputPath)

      const stats = fs.statSync(outputPath)
      const dimensions = await readImageDimensions(outputPath)
      completed = true
      return reply.code(201).send({
        url: `/uploads/${outputName}`,
        width: dimensions.width,
        height: dimensions.height,
        mimeType,
        size: stats.size,
      })
    } finally {
      fs.rmSync(tempPath, { force: true })
      if (outputPath && !completed) {
        fs.rmSync(outputPath, { force: true })
      }
    }
  })

  app.post('/api/imports/pdf', async (request, reply) => {
    const part = await request.file()
    if (!part) {
      return reply.code(400).send({ messageKey: 'errors.pdfFileMissing', message: '没有收到 PDF 文件。' })
    }

    const fileName = normalizeUploadFileName(part.filename, 'task.pdf')
    const mimetype = String(part.mimetype || '').toLowerCase()
    if (mimetype !== 'application/pdf' && !fileName.toLowerCase().endsWith('.pdf')) {
      return reply.code(400).send({ messageKey: 'errors.pdfOnly', message: '只支持导入 PDF 文件。' })
    }

    const tempPath = createTempFilePath(tmpDir, fileName, '.pdf')
    let createdAssets = []

    try {
      await pipeline(part.file, fs.createWriteStream(tempPath))
      const buffer = fs.readFileSync(tempPath)
      const imported = await importPdfBlocks(buffer, {
        uploadsDir,
      })
      createdAssets = imported.createdAssets || []

      if (!imported.blocks.length) {
        removeAssetFiles(createdAssets)
        return reply.code(422).send({
          messageKey: 'errors.pdfNoImportableContent',
          message: '没有从 PDF 中提取到可导入的文本或图片。',
        })
      }

      return reply.code(201).send({
        fileName,
        pageCount: imported.pageCount,
        blocks: imported.blocks,
      })
    } catch (error) {
      removeAssetFiles(error.createdAssets || createdAssets)
      throw createApiError(error?.messageKey || '', error?.message || 'PDF 导入失败。', error?.statusCode || 500, {
        createdAssets: error?.createdAssets || createdAssets,
        cause: error,
      })
    } finally {
      fs.rmSync(tempPath, { force: true })
    }
  })
}

export {
  registerAssetRoutes,
}
