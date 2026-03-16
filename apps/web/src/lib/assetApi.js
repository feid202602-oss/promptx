import { getApiBase } from './request.js'

const API_BASE = getApiBase()

export async function uploadImage(file) {
  const body = new FormData()
  body.append('file', file)

  const response = await fetch(`${API_BASE}/api/uploads`, {
    method: 'POST',
    body,
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new Error(payload.message || '上传失败。')
  }

  return response.json()
}

export async function importPdf(file) {
  const body = new FormData()
  body.append('file', file)

  const response = await fetch(`${API_BASE}/api/imports/pdf`, {
    method: 'POST',
    body,
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new Error(payload.message || 'PDF 导入失败。')
  }

  return response.json()
}
