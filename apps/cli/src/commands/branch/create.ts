import { Command, Args, Flags } from '@oclif/core'
import * as fs from 'fs'
import * as path from 'path'
import inquirer from 'inquirer'
import Database from 'better-sqlite3'
import { styles } from '../../lib/styles.js'
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
} from '../../lib/branch/index.js'
import { getCoderName, getGitUserName, getGitHubUsername } from '../../lib/execution/config.js'
import { getBranchType } from '../../lib/execution/types.js'
import { getPMOContext } from '../../lib/pmo/index.js'

export default class BranchCreate extends Command {
  static description = 'Create a new branch with conventional naming'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> feat/chris/add-user-auth',
    '<%= config.bin %> <%= command.id %> TKT-001/feat/chris/add-user-auth',
    '<%= config.bin %> <%= command.id %> -t feat -c chris -d add-user-auth',
    '<%= config.bin %> <%= command.id %> -t feat -T TKT-001 -d add-user-auth',
  ]

  static args = {
    name: Args.string({
      description: 'Full branch name (bypasses wizard)',
      required: false,
    }),
  }

  static flags = {
    ticket: Flags.string({
      char: 'T',
      description: 'Ticket ID (e.g., TKT-001) - puts ticket first in branch name',
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
      description: 'Create initial empty commit',
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
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(BranchCreate)

    // Check if in git repo
    if (!isGitRepo()) {
      this.error('Not in a git repository.')
    }

    let branchName: string

    if (args.name) {
      // Direct name provided - validate and create
      branchName = args.name
      const validation = validateBranchName(branchName)

      if (!validation.valid) {
        // Warn but allow creation
        const { proceed } = await inquirer.prompt([
          {
            type: 'list',
            name: 'proceed',
            message: `Branch name doesn't follow conventional format.\n   ${validation.error}\n   Continue anyway?`,
            choices: [
              { name: 'No', value: false },
              { name: 'Yes', value: true },
            ],
            default: false,
          },
        ])

        if (!proceed) {
          return
        }
      }
    } else if (flags.type && flags.description) {
      // Flags provided - build name
      const type = flags.type as BranchType

      if (!isValidBranchType(type)) {
        this.error(`Invalid branch type: "${type}"`)
      }

      const description = flags.description
      if (!isKebabCase(description)) {
        this.error(
          `Description must be kebab-case: "${description}"\n` +
            `Example: add-user-auth, fix-login-bug`
        )
      }

      // Use provided owner name or fall back to configured default
      const ownerName = flags.owner || this.getDefaultOwnerName()

      if (ownerName && !isKebabCase(ownerName)) {
        this.error(
          `Owner name must be kebab-case: "${ownerName}"\n` +
            `Example: chris, chris-m, team-alpha`
        )
      }

      branchName = buildBranchName(type, description, {
        ticketId: flags.ticket,
        owner: ownerName,
      })
    } else {
      // Interactive wizard
      const wizardResult = await this.runWizard()
      if (!wizardResult) return
      branchName = wizardResult
    }

    // Fetch from origin if requested
    if (flags['from-origin']) {
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
      const startPoint = flags['from-origin'] ? 'origin/main' : undefined
      createBranch(branchName, undefined, !flags['no-switch'], startPoint)

      if (flags['no-switch']) {
        this.log(styles.muted(`   Created branch (not switched)`))
      } else {
        this.log(styles.muted(`   Switched to new branch '${branchName}'`))
      }

      // Empty commit
      let createCommit = flags['empty-commit']
      if (!flags['empty-commit'] && !args.name) {
        // Only prompt in interactive mode
        const { wantCommit } = await inquirer.prompt([
          {
            type: 'list',
            name: 'wantCommit',
            message: 'Create initial empty commit? (helps seed PR title)',
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
        const { commitMessage } = await inquirer.prompt([
          {
            type: 'input',
            name: 'commitMessage',
            message: 'Enter commit message:',
            default: branchName,
          },
        ])

        createEmptyCommit(commitMessage)
        this.log(styles.success(`✅ Created empty commit: ${commitMessage}`))
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

  private async runWizard(): Promise<string | null> {
    this.log('')
    this.log(styles.header('🌿 Create New Branch'))
    this.log('')

    // Get default owner name from config or GitHub
    const defaultOwnerName = this.getDefaultOwnerName()

    // Try to load tickets from PMO (across all projects)
    let tickets: Array<{ id: string; title: string; category?: string; status?: string; projectName?: string }> = []
    try {
      const { storage } = await getPMOContext({ promptIfMultiple: false })

      // Get all projects and their tickets
      const projects = await storage.listProjects()
      for (const project of projects) {
        storage.setCurrentProject(project.id)
        const projectTickets = await storage.listTickets()
        // Filter to actionable tickets (todo, in-progress, backlog)
        const actionable = projectTickets.filter(t =>
          !t.status || ['todo', 'in-progress', 'backlog', 'in_progress'].includes(t.status.toLowerCase())
        )
        tickets.push(...actionable.map(t => ({ ...t, projectName: project.name })))
      }
      await storage.close()
    } catch {
      // No PMO context - that's fine, just skip ticket selection
    }

    // First choice: from ticket or custom
    const hasTickets = tickets.length > 0
    const { mode } = await inquirer.prompt([
      {
        type: 'list',
        name: 'mode',
        message: 'Create branch:',
        choices: [
          ...(hasTickets ? [{ name: `📋 From ticket (${tickets.length} available)`, value: 'ticket' }] : []),
          { name: '✏️  Custom branch name', value: 'custom' },
        ],
      },
    ])

    if (mode === 'ticket' && hasTickets) {
      return this.runTicketWizard(tickets, defaultOwnerName)
    }

    return this.runCustomWizard(defaultOwnerName)
  }

  /**
   * Wizard flow for creating branch from a ticket.
   */
  private async runTicketWizard(
    tickets: Array<{ id: string; title: string; category?: string; status?: string; projectName?: string }>,
    defaultOwnerName: string | undefined
  ): Promise<string | null> {
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

    const branchName = buildBranchName(type, slug, {
      ticketId: ticket.id,
      owner: owner || undefined,
    })

    this.log('')
    this.log(styles.muted(`   Generated: ${branchName}`))

    // Confirm or allow edit
    const { confirmed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmed',
        message: 'Use this branch name?',
        default: true,
      },
    ])

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
      return customName
    }

    return branchName
  }

  /**
   * Wizard flow for creating a custom branch (no ticket).
   */
  private async runCustomWizard(defaultOwnerName: string | undefined): Promise<string | null> {
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

    return buildBranchName(type, description, {
      owner: owner || undefined,
    })
  }
}
