/**
 * Container environment detection and read-only mode utilities.
 *
 * When running inside an agent container (devcontainer), the HQ directory
 * is typically mounted read-only. The CLI should operate in a degraded
 * mode that avoids writing to HQ paths.
 *
 * Detection signals:
 * - PRLT_AGENT_NAME env var is set (agent is running in a container)
 * - DEVCONTAINER=true env var is set (running inside a devcontainer)
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * Check if the CLI is running inside a container environment.
 *
 * Returns true when PRLT_AGENT_NAME is set or DEVCONTAINER=true,
 * indicating the process is inside an agent container where HQ
 * may be read-only.
 */
export function isContainerEnvironment(): boolean {
  return !!(process.env.PRLT_AGENT_NAME || process.env.DEVCONTAINER === 'true')
}

/**
 * Check if a given path is part of a read-only HQ mount in a container.
 *
 * Returns true only when:
 * 1. We're inside a container (PRLT_AGENT_NAME or DEVCONTAINER=true)
 * 2. PRLT_HQ_PATH is set
 * 3. The given path is at or under PRLT_HQ_PATH
 *
 * This prevents local/test databases from being accidentally treated
 * as read-only while ensuring the mounted HQ database is opened safely.
 */
export function isReadOnlyHQMount(targetPath: string): boolean {
  if (!isContainerEnvironment()) return false

  const hqPath = process.env.PRLT_HQ_PATH
  if (!hqPath) return false

  const normalizedTarget = path.resolve(targetPath)
  const normalizedHQ = path.resolve(hqPath)

  return normalizedTarget === normalizedHQ || normalizedTarget.startsWith(normalizedHQ + '/')
}

/**
 * Attempt to create a directory, logging a warning instead of crashing
 * if the operation fails with a permission error.
 *
 * @param dirPath - Directory path to create
 * @param label  - Human-readable label for warning messages
 * @returns true if directory exists or was created, false if creation failed
 */
export function tryMkdir(dirPath: string, label?: string): boolean {
  if (fs.existsSync(dirPath)) {
    return true
  }

  try {
    fs.mkdirSync(dirPath, { recursive: true })
    return true
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'EACCES' || code === 'EROFS' || code === 'EPERM') {
      const tag = label ? ` (${label})` : ''
      // In container mode this is expected — only warn when not in a container
      if (!isContainerEnvironment()) {
        console.warn(`Warning: Could not create directory${tag}: ${dirPath} (${code})`)
      }
      return false
    }
    throw err
  }
}
