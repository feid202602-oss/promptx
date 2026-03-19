import process from 'node:process'

import { startRelayServer } from '../apps/server/src/relayServer.js'

async function main() {
  await startRelayServer()
}

main().catch((error) => {
  console.error(`[promptx-relay] ${error.message || error}`)
  process.exitCode = 1
})
