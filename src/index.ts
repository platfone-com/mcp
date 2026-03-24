#!/usr/bin/env node

import 'dotenv/config'
import { startStdio } from './server/stdio.ts'
import { startHttp } from './server/http.ts'

function parseArgs() {
  const args = process.argv.slice(2)
  let transport: 'stdio' | 'http' = 'stdio'
  let port = 3000

  for (const arg of args) {
    if (arg.startsWith('--transport=')) {
      const val = arg.split('=')[1]
      if (val === 'http' || val === 'stdio') transport = val
      else {
        console.error(`Unknown transport: ${val}. Use "stdio" or "http".`)
        process.exit(1)
      }
    }
    if (arg.startsWith('--port=')) {
      port = parseInt(arg.split('=')[1], 10)
      if (isNaN(port)) {
        console.error('Invalid port number.')
        process.exit(1)
      }
    }
  }

  return { transport, port }
}

const { transport, port } = parseArgs()

if (transport === 'stdio') {
  startStdio().catch((err) => {
    console.error('Fatal:', err)
    process.exit(1)
  })
} else {
  startHttp(port).catch((err) => {
    console.error('Fatal:', err)
    process.exit(1)
  })
}
