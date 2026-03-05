#!/usr/bin/env node

const SUPPORTED_NODE_MAJORS = [20, 22, 23, 24, 25]

function parseNodeMajor(version) {
  const match = /^v?(\d+)/.exec(version)
  return match ? Number.parseInt(match[1], 10) : null
}

function runtimeInfo() {
  return {
    nodeVersion: process.version,
    nodeMajor: parseNodeMajor(process.version),
    abi: process.versions.modules,
    platform: process.platform,
    arch: process.arch,
  }
}

function buildMessage(error, context) {
  const info = runtimeInfo()
  const nodeMajorHint = info.nodeMajor === null || SUPPORTED_NODE_MAJORS.includes(info.nodeMajor)
    ? ''
    : `\n- Unsupported Node major for this CLI: ${info.nodeMajor} (supported: ${SUPPORTED_NODE_MAJORS.join(', ')})`
  const reason = error instanceof Error ? error.message : String(error)

  return [
    '',
    '╔══════════════════════════════════════════════════════════════════╗',
    '║  better-sqlite3 native module validation failed                ║',
    '╚══════════════════════════════════════════════════════════════════╝',
    '',
    `Context: ${context}`,
    `Runtime: node ${info.nodeVersion} (ABI ${info.abi}) on ${info.platform}-${info.arch}${nodeMajorHint}`,
    `Error:   ${reason}`,
    '',
    'Fix steps:',
    '1. Rebuild native bindings: npm rebuild better-sqlite3',
    '2. If globally installed, reinstall: pnpm install -g @proletariat/cli --force',
    '   (or: npm install -g @proletariat/cli --force)',
    '3. Verify architecture: node -p "process.platform + \'-\' + process.arch"',
    '',
    'If the problem persists, ensure you have build tools installed:',
    '  macOS:  xcode-select --install',
    '  Linux:  sudo apt-get install build-essential python3',
    '',
  ].join('\n')
}

function validate(context) {
  try {
    const Database = require('better-sqlite3')
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    db.close()
  } catch (error) {
    throw new Error(buildMessage(error, context))
  }
}

try {
  validate('postinstall')
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
