#!/usr/bin/env node

import path from 'node:path'
import process from 'node:process'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const serviceScriptPath = path.join(rootDir, 'scripts', 'service.mjs')
const doctorScriptPath = path.join(rootDir, 'scripts', 'doctor.mjs')

function printHelp() {
  console.log(`
PromptX CLI

用法：
  promptx start
  promptx stop
  promptx restart
  promptx status
  promptx doctor

说明：
  - start: 后台启动 PromptX，本机默认地址 http://127.0.0.1:3000
  - stop: 停止后台服务
  - restart: 重启后台服务
  - status: 查看当前运行状态
  - doctor: 检查 Node、Codex、数据目录、端口和打包产物
`.trim())
}

function runNodeScript(scriptPath, args = []) {
  const child = spawn(process.execPath, [scriptPath, ...args], {
    cwd: rootDir,
    stdio: 'inherit',
    env: process.env,
  })

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal)
      return
    }
    process.exit(code ?? 0)
  })
}

const command = String(process.argv[2] || 'help').trim()

if (!command || command === 'help' || command === '--help' || command === '-h') {
  printHelp()
} else if (['start', 'stop', 'restart', 'status'].includes(command)) {
  runNodeScript(serviceScriptPath, [command])
} else if (command === 'doctor') {
  runNodeScript(doctorScriptPath)
} else {
  console.error(`[promptx] 不支持的命令：${command}`)
  console.error('[promptx] 可用命令：start / stop / restart / status / doctor')
  process.exitCode = 1
}
