import { Args, Flags } from '@oclif/core'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'
import { RuntimeCommand, runtimeBaseFlags } from '../../lib/runtime-command.js'
import { styles } from '../../lib/styles.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'
import { getPMOContext } from '../../lib/pmo/pmo-context.js'

export default class ActionEdit extends RuntimeCommand {
  static description = 'Edit an action prompt in $EDITOR (reads from DB, writes back on save)'

  static examples = [
    '<%= config.bin %> <%= command.id %> implement',
    '<%= config.bin %> <%= command.id %> groom',
    '<%= config.bin %> <%= command.id %> implement --prompt "New prompt text"',
  ]

  static flags = {
    ...runtimeBaseFlags,
    prompt: Flags.string({
      description: 'Set prompt directly (skip $EDITOR)',
    }),
    description: Flags.string({
      char: 'd',
      description: 'Update description',
    }),
    'from-intent': Flags.string({
      description: 'Update from_intent',
    }),
    'to-intent': Flags.string({
      description: 'Update to_intent',
    }),
    executor: Flags.string({
      description: 'Update executor',
      options: ['claude', 'codex', 'opencode', 'custom'],
    }),
    timeout: Flags.integer({
      description: 'Update timeout in seconds',
    }),
    'valid-from': Flags.string({
      description: 'Comma-separated intent names this action can be invoked from (empty string to clear)',
    }),
  }

  static args = {
    name: Args.string({
      description: 'Action name or ID to edit',
      required: true,
    }),
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(ActionEdit)
    const jsonMode = shouldOutputJson(flags)

    const pmoContext = await getPMOContext({
      logger: (msg) => this.log(styles.muted(msg)),
    })

    try {
      const action = await pmoContext.storage.getAction(args.name)

      if (!action) {
        if (jsonMode) {
          outputErrorAsJson('NOT_FOUND', `Action "${args.name}" not found.`, createMetadata('action edit', flags))
          return
        }
        this.error(`Action "${args.name}" not found.`)
      }

      // Build changes from flags
      const changes: Record<string, unknown> = {}
      if (flags.description !== undefined) changes.description = flags.description
      if (flags['from-intent'] !== undefined) changes.fromIntent = flags['from-intent']
      if (flags['to-intent'] !== undefined) changes.toIntent = flags['to-intent']
      if (flags.executor !== undefined) changes.executor = flags.executor
      if (flags.timeout !== undefined) changes.timeout = flags.timeout
      if (flags['valid-from'] !== undefined) {
        changes.validFrom = flags['valid-from']
          ? flags['valid-from'].split(',').map((s: string) => s.trim()).filter(Boolean)
          : []
      }

      // Handle prompt: either from --prompt flag or open $EDITOR
      if (flags.prompt !== undefined) {
        changes.prompt = flags.prompt
      } else if (Object.keys(changes).length === 0) {
        // No flag-based changes — open editor for prompt
        const editor = process.env.EDITOR || process.env.VISUAL || 'vi'

        if (jsonMode) {
          // In JSON mode we can't open an editor — require --prompt flag
          outputErrorAsJson(
            'EDITOR_NOT_SUPPORTED',
            'Cannot open $EDITOR in non-interactive mode. Use --prompt flag to set the prompt directly.',
            createMetadata('action edit', flags),
          )
          return
        }

        const tmpDir = os.tmpdir()
        const tmpFile = path.join(tmpDir, `prlt-action-${action.id}.md`)

        try {
          fs.writeFileSync(tmpFile, action.prompt, 'utf-8')
          this.log(styles.muted(`Opening ${editor}...`))

          execFileSync(editor, [tmpFile], {
            stdio: 'inherit',
          })

          const newPrompt = fs.readFileSync(tmpFile, 'utf-8')

          if (newPrompt === action.prompt) {
            this.log(styles.info('No changes made.'))
            return
          }

          changes.prompt = newPrompt
        } finally {
          try {
            fs.unlinkSync(tmpFile)
          } catch {
            // Ignore cleanup errors
          }
        }
      }

      if (Object.keys(changes).length === 0) {
        if (jsonMode) {
          outputSuccessAsJson(
            { message: 'No changes to apply.', action: { id: action.id, name: action.name } },
            createMetadata('action edit', flags),
          )
          return
        }
        this.log(styles.info('No changes to apply.'))
        return
      }

      // Built-in actions: the storage layer blocks updateAction for built-ins.
      // We need to update them directly since the ticket says built-ins can be edited.
      let updated
      try {
        if (action.isBuiltin) {
          // Use direct DB update for built-in actions (storage layer blocks updateAction)
          await pmoContext.storage.updateBuiltinAction(action.id, changes)
          updated = await pmoContext.storage.getAction(action.id)
        } else {
          updated = await pmoContext.storage.updateAction(action.id, changes)
        }
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error)
        if (jsonMode) {
          outputErrorAsJson('UPDATE_FAILED', msg, createMetadata('action edit', flags))
          return
        }
        this.error(msg)
        return
      }

      if (jsonMode) {
        outputSuccessAsJson(
          {
            action: {
              id: updated!.id,
              name: updated!.name,
              description: updated!.description,
              isBuiltin: updated!.isBuiltin,
            },
            message: `Action "${updated!.name}" updated.`,
          },
          createMetadata('action edit', flags),
        )
        return
      }

      this.log(styles.success(`Action "${updated!.name}" updated.`))
    } finally {
      await pmoContext.storage.close()
    }
  }
}
