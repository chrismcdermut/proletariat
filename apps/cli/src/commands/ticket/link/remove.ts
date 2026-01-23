import { Args, Flags } from '@oclif/core'
import inquirer from 'inquirer'
import { autoExportToBoard, PMOCommand, pmoBaseFlags } from '../../../lib/pmo/index.js'
import { styles } from '../../../lib/styles.js'
import { TicketDependencyType } from '../../../lib/pmo/types.js'
import {
  shouldOutputJson,
  outputPromptAsJson,
  outputErrorAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../../lib/prompt-json.js'

export default class TicketLinkRemove extends PMOCommand {
  static description = 'Remove a dependency from a ticket'

  static examples = [
    '<%= config.bin %> <%= command.id %> TKT-001 TKT-002',
    '<%= config.bin %> <%= command.id %> TKT-001 TKT-002 --type blocks',
    '<%= config.bin %> <%= command.id %> TKT-001 --all',
    '<%= config.bin %> <%= command.id %> TKT-001         # Interactive selection',
  ]

  static args = {
    id: Args.string({
      description: 'Ticket ID',
      required: true,
    }),
    target: Args.string({
      description: 'Target ticket ID to unlink',
      required: false,
    }),
  }

  static flags = {
    ...pmoBaseFlags,
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
    type: Flags.string({
      char: 't',
      description: 'Dependency type to remove',
      options: ['blocks', 'relates_to', 'duplicates'],
    }),
    all: Flags.boolean({
      char: 'a',
      description: 'Remove all dependencies for this ticket',
      default: false,
    }),
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(TicketLinkRemove)

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags)

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('ticket link remove', flags))
        this.exit(1)
      }
      this.error(message)
    }

    const ticket = await this.storage.getTicket(args.id)
    if (!ticket) {
      return handleError('TICKET_NOT_FOUND', `Ticket not found: ${args.id}`)
    }

    const dependencies = await this.storage.listTicketDependencies(args.id)

    if (dependencies.length === 0) {
      if (jsonMode) {
        outputErrorAsJson('NO_DEPENDENCIES', `Ticket ${args.id} has no dependencies.`, createMetadata('ticket link remove', flags))
        return
      }
      this.log(styles.muted(`\nTicket ${args.id} has no dependencies.`))
      return
    }

    // If --all flag, remove all dependencies
    if (flags.all) {
      const confirmChoices = [
        { id: 'no', name: 'No, cancel' },
        { id: 'yes', name: `Yes, remove all ${dependencies.length} dependencies` },
      ]

      const confirmed = await this.selectFromList({
        message: `Remove all ${dependencies.length} dependencies from ${args.id}?`,
        items: confirmChoices,
        getName: (c) => c.name,
        getValue: (c) => c.id,
        getCommand: (c) => c.id === 'yes' ? `prlt ticket link remove ${args.id} --all --force --json` : '',
        jsonMode: jsonMode ? { flags, commandName: 'ticket link remove' } : null,
      })

      if (confirmed !== 'yes') {
        this.log(styles.muted('\nCancelled.'))
        return
      }

      for (const dep of dependencies) {
        await this.storage.deleteTicketDependency(args.id, dep.dependsOnTicketId, dep.dependencyType)
      }

      await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)))

      this.log(styles.success(`\n✅ Removed ${dependencies.length} dependencies from ${args.id}`))
      return
    }

    let targetId = args.target

    // If no target provided, prompt for selection
    if (!targetId) {
      const depChoices = await Promise.all(dependencies.map(async (dep) => {
        const depTicket = await this.storage.getTicket(dep.dependsOnTicketId)
        return {
          id: dep.dependsOnTicketId,
          name: `${dep.dependsOnTicketId} - ${depTicket?.title || 'Unknown'} (${dep.dependencyType})`,
          type: dep.dependencyType,
        }
      }))

      const selected = await this.selectFromList({
        message: 'Select dependency to remove:',
        items: depChoices,
        getName: (d) => d.name,
        getValue: (d) => d.id,
        getCommand: (d) => `prlt ticket link remove ${args.id} ${d.id} --type ${d.type} --json`,
        jsonMode: jsonMode ? { flags, commandName: 'ticket link remove' } : null,
      })

      if (!selected) {
        return
      }
      targetId = selected
    }

    // Find the dependency
    const dep = dependencies.find(d => d.dependsOnTicketId === targetId)
    if (!dep) {
      this.error(`No dependency found from ${args.id} to ${targetId}`)
    }

    const dependencyType = flags.type as TicketDependencyType | undefined
    await this.storage.deleteTicketDependency(args.id, targetId!, dependencyType)

    await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)))

    const depTicket = await this.storage.getTicket(targetId!)
    this.log(styles.success(`\n✅ Removed dependency: ${args.id} → ${targetId}`))
    if (depTicket) {
      this.log(styles.muted(`   ${ticket.title} no longer linked to ${depTicket.title}`))
    }
  }
}
