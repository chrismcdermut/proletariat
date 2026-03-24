/**
 * DAL Import Guard — Regression test for PRLT-1104
 *
 * Ensures command files do not bypass the Database Access Layer (DAL) by
 * importing better-sqlite3 directly. All workspace database access should
 * go through lib/database/index.ts so that a driver swap is a one-file change.
 *
 * Allowed exceptions:
 *   - db/repair.ts (diagnostic tool that intentionally opens raw db)
 *   - claude/index.ts, claude/open.ts, qa/index.ts (open non-workspace adhoc.db)
 */
import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Recursively find all .ts files under a directory.
 */
function findTsFiles(dir: string): string[] {
  const results: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...findTsFiles(full))
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      results.push(full)
    }
  }
  return results
}

describe('DAL Import Guard (PRLT-1104)', () => {
  const commandsDir = path.resolve(__dirname, '../../src/commands')

  // Files that legitimately need `import Database from 'better-sqlite3'`
  // because they open non-workspace databases (adhoc.db, temp dbs, raw repair).
  const ALLOWED_VALUE_IMPORTS = new Set([
    'db/repair.ts',       // Opens raw db for integrity checks
    'claude/index.ts',    // Opens adhoc.db for terminal prefs
    'claude/open.ts',     // Opens adhoc.db for terminal prefs
    'qa/index.ts',        // Opens adhoc.db for terminal prefs
  ])

  it('no command file should import Database as a value from better-sqlite3 (except allowed exceptions)', () => {
    const commandFiles = findTsFiles(commandsDir)
    const violations: string[] = []

    for (const filePath of commandFiles) {
      const relativePath = path.relative(commandsDir, filePath)
      if (ALLOWED_VALUE_IMPORTS.has(relativePath)) continue

      const content = fs.readFileSync(filePath, 'utf-8')

      // Match value imports (not type-only imports)
      // `import Database from 'better-sqlite3'` — value import (BAD)
      // `import type Database from 'better-sqlite3'` — type-only import (OK)
      if (/^import\s+Database\s+from\s+['"]better-sqlite3['"]/m.test(content)) {
        violations.push(relativePath)
      }
    }

    expect(violations, [
      'These command files import better-sqlite3 directly instead of using the DAL.',
      'Use openWorkspaceDatabase() from lib/database/index.js instead.',
      'If opening a non-workspace db (adhoc.db), add the file to ALLOWED_VALUE_IMPORTS.',
      '',
      'Violations:',
      ...violations.map(f => `  - ${f}`),
    ].join('\n')).to.be.empty
  })

  it('no command file should construct new Database() for workspace databases', () => {
    const commandFiles = findTsFiles(commandsDir)
    const violations: string[] = []

    for (const filePath of commandFiles) {
      const relativePath = path.relative(commandsDir, filePath)
      if (ALLOWED_VALUE_IMPORTS.has(relativePath)) continue

      const content = fs.readFileSync(filePath, 'utf-8')

      // Check for `new Database(` which indicates direct construction
      if (/new\s+Database\s*\(/.test(content)) {
        violations.push(relativePath)
      }
    }

    expect(violations, [
      'These command files construct Database instances directly.',
      'Use openWorkspaceDatabase() from lib/database/index.js instead.',
      '',
      'Violations:',
      ...violations.map(f => `  - ${f}`),
    ].join('\n')).to.be.empty
  })

  it('command files using workspace databases should import openWorkspaceDatabase from the DAL', () => {
    const commandFiles = findTsFiles(commandsDir)
    const missingDAL: string[] = []

    for (const filePath of commandFiles) {
      const relativePath = path.relative(commandsDir, filePath)
      const content = fs.readFileSync(filePath, 'utf-8')

      // If file has type import of Database but no openWorkspaceDatabase,
      // it might be a file that uses the type but delegates opening elsewhere.
      // Only flag files that have `import type Database from 'better-sqlite3'`
      // AND call db methods but don't import openWorkspaceDatabase.
      // This is a lighter check — just ensure consistency.
      if (
        /^import\s+type\s+Database\s+from\s+['"]better-sqlite3['"]/m.test(content) &&
        !content.includes('openWorkspaceDatabase')
      ) {
        // File uses the Database type but doesn't import the DAL opener.
        // Check if it's execution/config.ts which already uses the DAL.
        if (relativePath !== 'execution/config.ts') {
          missingDAL.push(relativePath)
        }
      }
    }

    expect(missingDAL, [
      'These files use the Database type but do not import openWorkspaceDatabase.',
      'They may be bypassing the DAL.',
      '',
      'Files:',
      ...missingDAL.map(f => `  - ${f}`),
    ].join('\n')).to.be.empty
  })
})
