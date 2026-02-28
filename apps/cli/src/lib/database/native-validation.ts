export interface BetterSqlite3RuntimeInfo {
  nodeVersion: string
  nodeMajor: number | null
  abi: string
  platform: NodeJS.Platform
  arch: string
}

export interface BetterSqlite3ValidationOptions {
  context: string
  loadModule?: () => Promise<{ default: new (path: string) => BetterSqlite3DatabaseLike }>
}

interface BetterSqlite3DatabaseLike {
  pragma(sql: string): unknown
  close(): void
}

const SUPPORTED_NODE_MAJORS = [20, 22, 23, 24, 25]

function parseNodeMajor(version: string): number | null {
  const match = /^v?(\d+)/.exec(version)
  return match ? Number.parseInt(match[1], 10) : null
}

export function getBetterSqlite3RuntimeInfo(): BetterSqlite3RuntimeInfo {
  return {
    nodeVersion: process.version,
    nodeMajor: parseNodeMajor(process.version),
    abi: process.versions.modules,
    platform: process.platform,
    arch: process.arch,
  }
}

export function buildBetterSqlite3ValidationMessage(
  cause: unknown,
  info: BetterSqlite3RuntimeInfo,
  context: string
): string {
  const reason = cause instanceof Error ? cause.message : String(cause)
  const nodeMajorHint = info.nodeMajor === null || SUPPORTED_NODE_MAJORS.includes(info.nodeMajor)
    ? null
    : `- Unsupported Node major for this CLI: ${info.nodeMajor} (supported: ${SUPPORTED_NODE_MAJORS.join(', ')})`

  const lines = [
    `better-sqlite3 native module validation failed (${context}).`,
    `Runtime: node ${info.nodeVersion} (ABI ${info.abi}) on ${info.platform}-${info.arch}.`,
    `Load error: ${reason}`,
    '',
    'Fix steps:',
    '1. Rebuild native bindings for the current runtime: `npm rebuild better-sqlite3`',
    '2. Verify runtime architecture: `node -p "process.platform + \'-\' + process.arch + \' abi=\' + process.versions.modules"`',
    '3. If globally installed, reinstall CLI with current Node: `npm uninstall -g @proletariat/cli && npm install -g @proletariat/cli`',
    '4. If running tests from source, reinstall workspace deps: `pnpm install`',
  ]

  if (nodeMajorHint) {
    lines.splice(2, 0, nodeMajorHint)
  }

  return lines.join('\n')
}

export async function validateBetterSqlite3NativeBinding(options: BetterSqlite3ValidationOptions): Promise<void> {
  const loadModule = options.loadModule ?? (async () => import('better-sqlite3'))
  const runtime = getBetterSqlite3RuntimeInfo()

  try {
    const mod = await loadModule()
    const Database = mod.default
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    db.close()
  } catch (error) {
    throw new Error(buildBetterSqlite3ValidationMessage(error, runtime, options.context))
  }
}
