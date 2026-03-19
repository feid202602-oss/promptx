import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildRelayWebSocketUrl,
  chunkBuffer,
  constantTimeEqual,
  parseCookieHeader,
  sanitizeProxyHeaders,
} from './relayProtocol.js'

test('buildRelayWebSocketUrl converts base URL to relay websocket endpoint', () => {
  assert.equal(buildRelayWebSocketUrl('https://relay.example.com/base?q=1'), 'wss://relay.example.com/relay/connect')
  assert.equal(buildRelayWebSocketUrl('http://127.0.0.1:3030/'), 'ws://127.0.0.1:3030/relay/connect')
})

test('chunkBuffer splits buffers by max size', () => {
  const chunks = chunkBuffer(Buffer.from('abcdefghij'), 4)
  assert.deepEqual(chunks.map((item) => item.toString('utf8')), ['abcd', 'efgh', 'ij'])
})

test('sanitizeProxyHeaders strips hop-by-hop headers and keeps content headers', () => {
  assert.deepEqual(
    sanitizeProxyHeaders({
      Host: 'localhost:3000',
      Connection: 'keep-alive',
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Cookie: 'secret=1',
    }, ['cookie']),
    {
      'content-type': 'application/json',
      accept: 'application/json',
    }
  )
})

test('parseCookieHeader parses browser cookies', () => {
  assert.deepEqual(parseCookieHeader('foo=bar; hello=world%20ok'), {
    foo: 'bar',
    hello: 'world ok',
  })
})

test('constantTimeEqual compares exact token text', () => {
  assert.equal(constantTimeEqual('abc', 'abc'), true)
  assert.equal(constantTimeEqual('abc', 'abcd'), false)
  assert.equal(constantTimeEqual('abc', 'abx'), false)
})
