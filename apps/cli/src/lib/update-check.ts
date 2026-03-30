/**
 * Update Check Module
 *
 * Handles background version checking with caching, package manager detection,
 * and dismissed version tracking. Never blocks startup with network calls —
 * uses cached values for display and checks in the background.
 *
 * Cache file: ~/.proletariat/version-check.json
 * Schema:
 * {
 *   "latest_version": "0.3.53",
 *   "last_checked_at": "2024-01-01T00:00:00.000Z",
 *   "dismissed_version": "0.3.53" | null
 * }
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { execSync } from 'node:child_process'
import { getMachineConfigDir, ensureMachineConfigDir } from './machine-config.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VersionCheckCache {
  latest_version: string | null
  last_checked_at: string | null
  dismissed_version: string | null
}

export type PackageManager = 'brew' | 'npm' | 'standalone'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum hours between version checks */
const CHECK_INTERVAL_HOURS = 4

/** npm package name for registry lookup */
const NPM_PACKAGE_NAME = '@proletariat/cli'

/** Homebrew Cask API URL for formula lookup */
const BREW_FORMULA_API = 'https://formulae.brew.sh/api/formula/chrismcdermut/proletariat/prlt.json'

/** Environment variable override for package manager (like Codex's CODEX_MANAGED_BY_NPM) */
const PACKAGE_MANAGER_ENV = 'PRLT_MANAGED_BY'

// ---------------------------------------------------------------------------
// Cache file management
// ---------------------------------------------------------------------------

function getCachePath(): string {
  return path.join(getMachineConfigDir(), 'version-check.json')
}

function getDefaultCache(): VersionCheckCache {
  return {
    latest_version: null,
    last_checked_at: null,
    dismissed_version: null,
  }
}

export function readCache(): VersionCheckCache {
  const cachePath = getCachePath()
  if (!fs.existsSync(cachePath)) {
    return getDefaultCache()
  }

  try {
    const content = fs.readFileSync(cachePath, 'utf-8')
    const parsed = JSON.parse(content) as Partial<VersionCheckCache>
    return {
      latest_version: parsed.latest_version ?? null,
      last_checked_at: parsed.last_checked_at ?? null,
      dismissed_version: parsed.dismissed_version ?? null,
    }
  } catch {
    return getDefaultCache()
  }
}

export function writeCache(cache: VersionCheckCache): void {
  ensureMachineConfigDir()
  const cachePath = getCachePath()
  const tempPath = `${cachePath}.tmp.${process.pid}`

  try {
    fs.writeFileSync(tempPath, JSON.stringify(cache, null, 2), 'utf-8')
    fs.renameSync(tempPath, cachePath)
  } catch {
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath)
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}

// ---------------------------------------------------------------------------
// Check timing
// ---------------------------------------------------------------------------

/**
 * Returns true if enough time has elapsed since the last check,
 * or if the cache is stale because the installed version is newer
 * than the cached "latest" version.
 */
export function shouldCheck(cache: VersionCheckCache, currentVersion?: string): boolean {
  if (!cache.last_checked_at) {
    return true
  }

  // If the installed version is newer than what's cached as "latest",
  // the cache is stale — a newer version was published and the user
  // already has it (or the cache recorded an outdated value).
  if (currentVersion && cache.latest_version && isNewerVersion(cache.latest_version, currentVersion)) {
    return true
  }

  const lastChecked = new Date(cache.last_checked_at).getTime()
  if (Number.isNaN(lastChecked)) {
    return true
  }

  const hoursElapsed = (Date.now() - lastChecked) / (1000 * 60 * 60)
  return hoursElapsed >= CHECK_INTERVAL_HOURS
}

// ---------------------------------------------------------------------------
// Package manager detection
// ---------------------------------------------------------------------------

/**
 * Detect how prlt was installed.
 *
 * Priority:
 * 1. PRLT_MANAGED_BY env var (explicit override)
 * 2. Standalone install metadata file (~/.local/lib/proletariat/.install-metadata.json)
 * 3. Binary path heuristic (Homebrew prefixes → brew, ~/.local/bin → standalone, otherwise npm)
 */
export function detectPackageManager(): PackageManager {
  // 1. Env var override
  const envOverride = process.env[PACKAGE_MANAGER_ENV]?.toLowerCase()
  if (envOverride === 'brew' || envOverride === 'homebrew') return 'brew'
  if (envOverride === 'npm') return 'npm'
  if (envOverride === 'standalone') return 'standalone'

  // 2. Binary path heuristic
  try {
    const binPath = execSync('which prlt', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 3000,
    }).trim()

    if (binPath.startsWith('/opt/homebrew/') || binPath.startsWith('/usr/local/')) {
      return 'brew'
    }

    // Standalone installer uses ~/.local/bin or custom PRLT_INSTALL_DIR
    const homeDir = process.env.HOME || ''
    if (homeDir && binPath.startsWith(path.join(homeDir, '.local'))) {
      return 'standalone'
    }
  } catch {
    // which failed — fall through
  }

  // 3. Check for standalone install metadata file
  const homeDir = process.env.HOME || ''
  if (homeDir) {
    const metadataPath = path.join(homeDir, '.local', 'lib', 'proletariat', '.install-metadata.json')
    if (fs.existsSync(metadataPath)) {
      return 'standalone'
    }
  }

  return 'npm'
}

/**
 * Get the update command string for the detected package manager.
 */
export function getUpdateCommand(pm: PackageManager): string {
  if (pm === 'brew') {
    return 'brew upgrade chrismcdermut/proletariat/prlt'
  }
  if (pm === 'standalone') {
    return 'prlt update'
  }
  return 'npm install -g @proletariat/cli'
}

/**
 * Get the standalone install directory from metadata or default.
 * Returns null if not a standalone install.
 */
export function getStandaloneInstallDir(): string | null {
  const homeDir = process.env.HOME || ''
  if (!homeDir) return null

  const metadataPath = path.join(homeDir, '.local', 'lib', 'proletariat', '.install-metadata.json')
  try {
    if (fs.existsSync(metadataPath)) {
      const content = fs.readFileSync(metadataPath, 'utf-8')
      const metadata = JSON.parse(content) as { install_dir?: string }
      return metadata.install_dir ?? path.join(homeDir, '.local')
    }
  } catch {
    // ignore
  }

  return path.join(homeDir, '.local')
}

// ---------------------------------------------------------------------------
// Stale Homebrew tap detection
// ---------------------------------------------------------------------------

/** The Homebrew tap that hosts the prlt formula */
const HOMEBREW_TAP = 'chrismcdermut/homebrew-proletariat'

/**
 * Resolve the local filesystem path for the Homebrew tap.
 * Returns null if the tap directory doesn't exist.
 */
export function getBrewTapPath(): string | null {
  const prefixes = ['/opt/homebrew/Library/Taps', '/usr/local/Homebrew/Library/Taps']
  for (const prefix of prefixes) {
    const tapDir = path.join(prefix, HOMEBREW_TAP)
    if (fs.existsSync(tapDir)) {
      return tapDir
    }
  }
  return null
}

export interface StaleTapResult {
  /** Whether the tap is stale (local HEAD behind origin/main) */
  isStale: boolean
  /** Local HEAD commit hash (short) */
  localHead?: string
  /** Remote HEAD commit hash (short) */
  remoteHead?: string
}

/**
 * Check whether the local Homebrew tap checkout is behind origin/main.
 *
 * Runs a quick `git fetch --dry-run` to update remote refs, then compares
 * local HEAD against origin/main. Returns { isStale: false } for any error
 * or when the tap is not installed (non-brew installs).
 */
export function checkStaleTap(tapPath?: string | null): StaleTapResult {
  const resolvedPath = tapPath ?? getBrewTapPath()
  if (!resolvedPath) {
    return { isStale: false }
  }

  try {
    // Fetch latest remote refs (quick, no data transfer for up-to-date repos)
    execSync('git fetch origin --quiet', {
      cwd: resolvedPath,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10_000,
    })

    const localHead = execSync('git rev-parse --short HEAD', {
      cwd: resolvedPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 3000,
    }).trim()

    const remoteHead = execSync('git rev-parse --short origin/main', {
      cwd: resolvedPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 3000,
    }).trim()

    if (localHead !== remoteHead) {
      return { isStale: true, localHead, remoteHead }
    }

    return { isStale: false, localHead, remoteHead }
  } catch {
    // Any git error → treat as non-stale (don't block user)
    return { isStale: false }
  }
}

/**
 * Get the remediation commands for a stale Homebrew tap.
 */
export function getStaleTapCommands(): string[] {
  return [
    `brew tap --force chrismcdermut/proletariat`,
    `brew upgrade chrismcdermut/proletariat/prlt`,
  ]
}

// ---------------------------------------------------------------------------
// Version fetching
// ---------------------------------------------------------------------------

/**
 * Fetch the latest version from the Homebrew Formulae API.
 * Returns null on any error.
 */
async function fetchBrewVersion(): Promise<string | null> {
  try {
    const response = await fetch(BREW_FORMULA_API, {
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) return null

    const data = await response.json() as { versions?: { stable?: string } }
    return data?.versions?.stable ?? null
  } catch {
    return null
  }
}

/**
 * Fetch the latest version from the npm registry.
 * Returns null on any error.
 */
async function fetchNpmVersion(): Promise<string | null> {
  try {
    const url = `https://registry.npmjs.org/${NPM_PACKAGE_NAME}/latest`
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) return null

    const data = await response.json() as { version?: string }
    return data?.version ?? null
  } catch {
    return null
  }
}

/**
 * Fetch the latest version using the appropriate source for the package manager.
 * For brew installs, uses the Homebrew API (avoids false positives from npm).
 * Falls back to npm registry if brew API fails.
 */
export async function fetchLatestVersion(pm: PackageManager): Promise<string | null> {
  if (pm === 'brew') {
    const brewVersion = await fetchBrewVersion()
    if (brewVersion) return brewVersion
    // Fall back to npm if brew API unavailable
  }

  return fetchNpmVersion()
}

// ---------------------------------------------------------------------------
// Version comparison
// ---------------------------------------------------------------------------

/**
 * Compare two semver-like version strings.
 * Returns true if `latest` is newer than `current`.
 */
export function isNewerVersion(current: string, latest: string): boolean {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number)
  const c = parse(current)
  const l = parse(latest)

  for (let i = 0; i < Math.max(c.length, l.length); i++) {
    const cv = c[i] ?? 0
    const lv = l[i] ?? 0
    if (lv > cv) return true
    if (lv < cv) return false
  }

  return false
}

// ---------------------------------------------------------------------------
// npm ENOTEMPTY workaround
// ---------------------------------------------------------------------------

/**
 * Get the npm global node_modules directory.
 * Returns null if it cannot be determined.
 */
export function getNpmGlobalModulesDir(): string | null {
  try {
    const prefix = execSync('npm prefix -g', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10_000,
    }).trim()
    return path.join(prefix, 'lib', 'node_modules')
  } catch {
    return null
  }
}

/**
 * Remove the existing @proletariat/cli directory from npm global node_modules.
 * This prevents ENOTEMPTY errors during `npm install -g`, which is a known npm
 * bug where renaming the old package directory fails.
 *
 * Safe to call even if the directory doesn't exist.
 */
export function cleanNpmPackageDir(): boolean {
  const modulesDir = getNpmGlobalModulesDir()
  if (!modulesDir) return false

  const packageDir = path.join(modulesDir, '@proletariat', 'cli')
  try {
    if (fs.existsSync(packageDir)) {
      fs.rmSync(packageDir, { recursive: true, force: true })
    }
    return true
  } catch {
    return false
  }
}

/**
 * Run an npm global install command with automatic ENOTEMPTY retry.
 *
 * npm global installs frequently fail with ENOTEMPTY when renaming the
 * old package directory (a known npm bug). When this error is detected
 * in stderr, the old package directory is removed and the install is
 * retried transparently.
 *
 * Throws on failure (both non-ENOTEMPTY errors and failed retries).
 */
export function runNpmInstallWithRetry(command: string): void {
  try {
    execSync(command, {
      stdio: ['inherit', 'inherit', 'pipe'],
      timeout: 120_000,
    })
  } catch (error: unknown) {
    const stderr = (error as { stderr?: Buffer })?.stderr?.toString() ?? ''

    if (!stderr.includes('ENOTEMPTY')) {
      // Not an ENOTEMPTY error — re-throw with stderr attached
      if (stderr) {
        process.stderr.write(stderr)
      }
      throw error
    }

    // ENOTEMPTY detected — clean the old directory and retry
    console.log('')
    console.log('npm encountered ENOTEMPTY error (known npm bug). Cleaning up and retrying…')

    if (!cleanNpmPackageDir()) {
      console.error('Could not clean the existing package directory.')
      if (stderr) {
        process.stderr.write(stderr)
      }
      throw error
    }

    // Retry with full stdio inherited
    execSync(command, {
      stdio: 'inherit',
      timeout: 120_000,
    })
  }
}

// ---------------------------------------------------------------------------
// Pending check tracking
// ---------------------------------------------------------------------------

/** Module-level promise tracking so the check can be flushed before exit. */
let pendingCheck: Promise<void> | null = null

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface UpdateInfo {
  /** Whether an update is available (and not dismissed) */
  updateAvailable: boolean
  /** The current CLI version */
  currentVersion: string
  /** The latest available version (from cache) */
  latestVersion: string | null
  /** Detected package manager */
  packageManager: PackageManager
  /** The command to run the update */
  updateCommand: string
  /** Whether the Homebrew tap is stale (only set for brew installs) */
  staleTap?: StaleTapResult
}

/**
 * Check if an update is available using cached data only (synchronous, never blocks).
 * Returns update info if an update is available and not dismissed.
 */
export function getCachedUpdateInfo(currentVersion: string): UpdateInfo {
  const cache = readCache()
  const pm = detectPackageManager()
  const updateCommand = getUpdateCommand(pm)

  const latestVersion = cache.latest_version
  const updateAvailable =
    latestVersion !== null &&
    isNewerVersion(currentVersion, latestVersion) &&
    cache.dismissed_version !== latestVersion

  // Check for stale Homebrew tap when using brew and an update is expected
  const staleTap = pm === 'brew' ? checkStaleTap() : undefined

  return {
    updateAvailable,
    currentVersion,
    latestVersion,
    packageManager: pm,
    updateCommand,
    staleTap,
  }
}

/**
 * Perform a background version check and update the cache.
 * The fetch runs without blocking startup, but the promise is tracked
 * internally so it can be flushed before process exit via
 * {@link flushPendingVersionCheck}.
 *
 * When `currentVersion` is provided, forces a re-check if the installed
 * version is newer than the cached "latest" (stale cache detection).
 */
export function triggerBackgroundCheck(pm: PackageManager, currentVersion?: string): void {
  const cache = readCache()

  if (!shouldCheck(cache, currentVersion)) {
    return
  }

  pendingCheck = fetchLatestVersion(pm)
    .then((latest) => {
      if (latest) {
        const updatedCache = readCache() // Re-read to avoid races
        updatedCache.latest_version = latest
        updatedCache.last_checked_at = new Date().toISOString()
        writeCache(updatedCache)
      }
    })
    .catch(() => {
      // Silently ignore — never fail startup due to version check
    })
    .finally(() => {
      pendingCheck = null
    })
}

/**
 * Await the in-flight background version check (if any) so the result
 * is written to disk before the process exits.  Called from the postrun
 * hook — mirrors the flush pattern used by analytics and Sentry.
 *
 * No-op when no check is pending (the common case).
 */
export async function flushPendingVersionCheck(): Promise<void> {
  if (pendingCheck) {
    await pendingCheck
  }
}

/**
 * Dismiss updates for a specific version. The prompt won't show again
 * until a newer version is available.
 */
export function dismissVersion(version: string): void {
  const cache = readCache()
  cache.dismissed_version = version
  writeCache(cache)
}

/**
 * Dismiss updates for the current session only (no persistence).
 * This is the default "Skip" behavior — just don't persist anything.
 */
export function dismissSession(): void {
  // No-op — the prompt simply won't show again until next startup
}
