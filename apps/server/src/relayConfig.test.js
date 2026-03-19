import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

test('relay config module reads and writes stored config under promptx data dir', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptx-relay-config-'))
  const originalPromptxHome = process.env.PROMPTX_HOME
  process.env.PROMPTX_HOME = tempDir

  try {
    const relayConfigModule = await import(`./relayConfig.js?test=${Date.now()}`)
    const saved = relayConfigModule.writeStoredRelayConfig({
      relayUrl: ' https://relay.example.com ',
      deviceId: ' my-device ',
      deviceToken: ' abc ',
      enabled: true,
    })

    assert.deepEqual(saved, {
      relayUrl: 'https://relay.example.com',
      deviceId: 'my-device',
      deviceToken: 'abc',
      enabled: true,
    })

    const loaded = relayConfigModule.readStoredRelayConfig()
    assert.deepEqual(loaded, saved)
    assert.equal(fs.existsSync(relayConfigModule.getRelayConfigPath()), true)
  } finally {
    if (typeof originalPromptxHome === 'string') {
      process.env.PROMPTX_HOME = originalPromptxHome
    } else {
      delete process.env.PROMPTX_HOME
    }
  }
})
