import { request } from './request.js'

export function getSystemConfig() {
  return request('/api/system/config', {
    cache: 'no-store',
  })
}

export function updateSystemConfig(payload) {
  return request('/api/system/config', {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function getRuntimeDiagnostics() {
  return request('/api/diagnostics/runtime', {
    cache: 'no-store',
  })
}
