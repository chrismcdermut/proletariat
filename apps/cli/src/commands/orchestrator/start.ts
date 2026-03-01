import { Flags } from '@oclif/core'
import * as path from 'node:path'
import * as fs from 'node:fs'
import Database from 'better-sqlite3'
import { PromptCommand } from '../../lib/prompt-command.js'
import { machineOutputFlags } from '../../lib/pmo/index.js'
import { findHQRoot } from '../../lib/workspace.js'
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
  ExecutionContext,
  ExecutorType,
  DEFAULT_EXECUTION_CONFIG,
} from '../../lib/execution/types.js'
import { runExecution } from '../../lib/execution/runners.js'
import { getHostTmuxSessionNames } from '../../lib/execution/session-utils.js'
import { ExecutionStorage } from '../../lib/execution/storage.js'
import {
  loadExecutionConfig,
  getTerminalApp,
  promptTerminalPreference,
  getShell,
  promptShellPreference,
  hasTerminalPreference,
  hasShellPreference,
} from '../../lib/execution/config.js'

export const ORCHESTRATOR_SESSION_NAME = 'prlt-orchestrator-main'

export default class OrchestratorStart extends PromptCommand {
  static description = 'Start the orchestrator agent in a tmux session'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --executor codex',
    '<%= config.bin %> <%= command.id %> --skip-permissions',
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
      options: ['claude-code', 'codex', 'aider', 'custom'],
    }),
    'skip-permissions': Flags.boolean({
      description: 'Run with --dangerously-skip-permissions',
      default: false,
      exclusive: ['sandboxed'],
    }),
    sandboxed: Flags.boolean({
      description: 'Run in sandboxed mode (requires approval for dangerous operations)',
      default: false,
      exclusive: ['skip-permissions'],
    }),
    background: Flags.boolean({
      char: 'b',
      description: 'Start detached (don\'t open terminal tab)',
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(OrchestratorStart)
    const jsonMode = shouldOutputJson(flags)

    // Check if orchestrator is already running
    const hostSessions = getHostTmuxSessionNames()
    if (hostSessions.includes(ORCHESTRATOR_SESSION_NAME)) {
      if (jsonMode) {
        outputErrorAsJson(
          'ALREADY_RUNNING',
          `Orchestrator is already running (session: ${ORCHESTRATOR_SESSION_NAME}). Use "prlt orchestrator attach" to reattach.`,
          createMetadata('orchestrator start', flags),
        )
        return
      }

      this.log('')
      this.log(styles.warning(`Orchestrator is already running (session: ${ORCHESTRATOR_SESSION_NAME})`))
      this.log('')

      const { choice } = await this.prompt<{ choice: string }>([{
        type: 'list',
        name: 'choice',
        message: 'What would you like to do?',
        choices: [
          { name: 'Attach to running orchestrator', value: 'attach', command: 'prlt orchestrator attach --json' },
          { name: 'Cancel', value: 'cancel' },
        ],
      }], jsonMode ? { flags, commandName: 'orchestrator start' } : null)

      if (choice === 'attach') {
        await this.config.runCommand('orchestrator:attach', [])
      }
      return
    }

    // Resolve HQ path
    const hqPath = findHQRoot(process.cwd())
    if (!hqPath) {
      if (jsonMode) {
        outputErrorAsJson('NO_HQ', 'Not in an HQ workspace. Run "prlt init" first.', createMetadata('orchestrator start', flags))
        return
      }
      this.error('Not in an HQ workspace. Run "prlt init" first.')
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
    let sandboxed: boolean
    if (flags['skip-permissions']) {
      sandboxed = false
    } else if (flags.sandboxed) {
      sandboxed = true
    } else {
      const permissionChoices = [
        { name: 'Sandboxed (requires approval for dangerous operations)', value: 'sandboxed', command: 'prlt orchestrator start --sandboxed --json' },
        { name: 'Accept all (--dangerously-skip-permissions)', value: 'skip', command: 'prlt orchestrator start --skip-permissions --json' },
      ]
      const permissionMessage = 'Select permission mode:'

      if (jsonMode) {
        outputPromptAsJson(
          buildPromptConfig('list', 'permissionMode', permissionMessage, permissionChoices),
          createMetadata('orchestrator start', flags),
        )
        return
      }

      const { permissionMode } = await this.prompt<{ permissionMode: string }>([{
        type: 'list',
        name: 'permissionMode',
        message: permissionMessage,
        choices: permissionChoices,
      }])
      sandboxed = permissionMode === 'sandboxed'
    }

    // Resolve action prompt
    let actionPrompt = flags.prompt
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
    // Use ticketId='prlt', actionName='orchestrator', agentName='main'
    // so buildSessionName produces 'prlt-orchestrator-main'
    const context: ExecutionContext = {
      ticketId: 'prlt',
      ticketTitle: 'Orchestrator',
      agentName: 'main',
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
    executionConfig.sandboxed = sandboxed

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

    // If no terminal preference saved, prompt for it (first run only)
    if (!jsonMode && db) {
      if (!hasTerminalPreference(db)) {
        executionConfig.terminal.app = await promptTerminalPreference(db)
      } else {
        executionConfig.terminal.app = await getTerminalApp(db)
      }

      if (!hasShellPreference(db)) {
        executionConfig.shell = await promptShellPreference(db)
      } else {
        executionConfig.shell = await getShell(db)
      }
    }

    // Show what we're doing
    if (!jsonMode) {
      this.log('')
      this.log(styles.muted(`   Starting orchestrator...`))
      this.log(styles.muted(`   Executor: ${selectedExecutor}`))
      this.log(styles.muted(`   Permission mode: ${sandboxed ? 'sandboxed' : 'skip-permissions'}`))
      this.log(styles.muted(`   Directory: ${hqPath}`))
      if (actionPrompt) {
        this.log(styles.muted(`   Prompt: "${actionPrompt.substring(0, 60)}${actionPrompt.length > 60 ? '...' : ''}"`))
      }
      this.log('')
    }

    // Launch orchestrator
    const displayMode = flags.background ? 'background' : 'terminal'
    const result = await runExecution('host', context, selectedExecutor, executionConfig, {
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
            environment: 'host',
            displayMode,
            sandboxed,
            sessionId: result.sessionId || ORCHESTRATOR_SESSION_NAME,
          })
        } catch {
          // Non-fatal: poke won't work but orchestrator is running
        }
      }

      if (jsonMode) {
        outputSuccessAsJson({
          sessionId: result.sessionId || ORCHESTRATOR_SESSION_NAME,
          executor: selectedExecutor,
          sandboxed,
          displayMode,
          directory: hqPath,
        }, createMetadata('orchestrator start', flags as Record<string, unknown>))
      }

      if (flags.background) {
        this.log(styles.success(`Orchestrator started in background`))
        this.log(styles.muted(`   Session: ${result.sessionId || ORCHESTRATOR_SESSION_NAME}`))
        this.log(styles.muted(`   Attach with: prlt orchestrator attach`))
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
