import { Flags } from '@oclif/core'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { execSync } from 'node:child_process'
import { PromptCommand } from '../../lib/prompt-command.js'
import { machineOutputFlags } from '../../lib/pmo/index.js'
import { SqliteDatabase } from '../../lib/database/sqlite.js'
import { findHQRoot } from '../../lib/workspace.js'
import {
  getWorkspaceInfo,
  createEphemeralAgent,
  WorkspaceInfo,
} from '../../lib/agents/commands.js'
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'
import { styles } from '../../lib/styles.js'
import {
  DisplayMode,
  OutputMode,
  ExecutionContext,
  ExecutionEnvironment,
  PermissionMode,
  DEFAULT_EXECUTION_CONFIG,
} from '../../lib/execution/types.js'
import { runExecution, isDockerRunning, isGitHubTokenAvailable, isDevcontainerCliInstalled } from '../../lib/execution/runners.js'
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
import { hasDevcontainerConfig } from '../../lib/execution/devcontainer.js'

// Catch-all devcontainer image for directories without .devcontainer
const CATCHALL_DEVCONTAINER_IMAGE = 'ghcr.io/chrismcdermut/proletariat-claude:latest'

export default class QA extends PromptCommand {
  static description = 'Spawn an exploratory QA agent to autonomously test the CLI (no ticket required)'

  static aliases = ['explore']

  static examples = [
    '<%= config.bin %> <%= command.id %>                      # Quick launch QA agent',
    '<%= config.bin %> <%= command.id %> --seed                # Seed test data first',
    '<%= config.bin %> <%= command.id %> --watch               # Stream agent\'s tmux screen',
    '<%= config.bin %> <%= command.id %> --environment host    # Run on host instead of container',
    '<%= config.bin %> <%= command.id %> --seed --watch        # Seed data and watch live',
  ]

  static flags = {
    ...machineOutputFlags,
    seed: Flags.boolean({
      char: 's',
      description: 'Seed test data before starting QA (runs seed-explore-data.mjs)',
      default: false,
    }),
    watch: Flags.boolean({
      char: 'w',
      description: 'Stream the agent\'s tmux screen to your terminal in real-time',
      default: false,
    }),
    environment: Flags.string({
      char: 'e',
      description: 'Where to run (devcontainer or host)',
      options: ['devcontainer', 'host'],
    }),
    'display-mode': Flags.string({
      char: 'd',
      description: 'How to display output (foreground=current terminal, terminal=new tab, background=detached)',
      options: ['terminal', 'background', 'foreground'],
    }),
    'permission-mode': Flags.string({
      char: 'p',
      description: 'Permission mode (danger: skip prompts, safe: require approval)',
      options: ['danger', 'safe'],
    }),
    prompt: Flags.string({
      description: 'Additional instructions to append to the QA prompt',
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(QA)
    const jsonMode = shouldOutputJson(flags)

    const workDir = process.cwd()

    // Check if we're inside an HQ
    const hqPath = findHQRoot(workDir)

    if (hqPath) {
      await this.runTracked(hqPath, workDir, flags, jsonMode)
    } else {
      await this.runYolo(workDir, flags, jsonMode)
    }
  }

  /**
   * Load the explore-cli action prompt from PMO storage.
   */
  private async getExploreCLIPrompt(): Promise<{ prompt: string; endPrompt?: string }> {
    try {
      const { getPMOContext } = await import('../../lib/pmo/index.js')
      const pmoContext = await getPMOContext()
      const action = await pmoContext.storage.getAction('explore-cli')
      if (action) {
        return { prompt: action.prompt, endPrompt: action.endPrompt ?? undefined }
      }
    } catch {
      // PMO not available - use fallback
    }

    // Fallback: return a minimal explore-cli prompt
    return {
      prompt: `# Action: Explore CLI (Autonomous QA)

You are an AI QA tester for the prlt CLI. You have access to a tmux session where the CLI is running.
Your job is to **systematically explore every menu, try every option, and find bugs**.

## Getting Started

1. Start a tmux session for testing:
   \`\`\`
   tmux_start_session({ session: "qa-test", command: "prlt" })
   \`\`\`
2. Wait a moment, then capture the screen to see the main menu:
   \`\`\`
   tmux_capture_pane({ session: "qa-test" })
   \`\`\`
3. Begin systematic exploration of all menus and features.

## When You Find a Bug

1. Document exact reproduction steps
2. Capture the screen showing the bug
3. File a ticket using the ticket_create MCP tool with category "bug"

## Session Management

- If the CLI crashes, restart it: kill the session and start a new one
- If you get stuck, use Ctrl+C to escape, or kill and restart the session`,
      endPrompt: `## Wrap-Up

Summarize your findings: list all bugs found with their ticket IDs, areas tested, and overall assessment.
Clean up your tmux session when done.`,
    }
  }

  /**
   * Run seed-explore-data.mjs to pre-populate test data.
   */
  private async runSeedData(hqPath: string): Promise<boolean> {
    // Look for seed script in the prlt source repo or fallback paths
    const seedPaths = [
      path.join(hqPath, 'scripts', 'seed-explore-data.mjs'),
      path.join(hqPath, 'repos', 'proletariat', 'scripts', 'seed-explore-data.mjs'),
    ]

    // Also check workspace repos for the script
    try {
      const workspaceInfo = getWorkspaceInfo()
      for (const repo of workspaceInfo.repositories) {
        const repoSeedPath = path.join(workspaceInfo.path, repo.path || repo.name, 'scripts', 'seed-explore-data.mjs')
        if (!seedPaths.includes(repoSeedPath)) {
          seedPaths.push(repoSeedPath)
        }
      }
    } catch {
      // Workspace info not available
    }

    // Find the global prlt installation directory for bundled seed script
    try {
      const prltPath = execSync('which prlt', { encoding: 'utf-8' }).trim()
      const prltDir = path.dirname(path.dirname(prltPath)) // Go up from bin/ to package root
      const globalSeedPath = path.join(prltDir, 'lib', 'node_modules', '@proletariat', 'cli', 'scripts', 'seed-explore-data.mjs')
      if (!seedPaths.includes(globalSeedPath)) {
        seedPaths.push(globalSeedPath)
      }
    } catch {
      // Can't find prlt path
    }

    for (const seedPath of seedPaths) {
      if (fs.existsSync(seedPath)) {
        this.log(styles.muted(`   Running seed script: ${seedPath}`))
        try {
          execSync(`node "${seedPath}"`, {
            cwd: hqPath,
            stdio: 'inherit',
            timeout: 60_000,
          })
          this.log(styles.success('   Test data seeded successfully'))
          return true
        } catch (error) {
          this.warn(`Seed script failed: ${error instanceof Error ? error.message : error}`)
          return false
        }
      }
    }

    // No seed script found - use prlt commands directly as fallback
    this.log(styles.muted('   Seed script not found, creating minimal test data with prlt commands...'))
    try {
      execSync('prlt project create --name "QA Test Project" --description "Auto-generated project for QA testing" --json 2>/dev/null || true', {
        cwd: hqPath,
        encoding: 'utf-8',
        timeout: 30_000,
      })
      execSync('prlt ticket create --title "Sample ticket for QA" --priority P2 --category feature --project "QA Test Project" --json 2>/dev/null || true', {
        cwd: hqPath,
        encoding: 'utf-8',
        timeout: 30_000,
      })
      this.log(styles.success('   Minimal test data created'))
      return true
    } catch {
      this.warn('Could not seed test data. QA agent will work with existing data.')
      return false
    }
  }

  /**
   * Run in tracked mode - inside an HQ
   * Creates an ephemeral QA agent with full tracking
   */
  private async runTracked(
    hqPath: string,
    workDir: string,
    flags: {
      seed: boolean
      watch: boolean
      environment?: string
      'display-mode'?: string
      'permission-mode'?: string
      prompt?: string
      json: boolean
    },
    jsonMode: boolean
  ): Promise<void> {
    this.log('')
    this.log(styles.header('🔍 Exploratory QA Agent'))
    this.log(styles.muted(`   HQ: ${hqPath}`))
    this.log('')

    // Get workspace info
    let workspaceInfo: WorkspaceInfo
    try {
      workspaceInfo = getWorkspaceInfo()
    } catch {
      if (jsonMode) {
        outputErrorAsJson('WORKSPACE_ERROR', 'Failed to get workspace info', createMetadata('qa', flags))
        return
      }
      this.error('Failed to get workspace info')
    }

    // Open database
    const dbPath = path.join(hqPath, '.proletariat', 'workspace.db')
    const db = SqliteDatabase.open(dbPath)
    const executionStorage = new ExecutionStorage(db)

    try {
      // Seed data if requested
      if (flags.seed) {
        this.log(styles.muted('   Seeding test data...'))
        await this.runSeedData(hqPath)
        this.log('')
      }

      // Get PMO context for ticket creation
      const { getPMOContext } = await import('../../lib/pmo/index.js')
      let pmoPath: string
      let storage: Awaited<ReturnType<typeof getPMOContext>>['storage']
      try {
        const pmoContext = await getPMOContext()
        pmoPath = pmoContext.pmoPath
        storage = pmoContext.storage
      } catch {
        if (jsonMode) {
          outputErrorAsJson('PMO_NOT_FOUND', 'PMO not found. Run "prlt pmo init" first.', createMetadata('qa', flags))
          return
        }
        this.error('PMO not found. Run "prlt pmo init" first.')
      }

      // Select project for filing bugs
      const jsonModeConfig = jsonMode ? { flags: flags as Record<string, unknown>, commandName: 'qa' } : null
      const projects = await storage.listProjects()
      let projectId: string

      if (projects.length === 0) {
        db.close()
        if (jsonMode) {
          outputErrorAsJson('NO_PROJECTS', 'No projects found. Create a project first, or use --seed.', createMetadata('qa', flags))
          return
        }
        this.error('No projects found. Create a project first, or use --seed to create test data.')
      } else if (projects.length === 1) {
        projectId = projects[0].id
      } else {
        const { selectedProject } = await this.prompt<{ selectedProject: string }>([
          {
            type: 'list',
            name: 'selectedProject',
            message: 'Select project for QA (bugs will be filed here):',
            choices: projects.map((p: { name: string; id: string }) => ({
              name: `${p.name} (${p.id})`,
              value: p.id,
              command: `prlt qa --json`,
            })),
          },
        ], jsonModeConfig)
        if (jsonMode) { db.close(); return }
        projectId = selectedProject
      }

      // Resolve environment
      const environment = await this.resolveEnvironment(workDir, flags, jsonMode, jsonModeConfig)
      if (jsonMode && !flags.environment) { db.close(); return }

      // Resolve display mode (--watch forces foreground)
      let displayMode: DisplayMode
      if (flags.watch) {
        displayMode = 'foreground'
      } else {
        displayMode = await this.resolveDisplayMode(flags, jsonMode, jsonModeConfig, environment)
        if (jsonMode && !flags['display-mode'] && !flags.watch) { db.close(); return }
      }

      // Resolve permission mode (default to danger for QA since it's in a container)
      const permissionMode = await this.resolvePermissionMode(flags, jsonMode, jsonModeConfig, environment, displayMode)
      if (jsonMode && !flags['permission-mode']) { db.close(); return }

      // Create an adhoc QA ticket
      const ticket = await storage.createTicket(projectId!, {
        title: `QA: Exploratory testing session`,
        description: 'Automated QA exploration session spawned by `prlt qa`',
        category: 'test',
        priority: 'P2',
      })
      if (!jsonMode) this.log(styles.success(`   Created QA ticket: ${ticket.id}`))

      // Create ephemeral agent
      if (!jsonMode) this.log(styles.muted('   Creating ephemeral agent...'))
      let ephemeralResult: { name: string; worktreePath: string }
      try {
        ephemeralResult = await createEphemeralAgent(workspaceInfo, {
          skipDevcontainer: environment === 'host',
          log: (msg) => { if (!jsonMode) this.log(styles.muted(`   ${msg}`)) },
        })
      } catch (agentError) {
        // Rollback ticket
        if (!jsonMode) this.log(styles.muted('   Rolling back ticket creation...'))
        try { await storage.deleteTicket(ticket.id) } catch { /* ignore */ }
        throw agentError
      }

      const agentName = ephemeralResult.name
      const agentDir = ephemeralResult.worktreePath
      if (!jsonMode) this.log(styles.success(`   Agent: ${agentName}`))

      // Load explore-cli action prompt
      const actionData = await this.getExploreCLIPrompt()
      let actionPrompt = actionData.prompt
      if (flags.prompt) {
        actionPrompt += `\n\n## Additional Instructions\n\n${flags.prompt}`
      }

      // Build execution context
      const context: ExecutionContext = {
        ticketId: ticket.id,
        ticketTitle: ticket.title,
        ticketDescription: ticket.description,
        agentName,
        agentDir,
        worktreePath: agentDir,
        branch: 'main',
        hqPath,
        pmoPath,
        actionId: 'explore-cli',
        actionName: 'Explore-CLI',
        actionPrompt,
        actionEndPrompt: actionData.endPrompt,
        modifiesCode: false,
      }

      // Create execution record
      const execution = executionStorage.createExecution({
        ticketId: ticket.id,
        agentName,
        executor: 'claude-code',
        environment,
        displayMode,
        permissionMode,
        branch: 'main',
      })

      // Update ticket assignee
      await storage.updateTicket(ticket.id, { assignee: agentName })

      // Load execution config
      const executionConfig = loadExecutionConfig(db)
      executionConfig.permissionMode = permissionMode
      executionConfig.outputMode = 'interactive' as OutputMode

      // For terminal mode, ensure terminal preference is set
      if (displayMode === 'terminal' && !jsonMode) {
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

      // Show summary
      this.log('')
      this.log(styles.muted(`   Ticket: ${ticket.id}`))
      this.log(styles.muted(`   Agent: ${agentName}`))
      this.log(styles.muted(`   Work ID: ${execution.id}`))
      this.log(styles.muted(`   Environment: ${environment === 'devcontainer' ? '🐳' : '💻'} ${environment}`))
      this.log(styles.muted(`   Display: ${displayMode}${flags.watch ? ' (watch mode)' : ''}`))
      this.log(styles.muted(`   Permissions: ${permissionMode === 'safe' ? '🔒 safe' : '⚠️  danger'}`))
      this.log('')

      // Run execution
      this.log(styles.muted('Starting QA agent...'))

      const result = await runExecution(environment, context, 'claude-code', executionConfig, {
        displayMode,
        sessionManager: environment === 'devcontainer' ? 'tmux' : undefined,
      })

      if (result.success) {
        executionStorage.updateStatus(execution.id, 'running')
        executionStorage.updateProcessInfo(execution.id, {
          pid: result.pid,
          containerId: result.containerId,
          sessionId: result.sessionId,
          logPath: result.logPath,
        })

        this.log('')
        this.log(styles.success(`✓ QA session started (${execution.id})`))
        this.log('')
        this.log(styles.muted('Commands:'))
        this.log(styles.muted(`  prlt work status              View work status`))
        this.log(styles.muted(`  prlt session attach           Attach to session`))
        this.log(styles.muted(`  prlt work stop ${execution.id}    Stop QA`))
        if (!flags.watch && result.sessionId) {
          this.log(styles.muted(`  tmux attach -t "${result.sessionId}"    Watch live`))
        }
      } else {
        executionStorage.updateStatus(execution.id, 'failed')
        this.error(`Failed to start QA session: ${result.error}`)
      }

      db.close()
    } catch (error) {
      db.close()
      throw error
    }
  }

  /**
   * Run in yolo mode - outside any HQ
   */
  private async runYolo(
    workDir: string,
    flags: {
      seed: boolean
      watch: boolean
      environment?: string
      'display-mode'?: string
      'permission-mode'?: string
      prompt?: string
      json: boolean
    },
    jsonMode: boolean
  ): Promise<void> {
    this.log('')
    this.log(styles.header('🔍 Exploratory QA Agent (Yolo Mode)'))
    this.log(styles.muted('   No HQ detected - running without tracking'))
    this.log('')

    if (flags.seed) {
      this.log(styles.warning('   --seed requires an HQ. Skipping seed step.'))
      this.log(styles.muted('   Run "prlt new" first to set up an HQ, then use --seed.'))
      this.log('')
    }

    const jsonModeConfig = jsonMode ? { flags: flags as Record<string, unknown>, commandName: 'qa' } : null

    // Resolve environment
    const environment = await this.resolveEnvironment(workDir, flags, jsonMode, jsonModeConfig)
    if (jsonMode && !flags.environment) return

    // Resolve display mode (--watch forces foreground)
    let displayMode: DisplayMode
    if (flags.watch) {
      displayMode = 'foreground'
    } else {
      displayMode = await this.resolveDisplayMode(flags, jsonMode, jsonModeConfig, environment)
      if (jsonMode && !flags['display-mode'] && !flags.watch) return
    }

    // Resolve permission mode
    const permissionMode = await this.resolvePermissionMode(flags, jsonMode, jsonModeConfig, environment, displayMode)
    if (jsonMode && !flags['permission-mode']) return

    const sessionName = `qa-explore-${Date.now().toString(36)}`

    // Load explore-cli prompt
    const actionData = await this.getExploreCLIPrompt()
    let actionPrompt = actionData.prompt
    if (flags.prompt) {
      actionPrompt += `\n\n## Additional Instructions\n\n${flags.prompt}`
    }

    // Prepare devcontainer if needed
    const hasProjectDevcontainer = hasDevcontainerConfig(workDir)
    let devcontainerConfigDir = workDir
    let cleanupDevcontainer: (() => void) | undefined

    if (environment === 'devcontainer' && !hasProjectDevcontainer) {
      const imageCheck = await this.checkCatchallImage()
      if (!imageCheck.available) {
        if (jsonMode) {
          outputErrorAsJson('CONTAINER_IMAGE_UNAVAILABLE', imageCheck.error!, createMetadata('qa', flags))
          return
        }
        this.error(imageCheck.error!)
      }

      this.log(styles.muted(`   Using catch-all devcontainer: ${CATCHALL_DEVCONTAINER_IMAGE}`))
      const devcontainerSetup = await this.setupCatchallDevcontainer(workDir, 'qa-explore')
      devcontainerConfigDir = devcontainerSetup.configDir
      cleanupDevcontainer = devcontainerSetup.cleanup
    }

    // Build execution context
    const context: ExecutionContext = {
      ticketId: 'QA',
      ticketTitle: 'Exploratory QA Session',
      agentName: 'qa-agent',
      agentDir: workDir,
      worktreePath: devcontainerConfigDir,
      branch: 'main',
      actionId: 'explore-cli',
      actionName: 'Explore-CLI',
      actionPrompt,
      actionEndPrompt: actionData.endPrompt,
      modifiesCode: false,
    }

    // Load execution config
    const executionConfig = { ...DEFAULT_EXECUTION_CONFIG }
    executionConfig.permissionMode = permissionMode
    executionConfig.outputMode = 'interactive' as OutputMode

    // For terminal mode, prompt for terminal preference
    if (displayMode === 'terminal' && !jsonMode) {
      const homePrltDir = path.join(process.env.HOME || '', '.proletariat')
      fs.mkdirSync(homePrltDir, { recursive: true })
      const tempDbPath = path.join(homePrltDir, 'adhoc.db')
      const tempDb = new SqliteDatabase(tempDbPath)

      tempDb.exec(`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `)

      if (!hasTerminalPreference(tempDb)) {
        executionConfig.terminal.app = await promptTerminalPreference(tempDb)
      } else {
        executionConfig.terminal.app = await getTerminalApp(tempDb)
      }

      if (!hasShellPreference(tempDb)) {
        executionConfig.shell = await promptShellPreference(tempDb)
      } else {
        executionConfig.shell = await getShell(tempDb)
      }

      tempDb.close()
    }

    // Show summary
    this.log('')
    this.log(styles.muted(`   Session: ${sessionName}`))
    this.log(styles.muted(`   Directory: ${workDir}`))
    this.log(styles.muted(`   Environment: ${environment === 'devcontainer' ? '🐳' : '💻'} ${environment}`))
    this.log(styles.muted(`   Display: ${displayMode}${flags.watch ? ' (watch mode)' : ''}`))
    this.log(styles.muted(`   Permissions: ${permissionMode === 'safe' ? '🔒 safe' : '⚠️  danger'}`))
    this.log('')

    // Run execution
    this.log(styles.muted('Starting QA agent...'))

    try {
      const result = await runExecution(environment, context, 'claude-code', executionConfig, {
        displayMode,
        sessionManager: environment === 'devcontainer' ? 'tmux' : undefined,
      })

      if (result.success) {
        this.log('')
        this.log(styles.success(`✓ QA session started: ${sessionName}`))
        if (displayMode === 'background' && result.sessionId) {
          this.log(styles.muted(`   Watch live: tmux attach -t "${result.sessionId}"`))
        }
        if (cleanupDevcontainer) cleanupDevcontainer()
      } else {
        if (cleanupDevcontainer) cleanupDevcontainer()
        this.error(`Failed to start QA session: ${result.error}`)
      }
    } catch (error) {
      if (cleanupDevcontainer) cleanupDevcontainer()
      throw error
    }
  }

  // ─── Shared helpers ─────────────────────────────────────────────────

  /**
   * Resolve execution environment (devcontainer vs host).
   */
  private async resolveEnvironment(
    workDir: string,
    flags: { environment?: string; json: boolean },
    jsonMode: boolean,
    jsonModeConfig: { flags: Record<string, unknown>; commandName: string } | null
  ): Promise<ExecutionEnvironment> {
    if (flags.environment) {
      return flags.environment as ExecutionEnvironment
    }

    const hasProjectDevcontainer = hasDevcontainerConfig(workDir)
    const devcontainerLabel = hasProjectDevcontainer
      ? '🐳 devcontainer (uses project config, isolated)'
      : '🐳 devcontainer (uses catch-all container, isolated)'

    if (jsonMode) {
      await this.prompt<{ selectedEnv: string }>([
        {
          type: 'list',
          name: 'selectedEnv',
          message: 'Where should the QA agent run?',
          choices: [
            { name: devcontainerLabel, value: 'devcontainer', command: `prlt qa --environment devcontainer --json` },
            { name: '💻 host (runs directly on your machine)', value: 'host', command: `prlt qa --environment host --json` },
          ],
          default: 'devcontainer',
        },
      ], jsonModeConfig)
      return 'host' // unreachable after JSON output
    }

    // Interactive: loop to handle Docker not running
    while (true) {
      // eslint-disable-next-line no-await-in-loop -- Interactive user prompt in loop
      const { selectedEnv } = await this.prompt<{ selectedEnv: string }>([
        {
          type: 'list',
          name: 'selectedEnv',
          message: 'Where should the QA agent run?',
          choices: [
            { name: devcontainerLabel, value: 'devcontainer' },
            { name: '💻 host (runs directly on your machine)', value: 'host' },
          ],
          default: 'devcontainer',
        },
      ], null)

      if (selectedEnv === 'devcontainer') {
        if (!isDockerRunning()) {
          this.log('')
          this.warn('Docker is not running. Please start Docker and try again.')
          this.log('')
          continue
        }

        if (!isDevcontainerCliInstalled()) {
          this.log('')
          this.warn(
            'devcontainer CLI is not installed.\n' +
            'Install with: npm install -g @devcontainers/cli\n' +
            'Or select "host" to run directly on your machine.'
          )
          this.log('')
          continue
        }

        if (!isGitHubTokenAvailable()) {
          this.log('')
          this.warn('GitHub token not found. Git push may fail inside the container.')
          this.log('')

          // eslint-disable-next-line no-await-in-loop -- Interactive user prompt in loop
          const { tokenAction } = await this.prompt<{ tokenAction: string }>([
            {
              type: 'list',
              name: 'tokenAction',
              message: 'Continue without GitHub token?',
              choices: [
                { name: 'Yes, continue anyway', value: 'continue' },
                { name: 'No, let me run gh auth login first', value: 'cancel' },
                { name: 'Switch to host mode instead', value: 'host' },
              ],
              default: 'continue',
            },
          ], null)

          if (tokenAction === 'cancel') {
            this.log(styles.muted('Run `gh auth login` and try again.'))
            this.exit(0)
          }
          if (tokenAction === 'host') return 'host'
        }
      }

      return selectedEnv as ExecutionEnvironment
    }
  }

  /**
   * Resolve display mode.
   */
  private async resolveDisplayMode(
    flags: { 'display-mode'?: string; json: boolean },
    jsonMode: boolean,
    jsonModeConfig: { flags: Record<string, unknown>; commandName: string } | null,
    environment: string
  ): Promise<DisplayMode> {
    if (flags['display-mode']) {
      return flags['display-mode'] as DisplayMode
    }

    const { selectedDisplay } = await this.prompt<{ selectedDisplay: string }>([
      {
        type: 'list',
        name: 'selectedDisplay',
        message: 'How should output be displayed?',
        choices: [
          { name: '▶️  Foreground  - Run in current terminal, watch live (recommended for QA)', value: 'foreground', command: `prlt qa --environment ${environment} --display-mode foreground --json` },
          { name: '🖥️  New tab      - Opens in new terminal tab', value: 'terminal', command: `prlt qa --environment ${environment} --display-mode terminal --json` },
          { name: '📦 Background  - Runs detached, reattach later', value: 'background', command: `prlt qa --environment ${environment} --display-mode background --json` },
        ],
        default: 'foreground',
      },
    ], jsonModeConfig)
    if (jsonMode) return 'foreground' // unreachable
    return selectedDisplay as DisplayMode
  }

  /**
   * Resolve permission mode. Defaults to danger for QA (container provides isolation).
   */
  private async resolvePermissionMode(
    flags: { 'permission-mode'?: string; json: boolean },
    jsonMode: boolean,
    jsonModeConfig: { flags: Record<string, unknown>; commandName: string } | null,
    environment: string,
    displayMode: string
  ): Promise<PermissionMode> {
    if (flags['permission-mode']) {
      return (flags['permission-mode'] || 'safe') as PermissionMode
    }

    const containerNote = environment === 'devcontainer' ? ' (container provides isolation)' : ''
    const { permissionMode } = await this.prompt<{ permissionMode: string }>([
      {
        type: 'list',
        name: 'permissionMode',
        message: `Permission mode${containerNote}:`,
        choices: [
          { name: '⚠️  danger - Skip permission checks (faster, recommended for QA)', value: 'danger', command: `prlt qa --environment ${environment} --display-mode ${displayMode} --permission-mode danger --json` },
          { name: '🔒 safe   - Requires approval for dangerous operations', value: 'safe', command: `prlt qa --environment ${environment} --display-mode ${displayMode} --permission-mode safe --json` },
        ],
        default: 'danger',
      },
    ], jsonModeConfig)
    if (jsonMode) return 'safe' // unreachable
    return permissionMode as PermissionMode
  }

  /**
   * Set up catch-all devcontainer for directories without one.
   */
  private async setupCatchallDevcontainer(workDir: string, slug: string): Promise<{ configDir: string; workDir: string; cleanup: () => void }> {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-qa-'))
    const devcontainerDir = path.join(tempDir, '.devcontainer')
    fs.mkdirSync(devcontainerDir, { recursive: true })

    const devcontainerJson = {
      name: `qa-${slug}`,
      image: CATCHALL_DEVCONTAINER_IMAGE,
      customizations: {
        vscode: {
          extensions: ['anthropic.claude-code'],
        },
      },
      remoteUser: 'node',
      workspaceFolder: '/workspace',
      mounts: [
        `source=${workDir},target=/workspace,type=bind`,
      ],
      containerEnv: {
        ANTHROPIC_API_KEY: '${localEnv:ANTHROPIC_API_KEY}',
      },
    }

    fs.writeFileSync(
      path.join(devcontainerDir, 'devcontainer.json'),
      JSON.stringify(devcontainerJson, null, 2)
    )

    this.log(styles.muted('   Created temporary .devcontainer config'))

    const cleanup = () => {
      try {
        if (fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true })
        }
      } catch {
        // Ignore cleanup errors
      }
    }

    return { configDir: tempDir, workDir, cleanup }
  }

  /**
   * Check if catch-all container image is available.
   */
  private async checkCatchallImage(): Promise<{ available: boolean; error?: string }> {
    try {
      execSync(`docker image inspect ${CATCHALL_DEVCONTAINER_IMAGE}`, { stdio: 'pipe' })
      return { available: true }
    } catch {
      this.log(styles.muted(`   Pulling container image: ${CATCHALL_DEVCONTAINER_IMAGE}`))
      try {
        execSync(`docker pull ${CATCHALL_DEVCONTAINER_IMAGE}`, { stdio: 'pipe', timeout: 120000 })
        return { available: true }
      } catch {
        return {
          available: false,
          error: `Failed to pull catch-all container image: ${CATCHALL_DEVCONTAINER_IMAGE}. Try running on host instead.`,
        }
      }
    }
  }
}
