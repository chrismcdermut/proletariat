import { Flags } from '@oclif/core'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { execSync } from 'node:child_process'
import { PromptCommand } from '../../lib/prompt-command.js'
import { machineOutputFlags } from '../../lib/pmo/index.js'
import Database from 'better-sqlite3'
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

/**
 * Check for uncommitted changes in git repo
 */
function hasUncommittedChanges(dir: string): boolean {
  try {
    const status = execSync('git status --porcelain', { cwd: dir, encoding: 'utf-8' })
    return status.trim().length > 0
  } catch {
    return false
  }
}

/**
 * Check if directory is a git repo
 */
function isGitRepo(dir: string): boolean {
  try {
    execSync('git rev-parse --git-dir', { cwd: dir, stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

export default class Claude extends PromptCommand {
  static description = 'Quick launch Claude Code for ad-hoc sessions (works anywhere)'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --slug debug-auth --permission-mode danger',
    '<%= config.bin %> <%= command.id %> --environment devcontainer --display-mode background',
    '<%= config.bin %> <%= command.id %> --prompt "help me debug this function"',
  ]

  static flags = {
    ...machineOutputFlags,
    slug: Flags.string({
      char: 's',
      description: 'Session name for pane/tab title',
    }),
    'permission-mode': Flags.string({
      char: 'p',
      description: 'Permission mode (danger: skip prompts, safe: require approval)',
      options: ['danger', 'safe'],
    }),
    environment: Flags.string({
      char: 'e',
      description: 'Where to run (host, sandbox, devcontainer, cloud)',
      options: ['host', 'sandbox', 'devcontainer', 'cloud'],
    }),
    'display-mode': Flags.string({
      char: 'd',
      description: 'How to display output',
      options: ['terminal', 'background', 'foreground'],
    }),
    prompt: Flags.string({
      description: 'Initial task/prompt for Claude',
    }),
    directory: Flags.string({
      description: 'Directory to run in (default: cwd)',
    }),
    // Inside HQ only flags
    project: Flags.string({
      char: 'P',
      description: 'Project for adhoc ticket (inside HQ only)',
    }),
    title: Flags.string({
      char: 't',
      description: 'Ticket title (inside HQ only)',
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(Claude)
    const jsonMode = shouldOutputJson(flags)

    // Determine working directory
    const workDir = flags.directory ? path.resolve(flags.directory) : process.cwd()
    if (!fs.existsSync(workDir)) {
      if (jsonMode) {
        outputErrorAsJson('DIRECTORY_NOT_FOUND', `Directory not found: ${workDir}`, createMetadata('claude', flags))
        this.exit(1)
      }
      this.error(`Directory not found: ${workDir}`)
    }

    // Check if we're inside an HQ
    const hqPath = findHQRoot(workDir)

    if (hqPath) {
      await this.runInsideHQ(hqPath, workDir, flags, jsonMode)
    } else {
      await this.runOutsideHQ(workDir, flags, jsonMode)
    }
  }

  /**
   * Run in "yolo mode" - outside any HQ
   * No ticket creation, no tracking, just launch Claude
   */
  private async runOutsideHQ(
    workDir: string,
    flags: {
      slug?: string
      'permission-mode'?: string
      environment?: string
      'display-mode'?: string
      prompt?: string
      json: boolean
    },
    jsonMode: boolean
  ): Promise<void> {
    this.log('')
    this.log(styles.header('🚀 Ad-hoc Claude Session (Yolo Mode)'))
    this.log(styles.muted('   No HQ detected - running without tracking'))
    this.log('')

    // Prompt for slug (session name)
    const jsonModeConfig = jsonMode ? { flags: flags as Record<string, unknown>, commandName: 'claude' } : null
    let slug = flags.slug
    if (!slug) {
      const { inputSlug } = await this.prompt<{ inputSlug: string }>([
        {
          type: 'input',
          name: 'inputSlug',
          message: 'Session name (for tab/pane title):',
          default: path.basename(workDir),
          validate: (input: unknown) => (input as string).trim() ? true : 'Session name required',
        },
      ], jsonModeConfig)
      if (jsonMode) return
      slug = inputSlug.trim()
    }

    // Determine if devcontainer is available
    const hasProjectDevcontainer = hasDevcontainerConfig(workDir)

    // Prompt for environment
    let environment: ExecutionEnvironment = 'host'
    if (flags.environment) {
      environment = flags.environment as ExecutionEnvironment
    } else {
      // Build devcontainer label
      const devcontainerLabel = hasProjectDevcontainer
        ? '🐳 devcontainer (uses project config, isolated)'
        : '🐳 devcontainer (uses catch-all container, isolated)'

      // In JSON mode, output environment prompt and exit
      if (jsonMode) {
        await this.prompt<{ selectedEnv: string }>([
          {
            type: 'list',
            name: 'selectedEnv',
            message: 'Where should Claude run?',
            choices: [
              {
                name: devcontainerLabel,
                value: 'devcontainer',
                command: `prlt claude --slug "${slug}" --environment devcontainer --json`,
              },
              {
                name: '🔒 sandbox (srt isolation on host)',
                value: 'sandbox',
                command: `prlt claude --slug "${slug}" --environment sandbox --json`,
              },
              {
                name: '💻 host (runs directly on your machine)',
                value: 'host',
                command: `prlt claude --slug "${slug}" --environment host --json`,
              },
            ],
            default: 'devcontainer',
          },
        ], jsonModeConfig)
        return // unreachable, but satisfies TypeScript
      }

      // Interactive mode: loop to handle Docker not running
      let environmentSelected = false
      while (!environmentSelected) {
        // eslint-disable-next-line no-await-in-loop -- Interactive user prompt in loop
        const { selectedEnv } = await this.prompt<{ selectedEnv: string }>([
          {
            type: 'list',
            name: 'selectedEnv',
            message: 'Where should Claude run?',
            choices: [
              {
                name: devcontainerLabel,
                value: 'devcontainer',
              },
              { name: '🔒 sandbox (srt isolation on host)', value: 'sandbox' },
              { name: '💻 host (runs directly on your machine)', value: 'host' },
            ],
            default: 'devcontainer',
          },
        ], null)

        if (selectedEnv === 'devcontainer') {
          // Dynamically check Docker when selected (user may have started it)
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

          // Check GitHub token is available for git push operations
          if (!isGitHubTokenAvailable()) {
            const tokenChoices = [
              { name: 'Yes, continue anyway (git push may fail)', value: 'continue', command: `prlt claude --slug "${slug}" --environment devcontainer --json` },
              { name: 'No, let me run gh auth login first', value: 'cancel' },
              { name: 'Switch to host mode instead', value: 'host', command: `prlt claude --slug "${slug}" --environment host --json` },
            ]
            const tokenMessage = 'GitHub token not found. Git push may fail. Continue without token?'

            this.log('')
            this.warn(
              'GitHub token not found.\n' +
              'Git push operations may fail inside the container.\n' +
              'Run `gh auth login` to authenticate, or continue without token.'
            )
            this.log('')

            // eslint-disable-next-line no-await-in-loop -- Interactive user prompt in loop
            const { tokenAction } = await this.prompt<{ tokenAction: string }>([
              {
                type: 'list',
                name: 'tokenAction',
                message: tokenMessage,
                choices: tokenChoices,
                default: 'continue',
              },
            ], null)

            if (tokenAction === 'cancel') {
              this.log(styles.muted('Run `gh auth login` and try again.'))
              return
            }

            if (tokenAction === 'host') {
              environment = 'host'
              environmentSelected = true
              continue
            }
            // tokenAction === 'continue' - fall through to devcontainer setup
          }
        }

        environment = selectedEnv as ExecutionEnvironment
        environmentSelected = true
      }
    }

    // Prompt for display mode
    let displayMode: DisplayMode = 'terminal'
    if (flags['display-mode']) {
      displayMode = flags['display-mode'] as DisplayMode
    } else {
      const { selectedDisplay } = await this.prompt<{ selectedDisplay: string }>([
        {
          type: 'list',
          name: 'selectedDisplay',
          message: 'How should output be displayed?',
          choices: [
            { name: '🖥️  New tab      - Opens in new terminal tab (recommended)', value: 'terminal', command: `prlt claude --slug "${slug}" --environment ${environment} --display-mode terminal --json` },
            { name: '▶️  Foreground  - Run in current terminal (blocking)', value: 'foreground', command: `prlt claude --slug "${slug}" --environment ${environment} --display-mode foreground --json` },
            { name: '📦 Background  - Runs detached, reattach later', value: 'background', command: `prlt claude --slug "${slug}" --environment ${environment} --display-mode background --json` },
          ],
          default: 'terminal',
        },
      ], jsonModeConfig)
      if (jsonMode) return
      displayMode = selectedDisplay as DisplayMode
    }

    // Prompt for permission mode
    let permissionMode: PermissionMode = 'safe'
    if (flags['permission-mode']) {
      permissionMode = (flags['permission-mode'] || 'safe') as PermissionMode
    } else {
      const { selectedMode } = await this.prompt<{ selectedMode: string }>([
        {
          type: 'list',
          name: 'selectedMode',
          message: 'Permission mode:',
          choices: [
            { name: '⚠️  danger - Skip permission checks (faster)', value: 'danger', command: `prlt claude --slug "${slug}" --environment ${environment} --display-mode ${displayMode} --permission-mode danger --json` },
            { name: '🔒 safe   - Requires approval for dangerous operations', value: 'safe', command: `prlt claude --slug "${slug}" --environment ${environment} --display-mode ${displayMode} --permission-mode safe --json` },
          ],
          default: 'danger',
        },
      ], jsonModeConfig)
      if (jsonMode) return
      permissionMode = selectedMode as PermissionMode
    }

    // Warn about uncommitted changes in danger mode
    if (permissionMode === 'danger' && isGitRepo(workDir) && hasUncommittedChanges(workDir)) {
      this.log('')
      this.warn('Running in danger mode with uncommitted changes!')
      this.log(styles.muted('   Consider committing or stashing changes first.'))
      this.log('')

      const { proceed } = await this.prompt<{ proceed: string }>([
        {
          type: 'list',
          name: 'proceed',
          message: 'Continue anyway?',
          choices: [
            { name: 'Yes, proceed', value: 'true' },
            { name: 'No, cancel', value: 'false' },
          ],
          default: 'true',
        },
      ], null)
      if (proceed !== 'true') {
        this.log(styles.muted('Cancelled.'))
        return
      }
    }

    // Build session name
    const sessionName = `adhoc-${slug}`

    // Prepare devcontainer if needed and not present
    let devcontainerConfigDir = workDir
    let cleanupDevcontainer: (() => void) | undefined
    if (environment === 'devcontainer' && !hasProjectDevcontainer) {
      // Check if catch-all image is available
      const imageCheck = await this.checkCatchallImage()
      if (!imageCheck.available) {
        if (jsonMode) {
          outputErrorAsJson('CONTAINER_IMAGE_UNAVAILABLE', imageCheck.error!, createMetadata('claude', flags))
          this.exit(1)
        }
        this.error(imageCheck.error!)
      }

      // Create temporary devcontainer config using catch-all image
      this.log(styles.muted(`   Using catch-all devcontainer: ${CATCHALL_DEVCONTAINER_IMAGE}`))
      const devcontainerSetup = await this.setupCatchallDevcontainer(workDir, slug!)
      devcontainerConfigDir = devcontainerSetup.configDir
      cleanupDevcontainer = devcontainerSetup.cleanup
    }

    // Build minimal execution context for yolo mode
    // Use devcontainerConfigDir for worktreePath so runner finds .devcontainer there
    const context: ExecutionContext = {
      ticketId: 'ADHOC',
      ticketTitle: `Ad-hoc: ${slug}`,
      agentName: 'adhoc',
      agentDir: workDir,
      worktreePath: devcontainerConfigDir, // Runner looks here for .devcontainer
      branch: 'adhoc',
      actionName: slug,
      actionPrompt: flags.prompt,
      modifiesCode: false, // Don't try to create branches
    }

    // Load execution config (use defaults for yolo mode)
    const executionConfig = { ...DEFAULT_EXECUTION_CONFIG }
    executionConfig.permissionMode = permissionMode
    executionConfig.outputMode = 'interactive' as OutputMode

    // For terminal mode, prompt for terminal preference
    if (displayMode === 'terminal' && !jsonMode) {
      const homePrltDir = path.join(process.env.HOME || '', '.proletariat')
      fs.mkdirSync(homePrltDir, { recursive: true })
      const tempDbPath = path.join(homePrltDir, 'adhoc.db')
      const tempDb = new Database(tempDbPath)

      // Ensure settings table exists
      tempDb.exec(`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `)

      if (!hasTerminalPreference(tempDb)) {
        const terminalApp = await promptTerminalPreference(tempDb)
        executionConfig.terminal.app = terminalApp
      } else {
        executionConfig.terminal.app = await getTerminalApp(tempDb)
      }

      if (!hasShellPreference(tempDb)) {
        const shell = await promptShellPreference(tempDb)
        executionConfig.shell = shell
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
    this.log(styles.muted(`   Display: ${displayMode}`))
    this.log(styles.muted(`   Permissions: ${permissionMode === 'safe' ? '🔒 safe' : '⚠️  danger'}`))
    if (flags.prompt) {
      this.log(styles.muted(`   Initial prompt: "${flags.prompt.substring(0, 50)}${flags.prompt.length > 50 ? '...' : ''}"`))
    }
    this.log('')

    // Run execution
    this.log(styles.muted('Starting Claude...'))

    try {
      const result = await runExecution(environment, context, 'claude-code', executionConfig, {
        displayMode,
        sessionManager: environment === 'devcontainer' ? 'tmux' : undefined,
      })

      if (result.success) {
        this.log('')
        this.log(styles.success(`✓ Session started: ${sessionName}`))
        if (displayMode === 'background') {
          this.log(styles.muted(`   Reattach with: tmux attach -t "${sessionName}"`))
        }
        // Clean up temp devcontainer config after session starts (container has cached the config)
        if (cleanupDevcontainer) {
          cleanupDevcontainer()
        }
      } else {
        // Clean up on failure
        if (cleanupDevcontainer) {
          cleanupDevcontainer()
        }
        this.error(`Failed to start session: ${result.error}`)
      }
    } catch (error) {
      // Clean up on error
      if (cleanupDevcontainer) {
        cleanupDevcontainer()
      }
      throw error
    }
  }

  /**
   * Run in "tracked mode" - inside an HQ
   * Creates adhoc ticket, ephemeral agent, full tracking
   */
  private async runInsideHQ(
    hqPath: string,
    workDir: string,
    flags: {
      slug?: string
      'permission-mode'?: string
      environment?: string
      'display-mode'?: string
      prompt?: string
      project?: string
      title?: string
      json: boolean
    },
    jsonMode: boolean
  ): Promise<void> {
    this.log('')
    this.log(styles.header('🚀 Ad-hoc Claude Session (Tracked)'))
    this.log(styles.muted(`   HQ: ${hqPath}`))
    this.log('')

    // Get workspace info
    let workspaceInfo: WorkspaceInfo
    try {
      workspaceInfo = getWorkspaceInfo()
    } catch {
      if (jsonMode) {
        outputErrorAsJson('WORKSPACE_ERROR', 'Failed to get workspace info', createMetadata('claude', flags))
        this.exit(1)
      }
      this.error('Failed to get workspace info')
    }

    // Open database
    const dbPath = path.join(hqPath, '.proletariat', 'workspace.db')
    const db = new Database(dbPath)
    const executionStorage = new ExecutionStorage(db)

    try {
      // Import PMO storage for ticket/project operations
      const { getPMOContext } = await import('../../lib/pmo/index.js')

      let pmoPath: string
      let storage: Awaited<ReturnType<typeof getPMOContext>>['storage']
      try {
        const pmoContext = await getPMOContext()
        pmoPath = pmoContext.pmoPath
        storage = pmoContext.storage
      } catch {
        if (jsonMode) {
          outputErrorAsJson('PMO_NOT_FOUND', 'PMO not found. Run "prlt pmo init" first.', createMetadata('claude', flags))
          this.exit(1)
        }
        this.error('PMO not found. Run "prlt pmo init" first.')
      }

      // Select project
      const jsonModeConfig = jsonMode ? { flags: flags as Record<string, unknown>, commandName: 'claude' } : null
      let projectId = flags.project
      if (!projectId) {
        const projects = await storage.listProjects()
        if (projects.length === 0) {
          db.close()
          if (jsonMode) {
            outputErrorAsJson('NO_PROJECTS', 'No projects found. Create a project first.', createMetadata('claude', flags))
            this.exit(1)
          }
          this.error('No projects found. Create a project first.')
        }

        if (projects.length === 1) {
          projectId = projects[0].id
        } else {
          const { selectedProject } = await this.prompt<{ selectedProject: string }>([
            {
              type: 'list',
              name: 'selectedProject',
              message: 'Select project for adhoc ticket:',
              choices: projects.map((p: { name: string; id: string }) => ({
                name: `${p.name} (${p.id})`,
                value: p.id,
                command: `prlt claude --project ${p.id} --json`,
              })),
            },
          ], jsonModeConfig)
          if (jsonMode) { db.close(); return }
          projectId = selectedProject
        }
      }

      // Get ticket title
      let ticketTitle = flags.title
      if (!ticketTitle) {
        const { inputTitle } = await this.prompt<{ inputTitle: string }>([
          {
            type: 'input',
            name: 'inputTitle',
            message: 'Ticket title:',
            default: `Ad-hoc session: ${path.basename(workDir)}`,
            validate: (input: unknown) => (input as string).trim() ? true : 'Title required',
          },
        ], jsonModeConfig)
        if (jsonMode) { db.close(); return }
        ticketTitle = inputTitle.trim()
      }

      // Get optional description
      let ticketDescription: string | undefined
      if (!jsonMode) {
        const { inputDesc } = await this.prompt<{ inputDesc: string }>([
          {
            type: 'input',
            name: 'inputDesc',
            message: 'Description (optional):',
          },
        ], null)
        if (inputDesc.trim()) {
          ticketDescription = inputDesc.trim()
        }
      }

      // Prompt for environment first (before creating ticket) so user can cancel early
      const hasProjectDevcontainer = hasDevcontainerConfig(workDir)

      // Build devcontainer label
      const devcontainerLabel = hasProjectDevcontainer
        ? '🐳 devcontainer (uses project config, isolated)'
        : '🐳 devcontainer (uses catch-all container, isolated)'

      let environment: ExecutionEnvironment = 'host'
      if (flags.environment) {
        environment = flags.environment as ExecutionEnvironment
      } else {
        // In JSON mode, output environment prompt and exit
        if (jsonMode) {
          await this.prompt<{ selectedEnv: string }>([
            {
              type: 'list',
              name: 'selectedEnv',
              message: 'Where should Claude run?',
              choices: [
                {
                  name: devcontainerLabel,
                  value: 'devcontainer',
                  command: `prlt claude --project ${projectId} --title "${ticketTitle}" --environment devcontainer --json`,
                },
                {
                  name: '🔒 sandbox (srt isolation on host)',
                  value: 'sandbox',
                  command: `prlt claude --project ${projectId} --title "${ticketTitle}" --environment sandbox --json`,
                },
                {
                  name: '💻 host (runs directly on your machine)',
                  value: 'host',
                  command: `prlt claude --project ${projectId} --title "${ticketTitle}" --environment host --json`,
                },
              ],
              default: 'devcontainer',
            },
          ], jsonModeConfig)
          db.close()
          return // unreachable, but satisfies TypeScript
        }

        // Interactive mode: loop to handle Docker not running
        let environmentSelected = false
        while (!environmentSelected) {
          // eslint-disable-next-line no-await-in-loop -- Interactive user prompt in loop
          const { selectedEnv } = await this.prompt<{ selectedEnv: string }>([
            {
              type: 'list',
              name: 'selectedEnv',
              message: 'Where should Claude run?',
              choices: [
                {
                  name: devcontainerLabel,
                  value: 'devcontainer',
                },
                { name: '🔒 sandbox (srt isolation on host)', value: 'sandbox' },
                { name: '💻 host (runs directly on your machine)', value: 'host' },
              ],
              default: 'devcontainer',
            },
          ], null)

          if (selectedEnv === 'devcontainer') {
            // Dynamically check Docker when selected (user may have started it)
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

            // Check GitHub token is available for git push operations
            if (!isGitHubTokenAvailable()) {
              const tokenChoices = [
                { name: 'Yes, continue anyway (git push may fail)', value: 'continue' },
                { name: 'No, let me run gh auth login first', value: 'cancel' },
                { name: 'Switch to host mode instead', value: 'host' },
              ]
              const tokenMessage = 'GitHub token not found. Git push may fail. Continue without token?'

              this.log('')
              this.warn(
                'GitHub token not found.\n' +
                'Git push operations may fail inside the container.\n' +
                'Run `gh auth login` to authenticate, or continue without token.'
              )
              this.log('')

              // eslint-disable-next-line no-await-in-loop -- Interactive user prompt in loop
              const { tokenAction } = await this.prompt<{ tokenAction: string }>([
                {
                  type: 'list',
                  name: 'tokenAction',
                  message: tokenMessage,
                  choices: tokenChoices,
                  default: 'continue',
                },
              ], null)

              if (tokenAction === 'cancel') {
                db.close()
                this.log(styles.muted('Run `gh auth login` and try again.'))
                return
              }

              if (tokenAction === 'host') {
                environment = 'host'
                environmentSelected = true
                continue
              }
              // tokenAction === 'continue' - fall through to devcontainer setup
            }
          }

          environment = selectedEnv as ExecutionEnvironment
          environmentSelected = true
        }
      }

      // Prompt for display mode
      let displayMode: DisplayMode = 'terminal'
      if (flags['display-mode']) {
        displayMode = flags['display-mode'] as DisplayMode
      } else {
        const { selectedDisplay } = await this.prompt<{ selectedDisplay: string }>([
          {
            type: 'list',
            name: 'selectedDisplay',
            message: 'How should output be displayed?',
            choices: [
              { name: '🖥️  New tab      - Opens in new terminal tab (recommended)', value: 'terminal', command: `prlt claude --project ${projectId} --title "${ticketTitle}" --environment ${environment} --display-mode terminal --json` },
              { name: '▶️  Foreground  - Run in current terminal (blocking)', value: 'foreground', command: `prlt claude --project ${projectId} --title "${ticketTitle}" --environment ${environment} --display-mode foreground --json` },
              { name: '📦 Background  - Runs detached, reattach later', value: 'background', command: `prlt claude --project ${projectId} --title "${ticketTitle}" --environment ${environment} --display-mode background --json` },
            ],
            default: 'terminal',
          },
        ], jsonModeConfig)
        if (jsonMode) { db.close(); return }
        displayMode = selectedDisplay as DisplayMode
      }

      // Prompt for permission mode
      let permissionMode: PermissionMode = 'safe'
      if (flags['permission-mode']) {
        permissionMode = (flags['permission-mode'] || 'safe') as PermissionMode
      } else {
        const containerNote = environment === 'devcontainer' ? ' (container provides additional isolation)' : ''
        const { selectedMode } = await this.prompt<{ selectedMode: string }>([
          {
            type: 'list',
            name: 'selectedMode',
            message: `Permission mode${containerNote}:`,
            choices: [
              { name: '⚠️  danger - Skip permission checks (faster)', value: 'danger', command: `prlt claude --project ${projectId} --title "${ticketTitle}" --environment ${environment} --display-mode ${displayMode} --permission-mode danger --json` },
              { name: '🔒 safe   - Requires approval for dangerous operations', value: 'safe', command: `prlt claude --project ${projectId} --title "${ticketTitle}" --environment ${environment} --display-mode ${displayMode} --permission-mode safe --json` },
            ],
            default: 'danger',
          },
        ], jsonModeConfig)
        if (jsonMode) { db.close(); return }
        permissionMode = selectedMode as PermissionMode
      }

      // Warn about uncommitted changes in danger mode
      if (permissionMode === 'danger' && isGitRepo(workDir) && hasUncommittedChanges(workDir)) {
        this.log('')
        this.warn('Running in danger mode with uncommitted changes!')
        this.log(styles.muted('   Consider committing or stashing changes first.'))
        this.log('')

        const { proceed } = await this.prompt<{ proceed: string }>([
          {
            type: 'list',
            name: 'proceed',
            message: 'Continue anyway?',
            choices: [
              { name: 'Yes, proceed', value: 'true' },
              { name: 'No, cancel', value: 'false' },
            ],
            default: 'true',
          },
        ], null)
        if (proceed !== 'true') {
          this.log(styles.muted('Cancelled.'))
          db.close()
          return
        }
      }

      // Now create ticket (after all prompts so user can cancel early without orphaned ticket)
      const ticket = await storage.createTicket(projectId!, {
        title: ticketTitle!,
        description: ticketDescription,
        category: 'adhoc',
        priority: 'P2',
      })

      if (!jsonMode) this.log(styles.success(`   Created ticket: ${ticket.id}`))

      // Now use the slug from ticket title if not provided
      // Note: slug reserved for future branch naming
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _slug = flags.slug || ticketTitle!.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 30)

      // Create ephemeral agent (with rollback on failure)
      if (!jsonMode) this.log(styles.muted('   Creating ephemeral agent...'))
      let ephemeralResult: { name: string; worktreePath: string }
      try {
        ephemeralResult = await createEphemeralAgent(workspaceInfo, {
          skipDevcontainer: environment === 'host',
          log: (msg) => { if (!jsonMode) this.log(styles.muted(`   ${msg}`)) },
        })
      } catch (agentError) {
        // Rollback: delete the ticket we just created
        if (!jsonMode) this.log(styles.muted('   Rolling back ticket creation due to agent error...'))
        try {
          await storage.deleteTicket(ticket.id)
          if (!jsonMode) this.log(styles.muted(`   Deleted orphaned ticket: ${ticket.id}`))
        } catch {
          this.warn(`Failed to delete orphaned ticket ${ticket.id}. Manual cleanup may be needed.`)
        }
        throw agentError
      }

      const agentName = ephemeralResult.name
      const agentDir = ephemeralResult.worktreePath
      this.log(styles.success(`   Agent: ${agentName}`))

      // Build execution context
      const context: ExecutionContext = {
        ticketId: ticket.id,
        ticketTitle: ticket.title,
        ticketDescription: ticket.description,
        agentName,
        agentDir,
        worktreePath: agentDir,
        branch: 'main', // Adhoc sessions work on main
        hqPath,
        pmoPath,
        actionId: 'adhoc',
        actionName: 'Ad-hoc',
        actionPrompt: flags.prompt,
        modifiesCode: false, // Don't manage branches for adhoc
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
      this.log(styles.muted(`   Display: ${displayMode}`))
      this.log(styles.muted(`   Permissions: ${permissionMode === 'safe' ? '🔒 safe' : '⚠️  danger'}`))
      if (flags.prompt) {
        this.log(styles.muted(`   Initial prompt: "${flags.prompt.substring(0, 50)}${flags.prompt.length > 50 ? '...' : ''}"`))
      }
      this.log('')

      // Run execution
      this.log(styles.muted('Starting Claude...'))

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
        this.log(styles.success(`✓ Session started (${execution.id})`))
        this.log('')
        this.log(styles.muted('Commands:'))
        this.log(styles.muted(`  prlt work status              View work status`))
        this.log(styles.muted(`  prlt session attach           Attach to session`))
        this.log(styles.muted(`  prlt work stop ${execution.id}    Stop work`))
      } else {
        executionStorage.updateStatus(execution.id, 'failed')
        this.error(`Failed to start session: ${result.error}`)
      }

      db.close()
    } catch (error) {
      db.close()
      throw error
    }
  }

  /**
   * Set up catch-all devcontainer for directories without one
   * Uses a temp directory to avoid polluting user's cwd
   * Returns { configDir, workDir } where configDir contains .devcontainer
   */
  private async setupCatchallDevcontainer(workDir: string, slug: string): Promise<{ configDir: string; workDir: string; cleanup: () => void }> {
    // Create temp directory for devcontainer config
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-adhoc-'))
    const devcontainerDir = path.join(tempDir, '.devcontainer')
    fs.mkdirSync(devcontainerDir, { recursive: true })

    // Create minimal devcontainer.json using catch-all image
    // Use absolute path for mount to point to user's actual workDir
    const devcontainerJson = {
      name: `adhoc-${slug}`,
      image: CATCHALL_DEVCONTAINER_IMAGE,
      customizations: {
        vscode: {
          extensions: ['anthropic.claude-code'],
        },
      },
      remoteUser: 'node',
      workspaceFolder: '/workspace',
      mounts: [
        // Use absolute path to user's workDir, not ${localWorkspaceFolder}
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

    // Cleanup function to remove temp directory
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
   * Check if catch-all container image is available
   * Returns true if image exists locally or can be pulled
   */
  private async checkCatchallImage(): Promise<{ available: boolean; error?: string }> {
    try {
      // First check if image exists locally
      execSync(`docker image inspect ${CATCHALL_DEVCONTAINER_IMAGE}`, { stdio: 'pipe' })
      return { available: true }
    } catch {
      // Image not local, try to pull it
      this.log(styles.muted(`   Pulling container image: ${CATCHALL_DEVCONTAINER_IMAGE}`))
      try {
        execSync(`docker pull ${CATCHALL_DEVCONTAINER_IMAGE}`, { stdio: 'pipe', timeout: 120000 })
        return { available: true }
      } catch {
        return {
          available: false,
          error: `Failed to pull catch-all container image: ${CATCHALL_DEVCONTAINER_IMAGE}. Try running on host instead, or ensure Docker is configured correctly.`,
        }
      }
    }
  }
}
