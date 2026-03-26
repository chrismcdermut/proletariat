/**
 * Daemon Process
 *
 * This is the background process spawned by `prlt sync start`.
 * It runs a sync cycle on a configurable interval.
 *
 * Args: [hqPath, intervalSeconds]
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { openWorkspaceDatabase } from '../database/index.js'
import { getPMOContext } from '../pmo/pmo-context.js'
import type { ProviderStorage } from '../providers/types.js'
import type { PMOStorage } from '../pmo/types.js'
import { runSyncCycle } from './engine.js'
import { removeDaemonPid, getDaemonLogPath } from './daemon.js'

const args = process.argv.slice(2)
const hqPath = args[0]
const intervalSeconds = parseInt(args[1] || '60', 10)

if (!hqPath) {
  console.error('Usage: daemon-process <hqPath> [intervalSeconds]')
  process.exit(1)
}

const logPath = getDaemonLogPath(hqPath)

function log(msg: string): void {
  const timestamp = new Date().toISOString()
  const line = `[${timestamp}] ${msg}\n`
  fs.appendFileSync(logPath, line)
}

async function getProjectId(): Promise<string> {
  const context = await getPMOContext()
  const projects = await context.storage.listProjects()
  await context.storage.close()

  if (projects.length === 0) {
    throw new Error('No projects found')
  }
  return projects[0].id
}

async function cycle(): Promise<void> {
  let db

  try {
    db = openWorkspaceDatabase(hqPath)
    const context = await getPMOContext()
    const projectId = await getProjectId()

    const report = await runSyncCycle(
      db,
      context.storage as unknown as PMOStorage & ProviderStorage,
      projectId,
      {
        cwd: hqPath,
        log,
      },
    )

    if (report.applied.length > 0) {
      log(`Applied ${report.applied.length} correction(s)`)
    }
    if (report.failed.length > 0) {
      log(`Failed ${report.failed.length} correction(s)`)
    }

    await context.storage.close()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log(`Error: ${msg}`)
  } finally {
    if (db) {
      try { db.close() } catch {}
    }
  }
}

// Signal handling
process.on('SIGTERM', () => {
  log('Received SIGTERM — shutting down')
  removeDaemonPid(hqPath)
  process.exit(0)
})

process.on('SIGINT', () => {
  log('Received SIGINT — shutting down')
  removeDaemonPid(hqPath)
  process.exit(0)
})

// Main loop
log(`Daemon started (PID ${process.pid}, interval ${intervalSeconds}s)`)

async function run(): Promise<void> {
  // Run initial cycle immediately
  await cycle()

  // Then schedule periodic runs
  setInterval(() => {
    cycle().catch(err => {
      log(`Unhandled error in cycle: ${err}`)
    })
  }, intervalSeconds * 1000)
}

run().catch(err => {
  log(`Fatal: ${err}`)
  removeDaemonPid(hqPath)
  process.exit(1)
})
