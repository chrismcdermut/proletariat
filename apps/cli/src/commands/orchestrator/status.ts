import { Flags } from '@oclif/core'
import { PromptCommand } from '../../lib/prompt-command.js'
import { machineOutputFlags } from '../../lib/pmo/index.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'
import { styles } from '../../lib/styles.js'
import { getHostTmuxSessionNames, captureTmuxPane } from '../../lib/execution/session-utils.js'
import { execSync } from 'node:child_process'
import { MachineDB } from '../../lib/machine-db.js'
import {
  findRunningOrchestratorSessions,
  findRunningOrchestratorContainers,
  getOrchestratorContainerId,
  enrichOrchestratorSessionFromMachineDb,
  formatHomePath,
  type OrchestratorSessionInfo,
} from './start.js'

export default class OrchestratorStatus extends PromptCommand {
  static description = 'Check if the orchestrator is running'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --peek',
    '<%= config.bin %> <%= command.id %> --peek --lines 50',
  ]

  static flags = {
    ...machineOutputFlags,
    name: Flags.string({
      char: 'n',
      description: 'Name of the orchestrator session to check (default: main)',
    }),
    peek: Flags.boolean({
      description: 'Show recent output from the orchestrator',
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

  /**
   * Discover every running orchestrator session on the machine (host tmux +
   * Docker), enriched with HQ context from machine.db. Works from anywhere —
   * no HQ workspace required.
   */
  private discoverMachineWideSessions(): OrchestratorSessionInfo[] {
    const hostSessions = getHostTmuxSessionNames()
    const hostOrchestrators = findRunningOrchestratorSessions(hostSessions)
    const containerOrchestrators = findRunningOrchestratorContainers()

    let machineDb: MachineDB | null = null
    try {
      machineDb = new MachineDB()
    } catch {
      // Machine DB not available — fall back to registry-only enrichment.
    }

    try {
      const hostInfos = hostOrchestrators.map(sessionId =>
        enrichOrchestratorSessionFromMachineDb(sessionId, false, machineDb),
      )
      const containerInfos = containerOrchestrators.map(containerName => {
        const containerId = getOrchestratorContainerId(containerName) || undefined
        return enrichOrchestratorSessionFromMachineDb(
          containerName,
          true,
          machineDb,
          containerId,
        )
      })
      return [...hostInfos, ...containerInfos]
    } finally {
      machineDb?.close()
    }
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(OrchestratorStatus)
    const jsonMode = shouldOutputJson(flags)

    // PRLT-1271: machine-wide discovery — `prlt orchestrator status` must
    // work from anywhere and show every running orchestrator's originating
    // HQ, not just the sessions scoped to the current HQ.
    const allSessions = this.discoverMachineWideSessions()

    // Single-session mode: `--name foo` shows details for the first match.
    if (flags.name) {
      const matches = allSessions.filter(s => s.orchestratorName === flags.name)
      const match = matches[0]

      if (jsonMode) {
        outputSuccessAsJson({
          running: !!match,
          sessionId: match?.sessionId ?? null,
          containerId: match && match.isDocker ? getOrchestratorContainerId(match.sessionId) : null,
          environment: match?.isDocker ? 'docker' : 'host',
          name: flags.name,
          hqPath: match?.hqPath ?? null,
          hqName: match?.hqName ?? null,
          ...(match && flags.peek
            ? { recentOutput: this.peekSession(match, flags.lines) }
            : {}),
        }, createMetadata('orchestrator status', flags as Record<string, unknown>))
        return
      }

      this.log('')
      if (match) {
        const context = match.hqPath ? formatHomePath(match.hqPath) : 'host'
        this.log(styles.success(`Orchestrator "${flags.name}" is running${match.isDocker ? ' (Docker)' : ''}`))
        this.log(styles.muted(`   Working directory: ${context}`))
        this.log(styles.muted(`   Session: ${match.sessionId}`))
        if (match.isDocker) {
          const containerId = getOrchestratorContainerId(match.sessionId)
          if (containerId) this.log(styles.muted(`   Container: ${containerId}`))
        }
        this.log(styles.muted(`   Attach: prlt orchestrator attach --name ${flags.name}`))

        if (flags.peek) {
          const recentOutput = this.peekSession(match, flags.lines)
          if (recentOutput) {
            this.log('')
            this.log(styles.header('Recent output:'))
            this.log(styles.muted('─'.repeat(60)))
            this.log(recentOutput)
            this.log(styles.muted('─'.repeat(60)))
          }
        }
      } else {
        this.log(styles.muted(`Orchestrator "${flags.name}" is not running.`))
        this.log(styles.muted('Start it with: prlt orchestrator start'))
      }
      this.log('')
      return
    }

    // No --name: show every running orchestrator on the machine.
    if (jsonMode) {
      outputSuccessAsJson({
        running: allSessions.length > 0,
        sessions: allSessions.map(s => ({
          sessionId: s.sessionId,
          name: s.orchestratorName,
          hqName: s.hqName,
          hqPath: s.hqPath,
          environment: s.isDocker ? 'docker' : 'host',
          containerId: s.isDocker ? getOrchestratorContainerId(s.sessionId) : null,
        })),
      }, createMetadata('orchestrator status', flags as Record<string, unknown>))
      return
    }

    this.log('')
    if (allSessions.length === 0) {
      this.log(styles.muted('No orchestrator sessions running.'))
      this.log(styles.muted('Start one with: prlt orchestrator start'))
    } else {
      this.log(styles.success(`${allSessions.length} orchestrator session(s) running:`))
      for (const s of allSessions) {
        const envLabel = s.isDocker ? ' (Docker)' : ''
        const context = s.hqPath ? formatHomePath(s.hqPath) : 'host'
        this.log(styles.muted(`   ${s.orchestratorName}${envLabel}  (running, ${context})`))
        this.log(styles.muted(`     Session: ${s.sessionId}`))
        this.log(styles.muted(`     Attach: prlt orchestrator attach --name ${s.orchestratorName}`))
        if (flags.peek) {
          const output = this.peekSession(s, flags.lines)
          if (output) {
            this.log(styles.muted('─'.repeat(60)))
            this.log(output)
            this.log(styles.muted('─'.repeat(60)))
          }
        }
      }
    }
    this.log('')
  }

  /**
   * Capture recent output from a session, host or Docker.
   */
  private peekSession(info: OrchestratorSessionInfo, lines: number): string | null {
    if (info.isDocker) {
      const containerId = getOrchestratorContainerId(info.sessionId)
      if (!containerId) return null
      return this.captureDockerTmuxPane(containerId, info.sessionId, lines)
    }
    return captureTmuxPane(info.sessionId, lines)
  }
}
