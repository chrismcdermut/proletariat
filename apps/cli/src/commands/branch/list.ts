import { Flags } from '@oclif/core'
import { PromptCommand } from '../../lib/prompt-command.js'
import { machineOutputFlags } from '../../lib/pmo/index.js'
import { styles } from '../../lib/styles.js'
import {
  BranchInfo,
  BRANCH_TYPES,
  listBranches,
  isGitRepo,
} from '../../lib/branch/index.js'
import { getWorkspaceRepoInfo } from '../../lib/repos/index.js'
import { isNonTTY } from '../../lib/prompt-json.js'
import { visualPadEnd } from '../../lib/string-utils.js'

export default class BranchList extends PromptCommand {
  static description = 'List branches with conventional naming information'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --all',
    '<%= config.bin %> <%= command.id %> --type feat',
    '<%= config.bin %> <%= command.id %> --format compact',
  ]

  static flags = {
    ...machineOutputFlags,
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

  protected getPMOOptions() {
    return { promptIfMultiple: false }
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(BranchList)

    // Default format to 'json' in non-TTY environments (piped output, CI, agents)
    if (flags.format === 'table' && isNonTTY()) {
      flags.format = 'json'
    }

    let branches: BranchInfo[]

    if (isGitRepo()) {
      // In a git repo - list branches for current repo
      branches = listBranches(undefined, flags.all)
    } else {
      // Not in a git repo - list branches across all registered HQ repos
      branches = this.listBranchesAcrossRepos(flags.all)
    }

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

    // Check if we have multi-repo results
    const hasRepoInfo = branches.some((b) => b.repo)

    // Output based on format
    switch (flags.format) {
      case 'json':
        this.log(JSON.stringify(branches, null, 2))
        break

      case 'compact':
        this.outputCompact(branches, hasRepoInfo)
        break

      case 'table':
      default:
        this.outputTable(branches, hasRepoInfo)
        break
    }
  }

  private listBranchesAcrossRepos(includeRemote: boolean): BranchInfo[] {
    let repoInfo
    try {
      repoInfo = getWorkspaceRepoInfo()
    } catch {
      this.error('Not in a git repository and no HQ workspace found.')
    }

    const allBranches: BranchInfo[] = []

    for (const repo of repoInfo.repositories) {
      if (repo.status === 'missing') continue
      const repoBranches = listBranches(repo.fullPath, includeRemote)
      for (const branch of repoBranches) {
        branch.repo = repo.name
        allBranches.push(branch)
      }
    }

    return allBranches
  }

  private outputTable(branches: BranchInfo[], hasRepoInfo = false): void {
    this.log('')
    this.log(styles.header(`🌿 Branches (${branches.length})`))
    this.log('')

    // Header
    const repoHeader = hasRepoInfo ? visualPadEnd('Repo', 18) : ''
    this.log(
      styles.muted(
        repoHeader +
          visualPadEnd('Name', 35) +
          visualPadEnd('Type', 8) +
          visualPadEnd('Owner', 12) +
          visualPadEnd('Description', 25) +
          'Status'
      )
    )
    this.log('─'.repeat(hasRepoInfo ? 108 : 90))

    // Rows
    for (const branch of branches) {
      const marker = branch.current ? '* ' : '  '
      const nameStyle = branch.current ? styles.success : (s: string) => s
      const typeDisplay = branch.type || '-'
      const ownerDisplay = branch.owner || '-'
      const descDisplay = branch.description || '-'
      const repoCol = hasRepoInfo ? visualPadEnd((branch.repo || '-').substring(0, 16), 18) : ''

      let status = 'local'
      if (branch.tracking) {
        status = `tracking ${branch.tracking}`
      }
      if (branch.current) {
        status = 'current'
      }

      this.log(
        marker +
          repoCol +
          nameStyle(visualPadEnd(branch.name.substring(0, 33), 33)) +
          visualPadEnd(typeDisplay, 8) +
          visualPadEnd(ownerDisplay.substring(0, 10), 12) +
          visualPadEnd(descDisplay.substring(0, 23), 25) +
          styles.muted(status)
      )
    }

    this.log('')
    this.log(styles.muted('Legend: * = current branch'))
    this.log('')
  }

  private outputCompact(branches: BranchInfo[], hasRepoInfo = false): void {
    this.log('')

    for (const branch of branches) {
      const marker = branch.current ? '* ' : '  '
      const icon = branch.type ? '🌿' : '  '
      const typeInfo = branch.type ? ` (${branch.type})` : ''
      const repoPrefix = hasRepoInfo && branch.repo ? `[${branch.repo}] ` : ''
      const nameStyle = branch.current ? styles.success : (s: string) => s

      this.log(`${icon} ${marker}${repoPrefix}${nameStyle(branch.name)}${styles.muted(typeInfo)}`)
    }

    this.log('')
  }
}
