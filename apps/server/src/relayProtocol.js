import crypto from 'node:crypto'

const RELAY_CHUNK_SIZE = 256 * 1024
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

function normalizeHeaderKey(value = '') {
  return String(value || '').trim().toLowerCase()
}

function normalizeHeaderValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? '')).join(', ')
  }
  if (typeof value === 'undefined' || value === null) {
    return ''
  }
  return String(value)
}

function normalizeHeaders(input = {}) {
  const headers = {}

  if (typeof input?.forEach === 'function') {
    input.forEach((value, key) => {
      const normalizedKey = normalizeHeaderKey(key)
      if (!normalizedKey) {
        return
      }
      headers[normalizedKey] = normalizeHeaderValue(value)
    })
    return headers
  }

  Object.entries(input || {}).forEach(([key, value]) => {
    const normalizedKey = normalizeHeaderKey(key)
    if (!normalizedKey) {
      return
    }
    headers[normalizedKey] = normalizeHeaderValue(value)
  })

  return headers
}

function sanitizeProxyHeaders(input = {}, extraExcludedHeaders = []) {
  const excludedHeaders = new Set([
    ...HOP_BY_HOP_HEADERS,
    ...extraExcludedHeaders.map((item) => normalizeHeaderKey(item)),
  ])
  const headers = normalizeHeaders(input)

  return Object.fromEntries(
    Object.entries(headers).filter(([key, value]) => !excludedHeaders.has(key) && value !== '')
  )
}

function chunkBuffer(buffer, maxBytes = RELAY_CHUNK_SIZE) {
  const source = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '')
  if (!source.length) {
    return []
  }

  const items = []
  for (let offset = 0; offset < source.length; offset += maxBytes) {
    items.push(source.subarray(offset, offset + maxBytes))
  }
  return items
}

function encodeChunk(chunk) {
  return Buffer.from(chunk || '').toString('base64')
}

function decodeChunk(value = '') {
  return Buffer.from(String(value || ''), 'base64')
}

function buildRelayWebSocketUrl(baseUrl = '') {
  const target = String(baseUrl || '').trim()
  if (!target) {
    return ''
  }

  const url = new URL(target)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = '/relay/connect'
  url.search = ''
  url.hash = ''
  return url.toString()
}

function parseCookieHeader(header = '') {
  return String(header || '')
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
    .reduce((result, item) => {
      const [rawKey, ...rawValueParts] = item.split('=')
      const key = String(rawKey || '').trim()
      if (!key) {
        return result
      }
      result[key] = decodeURIComponent(rawValueParts.join('=') || '')
      return result
    }, {})
}

function constantTimeEqual(left = '', right = '') {
  const leftBuffer = Buffer.from(String(left || ''))
  const rightBuffer = Buffer.from(String(right || ''))
  if (leftBuffer.length !== rightBuffer.length) {
    return false
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

function createRelayRequestId() {
  return crypto.randomUUID()
}

export {
  RELAY_CHUNK_SIZE,
  buildRelayWebSocketUrl,
  chunkBuffer,
  constantTimeEqual,
  createRelayRequestId,
  decodeChunk,
  encodeChunk,
  normalizeHeaders,
  parseCookieHeader,
  sanitizeProxyHeaders,
}
