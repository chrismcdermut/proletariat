import { Command, Args, Flags } from '@oclif/core'
import { execSync } from 'child_process'
import { validateBranchName, BranchType } from '../lib/branch/index.js'
import { styles } from '../lib/styles.js'

/**
 * Commit message format presets.
 */
export const COMMIT_FORMATS = {
  'conventional': {
    description: 'Conventional commits with ticket as scope',
    example: 'feat(TKT-053): add login',
    format: (type: string, ticketId: string | undefined, message: string) =>
      ticketId ? `${type}(${ticketId}): ${message}` : `${type}: ${message}`,
  },
  'ticket-prefix': {
    description: 'Ticket ID first, then type',
    example: 'TKT-053: feat: add login',
    format: (type: string, ticketId: string | undefined, message: string) =>
      ticketId ? `${ticketId}: ${type}: ${message}` : `${type}: ${message}`,
  },
  'ticket-suffix': {
    description: 'Type first, ticket at end in brackets',
    example: 'feat: add login [TKT-053]',
    format: (type: string, ticketId: string | undefined, message: string) =>
      ticketId ? `${type}: ${message} [${ticketId}]` : `${type}: ${message}`,
  },
  'ticket-only': {
    description: 'Just ticket ID prefix',
    example: 'TKT-053: add login',
    format: (_type: string, ticketId: string | undefined, message: string) =>
      ticketId ? `${ticketId}: ${message}` : message,
  },
  'simple': {
    description: 'Type and message only, no ticket',
    example: 'feat: add login',
    format: (type: string, _ticketId: string | undefined, message: string) =>
      `${type}: ${message}`,
  },
} as const

export type CommitFormat = keyof typeof COMMIT_FORMATS
export const DEFAULT_COMMIT_FORMAT: CommitFormat = 'ticket-prefix'

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
    '<%= config.bin %> <%= command.id %> -f conventional "add login"  # feat(TKT-053): add login',
    '<%= config.bin %> <%= command.id %> -f ticket-prefix "add login" # TKT-053: feat: add login',
    '<%= config.bin %> <%= command.id %> -f ticket-suffix "add login" # feat: add login [TKT-053]',
    '<%= config.bin %> <%= command.id %> -t fix "resolve bug"         # override type',
    '<%= config.bin %> <%= command.id %> --all "update dependencies"  # stage all + commit',
    '<%= config.bin %> <%= command.id %> --formats                    # list available formats',
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

    // Message is required if not listing formats
    if (!args.message) {
      this.error('Missing required argument: message\n\nUsage: prlt commit "your message"')
    }

    // Get current branch
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

    const { type: branchType, ticketId } = validation.parts

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

    // Get format preset
    const formatName = (flags.format || DEFAULT_COMMIT_FORMAT) as CommitFormat
    const formatPreset = COMMIT_FORMATS[formatName]

    // Build commit message using format preset
    const commitMessage = formatPreset.format(commitType, ticketId, args.message)

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
