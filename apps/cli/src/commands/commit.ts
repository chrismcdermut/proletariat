import { Command, Args, Flags } from '@oclif/core'
import { execSync } from 'child_process'
import inquirer from 'inquirer'
import { validateBranchName, BranchType } from '../lib/branch/index.js'
import { styles } from '../lib/styles.js'

/**
 * Format context passed to format functions.
 */
interface FormatContext {
  type: string
  ticketId?: string
  agent?: string
  message: string
}

/**
 * Commit message format presets.
 */
export const COMMIT_FORMATS = {
  'conventional': {
    description: 'Conventional commits with ticket as scope',
    example: '{type}(TKT-ID): {message}',
    format: (ctx: FormatContext) =>
      ctx.ticketId ? `${ctx.type}(${ctx.ticketId}): ${ctx.message}` : `${ctx.type}: ${ctx.message}`,
  },
  'full-context': {
    description: 'Ticket, type, and agent prefix',
    example: 'TKT-ID/{type}/{agent}: {message}',
    format: (ctx: FormatContext) => {
      if (ctx.ticketId && ctx.agent) return `${ctx.ticketId}/${ctx.type}/${ctx.agent}: ${ctx.message}`
      if (ctx.ticketId) return `${ctx.ticketId}/${ctx.type}: ${ctx.message}`
      return `${ctx.type}: ${ctx.message}`
    },
  },
  'ticket-first': {
    description: 'Ticket ID first, then type',
    example: 'TKT-ID: {type}: {message}',
    format: (ctx: FormatContext) =>
      ctx.ticketId ? `${ctx.ticketId}: ${ctx.type}: ${ctx.message}` : `${ctx.type}: ${ctx.message}`,
  },
  'with-agent': {
    description: 'Ticket and agent prefix',
    example: 'TKT-ID/{agent}: {message}',
    format: (ctx: FormatContext) => {
      if (ctx.ticketId && ctx.agent) return `${ctx.ticketId}/${ctx.agent}: ${ctx.message}`
      if (ctx.ticketId) return `${ctx.ticketId}: ${ctx.message}`
      return ctx.message
    },
  },
  'ticket-suffix': {
    description: 'Type first, ticket at end in brackets',
    example: '{type}: {message} [TKT-ID]',
    format: (ctx: FormatContext) =>
      ctx.ticketId ? `${ctx.type}: ${ctx.message} [${ctx.ticketId}]` : `${ctx.type}: ${ctx.message}`,
  },
  'ticket-only': {
    description: 'Just ticket ID prefix, no type',
    example: 'TKT-ID: {message}',
    format: (ctx: FormatContext) =>
      ctx.ticketId ? `${ctx.ticketId}: ${ctx.message}` : ctx.message,
  },
  'simple': {
    description: 'Type and message only, no ticket',
    example: '{type}: {message}',
    format: (ctx: FormatContext) =>
      `${ctx.type}: ${ctx.message}`,
  },
} as const

export type CommitFormat = keyof typeof COMMIT_FORMATS
export const DEFAULT_COMMIT_FORMAT: CommitFormat = 'conventional'

/**
 * Get current git branch name.
 */
function getCurrentBranch(cwd?: string): string | undefined {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
  } catch {
    return undefined
  }
}

/**
 * Map branch type to conventional commit type.
 * Some branch types use different names for commits.
 */
function branchTypeToCommitType(branchType: BranchType): string {
  const mapping: Partial<Record<BranchType, string>> = {
    rfct: 'refactor',
    sec: 'security',
    db: 'db',
    rel: 'release',
    // Founder types map to chore
    ship: 'chore',
    grow: 'chore',
    cx: 'chore',
    strat: 'chore',
    ops: 'chore',
  }
  return mapping[branchType] || branchType
}

export default class Commit extends Command {
  static description = 'Create a commit with ticket ID from branch name'

  static examples = [
    '<%= config.bin %> <%= command.id %> "add user authentication"',
    '<%= config.bin %> <%= command.id %> -f conventional "add login"   # feat(TKT-053): add login (default)',
    '<%= config.bin %> <%= command.id %> -f full-context "add login"   # TKT-053/feat/bezos: add login',
    '<%= config.bin %> <%= command.id %> -f ticket-first "add login"   # TKT-053: feat: add login',
    '<%= config.bin %> <%= command.id %> -f with-agent "add login"     # TKT-053/bezos: add login',
    '<%= config.bin %> <%= command.id %> -t fix "resolve bug"          # override type',
    '<%= config.bin %> <%= command.id %> --all "update dependencies"   # stage all + commit',
    '<%= config.bin %> <%= command.id %> --formats                     # list available formats',
  ]

  static args = {
    message: Args.string({
      description: 'Commit message (without type/scope prefix)',
      required: false,
    }),
  }

  static flags = {
    format: Flags.string({
      char: 'f',
      description: 'Commit message format preset',
      options: Object.keys(COMMIT_FORMATS),
    }),
    formats: Flags.boolean({
      description: 'List available format presets',
      default: false,
    }),
    type: Flags.string({
      char: 't',
      description: 'Override commit type (feat, fix, docs, etc.)',
    }),
    all: Flags.boolean({
      char: 'a',
      description: 'Stage all changes before committing (git add -A)',
      default: false,
    }),
    'dry-run': Flags.boolean({
      description: 'Show what would be committed without committing',
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Commit)

    // List formats if requested
    if (flags.formats) {
      this.log(styles.header('Available commit formats:'))
      this.log('')
      for (const [name, preset] of Object.entries(COMMIT_FORMATS)) {
        const isDefault = name === DEFAULT_COMMIT_FORMAT
        this.log(`  ${styles.code(name)}${isDefault ? ' (default)' : ''}`)
        this.log(`    ${preset.description}`)
        this.log(`    Example: ${styles.muted(preset.example)}`)
        this.log('')
      }
      return
    }

    // Get current branch first (needed for dynamic examples)
    const branch = getCurrentBranch()
    if (!branch) {
      this.error('Not in a git repository or could not determine current branch')
    }

    // Parse branch name
    const validation = validateBranchName(branch)
    if (!validation.valid || !validation.parts) {
      this.error(
        `Could not parse branch name: ${branch}\n\n` +
        `Expected format: {ticketId}/{type}/{owner}/{agent}/{description}\n` +
        `Example: TKT-053/feat/chris/bezos/add-login\n\n` +
        `Use -t to specify commit type manually:\n` +
        `  prlt commit -t feat "your message"`
      )
    }

    const { type: branchType, ticketId, agent } = validation.parts

    // Get commit type (from flag or branch)
    const commitType = flags.type || branchTypeToCommitType(branchType)

    // Validate commit type if overridden
    if (flags.type) {
      const validTypes = ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert']
      if (!validTypes.includes(flags.type)) {
        this.error(
          `Invalid commit type: ${flags.type}\n\n` +
          `Valid types: ${validTypes.join(', ')}`
        )
      }
    }

    // Interactive mode if no message provided
    const isInteractive = !args.message
    let message = args.message
    let selectedFormat = flags.format

    if (isInteractive) {
      // Prompt for format if not specified - show dynamic examples based on current branch
      if (!selectedFormat) {
        const exampleCtx = { type: commitType, ticketId, agent, message: '...' }
        const formatChoices = Object.entries(COMMIT_FORMATS).map(([name, preset]) => ({
          name: `${name}${name === DEFAULT_COMMIT_FORMAT ? ' (default)' : ''} → ${preset.format(exampleCtx)}`,
          value: name,
        }))

        const { chosenFormat } = await inquirer.prompt([
          {
            type: 'list',
            name: 'chosenFormat',
            message: 'Commit format:',
            choices: formatChoices,
            default: DEFAULT_COMMIT_FORMAT,
          },
        ])
        selectedFormat = chosenFormat
      }

      // Prompt for message
      const { inputMessage } = await inquirer.prompt([
        {
          type: 'input',
          name: 'inputMessage',
          message: 'Commit message:',
          validate: (input: string) => input.trim() ? true : 'Message cannot be empty',
        },
      ])
      message = inputMessage.trim()
    }

    // Get format preset
    const formatName = (selectedFormat || DEFAULT_COMMIT_FORMAT) as CommitFormat
    const formatPreset = COMMIT_FORMATS[formatName]

    // Build commit message using format preset
    const commitMessage = formatPreset.format({
      type: commitType,
      ticketId,
      agent,
      message: message!,
    })

    // Dry run - just show what would happen
    if (flags['dry-run']) {
      this.log(styles.header('Dry run - would commit:'))
      this.log('')
      this.log(`  ${styles.code(commitMessage)}`)
      this.log('')
      this.log(styles.muted(`Branch: ${branch}`))
      this.log(styles.muted(`Format: ${formatName}`))
      this.log(styles.muted(`Type: ${commitType} (from ${branchType})`))
      if (ticketId) {
        this.log(styles.muted(`Ticket: ${ticketId}`))
      }
      if (agent) {
        this.log(styles.muted(`Agent: ${agent}`))
      }
      return
    }

    // Stage all changes if requested
    if (flags.all) {
      try {
        execSync('git add -A', { stdio: 'pipe' })
      } catch (error) {
        this.error(`Failed to stage changes: ${error}`)
      }
    }

    // Check if there are staged changes
    try {
      const staged = execSync('git diff --cached --name-only', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim()

      if (!staged) {
        this.error(
          'No staged changes to commit.\n\n' +
          'Stage your changes first:\n' +
          '  git add <files>\n' +
          '  git add -A\n\n' +
          'Or use --all flag:\n' +
          '  prlt commit --all "your message"'
        )
      }
    } catch {
      // Ignore errors checking staged changes
    }

    // Create commit
    try {
      execSync(`git commit -m "${commitMessage.replace(/"/g, '\\"')}"`, {
        stdio: 'inherit',
      })
      this.log('')
      this.log(styles.success(`Committed: ${commitMessage}`))
    } catch {
      this.error('Commit failed')
    }
  }
}
