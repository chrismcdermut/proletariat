import { Command, Args, Flags } from '@oclif/core'
import inquirer from 'inquirer'
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
} from '../../lib/branch/index.js'

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

      if (flags.coder && !isKebabCase(flags.coder)) {
        this.error(
          `Coder name must be kebab-case: "${flags.coder}"\n` +
            `Example: chris, chris-m, team-alpha`
        )
      }

      branchName = buildBranchName(type, description, flags.coder)
    } else {
      // Interactive wizard
      const wizardResult = await this.runWizard()
      if (!wizardResult) return
      branchName = wizardResult
    }

    // Check if branch exists
    if (branchExists(branchName)) {
      this.error(`Branch "${branchName}" already exists.`)
    }

    // Create branch
    this.log('')
    this.log(styles.success(`✅ Creating branch: ${branchName}`))

    try {
      createBranch(branchName, undefined, !flags['no-switch'])

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

  private async runWizard(): Promise<string | null> {
    this.log('')
    this.log(styles.header('🌿 Create New Branch'))
    this.log('')

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

    // Enter coder (optional)
    const { coder } = await inquirer.prompt([
      {
        type: 'input',
        name: 'coder',
        message: 'Enter coder name (optional, press enter to skip):',
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
