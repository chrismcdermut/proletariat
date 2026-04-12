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
// npm ENOTEMPTY workaround (PRLT-1228, PRLT-1276)
// ---------------------------------------------------------------------------

/**
 * Environment variable override for the npm global `lib/node_modules` path.
 * Tests set this to a temp directory so retry logic can be exercised without
 * clobbering the user's real globally installed prlt package.
 */
const NPM_MODULES_DIR_OVERRIDE_ENV = 'PRLT_NPM_MODULES_DIR_OVERRIDE'

/**
 * Get the npm global node_modules directory.
 * Returns null if it cannot be determined.
 *
 * Honours the `PRLT_NPM_MODULES_DIR_OVERRIDE` env var for tests so the
 * backup/restore logic in {@link runNpmInstallWithRetry} can be exercised
 * against a temp directory instead of the user's real npm prefix.
 */
export function getNpmGlobalModulesDir(): string | null {
  const override = process.env[NPM_MODULES_DIR_OVERRIDE_ENV]
  if (override) {
    return override
  }

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
 * Captured state of a bin symlink — used so we can restore the symlink
 * if npm removed it during a failed retry install (PRLT-1276).
 */
interface BinSymlinkRecord {
  /** Absolute path to the bin entry (e.g. `<prefix>/bin/prlt`) */
  path: string
  /** Original link target, as returned by `readlink` (may be relative) */
  target: string
}

/**
 * State captured before we disturb the current @proletariat/cli install,
 * so it can be restored if the retry install fails.
 */
export interface NpmPackageBackup {
  /** Absolute path to the original package directory */
  originalPath: string
  /**
   * Absolute path to the backup (rename-aside) location.
   * Empty string when there was nothing to back up (package dir did not exist).
   */
  backupPath: string
  /** Bin symlinks that existed before the backup was taken */
  binSymlinks: BinSymlinkRecord[]
}

/**
 * Return the `<npm_prefix>/bin` directory for the given
 * `<npm_prefix>/lib/node_modules` path.
 */
function getNpmGlobalBinDir(modulesDir: string): string {
  // modulesDir is .../<prefix>/lib/node_modules → ../.. = <prefix>
  return path.join(modulesDir, '..', '..', 'bin')
}

/**
 * Record all known prlt bin symlinks so we can restore them if npm removes
 * them during a failed install. Only entries that are actual symbolic links
 * are recorded — regular files (Windows .cmd shims) are managed by npm and
 * left untouched.
 */
function captureBinSymlinks(modulesDir: string): BinSymlinkRecord[] {
  const binDir = getNpmGlobalBinDir(modulesDir)
  const records: BinSymlinkRecord[] = []

  for (const name of ['prlt', 'prltdev']) {
    const binPath = path.join(binDir, name)
    try {
      const stat = fs.lstatSync(binPath)
      if (stat.isSymbolicLink()) {
        const target = fs.readlinkSync(binPath)
        records.push({ path: binPath, target })
      }
    } catch {
      // Missing / inaccessible — nothing to capture
    }
  }

  return records
}

/**
 * Back up the existing @proletariat/cli package directory via atomic rename
 * so an install retry can run against a clean slate while preserving the
 * ability to restore the previous installation if the retry fails.
 *
 * The backup is placed adjacent to the original in the same directory, so
 * the rename is guaranteed to be atomic. Returns null if the rename fails
 * (e.g. permission error) — in that case the caller must not proceed,
 * because destroying the package dir without a backup is exactly the
 * PRLT-1276 regression we are trying to avoid.
 *
 * When there is no existing package dir to back up, this still returns a
 * valid `NpmPackageBackup` with an empty `backupPath` — the bin symlink
 * records are still captured so they can be restored on failure.
 */
export function backupNpmPackageDir(): NpmPackageBackup | null {
  const modulesDir = getNpmGlobalModulesDir()
  if (!modulesDir) return null

  const originalPath = path.join(modulesDir, '@proletariat', 'cli')
  const binSymlinks = captureBinSymlinks(modulesDir)

  if (!fs.existsSync(originalPath)) {
    return { originalPath, backupPath: '', binSymlinks }
  }

  // Timestamped + PID-tagged to avoid collisions with any leftover backup
  // from a prior aborted retry.
  const backupPath = `${originalPath}.prlt-backup-${Date.now()}-${process.pid}`
  try {
    fs.renameSync(originalPath, backupPath)
    return { originalPath, backupPath, binSymlinks }
  } catch {
    return null
  }
}

/**
 * Restore the backup created by {@link backupNpmPackageDir} after a failed
 * retry. Removes any partially-installed content at the original path,
 * renames the backup back into place, and re-creates bin symlinks that npm
 * may have removed during the failed install.
 */
export function restoreNpmPackageBackup(info: NpmPackageBackup): boolean {
  try {
    if (info.backupPath) {
      // Clear out any partial install from the failed retry
      if (fs.existsSync(info.originalPath)) {
        fs.rmSync(info.originalPath, { recursive: true, force: true })
      }
      fs.renameSync(info.backupPath, info.originalPath)
    }

    // Restore any bin symlinks that npm removed during the failed install.
    // The captured target is used verbatim so relative symlinks stay relative.
    for (const { path: binPath, target } of info.binSymlinks) {
      let needsRestore = false
      try {
        fs.lstatSync(binPath)
        // Symlink still present — leave it alone
      } catch {
        needsRestore = true
      }

      if (needsRestore) {
        try {
          fs.symlinkSync(target, binPath)
        } catch {
          // Best effort — a missing symlink is better than crashing
        }
      }
    }

    return true
  } catch {
    return false
  }
}

/**
 * Remove the backup created by {@link backupNpmPackageDir} after a
 * successful retry. Best-effort — failures are not fatal.
 */
export function discardNpmPackageBackup(info: NpmPackageBackup): void {
  if (!info.backupPath) return
  try {
    fs.rmSync(info.backupPath, { recursive: true, force: true })
  } catch {
    // Best effort
  }
}

/**
 * Run an npm global install command with automatic ENOTEMPTY retry.
 *
 * npm global installs frequently fail with ENOTEMPTY when renaming the
 * old package directory (a known npm bug). When this error is detected
 * in stderr, the existing @proletariat/cli directory is moved aside via
 * an atomic rename, the install is retried against a clean slate, and
 * the backup is either discarded (on success) or restored (on failure).
 *
 * PRLT-1276: this is the restore-on-failure path that fixes the "prlt
 * intermittently disappears from PATH" bug. Previously we `rm -rf`'d the
 * package directory before retrying, so a retry that failed for any reason
 * (network glitch, timeout, nvm mid-switch) left the user with a deleted
 * package and a dangling `bin/prlt` symlink.
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

    // ENOTEMPTY detected — move the old install aside and retry against a
    // clean slate. If the retry fails, restore the backup so prlt keeps
    // working. This is the PRLT-1276 fix.
    console.log('')
    console.log('npm encountered ENOTEMPTY error (known npm bug). Cleaning up and retrying…')

    const backup = backupNpmPackageDir()
    if (!backup) {
      console.error(
        'Could not prepare retry (failed to move the existing package directory aside). ' +
        'Leaving the current installation in place.',
      )
      if (stderr) {
        process.stderr.write(stderr)
      }
      throw error
    }

    try {
      // Retry with full stdio inherited
      execSync(command, {
        stdio: 'inherit',
        timeout: 120_000,
      })
      // Retry succeeded — discard the backup
      discardNpmPackageBackup(backup)
    } catch (retryError) {
      // Retry failed — restore the previous installation so prlt still works.
      console.error('')
      console.error('Update failed. Restoring previous installation so prlt keeps working…')
      if (restoreNpmPackageBackup(backup)) {
        console.error('Previous installation restored. Try the update again later:')
        console.error(`  ${command}`)
      } else {
        console.error(
          'Could not restore the previous installation automatically. ' +
          'Reinstall prlt manually:',
        )
        console.error(`  ${command}`)
      }
      throw retryError
    }
  }
}

// ---------------------------------------------------------------------------
// Binary integrity guard (PRLT-1276)
// ---------------------------------------------------------------------------

/**
 * Result of a binary integrity check.
 */
export interface BinaryIntegrityResult {
  /** Whether the prlt binary is healthy (exists and resolves) */
  healthy: boolean
  /** Path to the bin symlink that was checked (null if npm prefix unknown) */
  binPath: string | null
  /** True if the binary was restored from a stale backup */
  restoredFromBackup: boolean
  /** Number of stale backups cleaned up */
  staleBackupsCleaned: number
  /** Diagnostic message (present when unhealthy or restored) */
  message?: string
}

/**
 * Check whether the prlt binary symlink is intact and, if not, attempt
 * self-healing from any leftover `.prlt-backup-*` directory.
 *
 * This catches the PRLT-1276 scenario where a concurrent or interrupted
 * `npm install -g` left the package directory deleted and the bin symlink
 * dangling. If a backup from a previous {@link runNpmInstallWithRetry}
 * exists, the function restores it automatically.
 *
 * Also cleans up stale backups that may have accumulated from prior
 * aborted retries.
 *
 * Safe to call on every startup — returns quickly when everything is fine.
 */
export function checkBinaryIntegrity(): BinaryIntegrityResult {
  const modulesDir = getNpmGlobalModulesDir()
  if (!modulesDir) {
    return { healthy: true, binPath: null, restoredFromBackup: false, staleBackupsCleaned: 0 }
  }

  const binDir = getNpmGlobalBinDir(modulesDir)
  const binPath = path.join(binDir, 'prlt')
  const packageDir = path.join(modulesDir, '@proletariat', 'cli')

  // Check if the binary exists and resolves (not dangling)
  let binExists = false
  let binResolves = false
  try {
    const stat = fs.lstatSync(binPath)
    binExists = stat.isSymbolicLink() || stat.isFile()
    if (binExists) {
      // fs.existsSync follows symlinks — returns false for dangling
      binResolves = fs.existsSync(binPath)
    }
  } catch {
    // Binary doesn't exist at all
  }

  if (binExists && binResolves) {
    // Binary is healthy — clean up any stale backups from prior aborted retries
    const staleBackupsCleaned = cleanStaleBackups(modulesDir)
    return { healthy: true, binPath, restoredFromBackup: false, staleBackupsCleaned }
  }

  // Binary is missing or dangling — try to restore from a backup first
  const proletariatDir = path.join(modulesDir, '@proletariat')
  let restoredFromBackup = false
  let staleBackupsCleaned = 0

  try {
    if (fs.existsSync(proletariatDir)) {
      const entries = fs.readdirSync(proletariatDir)
      const backupDirs = entries
        .filter(e => e.startsWith('cli.prlt-backup-'))
        .sort()
        .reverse() // Most recent first

      if (backupDirs.length > 0) {
        const backupPath = path.join(proletariatDir, backupDirs[0])

        // Capture existing bin symlinks for restore
        const binSymlinks = captureBinSymlinks(modulesDir)

        const backup: NpmPackageBackup = {
          originalPath: packageDir,
          backupPath,
          binSymlinks,
        }

        if (restoreNpmPackageBackup(backup)) {
          restoredFromBackup = true
          // Clean remaining stale backups (the one we restored from was
          // already renamed back by restoreNpmPackageBackup)
          for (let i = 1; i < backupDirs.length; i++) {
            try {
              fs.rmSync(path.join(proletariatDir, backupDirs[i]), { recursive: true, force: true })
              staleBackupsCleaned++
            } catch {
              // Best effort
            }
          }
        }
      }
    }
  } catch {
    // Best effort — don't crash the CLI
  }

  if (restoredFromBackup) {
    const msg = `[PRLT-1276] prlt binary was missing at ${binPath}. Restored from backup automatically.`
    return {
      healthy: true,
      binPath,
      restoredFromBackup: true,
      staleBackupsCleaned,
      message: msg,
    }
  }

  // Could not self-heal — clean up any stale backups that couldn't be used
  staleBackupsCleaned = cleanStaleBackups(modulesDir)

  const msg =
    `[PRLT-1276] prlt binary is missing or broken at ${binPath}. ` +
    `Package dir exists: ${fs.existsSync(packageDir)}. ` +
    `Reinstall with: npm install -g @proletariat/cli`
  return {
    healthy: false,
    binPath,
    restoredFromBackup: false,
    staleBackupsCleaned,
    message: msg,
  }
}

/**
 * Remove stale `.prlt-backup-*` directories from `<modulesDir>/@proletariat/`.
 *
 * These accumulate when {@link runNpmInstallWithRetry} creates a backup but
 * the process exits before cleanup runs (e.g., SIGKILL, power loss, OOM).
 *
 * Returns the number of directories removed.
 */
export function cleanStaleBackups(modulesDir?: string | null): number {
  const dir = modulesDir ?? getNpmGlobalModulesDir()
  if (!dir) return 0

  const proletariatDir = path.join(dir, '@proletariat')
  let cleaned = 0

  try {
    if (!fs.existsSync(proletariatDir)) return 0

    const entries = fs.readdirSync(proletariatDir)
    for (const entry of entries) {
      if (entry.startsWith('cli.prlt-backup-')) {
        try {
          fs.rmSync(path.join(proletariatDir, entry), { recursive: true, force: true })
          cleaned++
        } catch {
          // Best effort
        }
      }
    }
  } catch {
    // Best effort — never crash
  }

  return cleaned
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
