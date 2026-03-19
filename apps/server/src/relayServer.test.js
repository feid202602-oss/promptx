import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  normalizeRelayHost,
  normalizeRequestBodyToBuffer,
  readRelayServerConfig,
  resolveRelayTenantByHost,
} from './relayServer.js'

function withEnv(overrides, run) {
  const previous = {}
  Object.keys(overrides).forEach((key) => {
    previous[key] = process.env[key]
    const value = overrides[key]
    if (value === null) {
      delete process.env[key]
      return
    }
    process.env[key] = value
  })

  try {
    return run()
  } finally {
    Object.entries(previous).forEach(([key, value]) => {
      if (typeof value === 'undefined') {
        delete process.env[key]
        return
      }
      process.env[key] = value
    })
  }
}

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

test('normalizeRelayHost strips protocol, port and casing', () => {
  assert.equal(normalizeRelayHost('https://User1.PromptX.mushayu.com/path?a=1'), 'user1.promptx.mushayu.com')
  assert.equal(normalizeRelayHost('USER2.promptx.mushayu.com:443'), 'user2.promptx.mushayu.com')
  assert.equal(normalizeRelayHost(' user3.promptx.mushayu.com , proxy-host '), 'user3.promptx.mushayu.com')
})

test('resolveRelayTenantByHost matches configured subdomains', () => {
  const tenants = [
    {
      key: 'user1',
      hosts: ['user1.promptx.mushayu.com'],
      deviceToken: 'token-1',
      accessToken: 'access-1',
      expectedDeviceId: 'user1-mac',
    },
    {
      key: 'user2',
      hosts: ['user2.promptx.mushayu.com'],
      deviceToken: 'token-2',
      accessToken: 'access-2',
      expectedDeviceId: 'user2-mac',
    },
  ]

  assert.equal(resolveRelayTenantByHost(tenants, 'user1.promptx.mushayu.com:443')?.key, 'user1')
  assert.equal(resolveRelayTenantByHost(tenants, 'https://user2.promptx.mushayu.com')?.key, 'user2')
  assert.equal(resolveRelayTenantByHost(tenants, 'promptx.mushayu.com'), null)
})

test('readRelayServerConfig loads multi-tenant relay settings from file', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptx-relay-server-'))
  const configPath = path.join(tempDir, 'relay-tenants.json')
  fs.writeFileSync(configPath, `${JSON.stringify({
    tenants: [
      {
        key: 'user1',
        host: 'https://user1.promptx.mushayu.com',
        deviceId: 'user1-mac',
        deviceToken: 'token-1',
        accessToken: 'access-1',
      },
      {
        key: 'user2',
        hosts: ['user2.promptx.mushayu.com', 'USER2-ALT.promptx.mushayu.com'],
        deviceId: 'user2-mac',
        deviceToken: 'token-2',
        accessToken: 'access-2',
      },
    ],
  }, null, 2)}\n`, 'utf8')

  withEnv({
    PROMPTX_RELAY_TENANTS_FILE: configPath,
    PROMPTX_RELAY_HOST: '0.0.0.0',
    PROMPTX_RELAY_PORT: '3030',
    PROMPTX_RELAY_PUBLIC_URL: null,
    PROMPTX_RELAY_DEVICE_ID: null,
    PROMPTX_RELAY_DEVICE_TOKEN: null,
    PROMPTX_RELAY_ACCESS_TOKEN: null,
  }, () => {
    const config = readRelayServerConfig()
    assert.equal(config.tenantSource, configPath)
    assert.equal(config.tenants.length, 2)
    assert.deepEqual(config.tenants[0], {
      key: 'user1',
      hosts: ['user1.promptx.mushayu.com'],
      expectedDeviceId: 'user1-mac',
      deviceToken: 'token-1',
      accessToken: 'access-1',
    })
    assert.deepEqual(config.tenants[1], {
      key: 'user2',
      hosts: ['user2.promptx.mushayu.com', 'user2-alt.promptx.mushayu.com'],
      expectedDeviceId: 'user2-mac',
      deviceToken: 'token-2',
      accessToken: 'access-2',
    })
  })
})
