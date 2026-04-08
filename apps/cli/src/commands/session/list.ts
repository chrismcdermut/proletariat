import { Flags } from '@oclif/core'
import { styles } from '../../lib/styles.js'
import { PromptCommand } from '../../lib/prompt-command.js'
import { machineOutputFlags } from '../../lib/pmo/index.js'
import { shouldOutputJson } from '../../lib/prompt-json.js'
import { visualPadEnd } from '../../lib/string-utils.js'
import {
  collectAllSessions,
  groupSessionsByHQ,
  bucketElsewhereByHq,
  formatRelativeAge,
  tildifyPath,
  type SessionRole,
  type UnifiedSession,
} from '../../lib/session/renderer.js'
import { findHQRoot } from '../../lib/workspace.js'

export default class SessionList extends PromptCommand {
  static description =
    'List active agent sessions across the entire machine, grouped by current HQ vs other locations.'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --here',
    '<%= config.bin %> <%= command.id %> --hq ~/Projects/backend-hq',
    '<%= config.bin %> <%= command.id %> --role orchestrator',
    '<%= config.bin %> <%= command.id %> --all',
  ]

  static flags = {
    ...machineOutputFlags,
    here: Flags.boolean({
      description: 'Filter to sessions in the current HQ only',
      default: false,
      exclusive: ['hq'],
    }),
    hq: Flags.string({
      description: 'Filter to sessions in a specific HQ path',
      exclusive: ['here'],
    }),
    role: Flags.string({
      description: 'Filter by session role',
      options: ['orchestrator', 'worker', 'headless'],
    }),
    all: Flags.boolean({
      char: 'a',
      description: 'Include stopped/completed sessions (default excludes them)',
      default: false,
    }),
    grouped: Flags.boolean({
      description:
        'In --json mode, emit the grouped { sessions, grouped } object instead of the flat array',
      default: false,
    }),
  }

  protected getPMOOptions() {
    return { promptIfMultiple: false }
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(SessionList)
    const jsonMode = shouldOutputJson(flags)

    // Resolve HQ filter
    let hqPathFilter: string | undefined
    if (flags.here) {
      const cwdHq = findHQRoot(process.cwd())
      if (!cwdHq) {
        if (jsonMode) {
          // Backward-compat: emit a flat (empty) array unless --grouped was requested.
          if (flags.grouped) {
            this.log(
              JSON.stringify(
                { sessions: [], grouped: { current_hq: null, here: [], elsewhere: [] } },
                null,
                2,
              ),
            )
          } else {
            this.log('[]')
          }
          return
        }
        this.log('')
        this.log(styles.warning('--here requires being inside an HQ workspace.'))
        this.log('')
        return
      }
      hqPathFilter = cwdHq
    } else if (flags.hq) {
      hqPathFilter = flags.hq
    }

    // Always query machine-wide; filters are applied inside collectAllSessions.
    const sessions = collectAllSessions({
      hqPathFilter,
      roleFilter: flags.role as SessionRole | undefined,
      includeAll: flags.all,
    })

    const grouped = groupSessionsByHQ(sessions)

    if (jsonMode) {
      // Default shape is a flat array for backward compatibility with
      // existing agents and e2e tests. Pass --grouped to get the new
      // { sessions, grouped: { current_hq, here, elsewhere } } shape.
      if (flags.grouped) {
        this.log(
          JSON.stringify(
            {
              sessions: sessions.map(toJsonSession),
              grouped: {
                current_hq: grouped.currentHq ? tildifyPath(grouped.currentHq) : null,
                here: grouped.here.map(toJsonSession),
                elsewhere: grouped.elsewhere.map(toJsonSession),
              },
            },
            null,
            2,
          ),
        )
      } else {
        this.log(JSON.stringify(sessions.map(toJsonSession), null, 2))
      }
      return
    }

    if (sessions.length === 0) {
      this.log('')
      this.log(styles.muted('No active sessions found on this machine.'))
      this.log('')
      this.log(styles.muted('Start work with: prlt work start <ticket-id>'))
      this.log(styles.muted('Or ticketless:   prlt work run --prompt "your task"'))
      this.log('')
      return
    }

    this.log('')

    // Render "Current HQ" section
    if (grouped.currentHq) {
      const label = `Current HQ: ${tildifyPath(grouped.currentHq)} (${grouped.here.length} session${grouped.here.length === 1 ? '' : 's'})`
      this.log(styles.header(label))
      if (grouped.here.length === 0) {
        this.log(styles.muted('  (none)'))
      } else {
        renderSessionRows(this.log.bind(this), grouped.here)
      }
      this.log('')
    }

    // Render "Other locations" section
    if (grouped.elsewhere.length > 0) {
      this.log(
        styles.muted(
          `Other locations (${grouped.elsewhere.length} session${grouped.elsewhere.length === 1 ? '' : 's'})`,
        ),
      )
      const buckets = bucketElsewhereByHq(grouped.elsewhere)
      for (const bucket of buckets) {
        const hqLabel = bucket.hqPath ? tildifyPath(bucket.hqPath) : '(no HQ)'
        this.log(styles.muted(`  ${bucket.hqName} — ${hqLabel}`))
        renderSessionRows(this.log.bind(this), bucket.sessions, /* dim */ true)
      }
      this.log('')
    }

    // Stale + died warnings (across all sessions)
    const stale = sessions.filter(s => !s.exists)
    if (stale.length > 0) {
      this.log(
        styles.warning(
          `  ${stale.length} stale session(s) in DB without live runtime.`,
        ),
      )
      this.log(styles.muted('   Run `prlt work stop <work-id>` to clean up.'))
      this.log('')
    }

    const died = sessions.filter(s => s.lifecycleState === 'died')
    if (died.length > 0) {
      this.log(
        styles.error(
          `  ${died.length} agent(s) detected as unresponsive (heartbeat timeout).`,
        ),
      )
      this.log(
        styles.muted(
          '   These agents were auto-terminated. Run `prlt session watch --once` for details.',
        ),
      )
      this.log('')
    }
  }
}

function toJsonSession(s: UnifiedSession): Record<string, unknown> {
  return {
    id: s.id,
    sessionId: s.sessionId,
    ticketId: s.ticketId,
    agentName: s.agentName,
    role: s.role,
    status: s.status,
    environment: s.environment,
    containerId: s.containerId ?? null,
    exists: s.exists,
    source: s.source,
    hqPath: s.hqPath ?? null,
    hqName: s.hqName ?? null,
    repoPath: s.repoPath ?? null,
    startedAt: s.startedAt?.toISOString() ?? null,
    lastHeartbeat: s.lastHeartbeat?.toISOString() ?? null,
    lifecycleState: s.lifecycleState ?? null,
  }
}

function renderSessionRows(
  log: (msg: string) => void,
  sessions: UnifiedSession[],
  dim = false,
): void {
  for (const s of sessions) {
    const statusColor =
      s.status === 'running' || s.status === 'starting'
        ? styles.success
        : s.status === 'idle'
          ? styles.warning
          : s.status === 'stale' || s.status === 'died' || s.status === 'failed'
            ? styles.error
            : styles.muted

    const displayName = truncateName(s.agentName, 16)
    const ticket = truncateName(s.ticketId, 14)
    const age = formatRelativeAge(s.startedAt)

    const row =
      '  ○ ' +
      visualPadEnd(displayName, 18) +
      visualPadEnd(ticket, 16) +
      visualPadEnd(statusColor(s.status), 20) +
      styles.muted(age)

    log(dim ? styles.muted(stripColor(row)) : row)
  }
}

function truncateName(name: string, max: number): string {
  if (!name) return ''
  if (name.length <= max) return name
  return name.slice(0, max - 1) + '…'
}

// chalk strings already include ANSI codes; for the dim "elsewhere" rendering
// we render the row text without inner colors so the dim style applies cleanly.
function stripColor(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1B\[[0-9;]*m/g, '')
}
