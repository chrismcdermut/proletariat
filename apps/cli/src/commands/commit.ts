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
 * Git file status info.
 */
interface GitStatus {
  staged: string[]
  unstaged: string[]
  untracked: string[]
}

/**
 * Get git status - staged, unstaged, and untracked files.
 */
function getGitStatus(): GitStatus {
  const result: GitStatus = { staged: [], unstaged: [], untracked: [] }

  try {
    // Get staged files
    const staged = execSync('git diff --cached --name-only', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
    if (staged) result.staged = staged.split('\n').filter(Boolean)

    // Get unstaged modified files
    const unstaged = execSync('git diff --name-only', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
    if (unstaged) result.unstaged = unstaged.split('\n').filter(Boolean)

    // Get untracked files
    const untracked = execSync('git ls-files --others --exclude-standard', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
    if (untracked) result.untracked = untracked.split('\n').filter(Boolean)
  } catch {
    // Return empty status on error
  }

  return result
}

/**
 * Stage specific files.
 */
function stageFiles(files: string[]): void {
  if (files.length === 0) return
  // Quote each file path to handle spaces
  const quotedFiles = files.map(f => `"${f}"`).join(' ')
  execSync(`git add ${quotedFiles}`, { stdio: 'pipe' })
}

/**
 * Stage all changes.
 */
function stageAll(): void {
  execSync('git add -A', { stdio: 'pipe' })
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
    '<%= config.bin %> <%= command.id %>                               # interactive mode',
    '<%= config.bin %> <%= command.id %> "add user authentication"     # commit staged files',
    '<%= config.bin %> <%= command.id %> -a "update dependencies"      # stage all + commit',
    '<%= config.bin %> <%= command.id %> -s src/foo.ts "add feature"   # stage specific file + commit',
    '<%= config.bin %> <%= command.id %> -t fix "resolve bug"          # override type',
    '<%= config.bin %> <%= command.id %> -T TKT-099 "add feature"      # override ticket ID',
    '<%= config.bin %> <%= command.id %> -f full-context "add login"   # use specific format',
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
    ticket: Flags.string({
      char: 'T',
      description: 'Override ticket ID (default: parsed from branch)',
    }),
    all: Flags.boolean({
      char: 'a',
      description: 'Stage all changes before committing (git add -A)',
      default: false,
    }),
    stage: Flags.string({
      char: 's',
      description: 'Stage specific files before committing (can be used multiple times)',
      multiple: true,
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

    const { type: branchType, ticketId: branchTicketId, agent } = validation.parts

    // Get ticket ID (from flag or branch)
    const ticketId = flags.ticket || branchTicketId

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

    // Stage specific files if --stage flag is used
    if (flags.stage && flags.stage.length > 0) {
      try {
        stageFiles(flags.stage)
      } catch (error) {
        this.error(`Failed to stage files: ${error}`)
      }
    }

    // Interactive mode if no message provided
    const isInteractive = !args.message
    let message = args.message
    let selectedFormat = flags.format

    if (isInteractive) {
      // Show git status and handle staging interactively (unless --all or --stage flags are set)
      if (!flags.all && !flags.stage) {
        const status = getGitStatus()
        const hasStaged = status.staged.length > 0
        const hasUnstaged = status.unstaged.length > 0
        const hasUntracked = status.untracked.length > 0
        const hasChanges = hasStaged || hasUnstaged || hasUntracked

        if (!hasChanges) {
          this.error('No changes to commit. Working tree is clean.')
        }

        // Build status display
        this.log('')
        if (hasStaged) {
          this.log(styles.success(`  Staged (${status.staged.length}):`))
          for (const file of status.staged.slice(0, 5)) {
            this.log(styles.success(`    ✓ ${file}`))
          }
          if (status.staged.length > 5) {
            this.log(styles.muted(`    ... and ${status.staged.length - 5} more`))
          }
        }
        if (hasUnstaged) {
          this.log(styles.warning(`  Modified (${status.unstaged.length}):`))
          for (const file of status.unstaged.slice(0, 5)) {
            this.log(styles.warning(`    ○ ${file}`))
          }
          if (status.unstaged.length > 5) {
            this.log(styles.muted(`    ... and ${status.unstaged.length - 5} more`))
          }
        }
        if (hasUntracked) {
          this.log(styles.muted(`  Untracked (${status.untracked.length}):`))
          for (const file of status.untracked.slice(0, 5)) {
            this.log(styles.muted(`    ? ${file}`))
          }
          if (status.untracked.length > 5) {
            this.log(styles.muted(`    ... and ${status.untracked.length - 5} more`))
          }
        }
        this.log('')

        // Build staging choices based on current state
        type StagingAction = 'staged' | 'all' | 'select' | 'cancel'
        const stagingChoices: Array<{ name: string; value: StagingAction }> = []

        if (hasStaged) {
          stagingChoices.push({
            name: `Commit staged only (${status.staged.length} file${status.staged.length === 1 ? '' : 's'})`,
            value: 'staged',
          })
        }
        if (hasUnstaged || hasUntracked) {
          const totalUnstaged = status.unstaged.length + status.untracked.length
          stagingChoices.push({
            name: `Add all & commit (${totalUnstaged} unstaged + ${status.staged.length} staged)`,
            value: 'all',
          })
          stagingChoices.push({
            name: 'Select files to add...',
            value: 'select',
          })
        }
        stagingChoices.push({ name: 'Cancel', value: 'cancel' })

        const { stagingAction } = await inquirer.prompt([
          {
            type: 'list',
            name: 'stagingAction',
            message: 'What would you like to commit?',
            choices: stagingChoices,
          },
        ])

        if (stagingAction === 'cancel') {
          this.log(styles.muted('Cancelled.'))
          return
        }

        if (stagingAction === 'all') {
          stageAll()
          this.log(styles.success('Staged all changes.'))
        } else if (stagingAction === 'select') {
          // Let user select files to stage
          const allUnstaged = [...status.unstaged, ...status.untracked]
          const { filesToStage } = await inquirer.prompt([
            {
              type: 'checkbox',
              name: 'filesToStage',
              message: 'Select files to stage:',
              choices: allUnstaged.map(file => ({
                name: file,
                value: file,
                checked: false,
              })),
            },
          ])

          if (filesToStage.length > 0) {
            stageFiles(filesToStage)
            this.log(styles.success(`Staged ${filesToStage.length} file${filesToStage.length === 1 ? '' : 's'}.`))
          }

          // Verify we have something to commit
          const newStatus = getGitStatus()
          if (newStatus.staged.length === 0) {
            this.error('No staged changes to commit.')
          }
        } else if (stagingAction === 'staged' && !hasStaged) {
          this.error('No staged changes to commit.')
        }
      }

      // Prompt for format if not specified - show dynamic examples based on current branch
      if (!selectedFormat) {
        // Use real values if available, otherwise show placeholder examples
        const exampleCtx = {
          type: commitType,
          ticketId: ticketId || 'TKT-##',
          agent: agent || 'agent',
          message: 'message',
        }
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
