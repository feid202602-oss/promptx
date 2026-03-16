import assert from 'node:assert/strict'
import test from 'node:test'

class FakeRequest {
  constructor() {
    this.result = undefined
    this.error = null
    this.onsuccess = null
    this.onerror = null
    this.onupgradeneeded = null
  }
}

class FakeObjectStore {
  constructor(store) {
    this.store = store
  }

  get(key) {
    const request = new FakeRequest()
    queueMicrotask(() => {
      request.result = this.store.get(key)
    })
    return request
  }

  put(value) {
    const request = new FakeRequest()
    queueMicrotask(() => {
      this.store.set(value.storageKey, value)
      request.result = value
    })
    return request
  }

  delete(key) {
    const request = new FakeRequest()
    queueMicrotask(() => {
      this.store.delete(key)
      request.result = undefined
    })
    return request
  }
}

class FakeTransaction {
  constructor(store) {
    this.store = store
    this.error = null
    this.oncomplete = null
    this.onerror = null
    this.onabort = null

    setTimeout(() => {
      this.oncomplete?.()
    }, 0)
  }

  objectStore() {
    return new FakeObjectStore(this.store)
  }
}

class FakeDatabase {
  constructor() {
    this.objectStoreNames = {
      contains: (name) => this.stores.has(name),
    }
    this.stores = new Map()
  }

  createObjectStore(name) {
    if (!this.stores.has(name)) {
      this.stores.set(name, new Map())
    }
    return this.stores.get(name)
  }

  transaction(name) {
    if (!this.stores.has(name)) {
      this.createObjectStore(name)
    }
    return new FakeTransaction(this.stores.get(name))
  }
}

class FakeIndexedDb {
  constructor() {
    this.database = new FakeDatabase()
  }

  open() {
    const request = new FakeRequest()
    queueMicrotask(() => {
      request.result = this.database
      request.onupgradeneeded?.()
      request.onsuccess?.()
    })
    return request
  }
}

async function importStoreModule() {
  return import(`./transcriptStore.js?test=${Date.now()}-${Math.random()}`)
}

test('transcript store reads and writes turns with indexedDB', async () => {
  global.window = { indexedDB: new FakeIndexedDb() }

  const { getTranscript, setTranscript, deleteTranscript } = await importStoreModule()

  await setTranscript('task-a', [{ id: 1, prompt: 'hello' }])
  const saved = await getTranscript('task-a')
  assert.deepEqual(saved, [{ id: 1, prompt: 'hello' }])

  await deleteTranscript('task-a')
  const removed = await getTranscript('task-a')
  assert.equal(removed, null)
})

test('transcript store returns null when indexedDB is unavailable', async () => {
  global.window = {}

  const { getTranscript, setTranscript, deleteTranscript } = await importStoreModule()

  await setTranscript('task-b', [{ id: 2 }])
  assert.equal(await getTranscript('task-b'), null)
  await deleteTranscript('task-b')
})
