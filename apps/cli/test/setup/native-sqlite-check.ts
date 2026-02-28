import { execSync } from 'node:child_process'
import { validateBetterSqlite3NativeBinding } from '../../src/lib/database/native-validation.js'

async function ensureNativeSqliteBinding(): Promise<void> {
  try {
    await validateBetterSqlite3NativeBinding({ context: 'mocha startup' })
    return
  } catch (firstError) {
    if (process.env.PRLT_SKIP_SQLITE_AUTO_REBUILD === '1') {
      throw firstError
    }
  }

  console.warn('[prlt:test] better-sqlite3 failed to load. Attempting automatic rebuild...')

  try {
    execSync('npm rebuild better-sqlite3', { stdio: 'inherit' })
  } catch {
    // Let the follow-up validation produce the actionable error message.
  }

  await validateBetterSqlite3NativeBinding({ context: 'mocha startup after npm rebuild better-sqlite3' })
}

await ensureNativeSqliteBinding()
