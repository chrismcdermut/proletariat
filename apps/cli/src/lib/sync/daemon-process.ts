/**
 * Daemon Process
 *
 * This is the background process spawned by `prlt sync start`.
 * It runs a sync cycle and merge queue cycle on a configurable interval.
 *
 * Args: [hqPath, intervalSeconds]
 */

import * as fs from 'node:fs'
import { openWorkspaceDatabase } from '../database/index.js'
import { getPMOContext } from '../pmo/pmo-context.js'
import type { ProviderStorage } from '../providers/types.js'
import type { PMOStorage } from '../pmo/types.js'
import { runSyncCycle } from './engine.js'
import { runMergeQueueCycle } from './merge-queue.js'
import { removeDaemonPid, getDaemonLogPath } from './daemon.js'
import {
  GCScheduler,
  collectGCCandidates,
  executeGC,
} from '../gc/index.js'

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

// GC scheduler with 1-hour grace period — persists across daemon cycles
const gcScheduler = new GCScheduler(60 * 60 * 1000)

/** Map ticket priority strings to numeric values (lower = higher priority). */
function priorityToNumber(priority: string | undefined | null): number {
  switch (priority) {
    case 'P0': return 0
    case 'P1': return 1
    case 'P2': return 2
    case 'P3': return 3
    default: return 3
  }
}

async function cycle(): Promise<void> {
  let db

  try {
    db = openWorkspaceDatabase(hqPath)
    const context = await getPMOContext()
    const projectId = await getProjectId()
    const storage = context.storage as unknown as PMOStorage & ProviderStorage

    // Phase 1: Reconciliation — sync ticket state with PR state
    const report = await runSyncCycle(
      db,
      storage,
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

    // Phase 2: Merge Queue — sequential rebase-test-merge pipeline
    try {
      // Build priority map from tickets for queue ordering
      const branchPriorities = new Map<string, number>()
      const startedTickets = await storage.listTickets(projectId, { statusCategory: 'started' })
      for (const ticket of startedTickets) {
        if (ticket.branch) {
          branchPriorities.set(ticket.branch, priorityToNumber(ticket.priority))
        }
      }

      const mqResult = runMergeQueueCycle({
        hqPath,
        cwd: hqPath,
        log,
        branchPriorities,
      })

      if (mqResult.action !== 'none' && mqResult.action !== 'paused') {
        log(`Merge queue: ${mqResult.action}${mqResult.prNumber ? ` PR #${mqResult.prNumber}` : ''}${mqResult.reason ? ` — ${mqResult.reason}` : ''}`)
      }
    } catch (mqErr) {
      const mqMsg = mqErr instanceof Error ? mqErr.message : String(mqErr)
      log(`Merge queue error: ${mqMsg}`)
    }

    // Phase 3: Garbage Collection — schedule cleanup for merged PRs, run ready cleanups
    try {
      // Schedule GC for any tickets that just moved to Done (PR merged)
      const mergedActions = report.applied.filter(a => a.type === 'move_to_done')
      if (mergedActions.length > 0) {
        const completedTickets = await storage.listTickets(projectId, { statusCategory: 'completed' })
        for (const action of mergedActions) {
          const ticket = completedTickets.find(t => t.id === action.ticketId)
          if (ticket?.branch) {
            gcScheduler.schedule(ticket.branch)
            log(`GC: Scheduled cleanup for branch ${ticket.branch} (1hr grace period)`)
          }
        }
      }

      // Process any ready cleanups (grace period expired)
      const readyBranches = gcScheduler.getReady()
      if (readyBranches.length > 0) {
        log(`GC: Processing ${readyBranches.length} cleanup(s) past grace period`)

        const candidates = collectGCCandidates({
          hqPath,
          staleDays: 7,
          log,
        })

        // Only clean up the branches that are ready
        const readySet = new Set(readyBranches)
        const readyCandidates = candidates.filter(c => readySet.has(c.branch))

        if (readyCandidates.length > 0) {
          const result = executeGC(readyCandidates, {
            hqPath,
            execute: true,
            log,
          })

          if (result.worktreesRemoved.length > 0) {
            log(`GC: Removed ${result.worktreesRemoved.length} worktree(s), ${result.containersRemoved.length} container(s), ${result.branchesPruned.length} branch(es)`)
          }
          if (result.errors.length > 0) {
            log(`GC: ${result.errors.length} error(s): ${result.errors.join('; ')}`)
          }
        }

        // Mark as completed regardless of whether cleanup was needed
        for (const branch of readyBranches) {
          gcScheduler.complete(branch)
        }
      }
    } catch (gcErr) {
      const gcMsg = gcErr instanceof Error ? gcErr.message : String(gcErr)
      log(`GC error: ${gcMsg}`)
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
