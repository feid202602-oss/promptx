import { request } from './request.js'

export function listTasks() {
  return request('/api/tasks')
}

export function createTask(payload) {
  return request('/api/tasks', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function getTask(slug) {
  return request(`/api/tasks/${slug}`)
}

export function updateTask(slug, payload) {
  return request(`/api/tasks/${slug}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function deleteTask(slug) {
  return request(`/api/tasks/${slug}`, {
    method: 'DELETE',
  })
}

export function fetchRawTask(slug) {
  return request(`/api/tasks/${slug}/raw`)
}
