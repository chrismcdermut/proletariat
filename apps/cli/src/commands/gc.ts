import { Flags } from '@oclif/core'
import { colors, format } from '../lib/colors.js'
import { PromptCommand } from '../lib/prompt-command.js'
import { machineOutputFlags } from '../lib/pmo/index.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  createMetadata,
} from '../lib/prompt-json.js'
import {
  collectGCCandidates,
  executeGC,
  type GCCandidate,
  type GCArtifactStatus,
} from '../lib/gc/index.js'
import { getWorkspaceInfo } from '../lib/agents/commands.js'

export default class GC extends PromptCommand {
  static description = 'Garbage collect agent artifacts (worktrees, containers, branches) for merged/closed PRs'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --execute',
    '<%= config.bin %> <%= command.id %> --stale-days 14',
    '<%= config.bin %> <%= command.id %> --status merged',
    '<%= config.bin %> <%= command.id %> --execute --json',
  ]

  static flags = {
    ...machineOutputFlags,
    execute: Flags.boolean({
      description: 'Actually execute cleanup (default is dry-run)',
      default: false,
    }),
    'stale-days': Flags.integer({
      description: 'Days of inactivity before a PR is considered stale',
      default: 7,
    }),
    status: Flags.string({
      description: 'Only process candidates with this status',
      options: ['merged', 'closed', 'stale'],
      multiple: true,
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(GC)
    const jsonMode = shouldOutputJson(flags)

    const workspaceInfo = getWorkspaceInfo()
    const execute = flags.execute

    const logLines: string[] = []
    const log = (msg: string): void => {
      logLines.push(msg)
      if (!jsonMode) {
        this.log(colors.textMuted(`  ${msg}`))
      }
    }

    if (!jsonMode) {
      this.log(colors.primary(
        execute ? '\nGarbage collecting agent artifacts...' : '\nGarbage collection dry run (use --execute to apply)...'
      ))
      this.log('')
    }

    // Collect candidates
    const candidates = collectGCCandidates({
      hqPath: workspaceInfo.path,
      staleDays: flags['stale-days'],
      log,
    })

    if (candidates.length === 0) {
      if (jsonMode) {
        outputSuccessAsJson(
          { message: 'No agent worktrees found to process', candidates: [], result: null },
          createMetadata('gc', flags),
        )
      } else {
        this.log(colors.textMuted('No agent worktrees found to process.'))
      }
      return
    }

    // Apply status filter
    const filterStatus = flags.status as GCArtifactStatus[] | undefined

    // Show candidates summary
    const statusCounts = new Map<GCArtifactStatus, number>()
    for (const c of candidates) {
      statusCounts.set(c.status, (statusCounts.get(c.status) ?? 0) + 1)
    }

    if (!jsonMode) {
      this.log(colors.primary(`Found ${candidates.length} worktree(s):`))
      for (const [status, count] of statusCounts) {
        const icon = status === 'merged' ? 'M' : status === 'closed' ? 'C' : status === 'stale' ? 'S' : '-'
        this.log(colors.textMuted(`  [${icon}] ${status}: ${count}`))
      }
      this.log('')
    }

    // Show what will be cleaned
    const actionable = candidates.filter(c => {
      if (filterStatus && filterStatus.length > 0) return filterStatus.includes(c.status)
      return c.status !== 'active'
    })

    if (actionable.length === 0) {
      if (jsonMode) {
        outputSuccessAsJson(
          {
            message: 'No artifacts eligible for cleanup',
            candidates: formatCandidatesForJson(candidates),
            result: null,
          },
          createMetadata('gc', flags),
        )
      } else {
        this.log(colors.textMuted('No artifacts eligible for cleanup (all active).'))
      }
      return
    }

    if (!jsonMode) {
      this.log(colors.primary(`${execute ? 'Cleaning' : 'Would clean'} ${actionable.length} artifact(s):\n`))
      for (const c of actionable) {
        const prLabel = c.pr ? ` (PR #${c.pr.number})` : ' (no PR)'
        this.log(`  ${statusIcon(c.status)} ${c.branch}${prLabel}`)
        this.log(colors.textMuted(`    worktree: ${c.worktreePath}`))
        if (c.container) {
          this.log(colors.textMuted(`    container: ${c.container.containerName}`))
        }
      }
      this.log('')
    }

    // Execute GC
    const result = executeGC(candidates, {
      hqPath: workspaceInfo.path,
      staleDays: flags['stale-days'],
      filterStatus: filterStatus && filterStatus.length > 0 ? filterStatus : undefined,
      execute,
      log,
    })

    // Output results
    if (jsonMode) {
      outputSuccessAsJson(
        {
          message: `${execute ? 'Cleaned' : 'Would clean'} ${actionable.length} artifact(s)`,
          dryRun: !execute,
          candidates: formatCandidatesForJson(candidates),
          result: {
            worktreesRemoved: result.worktreesRemoved.length,
            containersRemoved: result.containersRemoved.length,
            branchesPruned: result.branchesPruned.length,
            stalePRsClosed: result.stalePRsClosed,
            errors: result.errors,
            skipped: result.skipped,
          },
        },
        createMetadata('gc', flags),
      )
      return
    }

    // Summary
    this.log(colors.primary('--- Summary ---'))

    const prefix = execute ? '' : '[dry-run] Would have '
    if (result.worktreesRemoved.length > 0) {
      this.log(format.success(`${prefix}${execute ? 'Removed' : 'remove'} ${result.worktreesRemoved.length} worktree(s)`))
    }
    if (result.containersRemoved.length > 0) {
      this.log(format.success(`${prefix}${execute ? 'Removed' : 'remove'} ${result.containersRemoved.length} container(s)`))
    }
    if (result.branchesPruned.length > 0) {
      this.log(format.success(`${prefix}${execute ? 'Pruned' : 'prune'} ${result.branchesPruned.length} branch(es)`))
    }
    if (result.stalePRsClosed.length > 0) {
      this.log(format.success(`${prefix}${execute ? 'Closed' : 'close'} ${result.stalePRsClosed.length} stale PR(s)`))
    }
    if (result.skipped.length > 0) {
      this.log(colors.textMuted(`Skipped ${result.skipped.length} active artifact(s)`))
    }
    if (result.errors.length > 0) {
      this.log(format.error(`${result.errors.length} error(s):`))
      for (const err of result.errors) {
        this.log(colors.warning(`  - ${err}`))
      }
    }
  }
}

function statusIcon(status: GCArtifactStatus): string {
  switch (status) {
    case 'merged': return 'M'
    case 'closed': return 'C'
    case 'stale': return 'S'
    case 'active': return '-'
  }
}

function formatCandidatesForJson(candidates: GCCandidate[]): Array<{
  branch: string
  status: GCArtifactStatus
  agentName: string | null
  worktreePath: string
  prNumber: number | null
}> {
  return candidates.map(c => ({
    branch: c.branch,
    status: c.status,
    agentName: c.agentName,
    worktreePath: c.worktreePath,
    prNumber: c.pr?.number ?? null,
  }))
}
