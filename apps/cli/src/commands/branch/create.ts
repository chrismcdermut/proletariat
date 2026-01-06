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
import { getCoderName, getGitUserName } from '../../lib/execution/config.js'

export default class BranchCreate extends Command {
  static description = 'Create a new branch with conventional naming'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> feat/chris/add-user-auth',
    '<%= config.bin %> <%= command.id %> -t feat -c chris -d add-user-auth',
    '<%= config.bin %> <%= command.id %> -t fix -d login-bug',
  ]

  static args = {
    name: Args.string({
      description: 'Full branch name (bypasses wizard)',
      required: false,
    }),
  }

  static flags = {
    type: Flags.string({
      char: 't',
      description: 'Branch type',
      options: Object.keys(BRANCH_TYPES),
    }),
    coder: Flags.string({
      char: 'c',
      description: 'Coder/agent identifier',
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

      // Use provided coder name or fall back to configured default
      const coderName = flags.coder || this.getDefaultCoderName()

      if (coderName && !isKebabCase(coderName)) {
        this.error(
          `Coder name must be kebab-case: "${coderName}"\n` +
            `Example: chris, chris-m, team-alpha`
        )
      }

      branchName = buildBranchName(type, description, coderName)
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
   * Get the default coder name from workspace config or git.
   */
  private getDefaultCoderName(): string | undefined {
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
          // Ignore errors and try git config
        }
        break
      }
      currentDir = path.dirname(currentDir)
    }

    // Fall back to git config user.name
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

    // Get default coder name from config or git
    const defaultCoderName = this.getDefaultCoderName()

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

    // Enter coder (defaults to configured name if available)
    const { coder } = await inquirer.prompt([
      {
        type: 'input',
        name: 'coder',
        message: defaultCoderName
          ? `Enter coder name (default: ${defaultCoderName}):`
          : 'Enter coder name (optional, press enter to skip):',
        default: defaultCoderName,
        validate: (input: string) => {
          if (input && !isKebabCase(input)) {
            return 'Coder name must be kebab-case (lowercase, hyphens only)'
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
        message: 'Enter description (kebab-case):',
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

    return buildBranchName(type, description, coder || undefined)
  }
}
