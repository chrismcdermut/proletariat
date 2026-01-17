import { Args, Flags } from '@oclif/core'
import * as fs from 'fs'
import * as path from 'path'
import inquirer from 'inquirer'
import Database from 'better-sqlite3'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import { styles } from '../../lib/styles.js'
import {
  shouldOutputJson,
  outputPromptAsJson,
  outputErrorAsJson,
  createMetadata,
  buildPromptConfig,
  buildFormPromptConfig,
  FormField,
} from '../../lib/prompt-json.js'
import {
  BRANCH_TYPES,
  BranchType,
  DEVELOPMENT_TYPES,
  BUSINESS_TYPES,
  isKebabCase,
  isValidBranchType,
  buildBranchName,
  toKebabCase,
  validateBranchName,
  branchExists,
  createBranch,
  createEmptyCommit,
  isGitRepo,
  fetchOrigin,
  checkoutBranch,
  listBranches,
} from '../../lib/branch/index.js'
import { getCoderName, getGitUserName, getGitHubUsername } from '../../lib/execution/config.js'
import { getBranchType } from '../../lib/execution/types.js'
import { detectAgentName } from '../../lib/agents/index.js'

interface WizardResult {
  branchName: string
  ticket?: {
    id: string
    title: string
  }
  autoCommit?: boolean  // Skip commit prompt, auto-create
  fromOrigin?: boolean  // Branch from origin/main instead of current branch
  customStartPoint?: string  // Custom branch to start from (e.g., "origin/develop")
}

export default class BranchCreate extends PMOCommand {
  static description = 'Create a new branch with conventional naming'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> -T TKT-001',
    '<%= config.bin %> <%= command.id %> -T TKT-001 -e',
    '<%= config.bin %> <%= command.id %> feat/chris/add-user-auth',
    '<%= config.bin %> <%= command.id %> -t feat -c chris -d add-user-auth',
  ]

  static args = {
    name: Args.string({
      description: 'Full branch name (bypasses wizard)',
      required: false,
    }),
  }

  static flags = {
    ...pmoBaseFlags,
    ticket: Flags.string({
      char: 'T',
      description: 'Ticket ID - auto-generates branch from ticket (or use with -t/-d for manual)',
    }),
    type: Flags.string({
      char: 't',
      description: 'Branch type',
      options: Object.keys(BRANCH_TYPES),
    }),
    owner: Flags.string({
      char: 'c',
      description: 'Owner/coder identifier (defaults to GitHub username)',
    }),
    description: Flags.string({
      char: 'd',
      description: 'Branch description (kebab-case)',
    }),
    'empty-commit': Flags.boolean({
      char: 'e',
      description: 'Create initial commit to seed PR title',
      default: false,
    }),
    'no-switch': Flags.boolean({
      description: 'Create branch without switching to it',
      default: false,
    }),
    'from-origin': Flags.boolean({
      char: 'o',
      description: 'Fetch and create branch from origin/main',
      default: false,
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Non-interactive mode: skip prompts, switch to existing branch if it exists',
      default: false,
    }),
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
    'no-interactive': Flags.boolean({
      description: 'Alias for --json flag',
      default: false,
    }),
  }

  protected getPMOOptions() {
    return { promptIfMultiple: false }
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(BranchCreate)

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags)

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('branch create', flags))
        this.exit(1)
      }
      this.error(message)
    }

    // Check if in git repo
    if (!isGitRepo()) {
      return handleError('NOT_GIT_REPO', 'Not in a git repository.')
    }

    let branchName: string

    if (args.name) {
      // Direct name provided - validate and create
      branchName = args.name
      const validation = validateBranchName(branchName)

      if (!validation.valid) {
        // Build choices once, use for both JSON and interactive modes
        const confirmChoices = [
          { name: 'No', value: 'false' },
          { name: 'Yes', value: 'true' },
        ]
        const confirmMessage = `Branch name doesn't follow conventional format. ${validation.error} Continue anyway?`

        // In JSON mode, output validation warning prompt
        if (jsonMode) {
          outputPromptAsJson(
            buildPromptConfig('list', 'proceed', confirmMessage, confirmChoices),
            createMetadata('branch create', flags)
          )
          return
        }

        // Warn but allow creation
        const { proceed } = await inquirer.prompt([
          {
            type: 'list',
            name: 'proceed',
            message: confirmMessage.replace('. ', '.\n   ').replace('?', '?\n   '),
            choices: confirmChoices.map(c => ({ name: c.name, value: c.value === 'true' })),
            default: false,
          },
        ])

        if (!proceed) {
          return
        }
      }
    } else if (flags.ticket && !flags.type && !flags.description) {
      // Ticket-only mode: look up ticket and auto-generate branch name
      const projectId = (flags as { project?: string }).project
      const ticketResult = await this.createFromTicketId(flags.ticket, flags.owner, projectId)
      if (!ticketResult) {
        return handleError('TICKET_NOT_FOUND', `Could not find ticket: ${flags.ticket}`)
      }
      branchName = ticketResult.branchName
      ;(this as any)._selectedTicket = ticketResult.ticket
    } else if (flags.type && flags.description) {
      // Flags provided - build name
      const type = flags.type as BranchType

      if (!isValidBranchType(type)) {
        return handleError('INVALID_BRANCH_TYPE', `Invalid branch type: "${type}"`)
      }

      const description = flags.description
      if (!isKebabCase(description)) {
        return handleError('INVALID_DESCRIPTION', `Description must be kebab-case: "${description}". Example: add-user-auth, fix-login-bug`)
      }

      // Use provided owner name or fall back to configured default
      const ownerName = flags.owner || this.getDefaultOwnerName()

      if (ownerName && !isKebabCase(ownerName)) {
        return handleError('INVALID_OWNER', `Owner name must be kebab-case: "${ownerName}". Example: chris, chris-m, team-alpha`)
      }

      branchName = buildBranchName(type, description, {
        ticketId: flags.ticket,
        owner: ownerName,
      })
    } else {
      // Interactive wizard
      const wizardResult = await this.runWizard(jsonMode, flags)
      if (!wizardResult) return
      branchName = wizardResult.branchName
      // Store ticket info, autoCommit, fromOrigin, and customStartPoint flags for later
      ;(this as any)._selectedTicket = wizardResult.ticket
      ;(this as any)._autoCommit = wizardResult.autoCommit
      ;(this as any)._fromOrigin = wizardResult.fromOrigin
      ;(this as any)._customStartPoint = wizardResult.customStartPoint
    }

    // Fetch from origin if requested (via flag or wizard)
    const fromOrigin = flags['from-origin'] || (this as any)._fromOrigin
    if (fromOrigin) {
      this.log(styles.muted('Fetching from origin/main...'))
      if (!fetchOrigin('main')) {
        if (!flags.force) {
          this.warn('Could not fetch from origin/main, using local state')
        }
      }
    }

    // Check if branch exists
    if (branchExists(branchName)) {
      if (flags.force) {
        // In force mode, just switch to the existing branch
        this.log(styles.muted(`Branch "${branchName}" exists, switching to it...`))
        try {
          checkoutBranch(branchName)
          this.log(styles.success(`✅ Switched to branch: ${branchName}`))
          return
        } catch (error) {
          this.error(`Failed to switch to branch: ${error instanceof Error ? error.message : error}`)
        }
      }
      this.error(`Branch "${branchName}" already exists.`)
    }

    // Create branch
    this.log('')
    this.log(styles.success(`✅ Creating branch: ${branchName}`))

    try {
      const customStartPoint = (this as any)._customStartPoint as string | undefined
      const startPoint = customStartPoint || (fromOrigin ? 'origin/main' : undefined)
      createBranch(branchName, undefined, !flags['no-switch'], startPoint)

      if (flags['no-switch']) {
        this.log(styles.muted(`   Created branch (not switched)`))
      } else {
        this.log(styles.muted(`   Switched to new branch '${branchName}'`))
      }

      // Initial commit to seed PR title
      const autoCommit = (this as any)._autoCommit as boolean | undefined
      let createCommit = flags['empty-commit'] || autoCommit

      if (!createCommit && !args.name) {
        // Only prompt in interactive mode (non-quick)
        const { wantCommit } = await inquirer.prompt([
          {
            type: 'list',
            name: 'wantCommit',
            message: 'Create initial commit to seed PR title?',
            choices: [
              { name: 'Yes', value: true },
              { name: 'No', value: false },
            ],
            default: true,
          },
        ])
        createCommit = wantCommit
      }

      if (createCommit) {
        // Build default commit message: use ticket info if available, otherwise branch name
        const selectedTicket = (this as any)._selectedTicket as { id: string; title: string } | undefined
        const defaultCommitMessage = selectedTicket
          ? `${selectedTicket.id}: ${selectedTicket.title}`
          : branchName

        // In autoCommit mode, skip the prompt
        let commitMessage = defaultCommitMessage
        if (!autoCommit) {
          const result = await inquirer.prompt([
            {
              type: 'input',
              name: 'commitMessage',
              message: 'Enter commit message:',
              default: defaultCommitMessage,
            },
          ])
          commitMessage = result.commitMessage
        }

        createEmptyCommit(commitMessage)
        this.log(styles.success(`✅ Created initial commit: ${commitMessage}`))
      }

      this.log('')
    } catch (error) {
      this.error(`Failed to create branch: ${error instanceof Error ? error.message : error}`)
    }
  }

  /**
   * Get the default owner name.
   * Priority: workspace config > GitHub username > git user.name
   */
  private getDefaultOwnerName(): string | undefined {
    // Try to get from workspace database
    let currentDir = process.cwd()
    while (currentDir !== '/') {
      const dbPath = path.join(currentDir, '.proletariat', 'workspace.db')
      if (fs.existsSync(dbPath)) {
        try {
          const db = new Database(dbPath)
          const coderName = getCoderName(db)
          db.close()
          if (coderName) {
            return coderName
          }
        } catch {
          // Ignore errors and try other methods
        }
        break
      }
      currentDir = path.dirname(currentDir)
    }

    // Try GitHub username (most reliable)
    const ghUsername = getGitHubUsername()
    if (ghUsername) {
      return ghUsername
    }

    // Fall back to git config user.name (normalized)
    const gitUserName = getGitUserName()
    if (gitUserName) {
      return gitUserName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
    }

    return undefined
  }

  /**
   * Create branch from ticket ID with defaults (non-interactive).
   */
  private async createFromTicketId(ticketId: string, ownerOverride?: string, projectId?: string): Promise<WizardResult | null> {
    try {
      // Search for ticket across all projects
      const projects = await this.storage.listProjects()
      let foundTicket: { id: string; title: string; category?: string } | null = null

      for (const project of projects) {
        const tickets = await this.storage.listTickets(projectId)
        const match = tickets.find(t => t.id === ticketId)
        if (match) {
          foundTicket = match
          break
        }
      }

      if (!foundTicket) {
        return null
      }

      // Auto-generate branch name with defaults
      const type = getBranchType(foundTicket.category) as BranchType
      const slug = toKebabCase(foundTicket.title).substring(0, 20).replace(/-+$/, '')
      const ownerName = ownerOverride || this.getDefaultOwnerName()
      const agentName = detectAgentName()

      const branchName = buildBranchName(type, slug, {
        ticketId: foundTicket.id,
        owner: ownerName,
        agent: agentName || undefined,
      })

      this.log(styles.muted(`Ticket: ${foundTicket.title}`))

      return { branchName, ticket: { id: foundTicket.id, title: foundTicket.title } }
    } catch {
      return null
    }
  }

  private async runWizard(jsonMode = false, flags: Record<string, unknown> = {}): Promise<WizardResult | null> {
    // Get default owner name from config or GitHub
    const defaultOwnerName = this.getDefaultOwnerName()

    // Load tickets from PMO (across all projects)
    let tickets: Array<{ id: string; title: string; category?: string; status?: string; projectName?: string }> = []
    try {
      // Get all projects and their tickets
      const projects = await this.storage.listProjects()
      const projectId = (flags as { project?: string }).project
      for (const project of projects) {
        const projectTickets = await this.storage.listTickets(projectId)
        // Filter to actionable tickets (todo, in-progress, backlog)
        const actionable = projectTickets.filter(t =>
          !t.status || ['todo', 'in-progress', 'backlog', 'in_progress'].includes(t.status.toLowerCase())
        )
        tickets.push(...actionable.map(t => ({ ...t, projectName: project.name })))
      }
    } catch {
      // PMO context error - just skip ticket selection
    }

    // First choice: from ticket or custom
    const hasTickets = tickets.length > 0

    // Build choices once, use for both JSON and interactive modes
    const modeChoices = [
      ...(hasTickets ? [
        { name: 'From ticket - quick', value: 'ticket-quick' },
        { name: 'From ticket - customize', value: 'ticket' },
      ] : []),
      { name: 'Custom branch name', value: 'custom' },
    ]
    const modeMessage = 'Create branch:'

    // In JSON mode, output mode selection prompt
    if (jsonMode) {
      outputPromptAsJson(
        buildPromptConfig('list', 'mode', modeMessage, modeChoices),
        createMetadata('branch create', flags)
      )
      return null
    }

    this.log('')
    this.log(styles.header('🌿 Create New Branch'))
    this.log('')

    const { mode } = await inquirer.prompt([
      {
        type: 'list',
        name: 'mode',
        message: modeMessage,
        choices: modeChoices.map((c, i) => ({
          name: hasTickets && i < 2 ? `📋 ${c.name}` : (c.value === 'custom' ? `✏️  ${c.name}` : c.name),
          value: c.value,
        })),
      },
    ])

    if (mode === 'ticket-quick' && hasTickets) {
      return this.runTicketQuickWizard(tickets, defaultOwnerName)
    }

    if (mode === 'ticket' && hasTickets) {
      return this.runTicketWizard(tickets, defaultOwnerName)
    }

    return this.runCustomWizard(defaultOwnerName)
  }

  /**
   * Quick wizard - just select ticket, auto-generate with defaults.
   */
  private async runTicketQuickWizard(
    tickets: Array<{ id: string; title: string; category?: string; status?: string; projectName?: string }>,
    defaultOwnerName: string | undefined
  ): Promise<WizardResult | null> {
    // Select ticket (show project name if multiple projects)
    const hasMultipleProjects = new Set(tickets.map(t => t.projectName)).size > 1
    const ticketChoices = tickets.map(t => ({
      name: hasMultipleProjects
        ? `${t.id} - ${t.title.substring(0, 40)}${t.title.length > 40 ? '...' : ''} ${styles.muted(`[${t.projectName}]`)}`
        : `${t.id} - ${t.title.substring(0, 50)}${t.title.length > 50 ? '...' : ''} ${styles.muted(`[${t.status || 'todo'}]`)}`,
      value: t,
    }))

    const { ticket } = await inquirer.prompt([
      {
        type: 'list',
        name: 'ticket',
        message: 'Select ticket:',
        choices: ticketChoices,
        pageSize: 15,
      },
    ])

    // Auto-generate branch name with defaults
    const type = getBranchType(ticket.category) as BranchType
    const slug = toKebabCase(ticket.title).substring(0, 20).replace(/-+$/, '')
    const agentName = detectAgentName()

    const branchName = buildBranchName(type, slug, {
      ticketId: ticket.id,
      owner: defaultOwnerName,
      agent: agentName || undefined,
    })

    // Quick mode: always branch from origin/main
    return { branchName, ticket: { id: ticket.id, title: ticket.title }, autoCommit: true, fromOrigin: true }
  }

  /**
   * Wizard flow for creating branch from a ticket.
   */
  private async runTicketWizard(
    tickets: Array<{ id: string; title: string; category?: string; status?: string; projectName?: string }>,
    defaultOwnerName: string | undefined
  ): Promise<WizardResult | null> {
    // Select ticket (show project name if multiple projects)
    const hasMultipleProjects = new Set(tickets.map(t => t.projectName)).size > 1
    const ticketChoices = tickets.map(t => ({
      name: hasMultipleProjects
        ? `${t.id} - ${t.title.substring(0, 40)}${t.title.length > 40 ? '...' : ''} ${styles.muted(`[${t.projectName}]`)}`
        : `${t.id} - ${t.title.substring(0, 50)}${t.title.length > 50 ? '...' : ''} ${styles.muted(`[${t.status || 'todo'}]`)}`,
      value: t,
    }))

    const { ticket } = await inquirer.prompt([
      {
        type: 'list',
        name: 'ticket',
        message: 'Select ticket:',
        choices: ticketChoices,
        pageSize: 15,
      },
    ])

    // Get owner (defaults to GitHub username)
    const { owner } = await inquirer.prompt([
      {
        type: 'input',
        name: 'owner',
        message: defaultOwnerName
          ? `Owner (default: ${defaultOwnerName}):`
          : 'Owner (optional):',
        default: defaultOwnerName,
        validate: (input: string) => {
          if (input && !isKebabCase(input)) {
            return 'Owner must be kebab-case (lowercase, hyphens only)'
          }
          return true
        },
      },
    ])

    // Auto-generate branch name from ticket
    const type = getBranchType(ticket.category) as BranchType
    const slug = toKebabCase(ticket.title).substring(0, 20).replace(/-+$/, '')
    const agentName = detectAgentName()

    const branchName = buildBranchName(type, slug, {
      ticketId: ticket.id,
      owner: owner || undefined,
      agent: agentName || undefined,
    })

    this.log('')
    this.log(styles.muted(`   Generated: ${branchName}`))

    // Confirm or allow edit
    const { confirmed } = await inquirer.prompt([
      {
        type: 'list',
        name: 'confirmed',
        message: 'Use this branch name?',
        choices: [
          { name: 'Yes', value: true },
          { name: 'No, let me edit', value: false },
        ],
      },
    ])

    // Ask where to branch from
    const { branchFrom } = await inquirer.prompt([
      {
        type: 'list',
        name: 'branchFrom',
        message: 'Branch from:',
        choices: [
          { name: 'origin/main (recommended)', value: 'origin-main' },
          { name: 'Current branch', value: 'current' },
          { name: 'Other branch...', value: 'other' },
        ],
        default: 0,
      },
    ])

    let fromOrigin = branchFrom === 'origin-main'
    let customStartPoint: string | undefined

    if (branchFrom === 'other') {
      customStartPoint = await this.promptForBranch()
    }

    if (!confirmed) {
      // Allow manual edit
      const { customName } = await inquirer.prompt([
        {
          type: 'input',
          name: 'customName',
          message: 'Enter branch name:',
          default: branchName,
        },
      ])
      // Still return ticket info for commit message even with custom branch name
      return { branchName: customName, ticket: { id: ticket.id, title: ticket.title }, fromOrigin, customStartPoint }
    }

    return { branchName, ticket: { id: ticket.id, title: ticket.title }, fromOrigin, customStartPoint }
  }

  /**
   * Wizard flow for creating a custom branch (no ticket).
   */
  private async runCustomWizard(defaultOwnerName: string | undefined): Promise<WizardResult | null> {
    // Select type
    const typeChoices = [
      new inquirer.Separator('── Development ──'),
      ...DEVELOPMENT_TYPES.map((t) => ({
        name: `${t.padEnd(6)} - ${BRANCH_TYPES[t]}`,
        value: t,
      })),
      new inquirer.Separator('── Business ──'),
      ...BUSINESS_TYPES.map((t) => ({
        name: `${t.padEnd(6)} - ${BRANCH_TYPES[t]}`,
        value: t,
      })),
    ]

    const { type } = await inquirer.prompt([
      {
        type: 'list',
        name: 'type',
        message: 'Select branch type:',
        choices: typeChoices,
      },
    ])

    // Enter owner (defaults to GitHub username)
    const { owner } = await inquirer.prompt([
      {
        type: 'input',
        name: 'owner',
        message: defaultOwnerName
          ? `Owner (default: ${defaultOwnerName}):`
          : 'Owner (optional):',
        default: defaultOwnerName,
        validate: (input: string) => {
          if (input && !isKebabCase(input)) {
            return 'Owner must be kebab-case (lowercase, hyphens only)'
          }
          return true
        },
      },
    ])

    // Enter description
    const { description } = await inquirer.prompt([
      {
        type: 'input',
        name: 'description',
        message: 'Description (kebab-case):',
        validate: (input: string) => {
          if (!input.trim()) {
            return 'Description is required'
          }
          // Auto-convert to kebab case for validation preview
          const kebab = toKebabCase(input)
          if (kebab !== input && input.includes(' ')) {
            return `Will be converted to: ${kebab}. Use that? (press enter) or type kebab-case directly`
          }
          if (!isKebabCase(input)) {
            return 'Description must be kebab-case (lowercase, hyphens only)'
          }
          return true
        },
        filter: (input: string) => toKebabCase(input),
      },
    ])

    const branchName = buildBranchName(type, description, {
      owner: owner || undefined,
    })

    // Ask where to branch from
    const { branchFrom } = await inquirer.prompt([
      {
        type: 'list',
        name: 'branchFrom',
        message: 'Branch from:',
        choices: [
          { name: 'origin/main (recommended)', value: 'origin-main' },
          { name: 'Current branch', value: 'current' },
          { name: 'Other branch...', value: 'other' },
        ],
        default: 0,
      },
    ])

    let fromOrigin = branchFrom === 'origin-main'
    let customStartPoint: string | undefined

    if (branchFrom === 'other') {
      customStartPoint = await this.promptForBranch()
      if (!customStartPoint) {
        return null // User cancelled
      }
    }

    // No ticket info for custom branches
    return { branchName, fromOrigin, customStartPoint }
  }

  /**
   * Prompt user to select a branch from local or remote branches.
   */
  private async promptForBranch(): Promise<string | undefined> {
    // Get all branches (local and remote)
    const branches = listBranches(undefined, true)
      .map((b) => b.name)
      .filter((name) => !name.startsWith('HEAD'))
      .sort()

    if (branches.length === 0) {
      this.warn('No branches found')
      return undefined
    }

    const { selectedBranch } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selectedBranch',
        message: 'Select branch:',
        choices: branches,
        pageSize: 15,
      },
    ])

    return selectedBranch
  }
}
