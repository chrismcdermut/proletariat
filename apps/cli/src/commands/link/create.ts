import { Args, Flags } from '@oclif/core'
import { autoExportToBoard, PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import { styles } from '../../lib/styles.js'
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'

type EntityType = 'ticket' | 'epic'

/**
 * Infer entity type from ID prefix
 */
function inferEntityType(id: string): EntityType | null {
  const upper = id.toUpperCase()
  if (upper.startsWith('TKT-')) return 'ticket'
  if (upper.startsWith('EPIC-')) return 'epic'
  return null
}

export default class LinkCreate extends PMOCommand {
  static description = 'Create a link (dependency) between two entities'

  static examples = [
    '<%= config.bin %> <%= command.id %> TKT-001 TKT-002 --type blocks    # TKT-001 is blocked by TKT-002',
    '<%= config.bin %> <%= command.id %> TKT-001 TKT-002 --type relates   # TKT-001 relates to TKT-002',
    '<%= config.bin %> <%= command.id %> EPIC-001 EPIC-002 --type blocks  # EPIC-001 is blocked by EPIC-002',
  ]

  static args = {
    from: Args.string({
      description: 'Source entity ID (TKT-xxx or EPIC-xxx)',
      required: true,
    }),
    to: Args.string({
      description: 'Target entity ID',
      required: true,
    }),
  }

  static flags = {
    ...pmoBaseFlags,
    type: Flags.string({
      char: 't',
      description: 'Link type',
      options: ['blocks', 'relates', 'duplicates'],
      required: true,
    }),
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(LinkCreate)

    const jsonMode = shouldOutputJson(flags)

    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('link create', flags))
        this.exit(1)
      }
      this.error(message)
    }

    const fromType = inferEntityType(args.from)
    const toType = inferEntityType(args.to)

    if (!fromType) {
      return handleError('INVALID_FROM_ID', `Cannot infer entity type from "${args.from}". Use TKT- or EPIC- prefix.`)
    }
    if (!toType) {
      return handleError('INVALID_TO_ID', `Cannot infer entity type from "${args.to}". Use TKT- or EPIC- prefix.`)
    }
    if (fromType !== toType) {
      return handleError('TYPE_MISMATCH', `Cannot link different entity types: ${fromType} and ${toType}`)
    }

    const linkType = flags.type as string

    // Map the link type to the storage dependency type
    const dependencyType = linkType === 'relates' ? 'relates_to' : linkType

    try {
      if (fromType === 'ticket') {
        const ticket = await this.storage.getTicket(args.from)
        if (!ticket) return handleError('FROM_NOT_FOUND', `Ticket not found: ${args.from}`)

        const targetTicket = await this.storage.getTicket(args.to)
        if (!targetTicket) return handleError('TO_NOT_FOUND', `Ticket not found: ${args.to}`)

        await this.storage.createTicketDependency(args.from, args.to, dependencyType as 'blocks' | 'relates_to' | 'duplicates')
        await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)))

        this.log(styles.success(`\n✅ Link created: ${styles.emphasis(args.from)} → ${styles.emphasis(args.to)} (${linkType})`))
        this.log(styles.muted(`   ${ticket.title}`))
        this.log(styles.muted(`   ${linkType}: ${targetTicket.title}`))

      } else if (fromType === 'epic') {
        const epic = await this.storage.getEpic(args.from)
        if (!epic) return handleError('FROM_NOT_FOUND', `Epic not found: ${args.from}`)

        const targetEpic = await this.storage.getEpic(args.to)
        if (!targetEpic) return handleError('TO_NOT_FOUND', `Epic not found: ${args.to}`)

        await this.storage.createEpicDependency(args.from, args.to, dependencyType as 'blocks' | 'relates_to' | 'duplicates')
        await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)))

        this.log(styles.success(`\n✅ Link created: ${styles.emphasis(args.from)} → ${styles.emphasis(args.to)} (${linkType})`))
        this.log(styles.muted(`   ${epic.title}`))
        this.log(styles.muted(`   ${linkType}: ${targetEpic.title}`))
      }

    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('already exists')) {
          return handleError('ALREADY_EXISTS', 'Link already exists')
        }
        if (error.message.includes('self-dependency')) {
          return handleError('SELF_LINK', 'Cannot create self-link')
        }
      }
      throw error
    }
  }
}
