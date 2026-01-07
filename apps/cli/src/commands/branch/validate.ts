import { Command, Args } from '@oclif/core'
import { styles } from '../../lib/styles.js'
import {
  BRANCH_TYPES,
  validateBranchName,
  getCurrentBranch,
  isGitRepo,
} from '../../lib/branch/index.js'

export default class BranchValidate extends Command {
  static description = 'Validate branch name against conventional format'

  static examples = [
    '<%= config.bin %> <%= command.id %> feat/chris/add-user-auth',
    '<%= config.bin %> <%= command.id %> my-random-branch',
    '<%= config.bin %> <%= command.id %>  # Validates current branch',
  ]

  static args = {
    name: Args.string({
      description: 'Branch name to validate. Defaults to current branch.',
      required: false,
    }),
  }

  async run(): Promise<void> {
    const { args } = await this.parse(BranchValidate)

    let branchName: string = args.name || ''

    // Use current branch if not provided
    if (!branchName) {
      if (!isGitRepo()) {
        this.error('Not in a git repository.')
      }

      const currentBranch = getCurrentBranch()
      if (!currentBranch) {
        this.error('Could not determine current branch.')
      }
      branchName = currentBranch
    }

    const result = validateBranchName(branchName)

    this.log('')

    if (result.valid && result.parts) {
      if (args.name) {
        this.log(styles.success('✅ Valid branch name'))
      } else {
        this.log(styles.success(`✅ Current branch '${branchName}' is valid`))
      }
      if (result.parts.ticketId) {
        this.log(styles.muted(`   Ticket: ${result.parts.ticketId}`))
      }
      this.log(styles.muted(`   Type: ${result.parts.type}`))
      if (result.parts.owner) {
        this.log(styles.muted(`   Owner: ${result.parts.owner}`))
      }
      if (result.parts.agent) {
        this.log(styles.muted(`   Agent: ${result.parts.agent}`))
      }
      this.log(styles.muted(`   Description: ${result.parts.description}`))
    } else {
      this.log(styles.error('❌ Invalid branch name format'))
      if (result.error) {
        this.log(styles.muted(`   ${result.error}`))
      }
      this.log(styles.muted(`   Expected: {ticketId?}/{type}/{owner?}/{description}`))
      this.log(styles.muted(`   Types: ${Object.keys(BRANCH_TYPES).join(', ')}`))
    }

    this.log('')

    // Exit with error code if invalid (useful for scripts)
    if (!result.valid) {
      this.exit(1)
    }
  }
}
