const APP_ORIGIN = 'http://localhost:5173'
const API_ORIGIN = 'http://localhost:3000'

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'CREATE_PROMPTX_TASK_FROM_ZENTAO') {
    return false
  }

  createPromptxTask(message.payload)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: error.message || '创建 PromptX 任务失败。' }))

  return true
})

async function readJson(response) {
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload.message || '请求失败。')
  }
  return payload
}

function getFileNameFromUrl(url = '', mimeType = '') {
  const fallbackExt = (() => {
    if (mimeType.includes('png')) return 'png'
    if (mimeType.includes('webp')) return 'webp'
    if (mimeType.includes('gif')) return 'gif'
    return 'jpg'
  })()

  try {
    const parsed = new URL(url)
    const lastSegment = parsed.pathname.split('/').filter(Boolean).pop() || ''
    const safeName = lastSegment.replace(/[^a-zA-Z0-9._-]/g, '-')
    if (safeName && /\.[a-zA-Z0-9]+$/.test(safeName)) {
      return safeName
    }
    if (safeName) {
      return `${safeName}.${fallbackExt}`
    }
  } catch {}

  return `zentao-image.${fallbackExt}`
}

function buildTaskContent(payload = {}) {
  const lines = []

  if (Array.isArray(payload.metaPairs) && payload.metaPairs.length) {
    lines.push('基本信息：')
    payload.metaPairs.forEach((item) => {
      lines.push(`- ${item.label}：${item.value}`)
    })
    lines.push('')
  }

  if (Array.isArray(payload.sections)) {
    payload.sections.forEach((section) => {
      if (!section?.title || !section.content) {
        return
      }
      lines.push(`${section.title}：`, section.content, '')
    })
  }

  if (payload.mainContent) {
    lines.push('正文内容：', payload.mainContent, '')
  }

  if (Array.isArray(payload.comments) && payload.comments.length) {
    lines.push('评论 / 处理记录：')
    payload.comments.forEach((item, index) => {
      const title = item?.title ? `${index + 1}. ${item.title}` : `${index + 1}.`
      lines.push(title)
      if (item?.content) {
        lines.push(item.content)
      }
      lines.push('')
    })
  }

  if (Array.isArray(payload.attachments) && payload.attachments.length) {
    lines.push('附件 / 关联链接：')
    payload.attachments.forEach((item) => {
      const label = item.label ? `${item.label}：` : ''
      lines.push(`- ${label}${item.url}`)
    })
    lines.push('')
  }

  if (payload.pageExcerpt) {
    lines.push('页面摘录：', payload.pageExcerpt, '')
  }

  const content = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  if (!content) {
    throw new Error('没有提取到可用内容。')
  }

  return content
}

function buildBlocksFromPayload(payload = {}) {
  const source = Array.isArray(payload.blocks) ? payload.blocks : []
  const blocks = source
    .map((block) => {
      if (!block || !block.content) {
        return null
      }
      if (block.type === 'image') {
        return {
          type: 'image',
          content: String(block.content).trim(),
          meta: {},
        }
      }
      return {
        type: 'text',
        content: String(block.content).trim(),
        meta: {},
      }
    })
    .filter(Boolean)

  if (blocks.length) {
    return blocks
  }

  const fallbackContent = buildTaskContent(payload)
  return [
    {
      type: 'text',
      content: fallbackContent,
      meta: {},
    },
  ]
}

async function transferImageToPromptx(settings, imageUrl) {
  const sourceResponse = await fetch(imageUrl, {
    credentials: 'include',
  })

  if (!sourceResponse.ok) {
    throw new Error(`抓取禅道图片失败：${sourceResponse.status}`)
  }

  const blob = await sourceResponse.blob()
  const formData = new FormData()
  formData.append('file', blob, getFileNameFromUrl(imageUrl, blob.type || ''))

  const uploaded = await fetch(`${settings.apiOrigin}/api/uploads`, {
    method: 'POST',
    body: formData,
  }).then(readJson)

  return uploaded.url
}

function isLikelyImageReference(url = '', line = '') {
  const normalizedUrl = String(url || '').trim()
  const normalizedLine = String(line || '').trim()

  if (!normalizedUrl) {
    return false
  }

  if (/^\[图片\]/.test(normalizedLine) || /^!\[[^\]]*]\(https?:\/\/[^)]+\)$/.test(normalizedLine)) {
    return true
  }

  if (/\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/i.test(normalizedUrl)) {
    return true
  }

  return /\/(file-read|file-download)-/i.test(normalizedUrl)
    || /[?&]m=file&f=(read|download)\b/i.test(normalizedUrl)
    || /\/api\.php\?m=file\b/i.test(normalizedUrl)
}

function extractImageReference(line = '') {
  const trimmed = String(line || '').trim()
  if (!trimmed) {
    return null
  }

  const markdownMatch = trimmed.match(/^!\[(?<caption>[^\]]*)\]\((?<url>https?:\/\/[^)]+)\)$/)
  if (markdownMatch?.groups?.url) {
    return {
      url: markdownMatch.groups.url,
      caption: String(markdownMatch.groups.caption || '').trim(),
    }
  }

  const taggedMatch = trimmed.match(/^\[图片\]\s*(?<caption>.*?)(?:[:：]\s*)?(?<url>https?:\/\/\S+)$/)
  if (taggedMatch?.groups?.url) {
    return {
      url: taggedMatch.groups.url,
      caption: String(taggedMatch.groups.caption || '').replace(/[:：]\s*$/, '').trim(),
    }
  }

  const urlMatches = trimmed.match(/https?:\/\/[^\s)]+/ig) || []
  if (urlMatches.length !== 1) {
    return null
  }

  const url = urlMatches[0]
  if (!isLikelyImageReference(url, trimmed)) {
    return null
  }

  const prefix = trimmed
    .slice(0, trimmed.indexOf(url))
    .replace(/^\[图片\]\s*/, '')
    .replace(/[:：-]\s*$/, '')
    .trim()
  const suffix = trimmed
    .slice(trimmed.indexOf(url) + url.length)
    .replace(/^[)\]】】\s]+/, '')
    .trim()

  if (suffix) {
    return null
  }

  return {
    url,
    caption: prefix,
  }
}

function pushTextBlock(blocks, content, meta = {}) {
  const value = String(content || '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  if (!value) {
    return
  }

  blocks.push({
    type: 'text',
    content: value,
    meta: { ...meta },
  })
}

async function expandTextBlockWithHostedImages(settings, block) {
  const content = String(block?.content || '')
  if (!content.trim()) {
    return []
  }

  const lines = content.split('\n')
  const normalized = []
  let textBuffer = []

  const flushText = () => {
    if (!textBuffer.length) {
      return
    }
    pushTextBlock(normalized, textBuffer.join('\n'), block.meta || {})
    textBuffer = []
  }

  for (const rawLine of lines) {
    const reference = extractImageReference(rawLine)
    if (!reference?.url) {
      textBuffer.push(rawLine)
      continue
    }

    try {
      const hostedUrl = await transferImageToPromptx(settings, reference.url)
      flushText()
      if (reference.caption) {
        pushTextBlock(normalized, reference.caption, block.meta || {})
      }
      normalized.push({
        type: 'image',
        content: hostedUrl,
        meta: {},
      })
    } catch {
      textBuffer.push(rawLine)
    }
  }

  flushText()
  return normalized.length ? normalized : [block]
}

async function normalizeBlocksWithHostedImages(settings, blocks = []) {
  const normalized = []

  for (const block of blocks) {
    if (!block || !block.content) {
      continue
    }

    if (block.type !== 'image') {
      const expandedBlocks = await expandTextBlockWithHostedImages(settings, block)
      normalized.push(...expandedBlocks)
      continue
    }

    try {
      const hostedUrl = await transferImageToPromptx(settings, block.content)
      normalized.push({
        ...block,
        content: hostedUrl,
      })
    } catch (error) {
      normalized.push(block)
    }
  }

  return normalized
}

async function createPromptxTask(payload = {}) {
  const title = String(payload.title || '').trim() || '禅道 Bug'
  const blocks = await normalizeBlocksWithHostedImages(
    {
      appOrigin: APP_ORIGIN,
      apiOrigin: API_ORIGIN,
    },
    buildBlocksFromPayload(payload)
  )

  const created = await fetch(`${API_ORIGIN}/api/tasks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title,
      expiry: 'none',
      visibility: 'private',
    }),
  }).then(readJson)

  await fetch(`${API_ORIGIN}/api/tasks/${created.slug}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title,
      expiry: 'none',
      visibility: 'private',
      blocks,
    }),
  }).then(readJson)

  const rawUrl = `${API_ORIGIN}/api/tasks/${created.slug}/raw`
  const taskUrl = `${APP_ORIGIN}/?task=${encodeURIComponent(created.slug)}`

  return {
    taskUrl,
    rawUrl,
    editUrl: taskUrl,
    promptText: `请先阅读这份任务内容，再继续开发：\n${rawUrl}`,
  }
}
