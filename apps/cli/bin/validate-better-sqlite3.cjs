#!/usr/bin/env node

const SUPPORTED_NODE_MAJORS = [20, 22, 23, 24]

function parseNodeMajor(version) {
  const match = /^v?(\d+)/.exec(version)
  return match ? Number.parseInt(match[1], 10) : null
}

function isBunRuntime() {
  return typeof process.versions.bun === 'string'
    || typeof globalThis.Bun !== 'undefined'
}

function runtimeInfo() {
  return {
    nodeVersion: process.version,
    nodeMajor: parseNodeMajor(process.version),
    abi: process.versions.modules,
    platform: process.platform,
    arch: process.arch,
    isBun: isBunRuntime(),
  }
}

function isBunNodeGypError(error) {
  if (!(error instanceof Error)) return false
  const msg = error.message.toLowerCase()
  return msg.includes('isexe') || msg.includes('which.js') || msg.includes('node-gyp')
}

function buildMessage(error, context) {
  const info = runtimeInfo()
  const runtimeLabel = info.isBun ? 'bun' : 'node'
  const nodeMajorHint = info.nodeMajor === null || SUPPORTED_NODE_MAJORS.includes(info.nodeMajor)
    ? ''
    : `\n- Unsupported Node major for this CLI: ${info.nodeMajor} (supported: ${SUPPORTED_NODE_MAJORS.join(', ')})`
  const reason = error instanceof Error ? error.message : String(error)

  const lines = [
    '',
    '╔══════════════════════════════════════════════════════════════════╗',
    '║  better-sqlite3 native module validation failed                ║',
    '╚══════════════════════════════════════════════════════════════════╝',
    '',
    `Context: ${context}`,
    `Runtime: ${runtimeLabel} ${info.nodeVersion} (ABI ${info.abi}) on ${info.platform}-${info.arch}${nodeMajorHint}`,
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
  ]

  if (info.isBun || isBunNodeGypError(error)) {
    lines.push(
      '',
      'Bun users:',
      '  Bun\'s node-gyp compatibility is limited and may fail to compile',
      '  better-sqlite3. Recommended alternatives:',
      '  - Install with npm instead: npm install -g @proletariat/cli',
      '  - Install with Homebrew (macOS): brew install chrismcdermut/proletariat/prlt',
      '  - Use Node.js 22 (LTS) for best compatibility',
    )
  }

  lines.push('')
  return lines.join('\n')
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
  const info = runtimeInfo()
  const message = error instanceof Error ? error.message : String(error)

  // In CI, the workflow has explicit "Verify better-sqlite3 native binding" steps
  // that run after cache restore / rebuild-with-retry. Don't fail pnpm install here
  // — the flaky native build is handled by the workflow's fallback rebuild step.
  if (process.env.CI) {
    console.warn(message)
    console.warn('\n[warn] better-sqlite3 validation failed during postinstall (CI mode).')
    console.warn('[warn] The workflow will restore the cached binding or rebuild with retry.\n')
    process.exit(0)
  }

  // Under bun, native module build failures are expected — warn instead of
  // hard-failing so the install can complete. The user will get a clear error
  // at runtime with actionable fix steps.
  if (info.isBun) {
    console.warn(message)
    console.warn('\n[warn] Continuing installation despite validation failure (bun detected).')
    console.warn('[warn] Run prlt with Node.js, or reinstall with npm/Homebrew for full support.\n')
    process.exit(0)
  }

  // Friendlier message when the failure is likely due to an unsupported Node version
  if (info.nodeMajor !== null && !SUPPORTED_NODE_MAJORS.includes(info.nodeMajor)) {
    console.error(message)
    console.error('')
    console.error(`Node ${info.nodeMajor} is not yet supported — prebuilt better-sqlite3 binaries`)
    console.error(`may not exist for this version. Please switch to Node 22 (LTS):`)
    console.error('')
    console.error('  nvm install 22   # or: nvm use 22')
    console.error('  fnm install 22   # or: fnm use 22')
    console.error('')
    process.exit(1)
  }

  console.error(message)
  process.exit(1)
}
