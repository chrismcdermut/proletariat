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

export default class EpicLinkDuplicates extends PMOCommand {
  static description = 'Mark an epic as duplicate of another'
  static examples = ['<%= config.bin %> <%= command.id %> EPIC-001 EPIC-002']

  static args = {
    id: Args.string({ description: 'Duplicate epic ID', required: true }),
    original: Args.string({ description: 'Original epic ID', required: false }),
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
    const { args, flags } = await this.parse(EpicLinkDuplicates)

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags)

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('epic link duplicates', flags))
        this.exit(1)
      }
      this.error(message)
    }

    const epic = await this.storage.getEpic(args.id)
    if (!epic) return handleError('EPIC_NOT_FOUND', `Epic not found: ${args.id}`)

    const projectId = epic.projectId

    let originalId = args.original
    if (!originalId) {
      const allEpics = await this.storage.listEpics(projectId)
      const otherEpics = allEpics.filter(e => e.id !== args.id)
      if (otherEpics.length === 0) {
        if (jsonMode) {
          outputErrorAsJson('NO_OTHER_EPICS', 'No other epics.', createMetadata('epic link duplicates', flags))
          return
        }
        this.log(styles.muted('\nNo other epics.'))
        return
      }

      // In JSON mode, output original epic selection prompt
      if (jsonMode) {
        const epicChoices = otherEpics.map(e => ({ name: `${e.id} - ${e.title}`, value: e.id }))
        outputPromptAsJson(
          buildPromptConfig('list', 'original', `Select the original epic (${args.id} is a duplicate of):`, epicChoices),
          createMetadata('epic link duplicates', flags)
        )
        return
      }

      const { selected } = await inquirer.prompt([{ type: 'list', name: 'selected', message: `Select the original epic (${args.id} is a duplicate of):`,
        choices: otherEpics.map(e => ({ name: `${e.id} - ${e.title}`, value: e.id })) }])
      originalId = selected
    }

    const originalEpic = await this.storage.getEpic(originalId!)
    if (!originalEpic) return handleError('ORIGINAL_EPIC_NOT_FOUND', `Epic not found: ${originalId}`)

    await this.storage.createEpicDependency(args.id, originalId!, 'duplicates')
    await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)))
    this.log(styles.success(`\n✅ ${styles.emphasis(args.id)} duplicates ${styles.emphasis(originalId!)}`))
  }
}
