import { Flags } from '@oclif/core'
import { execSync } from 'node:child_process'
import * as os from 'node:os'
import * as path from 'node:path'
import { RuntimeCommand, machineOutputFlags } from '../../lib/runtime-command.js'
import {
  getHeadquartersNameFromPath,
  getRegisteredHeadquarters,
  type RegisteredHeadquarters,
} from '../../lib/machine-config.js'
import {
  shouldOutputJson,
  outputErrorAsJson,
  outputSuccessAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'
import { styles } from '../../lib/styles.js'
import {
  OutputMode,
  DisplayMode,
  ExecutionEnvironment,
  ExecutionContext,
  ExecutorType,
  PermissionMode,
  DEFAULT_EXECUTION_CONFIG,
} from '../../lib/execution/types.js'
import {
  runExecution,
  hostCredentialsExist,
  isDockerRunning,
  runOrchestratorInDocker,
} from '../../lib/execution/runners.js'
import { getHostTmuxSessionNames } from '../../lib/execution/session-utils.js'
import { ExecutionStorage } from '../../lib/execution/storage.js'
import { MachineDB, type MachineExecution } from '../../lib/machine-db.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import {
  loadExecutionConfig,
  getTerminalApp,
  getShell,
  detectShell,
  detectTerminalApp,
} from '../../lib/execution/config.js'
import { ensureBuiltinThemes } from '../../lib/themes.js'
import { getActiveTheme, getAvailableThemeNames } from '../../lib/database/index.js'
import { getConnectedIntegrations } from '../../lib/work-source/index.js'

/**
 * Sanitize a name segment for use in tmux session names.
 */
export function sanitizeName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * Build orchestrator tmux session name scoped to the HQ workspace.
 * Format: 'prlt-orchestrator-{hqName}-{name}'
 * Example: 'prlt-orchestrator-proletariat-main'
 */
export function buildOrchestratorSessionName(hqName: string, name: string = 'main'): string {
  const safeHqName = sanitizeName(hqName) || 'default'
  const safeName = sanitizeName(name) || 'main'
  return `prlt-orchestrator-${safeHqName}-${safeName}`
}

/**
 * Find running orchestrator session(s) by prefix match.
 * Returns all tmux session names that start with 'prlt-orchestrator-'.
 */
export function findRunningOrchestratorSessions(hostSessions: string[]): string[] {
  return hostSessions.filter(s => s.startsWith('prlt-orchestrator-'))
}

/**
 * Find orchestrator sessions scoped to a specific HQ workspace.
 * Filters sessions by 'prlt-orchestrator-{sanitizedHqName}-' prefix.
 */
export function findHQOrchestratorSessions(hostSessions: string[], hqName: string): string[] {
  const prefix = `prlt-orchestrator-${sanitizeName(hqName) || 'default'}-`
  return hostSessions.filter(s => s.startsWith(prefix))
}

/**
 * Build Docker container name for an orchestrator instance.
 * Format: 'prlt-orchestrator-{hqName}-{name}'
 */
export function buildOrchestratorContainerName(hqName: string, name: string = 'main'): string {
  const safeHqName = sanitizeName(hqName) || 'default'
  const safeName = sanitizeName(name) || 'main'
  return `prlt-orchestrator-${safeHqName}-${safeName}`
}

/**
 * Find running Docker-based orchestrator containers.
 * Returns container names matching 'prlt-orchestrator-*'.
 */
export function findRunningOrchestratorContainers(): string[] {
  try {
    const output = execSync(
      'docker ps --filter "name=prlt-orchestrator-" --format "{{.Names}}"',
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim()
    if (!output) return []
    return output.split('\n').filter(Boolean)
  } catch {
    return []
  }
}

/**
 * Find Docker orchestrator containers scoped to a specific HQ workspace.
 */
export function findHQOrchestratorContainers(hqName: string): string[] {
  const prefix = `prlt-orchestrator-${sanitizeName(hqName) || 'default'}-`
  return findRunningOrchestratorContainers().filter(c => c.startsWith(prefix))
}

/**
 * Get the Docker container ID for a running orchestrator container.
 */
export function getOrchestratorContainerId(containerName: string): string | null {
  try {
    const id = execSync(
      `docker container inspect -f '{{.Id}}' ${containerName}`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim()
    return id ? id.substring(0, 12) : null
  } catch {
    return null
  }
}

export function resolveOrchestratorName(name?: string): string {
  const normalized = name?.trim()
  return normalized && normalized.length > 0 ? normalized : 'main'
}

export function buildOrchestratorAttachCommand(name: string): string {
  return name === 'main'
    ? 'prlt orchestrator attach'
    : `prlt orchestrator attach --name ${name}`
}

export function extractOrchestratorNameFromSession(sessionName: string, hqName: string): string | null {
  const prefix = `prlt-orchestrator-${sanitizeName(hqName) || 'default'}-`
  if (!sessionName.startsWith(prefix)) {
    return null
  }

  const extracted = sessionName.slice(prefix.length)
  return extracted.length > 0 ? extracted : null
}

/**
 * Information about an orchestrator session, including its HQ context.
 */
export interface OrchestratorSessionInfo {
  /** Full session id (tmux session name or docker container name). */
  sessionId: string
  /** Orchestrator name (e.g. 'main', 'reviewer'). */
  orchestratorName: string
  /** Resolved HQ name from the registry, or null if not matched. */
  hqName: string | null
  /** Resolved HQ path from the registry, or null if not matched. */
  hqPath: string | null
  /** Whether this session runs in a Docker container (true) or host tmux (false). */
  isDocker: boolean
}

/**
 * Parse an orchestrator session id (tmux/container name) into its parts by
 * matching against the set of registered headquarters. Returns the HQ
 * with the longest matching sanitized-name prefix to handle nested HQs.
 *
 * If no registered HQ matches, returns hqName/hqPath as null and treats
 * everything after the `prlt-orchestrator-` prefix as the orchestrator name.
 */
export function parseOrchestratorSessionId(
  sessionId: string,
  registeredHqs: Array<Pick<RegisteredHeadquarters, 'name' | 'path'>>,
): { hqName: string | null; hqPath: string | null; orchestratorName: string } {
  const globalPrefix = 'prlt-orchestrator-'
  if (!sessionId.startsWith(globalPrefix)) {
    return { hqName: null, hqPath: null, orchestratorName: sessionId }
  }

  // Try to match against registered HQs (longest sanitized-name prefix wins).
  let best: { hqName: string; hqPath: string; orchestratorName: string } | null = null

  for (const hq of registeredHqs) {
    const sanitized = sanitizeName(hq.name) || 'default'
    const prefix = `${globalPrefix}${sanitized}-`
    if (!sessionId.startsWith(prefix)) continue

    const orchestratorName = sessionId.slice(prefix.length)
    if (orchestratorName.length === 0) continue

    if (!best || sanitized.length > (sanitizeName(best.hqName) || 'default').length) {
      best = { hqName: hq.name, hqPath: hq.path, orchestratorName }
    }
  }

  if (best) {
    return best
  }

  // No registered HQ matched. Return the suffix as the orchestrator name with
  // unknown HQ context — this can happen for sessions belonging to an
  // unregistered or pruned HQ.
  return {
    hqName: null,
    hqPath: null,
    orchestratorName: sessionId.slice(globalPrefix.length),
  }
}

/**
 * Enrich an orchestrator session id with HQ context resolved from the
 * machine-level registry. Always returns a valid OrchestratorSessionInfo,
 * with hqName/hqPath set to null when the session cannot be mapped back
 * to a known HQ.
 */
export function enrichOrchestratorSession(
  sessionId: string,
  isDocker: boolean,
  registeredHqs?: Array<Pick<RegisteredHeadquarters, 'name' | 'path'>>,
): OrchestratorSessionInfo {
  const hqs = registeredHqs ?? getRegisteredHeadquarters()
  const parsed = parseOrchestratorSessionId(sessionId, hqs)
  return {
    sessionId,
    orchestratorName: parsed.orchestratorName,
    hqName: parsed.hqName,
    hqPath: parsed.hqPath,
    isDocker,
  }
}

/**
 * Look up an orchestrator session in machine.db by its session id (for host
 * tmux sessions) or container id (for Docker sessions). Returns the matching
 * execution row if one exists, or null.
 *
 * Machine.db is the source of truth for the HQ path an orchestrator was
 * started from — prefix-parsing only gives us the HQ name, which can be
 * ambiguous across multiple registered HQs with the same basename.
 */
export function findMachineOrchestratorExecution(
  machineDb: Pick<MachineDB, 'listExecutions'>,
  sessionId: string,
  containerId?: string,
): MachineExecution | null {
  // Pull all running + starting orchestrator executions. The set is small
  // enough that client-side filtering is fine.
  const active = [
    ...machineDb.listExecutions({ status: 'running' }),
    ...machineDb.listExecutions({ status: 'starting' }),
  ]
  const orchestrators = active.filter(e => e.agentName.startsWith('orchestrator-'))

  // Prefer an exact session id match (covers host tmux sessions).
  const bySession = orchestrators.find(e => e.sessionId === sessionId)
  if (bySession) return bySession

  // For Docker sessions the tmux "session id" and the container name are
  // equal by construction (see buildOrchestratorContainerName), but fall back
  // to matching by the short container id as well.
  if (containerId) {
    const byContainer = orchestrators.find(e => e.containerId === containerId)
    if (byContainer) return byContainer
  }

  return null
}

/**
 * Enrich an orchestrator session id with HQ context using machine.db as the
 * primary source and the machine registry as fallback.
 *
 * Machine.db gives us the exact `repo_path` the orchestrator was launched
 * from, which is more reliable than sanitized-name prefix matching.
 */
export function enrichOrchestratorSessionFromMachineDb(
  sessionId: string,
  isDocker: boolean,
  machineDb: Pick<MachineDB, 'listExecutions'> | null,
  containerId?: string,
  registeredHqs?: Array<Pick<RegisteredHeadquarters, 'name' | 'path'>>,
): OrchestratorSessionInfo {
  const base = enrichOrchestratorSession(sessionId, isDocker, registeredHqs)

  if (!machineDb) return base

  const execution = findMachineOrchestratorExecution(machineDb, sessionId, containerId)
  if (!execution) return base

  // Derive orchestrator name from the agent_name column
  // (format: 'orchestrator-{name}'), falling back to whatever prefix-parsing
  // produced if the agent name is malformed.
  const orchestratorName = execution.agentName.startsWith('orchestrator-')
    ? execution.agentName.slice('orchestrator-'.length) || base.orchestratorName
    : base.orchestratorName

  return {
    sessionId,
    orchestratorName,
    // Machine.db doesn't store HQ name separately — reuse whatever the
    // registry matched, so we can still keep a human-readable name handy.
    hqName: base.hqName,
    hqPath: execution.repoPath,
    isDocker,
  }
}

/**
 * Replace the user's home directory with `~` for compact display.
 */
export function formatHomePath(input: string): string {
  const home = process.env.HOME || os.homedir()
  if (!home) return input
  if (input === home) return '~'
  if (input.startsWith(home + path.sep)) {
    return '~' + input.slice(home.length)
  }
  return input
}

/**
 * Build the human-readable label for an orchestrator session in pickers and
 * status output. Format: `{name} (running, {context}[, Docker])`.
 *
 * Examples:
 *   main      (running, ~/Projects/backend)
 *   backend   (running, ~/Projects/proletariat-hq, Docker)
 *   reviewer  (running, host)  // when HQ context can't be resolved
 */
export function formatOrchestratorSessionLabel(info: OrchestratorSessionInfo): string {
  const context = info.hqPath ? formatHomePath(info.hqPath) : 'host'
  const dockerSuffix = info.isDocker ? ', Docker' : ''
  return `${info.orchestratorName} (running, ${context}${dockerSuffix})`
}

export function collectReservedOrchestratorNames(
  agentNames: string[],
  hostSessions: string[],
  hqName: string,
): Set<string> {
  const reserved = new Set<string>()

  for (const agentName of agentNames) {
    const normalized = resolveOrchestratorName(sanitizeName(agentName).toLowerCase())
    reserved.add(normalized)
  }

  for (const session of hostSessions) {
    const extracted = extractOrchestratorNameFromSession(session, hqName)
    if (!extracted) continue
    reserved.add(resolveOrchestratorName(extracted.toLowerCase()))
  }

  return reserved
}

function nextAvailableName(baseName: string, reserved: Set<string>): string {
  const normalizedBase = resolveOrchestratorName(baseName.toLowerCase())
  if (!reserved.has(normalizedBase)) {
    return normalizedBase
  }

  let suffix = 2
  while (reserved.has(`${normalizedBase}-${suffix}`)) {
    suffix += 1
  }

  return `${normalizedBase}-${suffix}`
}

export function buildAvailableOrchestratorNames(reserved: Set<string>, maxNames: number = 8): string[] {
  const orderedBases = ['main', ...Array.from(reserved).sort()]
  const suggestions: string[] = []
  const taken = new Set<string>(reserved)

  for (const base of orderedBases) {
    const candidate = nextAvailableName(base, taken)
    if (suggestions.includes(candidate)) continue
    suggestions.push(candidate)
    taken.add(candidate)

    if (suggestions.length >= maxNames) {
      break
    }
  }

  return suggestions
}

export function findGlobalOrchestratorNameConflict(name: string, reserved: Set<string>): string | null {
  const normalized = resolveOrchestratorName(sanitizeName(name).toLowerCase())
  return reserved.has(normalized) ? normalized : null
}

export default class OrchestratorStart extends RuntimeCommand {
  static description = 'Start the orchestrator agent in a tmux session'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --executor codex',
    '<%= config.bin %> <%= command.id %> --permission-mode danger',
    '<%= config.bin %> <%= command.id %> --prompt "coordinate all agents on TKT-100"',
    '<%= config.bin %> <%= command.id %> --background',
  ]

  static flags = {
    ...machineOutputFlags,
    prompt: Flags.string({
      char: 'p',
      description: 'Initial prompt for the orchestrator',
    }),
    action: Flags.string({
      char: 'A',
      description: 'Load an action by name from the actions table (uses its prompt)',
    }),
    executor: Flags.string({
      char: 'e',
      description: 'Executor type',
      options: ['claude-code', 'codex', 'custom'],
    }),
    'skip-permissions': Flags.boolean({
      description: 'Skip permission checks (shorthand for --permission-mode danger)',
      default: false,
      exclusive: ['permission-mode'],
    }),
    'permission-mode': Flags.string({
      description: 'Permission mode for the orchestrator (danger=skip checks, safe=require approval)',
      options: ['danger', 'safe'],
      exclusive: ['skip-permissions'],
    }),
    name: Flags.string({
      char: 'n',
      description: 'Name for the orchestrator session (default: main)',
    }),
    background: Flags.boolean({
      char: 'b',
      description: 'Start detached (don\'t open terminal tab)',
      default: false,
      exclusive: ['foreground'],
    }),
    foreground: Flags.boolean({
      char: 'f',
      description: 'Attach to the tmux session in the current terminal (blocking)',
      default: false,
      exclusive: ['background'],
    }),
    docker: Flags.boolean({
      description: 'Run orchestrator in a Docker container (sibling container pattern)',
      default: false,
      exclusive: ['run-on-host'],
    }),
    'run-on-host': Flags.boolean({
      description: 'Run orchestrator on host (default behavior)',
      default: false,
      exclusive: ['docker'],
    }),
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(OrchestratorStart)
    const jsonMode = shouldOutputJson(flags)

    // Use HQ path from RuntimeCommand (resolved in init())
    const hqPath = this.hqPath
    if (!hqPath) {
      if (jsonMode) {
        outputErrorAsJson('NO_HQ', 'Not in an HQ workspace. Run "prlt new" first.', createMetadata('orchestrator start', flags))
        return
      }
      this.error('Not in an HQ workspace. Run "prlt new" first.')
    }

    // Resolve orchestrator name (interactive prompt when --name is omitted)
    const workspaceInfo = getWorkspaceInfo()
    const hqName = getHeadquartersNameFromPath(hqPath)
    const hostSessions = getHostTmuxSessionNames()
    const reservedAgentNames = new Set(
      workspaceInfo.agents.map(agent => resolveOrchestratorName(sanitizeName(agent.name).toLowerCase())),
    )
    const reservedNames = collectReservedOrchestratorNames(
      workspaceInfo.agents.map(agent => agent.name),
      hostSessions,
      hqName,
    )

    let orchestratorName = resolveOrchestratorName(flags.name)
    if (!flags.name) {
      // Try theme-based names first
      ensureBuiltinThemes(hqPath)
      const activeTheme = getActiveTheme(hqPath)
      let availableNames: string[]

      if (activeTheme) {
        const themeNames = getAvailableThemeNames(hqPath, activeTheme.id)
        // Filter out names that are reserved by running orchestrators or agents
        availableNames = themeNames
          .filter(n => !reservedNames.has(n.toLowerCase()))
          .slice(0, 8)
      } else {
        availableNames = []
      }

      // Fall back to buildAvailableOrchestratorNames if no theme names available
      if (availableNames.length === 0) {
        availableNames = buildAvailableOrchestratorNames(reservedNames)
      }

      // JSON mode: auto-select first available name instead of prompting
      if (jsonMode) {
        orchestratorName = resolveOrchestratorName(availableNames[0])
      } else {
        const nameChoices = [
          ...availableNames.map(name => ({
            name,
            value: name,
            command: `prlt orchestrator start --name ${name} --json`,
          })),
          { name: 'Custom...', value: '__custom__' },
        ]
        const nameMessage = 'Select orchestrator name:'

        const { selectedName } = await this.prompt<{ selectedName: string }>([{
          type: 'list',
          name: 'selectedName',
          message: nameMessage,
          choices: nameChoices,
        }])

        if (selectedName === '__custom__') {
          const defaultCustomName = availableNames[0] || 'main'
          const { customName } = await this.prompt<{ customName: string }>([{
            type: 'input',
            name: 'customName',
            message: 'Enter orchestrator name:',
            default: defaultCustomName,
            validate: (input: unknown) => {
              const normalized = resolveOrchestratorName(sanitizeName(String(input ?? '')).toLowerCase())
              if (reservedNames.has(normalized)) {
                return `Name "${normalized}" is already in use by an agent or orchestrator session.`
              }
              return true
            },
          }])
          orchestratorName = resolveOrchestratorName(customName)
        } else {
          orchestratorName = resolveOrchestratorName(selectedName)
        }
      }
    }

    const attachCommand = buildOrchestratorAttachCommand(orchestratorName)
    const attachArgs = orchestratorName === 'main' ? [] : ['--name', orchestratorName]

    // Build session name scoped to this HQ
    const sessionName = buildOrchestratorSessionName(hqName, orchestratorName)

    // Check if orchestrator is already running
    if (hostSessions.includes(sessionName)) {
      if (jsonMode) {
        outputErrorAsJson(
          'ALREADY_RUNNING',
          `Orchestrator is already running (session: ${sessionName}). Use "${attachCommand}" to reattach.`,
          createMetadata('orchestrator start', flags),
        )
        return
      }

      this.log('')
      this.log(styles.warning(`Orchestrator is already running (session: ${sessionName})`))
      this.log('')

      const { choice } = await this.prompt<{ choice: string }>([{
        type: 'list',
        name: 'choice',
        message: 'What would you like to do?',
        choices: [
          { name: 'Attach to running orchestrator', value: 'attach', command: `${attachCommand} --json` },
          { name: 'Cancel', value: 'cancel' },
        ],
      }], jsonMode ? { flags, commandName: 'orchestrator start' } : null)

      if (choice === 'attach') {
        await this.config.runCommand('orchestrator:attach', attachArgs)
      }
      return
    }

    const conflict = findGlobalOrchestratorNameConflict(orchestratorName, reservedAgentNames)
    if (conflict) {
      if (jsonMode) {
        outputErrorAsJson(
          'NAME_CONFLICT',
          `Orchestrator name "${conflict}" is already in use by a staff/temp agent. Choose a unique name with --name.`,
          createMetadata('orchestrator start', flags),
        )
        return
      }
      this.error(`Orchestrator name "${conflict}" is already in use by a staff/temp agent. Choose a different name.`)
    }

    // Executor selection (JSON mode defaults to claude-code)
    let selectedExecutor: ExecutorType
    if (flags.executor) {
      selectedExecutor = flags.executor as ExecutorType
    } else if (jsonMode) {
      selectedExecutor = 'claude-code'
    } else {
      const executorChoices = [
        { name: 'Claude Code', value: 'claude-code', command: 'prlt orchestrator start --executor claude-code --json' },
        { name: 'Codex', value: 'codex', command: 'prlt orchestrator start --executor codex --json' },
        { name: 'Custom', value: 'custom', command: 'prlt orchestrator start --executor custom --json' },
        { name: 'Request executor support...', value: 'request-support' },
      ]
      const executorMessage = 'Select executor:'

      const { executor } = await this.prompt<{ executor: string }>([{
        type: 'list',
        name: 'executor',
        message: executorMessage,
        choices: executorChoices,
      }])
      if (executor === 'request-support') {
        this.log('Request support for a new executor at: https://github.com/chrismcdermut/proletariat/issues')
        return
      }
      selectedExecutor = executor as ExecutorType
    }

    // Determine execution environment
    let environment: ExecutionEnvironment = 'host'
    if (flags.docker) {
      environment = 'docker'
    } else if (!flags['run-on-host'] && !jsonMode) {
      // Interactive mode: if Docker is available, offer the choice
      // (unless --run-on-host was explicitly set)
      if (isDockerRunning()) {
        const envChoices = [
          { name: '💻 Host — run directly on this machine (default)', value: 'host', command: 'prlt orchestrator start --run-on-host --json' },
          { name: '🐳 Docker — run in isolated container (sibling container pattern)', value: 'docker', command: 'prlt orchestrator start --docker --json' },
        ]

        const { selectedEnv } = await this.prompt<{ selectedEnv: string }>([{
          type: 'list',
          name: 'selectedEnv',
          message: 'Where should the orchestrator run?',
          choices: envChoices,
        }])
        environment = selectedEnv as ExecutionEnvironment
      }
    }

    // Validate Docker is running if docker environment was selected
    if (environment === 'docker' && !isDockerRunning()) {
      const errorMsg = 'Docker is not running. Please start Docker Desktop and try again, or use --run-on-host.'
      if (jsonMode) {
        outputErrorAsJson('DOCKER_NOT_RUNNING', errorMsg, createMetadata('orchestrator start', flags))
        return
      }
      this.error(errorMsg)
    }

    // Validate Claude Code authentication for host execution
    // Docker uses OAuth credentials volume, so host auth check only applies to host mode
    if (environment === 'host' && selectedExecutor === 'claude-code' && !hostCredentialsExist()) {
      const errorMsg = 'Claude Code authentication is not available. This usually happens when the macOS keychain is locked in SSH sessions.'
      const remediation = [
        '',
        'To fix this, choose one of the following:',
        '',
        '1. Run orchestrator in Docker (uses OAuth, no keychain needed):',
        '   prlt orchestrator start --docker',
        '',
        '2. Unlock the keychain:',
        '   security unlock-keychain',
        '',
        '3. Set the ANTHROPIC_API_KEY environment variable:',
        '   export ANTHROPIC_API_KEY=your-api-key',
        '',
        '4. Login to Claude Code:',
        '   claude /login',
        '',
      ].join('\n')

      if (jsonMode) {
        outputErrorAsJson(
          'AUTH_UNAVAILABLE',
          errorMsg + '\n' + remediation,
          createMetadata('orchestrator start', flags)
        )
        return
      }

      this.log('')
      this.log(styles.error(errorMsg))
      this.log(remediation)
      return
    }

    // Permission mode selection (JSON mode defaults to danger)
    let permissionMode: PermissionMode
    if (flags['skip-permissions']) {
      permissionMode = 'danger'
    } else if (flags['permission-mode']) {
      permissionMode = flags['permission-mode'] as PermissionMode
    } else if (jsonMode) {
      permissionMode = 'danger'
    } else {
      const permissionChoices = [
        { name: '⚠️  danger - Skip permission checks (faster)', value: 'danger', command: 'prlt orchestrator start --permission-mode danger --json' },
        { name: '🔒 safe   - Requires approval for dangerous operations', value: 'safe', command: 'prlt orchestrator start --permission-mode safe --json' },
      ]
      const permissionMessage = 'Permission mode:'

      const { permissionMode: selectedMode } = await this.prompt<{ permissionMode: string }>([{
        type: 'list',
        name: 'permissionMode',
        message: permissionMessage,
        choices: permissionChoices,
      }])
      permissionMode = selectedMode as PermissionMode
    }

    // Resolve action prompt
    let actionPrompt = flags.prompt
    let actionName = 'orchestrate'

    if (flags.action && !actionPrompt) {
      // Load action from workspace.db (provided by RuntimeCommand)
      const db = this.db
      if (!db) {
        if (jsonMode) {
          outputErrorAsJson('NO_DATABASE', 'Workspace database not available.', createMetadata('orchestrator start', flags))
          return
        }
        this.error('Workspace database not available. Run "prlt new" first.')
      }
      const row = db.prepare('SELECT prompt, name FROM actions WHERE id = ? OR name = ?').get(flags.action, flags.action) as { prompt: string; name: string } | undefined
      if (row) {
        actionPrompt = row.prompt
        actionName = row.name
      } else {
        if (jsonMode) {
          outputErrorAsJson('ACTION_NOT_FOUND', `Action "${flags.action}" not found.`, createMetadata('orchestrator start', flags))
          return
        }
        this.error(`Action "${flags.action}" not found.`)
      }
    }

    // Build execution context
    // Use ticketId='prlt', actionName='orchestrator', agentName=orchestratorName
    // so buildSessionName produces 'prlt-orchestrator-{name}'
    const context: ExecutionContext = {
      ticketId: 'prlt',
      ticketTitle: 'Orchestrator',
      agentName: orchestratorName,
      agentDir: hqPath,
      worktreePath: hqPath,
      branch: 'main',
      actionName: 'orchestrator',
      actionPrompt,
      modifiesCode: false,
      hqPath,
      isOrchestrator: true,
      hqName,
      executionEnvironment: environment,
    }

    // Build execution config
    const executionConfig = { ...DEFAULT_EXECUTION_CONFIG }
    executionConfig.outputMode = 'interactive' as OutputMode
    executionConfig.permissionMode = permissionMode

    // Use workspace.db from RuntimeCommand for config loading
    const db = this.db
    if (db) {
      try {
        const savedConfig = loadExecutionConfig(db)
        executionConfig.terminal = savedConfig.terminal
        executionConfig.shell = savedConfig.shell
        executionConfig.tmux = savedConfig.tmux
      } catch {
        // Ignore config loading errors, use defaults
      }
    }

    // Inject connected integrations into context
    if (db) {
      context.connectedIntegrations = getConnectedIntegrations(db)
    }

    // Auto-detect shell (never prompt for orchestrator)
    if (db) {
      executionConfig.shell = await getShell(db)
    } else {
      executionConfig.shell = detectShell() || 'zsh'
    }

    // Determine display mode (JSON mode defaults to background)
    let displayMode: DisplayMode
    if (flags.background) {
      displayMode = 'background'
    } else if (flags.foreground) {
      displayMode = 'foreground'
    } else if (jsonMode) {
      displayMode = 'background'
    } else {
      const displayChoices = [
        { name: 'New terminal tab — opens attached to the tmux session', value: 'terminal', command: `prlt orchestrator start${orchestratorName !== 'main' ? ` --name ${orchestratorName}` : ''} --json` },
        { name: 'Current session — attach to tmux here (foreground, blocking)', value: 'foreground', command: `prlt orchestrator start${orchestratorName !== 'main' ? ` --name ${orchestratorName}` : ''} --foreground --json` },
        { name: 'Background — start detached, attach later', value: 'background', command: `prlt orchestrator start${orchestratorName !== 'main' ? ` --name ${orchestratorName}` : ''} --background --json` },
      ]
      const displayMessage = 'How do you want to view the orchestrator?'

      const { displayMode: selectedMode } = await this.prompt<{ displayMode: DisplayMode }>([{
        type: 'list',
        name: 'displayMode',
        message: displayMessage,
        choices: displayChoices,
      }])
      displayMode = selectedMode
    }

    // For 'terminal' display mode, auto-detect terminal app
    if (displayMode === 'terminal') {
      if (db) {
        executionConfig.terminal.app = await getTerminalApp(db)
      } else {
        const detected = detectTerminalApp()
        if (detected) {
          executionConfig.terminal.app = detected
        } else {
          // Can't detect terminal and no db to prompt — fall back to foreground
          displayMode = 'foreground'
        }
      }
    }

    // Show what we're doing
    if (!jsonMode) {
      this.log('')
      this.log(styles.muted(`   Starting orchestrator...`))
      this.log(styles.muted(`   Environment: ${environment}`))
      this.log(styles.muted(`   Executor: ${selectedExecutor}`))
      this.log(styles.muted(`   Permission mode: ${permissionMode}`))
      this.log(styles.muted(`   Display mode: ${displayMode}`))
      this.log(styles.muted(`   Directory: ${hqPath}`))
      if (orchestratorName !== 'main') {
        this.log(styles.muted(`   Name: ${orchestratorName}`))
      }
      if (actionPrompt) {
        this.log(styles.muted(`   Prompt: "${actionPrompt.substring(0, 60)}${actionPrompt.length > 60 ? '...' : ''}"`))
      }
      this.log('')
    }

    // Launch orchestrator
    let result
    if (environment === 'docker') {
      result = await runOrchestratorInDocker(context, selectedExecutor, executionConfig, {
        displayMode,
        sessionName,
      })
    } else {
      result = await runExecution('host', context, selectedExecutor, executionConfig, {
        displayMode,
      })
    }

    if (result.success) {
      // Create execution record so `prlt session poke orchestrator "message"` works
      if (db) {
        try {
          const executionStorage = new ExecutionStorage(db)
          executionStorage.createExecution({
            ticketId: 'ORCH',
            agentName: `orchestrator-${orchestratorName}`,
            executor: selectedExecutor,
            environment,
            displayMode,
            permissionMode,
            sessionId: result.sessionId || sessionName,
            containerId: result.containerId,
          })
        } catch {
          // Non-fatal: poke won't work but orchestrator is running
        }
      }

      // PRLT-1271: Also record the orchestrator in machine.db so that
      // `prlt orchestrator attach/status/stop` can discover sessions from
      // anywhere on the machine, not just from inside the originating HQ.
      // Persistent + cleanup policy mirrors how `prlt work run` persists
      // long-lived agents.
      let machineDb: MachineDB | null = null
      try {
        machineDb = new MachineDB()
        const machineExec = machineDb.createExecution({
          prompt: actionPrompt || `orchestrator: ${orchestratorName}`,
          repoPath: hqPath,
          agentName: `orchestrator-${orchestratorName}`,
          executor: selectedExecutor,
          environment,
          ticketId: 'ORCH',
          persistent: true,
          cleanupPolicy: 'persistent',
        })
        machineDb.updateStatus(machineExec.id, 'running')
        machineDb.updateProcessInfo(machineExec.id, {
          sessionId: result.sessionId || sessionName,
          containerId: result.containerId,
        })
      } catch {
        // Non-fatal: machine-wide discovery will fall back to registry
        // prefix matching for this session.
      } finally {
        machineDb?.close()
      }

      if (jsonMode) {
        outputSuccessAsJson({
          sessionId: result.sessionId || sessionName,
          containerId: result.containerId,
          environment,
          executor: selectedExecutor,
          permissionMode,
          displayMode,
          directory: hqPath,
          name: orchestratorName,
        }, createMetadata('orchestrator start', flags as Record<string, unknown>))
        return
      }

      if (displayMode === 'background') {
        this.log(styles.success(`Orchestrator started in background${environment === 'docker' ? ' (Docker)' : ''}`))
        this.log(styles.muted(`   Session: ${result.sessionId || sessionName}`))
        if (result.containerId) {
          this.log(styles.muted(`   Container: ${result.containerId}`))
        }
        this.log(styles.muted(`   Attach with: ${attachCommand}`))
      } else {
        this.log(styles.success(`Orchestrator started${environment === 'docker' ? ' (Docker)' : ''}`))
        if (result.sessionId) {
          this.log(styles.muted(`   Session: ${result.sessionId}`))
        }
        if (result.containerId) {
          this.log(styles.muted(`   Container: ${result.containerId}`))
        }
      }
    } else {
      if (jsonMode) {
        outputErrorAsJson('EXECUTION_FAILED', `Failed to start orchestrator: ${result.error}`, createMetadata('orchestrator start', flags))
        return
      }
      this.error(`Failed to start orchestrator: ${result.error}`)
    }

    // Note: db cleanup is handled by RuntimeCommand.cleanup()
  }
}
