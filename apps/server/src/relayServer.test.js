import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeRequestBodyToBuffer } from './relayServer.js'

test('normalizeRequestBodyToBuffer handles common relay request body shapes', () => {
  assert.equal(normalizeRequestBodyToBuffer(null).length, 0)
  assert.equal(normalizeRequestBodyToBuffer(undefined).length, 0)
  assert.equal(normalizeRequestBodyToBuffer('hello').toString('utf8'), 'hello')
  assert.equal(normalizeRequestBodyToBuffer({ foo: 'bar' }).toString('utf8'), '{"foo":"bar"}')
  assert.equal(normalizeRequestBodyToBuffer(123).toString('utf8'), '123')

  const source = Buffer.from('abc')
  assert.equal(normalizeRequestBodyToBuffer(source), source)

  const bytes = new Uint8Array([65, 66, 67])
  assert.equal(normalizeRequestBodyToBuffer(bytes).toString('utf8'), 'ABC')
})
