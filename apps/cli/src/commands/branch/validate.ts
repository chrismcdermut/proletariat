import { Args } from '@oclif/core'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import { styles } from '../../lib/styles.js'
import {
  BRANCH_TYPES,
  validateBranchName,
  getCurrentBranch,
  isGitRepo,
} from '../../lib/branch/index.js'
import { shouldOutputJson, outputErrorAsJson, createMetadata } from '../../lib/prompt-json.js'

export default class BranchValidate extends PMOCommand {
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

  static flags = {
    ...pmoBaseFlags,
  }

  protected getPMOOptions() {
    return { promptIfMultiple: false }
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(BranchValidate)
    const jsonMode = shouldOutputJson(flags)

    let branchName: string = args.name || ''

    // Use current branch if not provided
    if (!branchName) {
      if (!isGitRepo()) {
        if (jsonMode) {
          outputErrorAsJson('NOT_GIT_REPO', 'Not in a git repository.', createMetadata('branch validate', flags))
          return
        }
        this.error('Not in a git repository.')
      }

      const currentBranch = getCurrentBranch()
      if (!currentBranch) {
        if (jsonMode) {
          outputErrorAsJson('NO_BRANCH', 'Could not determine current branch.', createMetadata('branch validate', flags))
          return
        }
        this.error('Could not determine current branch.')
      }
      branchName = currentBranch
    }

    const result = validateBranchName(branchName)

    if (jsonMode) {
      this.log(JSON.stringify({ branch: branchName, ...result }, null, 2))
      if (!result.valid) {
        this.exit(1)
      }
      return
    }

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
      this.log(styles.muted(`   Expected: {ticketId}/{type}/{description} or {type}/{description}`))
      this.log(styles.muted(`   Types: ${Object.keys(BRANCH_TYPES).join(', ')}`))
    }

    this.log('')

    // Exit with error code if invalid (useful for scripts)
    if (!result.valid) {
      this.exit(1)
    }
  }
}
