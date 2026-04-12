/**
 * Mocha root hook: workspace DB sandbox (PRLT-1301).
 *
 * Prevents any test from accidentally discovering or modifying the real
 * HQ workspace.db. This is a safety net — similar to npm-sandbox.ts for
 * the global npm prefix.
 *
 * Problem: Agents running in worktrees inside the HQ directory tree can
 * walk up the directory tree and find the real workspace DB at
 * .proletariat/workspace.db. Two critical incidents (PRLT-1284, PRLT-1299)
 * were caused by agent tests running migrations or deleting rows on the
 * live DB.
 *
 * Solution: Create a sandboxed workspace directory with a fresh, schema-only
 * DB and point all workspace resolution at it via PRLT_HQ_PATH + PRLT_TEST_ENV.
 * Agent prlt CLI commands are unaffected (they don't load mocha root hooks).
 *
 * If PRLT_TEST_WORKSPACE_DB is set (by agent startup scripts), the sandbox
 * DB is created at that path. Otherwise a temp path is generated.
 */

import { mkdtempSync, mkdirSync, writeFileSync, existsSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getOrCreateWorkspaceTemplate } from './template-db.js'

const sandboxDir = mkdtempSync(join(tmpdir(), 'prlt-workspace-sandbox-'))
const proletariatDir = join(sandboxDir, '.proletariat')
mkdirSync(proletariatDir, { recursive: true })

// Determine DB path: use agent-provided path or default to sandbox dir
const dbPath = process.env.PRLT_TEST_WORKSPACE_DB || join(proletariatDir, 'workspace.db')

// If using a custom DB path, ensure its parent directory exists
if (process.env.PRLT_TEST_WORKSPACE_DB) {
  const { dirname } = await import('node:path')
  const parentDir = dirname(dbPath)
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true })
  }
}

// Initialize DB with current schema (no data) using the cached template
const templatePath = getOrCreateWorkspaceTemplate()
copyFileSync(templatePath, dbPath)

// Write config.json so isValidHQ() recognizes this as a valid HQ
writeFileSync(
  join(proletariatDir, 'config.json'),
  JSON.stringify({ version: '1.0.0', schemaVersion: 1, type: 'hq' }, null, 2)
)

// Create minimal HQ directory structure (agents dirs needed by some tests)
mkdirSync(join(sandboxDir, 'agents', 'staff'), { recursive: true })
mkdirSync(join(sandboxDir, 'agents', 'temp'), { recursive: true })

// Point workspace resolution at the sandbox
// PRLT_HQ_PATH is only respected when PRLT_TEST_ENV=true (see workspace.ts)
process.env.PRLT_HQ_PATH = sandboxDir
process.env.PRLT_TEST_ENV = 'true'

// Export the sandbox path so tests can verify isolation
process.env.PRLT_TEST_WORKSPACE_DB = dbPath
