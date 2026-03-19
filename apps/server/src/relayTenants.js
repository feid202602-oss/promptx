import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

function normalizeTenantKey(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function normalizeHost(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .replace(/\.$/, '')
}

function resolveTenantHost({ key = '', domain = '', host = '' } = {}) {
  const normalizedHost = normalizeHost(host)
  if (normalizedHost) {
    return normalizedHost
  }

  const normalizedKey = normalizeTenantKey(key)
  const normalizedDomain = normalizeHost(domain)
  if (!normalizedKey || !normalizedDomain) {
    return ''
  }

  return `${normalizedKey}.${normalizedDomain}`
}

function createRandomToken(prefix = 'px') {
  return `${prefix}_${crypto.randomBytes(12).toString('base64url')}`
}

function readRelayTenantsFile(filePath) {
  const resolvedPath = path.resolve(String(filePath || '').trim())

  try {
    const payload = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'))
    const tenants = Array.isArray(payload) ? payload : payload?.tenants
    if (!Array.isArray(tenants)) {
      return {
        path: resolvedPath,
        tenants: [],
      }
    }
    return {
      path: resolvedPath,
      tenants,
    }
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        path: resolvedPath,
        tenants: [],
      }
    }
    throw error
  }
}

function writeRelayTenantsFile(filePath, tenants = []) {
  const resolvedPath = path.resolve(String(filePath || '').trim())
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true })
  fs.writeFileSync(resolvedPath, `${JSON.stringify({ tenants }, null, 2)}\n`, 'utf8')
  return resolvedPath
}

function addRelayTenant({
  filePath,
  key,
  domain,
  host,
  deviceId,
  deviceToken,
  accessToken,
} = {}) {
  const normalizedKey = normalizeTenantKey(key)
  if (!normalizedKey) {
    throw new Error('租户 key 不能为空，且只能包含字母、数字和中划线。')
  }

  const resolvedHost = resolveTenantHost({ key: normalizedKey, domain, host })
  if (!resolvedHost) {
    throw new Error('请提供 --domain 或 --host，用来生成租户子域名。')
  }

  const normalizedDeviceId = String(deviceId || `${normalizedKey}-mac`).trim()
  if (!normalizedDeviceId) {
    throw new Error('deviceId 不能为空。')
  }

  const nextTenant = {
    key: normalizedKey,
    host: resolvedHost,
    deviceId: normalizedDeviceId,
    deviceToken: String(deviceToken || createRandomToken(`dev_${normalizedKey}`)).trim(),
    accessToken: String(accessToken || createRandomToken(`access_${normalizedKey}`)).trim(),
  }

  const current = readRelayTenantsFile(filePath)
  if (current.tenants.some((item) => normalizeTenantKey(item?.key) === normalizedKey)) {
    throw new Error(`租户已存在：${normalizedKey}`)
  }
  if (current.tenants.some((item) => normalizeHost(item?.host) === resolvedHost)) {
    throw new Error(`域名已存在：${resolvedHost}`)
  }

  const nextTenants = [...current.tenants, nextTenant]
  writeRelayTenantsFile(current.path, nextTenants)

  return {
    path: current.path,
    tenant: nextTenant,
    tenants: nextTenants,
  }
}

export {
  addRelayTenant,
  createRandomToken,
  normalizeHost,
  normalizeTenantKey,
  readRelayTenantsFile,
  resolveTenantHost,
  writeRelayTenantsFile,
}
