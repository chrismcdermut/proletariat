import { Args, Flags } from '@oclif/core'
import inquirer from 'inquirer'
import { PMOCommand, pmoBaseFlags, autoExportToBoard } from '../../../lib/pmo/index.js'
import { styles } from '../../../lib/styles.js'
import {
  shouldOutputJson,
  outputPromptAsJson,
  outputErrorAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../../lib/prompt-json.js'

export default class EpicLinkBlock extends PMOCommand {
  static description = 'Add a blocking dependency (epic is blocked by another)'

  static examples = [
    '<%= config.bin %> <%= command.id %> EPIC-001 EPIC-002  # EPIC-001 is blocked by EPIC-002',
  ]

  static args = {
    id: Args.string({ description: 'Epic ID that will be blocked', required: true }),
    blocker: Args.string({ description: 'Epic ID that blocks this epic', required: false }),
  }

  static flags = {
    ...pmoBaseFlags,
    project: Flags.string({ char: 'P', description: 'Project ID' }),
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
    'no-interactive': Flags.boolean({
      description: 'Alias for --json flag',
      default: false,
    }),
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(EpicLinkBlock)

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags)

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('epic link block', flags))
        this.exit(1)
      }
      this.error(message)
    }

    const epic = await this.storage.getEpic(args.id)
    if (!epic) return handleError('EPIC_NOT_FOUND', `Epic not found: ${args.id}`)

    const projectId = epic.projectId

    let blockerId = args.blocker
    if (!blockerId) {
      const allEpics = await this.storage.listEpics(projectId)
      const otherEpics = allEpics.filter(e => e.id !== args.id)
      if (otherEpics.length === 0) {
        if (jsonMode) {
          outputErrorAsJson('NO_OTHER_EPICS', 'No other epics.', createMetadata('epic link block', flags))
          return
        }
        this.log(styles.muted('\nNo other epics.'))
        return
      }

      // In JSON mode, output blocker selection prompt
      if (jsonMode) {
        const epicChoices = otherEpics.map(e => ({ name: `${e.id} - ${e.title} (${e.status})`, value: e.id }))
        outputPromptAsJson(
          buildPromptConfig('list', 'blocker', `Select epic that blocks ${args.id}:`, epicChoices),
          createMetadata('epic link block', flags)
        )
        return
      }

      const { selected } = await inquirer.prompt([{
        type: 'list', name: 'selected', message: `Select epic that blocks ${args.id}:`,
        choices: otherEpics.map(e => ({ name: `${e.id} - ${e.title} (${e.status})`, value: e.id })),
      }])
      blockerId = selected
    }

    const blockerEpic = await this.storage.getEpic(blockerId!)
    if (!blockerEpic) return handleError('BLOCKER_EPIC_NOT_FOUND', `Epic not found: ${blockerId}`)

    try {
      await this.storage.createEpicDependency(args.id, blockerId!, 'blocks')
      await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)))

      this.log(styles.success(`\n✅ ${styles.emphasis(args.id)} is blocked by ${styles.emphasis(blockerId!)}`))
      this.log(styles.muted(`   ${epic.title} blocked by: ${blockerEpic.title}`))
    } catch (error) {
      if (error instanceof Error && (error.message.includes('already exists') || error.message.includes('self-dependency'))) {
        this.error(error.message.includes('already exists') ? 'Dependency already exists' : 'Cannot create self-dependency')
      }
      throw error
    }
  }
}
