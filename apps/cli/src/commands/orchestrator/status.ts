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
import { findHQRoot } from '../../lib/workspace.js'
import { getHeadquartersNameFromPath } from '../../lib/machine-config.js'
import { execSync } from 'node:child_process'
import {
  buildOrchestratorSessionName,
  buildOrchestratorContainerName,
  findRunningOrchestratorSessions,
  findHQOrchestratorSessions,
  findHQOrchestratorContainers,
  findRunningOrchestratorContainers,
  getOrchestratorContainerId,
  enrichOrchestratorSession,
  formatHomePath,
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

  async run(): Promise<void> {
    const { flags } = await this.parse(OrchestratorStatus)
    const jsonMode = shouldOutputJson(flags)
    const hostSessions = getHostTmuxSessionNames()

    // Resolve session name: try HQ-scoped first, fall back to discovery
    const hqPath = findHQRoot(process.cwd())

    if (hqPath) {
      const hqName = getHeadquartersNameFromPath(hqPath)

      if (flags.name) {
        // Explicit --name: check that specific orchestrator (host tmux + Docker)
        const sessionName = buildOrchestratorSessionName(hqName, flags.name)
        const isHostRunning = hostSessions.includes(sessionName)

        const containerName = buildOrchestratorContainerName(hqName, flags.name)
        const dockerContainerId = getOrchestratorContainerId(containerName)
        const isDockerRunning = !!dockerContainerId

        const isRunning = isHostRunning || isDockerRunning
        const environment = isDockerRunning ? 'docker' : 'host'

        let recentOutput: string | null = null
        if (isRunning && flags.peek) {
          if (isDockerRunning && dockerContainerId) {
            recentOutput = this.captureDockerTmuxPane(dockerContainerId, containerName, flags.lines)
          } else {
            recentOutput = captureTmuxPane(sessionName, flags.lines)
          }
        }

        if (jsonMode) {
          outputSuccessAsJson({
            running: isRunning,
            sessionId: isRunning ? (isDockerRunning ? containerName : sessionName) : null,
            containerId: dockerContainerId || null,
            environment,
            name: flags.name,
            ...(recentOutput !== null && { recentOutput }),
          }, createMetadata('orchestrator status', flags as Record<string, unknown>))
          return
        }

        this.log('')
        if (isRunning) {
          this.log(styles.success(`Orchestrator "${flags.name}" is running${isDockerRunning ? ' (Docker)' : ''}`))
          this.log(styles.muted(`   Session: ${isDockerRunning ? containerName : sessionName}`))
          if (dockerContainerId) {
            this.log(styles.muted(`   Container: ${dockerContainerId}`))
          }
          this.log(styles.muted(`   Attach: prlt orchestrator attach --name ${flags.name}`))

          if (recentOutput) {
            this.log('')
            this.log(styles.header('Recent output:'))
            this.log(styles.muted('─'.repeat(60)))
            this.log(recentOutput)
            this.log(styles.muted('─'.repeat(60)))
          }
        } else {
          this.log(styles.muted(`Orchestrator "${flags.name}" is not running.`))
          this.log(styles.muted('Start it with: prlt orchestrator start'))
        }
        this.log('')
        return
      }

      // No --name: show status for ALL orchestrators in this HQ (host + Docker)
      const hqSessions = findHQOrchestratorSessions(hostSessions, hqName)
      const hqContainers = findHQOrchestratorContainers(hqName)

      const allSessions = [
        ...hqSessions.map(s => {
          const info = enrichOrchestratorSession(s, false)
          return {
            sessionId: s,
            name: info.orchestratorName,
            hqName: info.hqName,
            hqPath: info.hqPath,
            environment: 'host' as const,
            containerId: null as string | null,
          }
        }),
        ...hqContainers.map(c => {
          const info = enrichOrchestratorSession(c, true)
          return {
            sessionId: c,
            name: info.orchestratorName,
            hqName: info.hqName,
            hqPath: info.hqPath,
            environment: 'docker' as const,
            containerId: getOrchestratorContainerId(c),
          }
        }),
      ]

      if (jsonMode) {
        outputSuccessAsJson({
          running: allSessions.length > 0,
          sessions: allSessions,
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
          const envLabel = s.environment === 'docker' ? ' (Docker)' : ''
          const context = s.hqPath ? formatHomePath(s.hqPath) : 'host'
          this.log(styles.muted(`   ${s.name}${envLabel}  (running, ${context})`))
          this.log(styles.muted(`     Session: ${s.sessionId}`))
          this.log(styles.muted(`     Attach: prlt orchestrator attach --name ${s.name}`))
          if (flags.peek) {
            let output: string | null = null
            if (s.environment === 'docker' && s.containerId) {
              output = this.captureDockerTmuxPane(s.containerId, s.sessionId, flags.lines)
            } else {
              output = captureTmuxPane(s.sessionId, flags.lines)
            }
            if (output) {
              this.log(styles.muted('─'.repeat(60)))
              this.log(output)
              this.log(styles.muted('─'.repeat(60)))
            }
          }
        }
      }
      this.log('')
      return
    }

    // Not in HQ — discover all running orchestrator sessions globally (host + Docker)
    const runningSessions = findRunningOrchestratorSessions(hostSessions)
    const runningContainers = findRunningOrchestratorContainers()

    const allSessions = [
      ...runningSessions.map(s => {
        const info = enrichOrchestratorSession(s, false)
        return {
          sessionId: s,
          name: info.orchestratorName,
          hqName: info.hqName,
          hqPath: info.hqPath,
          environment: 'host' as const,
        }
      }),
      ...runningContainers.map(c => {
        const info = enrichOrchestratorSession(c, true)
        return {
          sessionId: c,
          name: info.orchestratorName,
          hqName: info.hqName,
          hqPath: info.hqPath,
          environment: 'docker' as const,
        }
      }),
    ]

    if (jsonMode) {
      outputSuccessAsJson({
        running: allSessions.length > 0,
        sessions: allSessions,
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
        const envLabel = s.environment === 'docker' ? ' (Docker)' : ''
        const context = s.hqPath ? formatHomePath(s.hqPath) : 'host'
        this.log(styles.muted(`   ${s.name}${envLabel}  (running, ${context})`))
        this.log(styles.muted(`     Session: ${s.sessionId}`))
        if (flags.peek && s.environment === 'host') {
          // Can only peek at host sessions with captureTmuxPane
          const output = captureTmuxPane(s.sessionId, flags.lines)
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
}
