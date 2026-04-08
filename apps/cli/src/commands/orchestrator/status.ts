import { Flags } from '@oclif/core'
import { PromptCommand } from '../../lib/prompt-command.js'
import { machineOutputFlags } from '../../lib/pmo/index.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'
import { styles } from '../../lib/styles.js'
import { captureTmuxPane } from '../../lib/execution/session-utils.js'
import { execSync } from 'node:child_process'
import {
  collectAllSessions,
  groupSessionsByHQ,
  bucketElsewhereByHq,
  tildifyPath,
  type UnifiedSession,
} from '../../lib/session/renderer.js'
import { findHQRoot } from '../../lib/workspace.js'

export default class OrchestratorStatus extends PromptCommand {
  static description =
    'Check orchestrator sessions across the entire machine, grouped by HQ.'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --here',
    '<%= config.bin %> <%= command.id %> --hq ~/Projects/backend-hq',
    '<%= config.bin %> <%= command.id %> --peek',
    '<%= config.bin %> <%= command.id %> --peek --lines 50',
  ]

  static flags = {
    ...machineOutputFlags,
    name: Flags.string({
      char: 'n',
      description: 'Filter to a single orchestrator by name (matches agentName)',
    }),
    here: Flags.boolean({
      description: 'Filter to orchestrators in the current HQ only',
      default: false,
      exclusive: ['hq'],
    }),
    hq: Flags.string({
      description: 'Filter to orchestrators in a specific HQ path',
      exclusive: ['here'],
    }),
    peek: Flags.boolean({
      description: 'Show recent output from each orchestrator',
      default: false,
    }),
    lines: Flags.integer({
      description: 'Number of lines to show when peeking',
      default: 20,
    }),
  }

  /**
   * Capture tmux pane from inside a Docker container.
   */
  private captureDockerTmuxPane(containerId: string, sessionName: string, lines: number): string | null {
    try {
      return execSync(
        `docker exec ${containerId} tmux capture-pane -t "${sessionName}" -p -S -${lines}`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim() || null
    } catch {
      return null
    }
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(OrchestratorStatus)
    const jsonMode = shouldOutputJson(flags)

    // Resolve HQ filter
    let hqPathFilter: string | undefined
    if (flags.here) {
      const cwdHq = findHQRoot(process.cwd())
      if (cwdHq) hqPathFilter = cwdHq
    } else if (flags.hq) {
      hqPathFilter = flags.hq
    }

    // Always query machine-wide for orchestrator role.
    let orchestrators = collectAllSessions({
      hqPathFilter,
      roleFilter: 'orchestrator',
      includeAll: false,
    })

    // Optional --name filter (substring match against agentName/sessionId)
    if (flags.name) {
      const needle = flags.name.toLowerCase()
      orchestrators = orchestrators.filter(
        s =>
          s.agentName.toLowerCase().includes(needle) ||
          s.sessionId.toLowerCase().includes(needle),
      )
    }

    const grouped = groupSessionsByHQ(orchestrators)

    if (jsonMode) {
      outputSuccessAsJson(
        {
          running: orchestrators.length > 0,
          sessions: orchestrators.map(toJsonOrchestrator),
          grouped: {
            current_hq: grouped.currentHq ? tildifyPath(grouped.currentHq) : null,
            here: grouped.here.map(toJsonOrchestrator),
            elsewhere: grouped.elsewhere.map(toJsonOrchestrator),
          },
        },
        createMetadata('orchestrator status', flags as Record<string, unknown>),
      )
      return
    }

    this.log('')
    if (orchestrators.length === 0) {
      this.log(styles.muted('No orchestrator sessions running.'))
      this.log(styles.muted('Start one with: prlt orchestrator start'))
      this.log('')
      return
    }

    // Render current HQ
    if (grouped.currentHq) {
      this.log(
        styles.header(
          `Current HQ: ${tildifyPath(grouped.currentHq)} (${grouped.here.length} orchestrator${grouped.here.length === 1 ? '' : 's'})`,
        ),
      )
      if (grouped.here.length === 0) {
        this.log(styles.muted('  (none)'))
      } else {
        this.renderOrchestratorRows(grouped.here, flags.peek, flags.lines, /* dim */ false)
      }
      this.log('')
    }

    // Render elsewhere
    if (grouped.elsewhere.length > 0) {
      this.log(
        styles.muted(
          `Other locations (${grouped.elsewhere.length} orchestrator${grouped.elsewhere.length === 1 ? '' : 's'})`,
        ),
      )
      const buckets = bucketElsewhereByHq(grouped.elsewhere)
      for (const bucket of buckets) {
        const hqLabel = bucket.hqPath ? tildifyPath(bucket.hqPath) : '(no HQ)'
        this.log(styles.muted(`  ${bucket.hqName} — ${hqLabel}`))
        this.renderOrchestratorRows(bucket.sessions, flags.peek, flags.lines, /* dim */ true)
      }
      this.log('')
    }
  }

  private renderOrchestratorRows(
    sessions: UnifiedSession[],
    peek: boolean,
    lines: number,
    dim: boolean,
  ): void {
    for (const s of sessions) {
      const envLabel = s.environment === 'container' ? ' (Docker)' : ''
      const line = `   ${s.agentName}${envLabel} (${s.sessionId})`
      this.log(dim ? styles.muted(line) : styles.muted(line))
      const attachCmd = s.agentName === 'main'
        ? '     Attach: prlt orchestrator attach'
        : `     Attach: prlt orchestrator attach --name ${s.agentName}`
      this.log(styles.muted(attachCmd))

      if (peek) {
        let output: string | null = null
        if (s.environment === 'container' && s.containerId) {
          output = this.captureDockerTmuxPane(s.containerId, s.sessionId, lines)
        } else {
          output = captureTmuxPane(s.sessionId, lines)
        }
        if (output) {
          this.log(styles.muted('─'.repeat(60)))
          this.log(output)
          this.log(styles.muted('─'.repeat(60)))
        }
      }
    }
  }
}

function toJsonOrchestrator(s: UnifiedSession): Record<string, unknown> {
  return {
    sessionId: s.sessionId,
    name: s.agentName,
    environment: s.environment === 'container' ? 'docker' : 'host',
    containerId: s.containerId ?? null,
    hqPath: s.hqPath ?? null,
    hqName: s.hqName ?? null,
    status: s.status,
  }
}
