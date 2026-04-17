import { RuntimeCommand, runtimeBaseFlags } from '../../lib/runtime-command.js'
import {
  shouldOutputJson,
  outputPromptAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'

export default class ActionIndex extends RuntimeCommand {
  static description = 'Manage work actions — list, show, create, edit, delete, run'

  static examples = [
    '<%= config.bin %> action list',
    '<%= config.bin %> action show implement',
    '<%= config.bin %> action edit groom',
    '<%= config.bin %> action create deploy --prompt "Deploy changes"',
    '<%= config.bin %> action delete deploy',
    '<%= config.bin %> action run implement PRLT-123',
  ]

  static flags = {
    ...runtimeBaseFlags,
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(ActionIndex)
    const jsonMode = shouldOutputJson(flags)

    const subcommands = [
      { name: 'list — List all actions', value: 'action:list', command: 'prlt action list' },
      { name: 'show — Show full action config + prompt', value: 'action:show', command: 'prlt action show <name>' },
      { name: 'edit — Edit action prompt in $EDITOR', value: 'action:edit', command: 'prlt action edit <name>' },
      { name: 'create — Add a new custom action', value: 'action:create', command: 'prlt action create <name> --prompt "..."' },
      { name: 'delete — Remove a custom action', value: 'action:delete', command: 'prlt action delete <name>' },
      { name: 'run — Run an action on a ticket', value: 'action:run', command: 'prlt action run <name> <ticket>' },
    ]

    if (jsonMode) {
      outputPromptAsJson(
        {
          type: 'list',
          name: 'subcommand',
          message: 'Select action subcommand:',
          choices: subcommands,
        },
        createMetadata('action', flags),
      )
      return
    }

    const selected = await this.selectFromList({
      message: 'Select action subcommand:',
      items: subcommands,
      getName: (s) => s.name,
      getValue: (s) => s.value,
      getCommand: (s) => `${s.command} --json`,
    })

    if (selected) {
      await this.config.runCommand(selected)
    }
  }
}
