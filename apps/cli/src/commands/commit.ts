import { Command, Args, Flags } from '@oclif/core'
import { execSync } from 'child_process'
import { validateBranchName, BranchType } from '../lib/branch/index.js'
import { styles } from '../lib/styles.js'

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
  static description = 'Create a conventional commit with ticket ID from branch name'

  static examples = [
    '<%= config.bin %> <%= command.id %> "add user authentication"',
    '<%= config.bin %> <%= command.id %> -t fix "resolve login bug"',
    '<%= config.bin %> <%= command.id %> --all "update dependencies"',
  ]

  static args = {
    message: Args.string({
      description: 'Commit message (without type/scope prefix)',
      required: true,
    }),
  }

  static flags = {
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

    // Build commit message
    let commitMessage: string
    if (ticketId) {
      commitMessage = `${commitType}(${ticketId}): ${args.message}`
    } else {
      commitMessage = `${commitType}: ${args.message}`
    }

    // Dry run - just show what would happen
    if (flags['dry-run']) {
      this.log(styles.header('Dry run - would commit:'))
      this.log('')
      this.log(`  ${styles.code(commitMessage)}`)
      this.log('')
      this.log(styles.muted(`Branch: ${branch}`))
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
