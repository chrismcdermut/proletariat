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

/**
 * Detect whether an error is caused by a missing or incompatible better-sqlite3
 * native binding (.node file) rather than a normal SQLite operational error.
 *
 * Common patterns:
 * - "Could not locate the bindings file" (node-gyp / node-bindings)
 * - "better_sqlite3.node" in the message (missing prebuilt)
 * - "MODULE_NOT_FOUND" code (Node can't resolve the addon)
 * - "was compiled against a different Node.js version" (ABI mismatch)
 * - "A dynamic link library (DLL) initialization routine failed" (Windows ABI issue)
 */
export function isBetterSqlite3NativeError(error: unknown): boolean {
  if (!(error instanceof Error)) return false

  const msg = error.message.toLowerCase()
  const code = (error as NodeJS.ErrnoException).code

  if (code === 'MODULE_NOT_FOUND') return true
  if (msg.includes('could not locate the bindings file')) return true
  if (msg.includes('better_sqlite3.node')) return true
  if (msg.includes('was compiled against a different node.js version')) return true
  if (msg.includes('dll initialization routine failed')) return true
  if (msg.includes('cannot open shared object file')) return true
  if (msg.includes('is not a valid win32 application')) return true
  if (msg.includes('node_module_version')) return true

  return false
}

/**
 * If the given error is a native binding error, throw a user-friendly error
 * with actionable fix steps. Otherwise re-throw the original error.
 */
export function throwIfNativeBindingError(error: unknown, context: string): void {
  if (isBetterSqlite3NativeError(error)) {
    const info = getBetterSqlite3RuntimeInfo()
    throw new Error(buildBetterSqlite3ValidationMessage(error, info, context))
  }
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
