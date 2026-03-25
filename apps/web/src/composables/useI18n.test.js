import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getCurrentLocale,
  initializeI18n,
  setLocale,
} from './useI18n.js'

test('首次初始化时，即使浏览器语言是英文也默认使用中文', () => {
  const originalWindow = globalThis.window
  const storage = new Map()

  globalThis.window = {
    navigator: {
      language: 'en-US',
      languages: ['en-US', 'zh-CN'],
    },
    localStorage: {
      getItem(key) {
        return storage.has(key) ? storage.get(key) : null
      },
      setItem(key, value) {
        storage.set(key, String(value))
      },
    },
  }

  try {
    const locale = initializeI18n()
    assert.equal(locale, 'zh-CN')
    assert.equal(getCurrentLocale(), 'zh-CN')
    assert.equal(storage.get('promptx:locale'), 'zh-CN')
  } finally {
    globalThis.window = originalWindow
    setLocale('zh-CN')
  }
})

test('用户手动切到英文后，初始化会继续沿用已保存语言', () => {
  const originalWindow = globalThis.window
  const storage = new Map([['promptx:locale', 'en-US']])

  globalThis.window = {
    navigator: {
      language: 'zh-CN',
      languages: ['zh-CN', 'en-US'],
    },
    localStorage: {
      getItem(key) {
        return storage.has(key) ? storage.get(key) : null
      },
      setItem(key, value) {
        storage.set(key, String(value))
      },
    },
  }

  try {
    const locale = initializeI18n()
    assert.equal(locale, 'en-US')
    assert.equal(getCurrentLocale(), 'en-US')
    assert.equal(storage.get('promptx:locale'), 'en-US')
  } finally {
    globalThis.window = originalWindow
    setLocale('zh-CN')
  }
})
