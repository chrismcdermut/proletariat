import { Command, Flags } from '@oclif/core'
import { styles } from '../../lib/styles.js'
import {
  BRANCH_TYPES,
  listBranches,
  isGitRepo,
} from '../../lib/branch/index.js'

export default class BranchList extends Command {
  static description = 'List branches with conventional naming information'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --all',
    '<%= config.bin %> <%= command.id %> --type feat',
    '<%= config.bin %> <%= command.id %> --format compact',
  ]

  static flags = {
    all: Flags.boolean({
      char: 'a',
      description: 'Include remote branches',
      default: false,
    }),
    type: Flags.string({
      char: 't',
      description: 'Filter by branch type',
      options: Object.keys(BRANCH_TYPES),
    }),
    format: Flags.string({
      char: 'f',
      description: 'Output format',
      options: ['table', 'compact', 'json'],
      default: 'table',
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(BranchList)

    // Check if in git repo
    if (!isGitRepo()) {
      this.error('Not in a git repository.')
    }

    // Get branches
    let branches = listBranches(undefined, flags.all)

    // Filter by type
    if (flags.type) {
      branches = branches.filter((b) => b.type === flags.type)
    }

    if (branches.length === 0) {
      if (flags.type) {
        this.log(styles.muted(`\nNo ${flags.type} branches found.\n`))
      } else {
        this.log(styles.muted('\nNo branches found.\n'))
      }
      return
    }

    // Output based on format
    switch (flags.format) {
      case 'json':
        this.log(JSON.stringify(branches, null, 2))
        break

      case 'compact':
        this.outputCompact(branches)
        break

      case 'table':
      default:
        this.outputTable(branches)
        break
    }
  }

  private outputTable(branches: ReturnType<typeof listBranches>): void {
    this.log('')
    this.log(styles.header(`🌿 Branches (${branches.length})`))
    this.log('')

    // Header
    this.log(
      styles.muted(
        padEnd('Name', 35) +
          padEnd('Type', 8) +
          padEnd('Owner', 12) +
          padEnd('Description', 25) +
          'Status'
      )
    )
    this.log('─'.repeat(90))

    // Rows
    for (const branch of branches) {
      const marker = branch.current ? '* ' : '  '
      const nameStyle = branch.current ? styles.success : (s: string) => s
      const typeDisplay = branch.type || '-'
      const ownerDisplay = branch.owner || '-'
      const descDisplay = branch.description || '-'

      let status = 'local'
      if (branch.tracking) {
        status = `tracking ${branch.tracking}`
      }
      if (branch.current) {
        status = 'current'
      }

      this.log(
        marker +
          nameStyle(padEnd(branch.name.substring(0, 33), 33)) +
          padEnd(typeDisplay, 8) +
          padEnd(ownerDisplay.substring(0, 10), 12) +
          padEnd(descDisplay.substring(0, 23), 25) +
          styles.muted(status)
      )
    }

    this.log('')
    this.log(styles.muted('Legend: * = current branch'))
    this.log('')
  }

  private outputCompact(branches: ReturnType<typeof listBranches>): void {
    this.log('')

    for (const branch of branches) {
      const marker = branch.current ? '* ' : '  '
      const icon = branch.type ? '🌿' : '  '
      const typeInfo = branch.type ? ` (${branch.type})` : ''
      const nameStyle = branch.current ? styles.success : (s: string) => s

      this.log(`${icon} ${marker}${nameStyle(branch.name)}${styles.muted(typeInfo)}`)
    }

    this.log('')
  }
}

function padEnd(str: string, length: number): string {
  return str.padEnd(length)
}
