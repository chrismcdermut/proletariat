import { Flags } from '@oclif/core'
import * as path from 'node:path'
import * as fs from 'node:fs'
import Database from 'better-sqlite3'
import { PromptCommand } from '../../lib/prompt-command.js'
import { machineOutputFlags } from '../../lib/pmo/index.js'
import { findHQRoot } from '../../lib/workspace.js'
import { getHeadquartersNameFromPath } from '../../lib/machine-config.js'
import {
  shouldOutputJson,
  outputErrorAsJson,
  outputSuccessAsJson,
  createMetadata,
  buildPromptConfig,
  outputPromptAsJson,
} from '../../lib/prompt-json.js'
import { styles } from '../../lib/styles.js'
import {
  OutputMode,
  DisplayMode,
  ExecutionContext,
  ExecutorType,
  ExecutionEnvironment,
  PermissionMode,
  DEFAULT_EXECUTION_CONFIG,
} from '../../lib/execution/types.js'
import { runExecution } from '../../lib/execution/runners.js'
import { getHostTmuxSessionNames } from '../../lib/execution/session-utils.js'
import { ExecutionStorage } from '../../lib/execution/storage.js'
import {
  loadExecutionConfig,
  getTerminalApp,
  getShell,
  detectShell,
  detectTerminalApp,
} from '../../lib/execution/config.js'

/**
 * Sanitize a name segment for use in tmux session names.
 */
function sanitizeName(name: string): string {
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

export default class OrchestratorStart extends PromptCommand {
  static description = 'Start the orchestrator agent in a tmux session'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --executor codex',
    '<%= config.bin %> <%= command.id %> --permission-mode danger',
    '<%= config.bin %> <%= command.id %> --prompt "coordinate all agents on TKT-100"',
    '<%= config.bin %> <%= command.id %> --background',
    '<%= config.bin %> <%= command.id %> --docker  # Run in Docker container (sibling pattern)',
    '<%= config.bin %> <%= command.id %> --run-on-host  # Explicitly run on host machine',
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
      options: ['claude-code', 'codex', 'aider', 'custom'],
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
      description: 'Run orchestrator in Docker container (sibling pattern with Docker socket mounted)',
      default: false,
      exclusive: ['run-on-host'],
    }),
    'run-on-host': Flags.boolean({
      description: 'Run orchestrator directly on host machine (default)',
      default: false,
      exclusive: ['docker'],
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(OrchestratorStart)
    const jsonMode = shouldOutputJson(flags)
    const orchestratorName = flags.name || 'main'

    // Resolve HQ path first (needed for scoped session name)
    const hqPath = findHQRoot(process.cwd())
    if (!hqPath) {
      if (jsonMode) {
        outputErrorAsJson('NO_HQ', 'Not in an HQ workspace. Run "prlt init" first.', createMetadata('orchestrator start', flags))
        return
      }
      this.error('Not in an HQ workspace. Run "prlt init" first.')
    }

    // Build session name scoped to this HQ
    const hqName = getHeadquartersNameFromPath(hqPath)
    const sessionName = buildOrchestratorSessionName(hqName, orchestratorName)

    // Check if orchestrator is already running
    const hostSessions = getHostTmuxSessionNames()
    if (hostSessions.includes(sessionName)) {
      if (jsonMode) {
        outputErrorAsJson(
          'ALREADY_RUNNING',
          `Orchestrator is already running (session: ${sessionName}). Use "prlt orchestrator attach${flags.name ? ` --name ${flags.name}` : ''}" to reattach.`,
          createMetadata('orchestrator start', flags),
        )
        return
      }

      this.log('')
      this.log(styles.warning(`Orchestrator is already running (session: ${sessionName})`))
      this.log('')

      const attachArgs = flags.name ? ['--name', flags.name] : []
      const { choice } = await this.prompt<{ choice: string }>([{
        type: 'list',
        name: 'choice',
        message: 'What would you like to do?',
        choices: [
          { name: 'Attach to running orchestrator', value: 'attach', command: `prlt orchestrator attach${flags.name ? ` --name ${flags.name}` : ''} --json` },
          { name: 'Cancel', value: 'cancel' },
        ],
      }], jsonMode ? { flags, commandName: 'orchestrator start' } : null)

      if (choice === 'attach') {
        await this.config.runCommand('orchestrator:attach', attachArgs)
      }
      return
    }

    // Executor selection
    let selectedExecutor: ExecutorType
    if (flags.executor) {
      selectedExecutor = flags.executor as ExecutorType
    } else {
      const executorChoices = [
        { name: 'Claude Code', value: 'claude-code', command: 'prlt orchestrator start --executor claude-code --json' },
        { name: 'Codex', value: 'codex', command: 'prlt orchestrator start --executor codex --json' },
        { name: 'Aider', value: 'aider', command: 'prlt orchestrator start --executor aider --json' },
        { name: 'Custom', value: 'custom', command: 'prlt orchestrator start --executor custom --json' },
      ]
      const executorMessage = 'Select executor:'

      if (jsonMode) {
        outputPromptAsJson(
          buildPromptConfig('list', 'executor', executorMessage, executorChoices),
          createMetadata('orchestrator start', flags),
        )
        return
      }

      const { executor } = await this.prompt<{ executor: ExecutorType }>([{
        type: 'list',
        name: 'executor',
        message: executorMessage,
        choices: executorChoices,
      }])
      selectedExecutor = executor
    }

    // Permission mode selection
    let permissionMode: PermissionMode
    if (flags['skip-permissions']) {
      permissionMode = 'danger'
    } else if (flags['permission-mode']) {
      permissionMode = flags['permission-mode'] as PermissionMode
    } else {
      const permissionChoices = [
        { name: '⚠️  danger - Skip permission checks (faster)', value: 'danger', command: 'prlt orchestrator start --permission-mode danger --json' },
        { name: '🔒 safe   - Requires approval for dangerous operations', value: 'safe', command: 'prlt orchestrator start --permission-mode safe --json' },
      ]
      const permissionMessage = 'Permission mode:'

      if (jsonMode) {
        outputPromptAsJson(
          buildPromptConfig('list', 'permissionMode', permissionMessage, permissionChoices),
          createMetadata('orchestrator start', flags),
        )
        return
      }

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
      // Load action from DB
      const dbPath = path.join(hqPath, '.proletariat', 'workspace.db')
      if (fs.existsSync(dbPath)) {
        let db: Database.Database | null = null
        try {
          db = new Database(dbPath)
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
        } finally {
          db?.close()
        }
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
    }

    // Build execution config
    const executionConfig = { ...DEFAULT_EXECUTION_CONFIG }
    executionConfig.outputMode = 'interactive' as OutputMode
    executionConfig.permissionMode = permissionMode

    // Load saved preferences from workspace DB
    const dbPath = path.join(hqPath, '.proletariat', 'workspace.db')
    let db: Database.Database | null = null
    try {
      if (fs.existsSync(dbPath)) {
        db = new Database(dbPath)
        const savedConfig = loadExecutionConfig(db)
        executionConfig.terminal = savedConfig.terminal
        executionConfig.shell = savedConfig.shell
        executionConfig.tmux = savedConfig.tmux
      }
    } catch {
      // Ignore config loading errors, use defaults
    }

    // Auto-detect shell (never prompt for orchestrator)
    if (db) {
      executionConfig.shell = await getShell(db)
    } else {
      executionConfig.shell = detectShell() || 'zsh'
    }

    // Determine display mode
    let displayMode: DisplayMode
    if (flags.background) {
      displayMode = 'background'
    } else if (flags.foreground) {
      displayMode = 'foreground'
    } else {
      const displayChoices = [
        { name: 'New terminal tab — opens attached to the tmux session', value: 'terminal', command: `prlt orchestrator start${flags.name ? ` --name ${flags.name}` : ''} --json` },
        { name: 'Current session — attach to tmux here (foreground, blocking)', value: 'foreground', command: `prlt orchestrator start${flags.name ? ` --name ${flags.name}` : ''} --foreground --json` },
        { name: 'Background — start detached, attach later', value: 'background', command: `prlt orchestrator start${flags.name ? ` --name ${flags.name}` : ''} --background --json` },
      ]
      const displayMessage = 'How do you want to view the orchestrator?'

      if (jsonMode) {
        outputPromptAsJson(
          buildPromptConfig('list', 'displayMode', displayMessage, displayChoices),
          createMetadata('orchestrator start', flags),
        )
        return
      }

      const { displayMode: selectedMode } = await this.prompt<{ displayMode: DisplayMode }>([{
        type: 'list',
        name: 'displayMode',
        message: displayMessage,
        choices: displayChoices,
      }], jsonMode ? { flags, commandName: 'orchestrator start' } : null)
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

    // Determine execution environment
    let environment: ExecutionEnvironment = 'host'
    if (flags.docker) {
      environment = 'docker'
    } else if (flags['run-on-host']) {
      environment = 'host'
    }

    // Show what we're doing
    if (!jsonMode) {
      this.log('')
      this.log(styles.muted(`   Starting orchestrator...`))
      this.log(styles.muted(`   Executor: ${selectedExecutor}`))
      this.log(styles.muted(`   Permission mode: ${permissionMode}`))
      this.log(styles.muted(`   Environment: ${environment}`))
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
    const result = await runExecution(environment, context, selectedExecutor, executionConfig, {
      displayMode,
    })

    if (result.success) {
      // Create execution record so `prlt session poke orchestrator "message"` works
      if (db) {
        try {
          const executionStorage = new ExecutionStorage(db)
          executionStorage.createExecution({
            ticketId: 'ORCH',
            agentName: 'orchestrator',
            executor: selectedExecutor,
            environment,
            displayMode,
            permissionMode,
            sessionId: result.sessionId || sessionName,
          })
        } catch {
          // Non-fatal: poke won't work but orchestrator is running
        }
      }

      if (jsonMode) {
        outputSuccessAsJson({
          sessionId: result.sessionId || sessionName,
          executor: selectedExecutor,
          permissionMode,
          displayMode,
          directory: hqPath,
          name: orchestratorName,
        }, createMetadata('orchestrator start', flags as Record<string, unknown>))
      }

      if (displayMode === 'background') {
        this.log(styles.success(`Orchestrator started in background`))
        this.log(styles.muted(`   Session: ${result.sessionId || sessionName}`))
        this.log(styles.muted(`   Attach with: prlt orchestrator attach${flags.name ? ` --name ${flags.name}` : ''}`))
      } else {
        this.log(styles.success(`Orchestrator started`))
        if (result.sessionId) {
          this.log(styles.muted(`   Session: ${result.sessionId}`))
        }
      }
    } else {
      if (jsonMode) {
        outputErrorAsJson('EXECUTION_FAILED', `Failed to start orchestrator: ${result.error}`, createMetadata('orchestrator start', flags))
      }
      this.error(`Failed to start orchestrator: ${result.error}`)
    }

    if (db) {
      db.close()
    }
  }
}
