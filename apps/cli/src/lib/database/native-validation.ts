export interface BetterSqlite3RuntimeInfo {
  nodeVersion: string
  nodeMajor: number | null
  abi: string
  platform: NodeJS.Platform
  arch: string
  isBun: boolean
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

/**
 * Detect whether the current runtime is Bun rather than Node.js.
 * Bun sets `process.versions.bun` and the `Bun` global.
 */
function detectBunRuntime(): boolean {
  return typeof (process.versions as Record<string, string | undefined>).bun === 'string'
    || typeof (globalThis as Record<string, unknown>).Bun !== 'undefined'
}

export function getBetterSqlite3RuntimeInfo(): BetterSqlite3RuntimeInfo {
  return {
    nodeVersion: process.version,
    nodeMajor: parseNodeMajor(process.version),
    abi: process.versions.modules,
    platform: process.platform,
    arch: process.arch,
    isBun: detectBunRuntime(),
  }
}

export function buildBetterSqlite3ValidationMessage(
  cause: unknown,
  info: BetterSqlite3RuntimeInfo,
  context: string
): string {
  const reason = cause instanceof Error ? cause.message : String(cause)
  const runtimeLabel = info.isBun ? 'bun' : 'node'
  const nodeMajorHint = info.nodeMajor === null || SUPPORTED_NODE_MAJORS.includes(info.nodeMajor)
    ? null
    : `- Unsupported Node major for this CLI: ${info.nodeMajor} (supported: ${SUPPORTED_NODE_MAJORS.join(', ')})`

  const lines = [
    `better-sqlite3 native module failed to load (${context}).`,
    `Runtime: ${runtimeLabel} ${info.nodeVersion} (ABI ${info.abi}) on ${info.platform}-${info.arch}.`,
    `Error: ${reason}`,
    '',
    'Fix steps:',
    '1. Rebuild native bindings: npm rebuild better-sqlite3',
    '2. If globally installed, reinstall: pnpm install -g @proletariat/cli --force',
    '   (or: npm install -g @proletariat/cli --force)',
    '3. If running from source, reinstall workspace deps: pnpm install',
  ]

  if (nodeMajorHint) {
    lines.splice(2, 0, nodeMajorHint)
  }

  if (info.isBun || isBunNodeGypError(cause)) {
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

  return lines.join('\n')
}

/**
 * Detect whether an error looks like a bun-specific node-gyp failure.
 * Bun's node-gyp integration has known issues with the `isexe` module
 * (used by `which`) and other native compilation steps.
 */
function isBunNodeGypError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const msg = error.message.toLowerCase()
  return msg.includes('isexe') || msg.includes('which.js') || msg.includes('node-gyp')
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
 * - "isexe" / "which.js" (bun node-gyp compatibility issues)
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
  // Bun-specific: node-gyp fails because bun's `which` shim uses an
  // incompatible `isexe` version that throws at runtime.
  if (msg.includes('isexe') && msg.includes('not a function')) return true

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
