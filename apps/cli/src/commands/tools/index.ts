import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import { shouldOutputJson } from '../../lib/prompt-json.js'

export default class Tools extends PMOCommand {
  static description = 'Manage registered MCP servers and CLI tools'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> list',
    '<%= config.bin %> <%= command.id %> add mcp arcade --url https://api.arcade.dev/mcp',
    '<%= config.bin %> <%= command.id %> add cli gh --command gh',
    '<%= config.bin %> <%= command.id %> remove arcade',
    '<%= config.bin %> <%= command.id %> check',
    '<%= config.bin %> <%= command.id %> detect',
  ]

  static flags = {
    ...pmoBaseFlags,
  }

  protected getPMOOptions() {
    return { promptIfMultiple: false }
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(Tools)

    const jsonModeConfig = shouldOutputJson(flags) ? { flags, commandName: 'tools' } : null

    const { action } = await this.prompt<{ action: string }>([{
      type: 'list',
      name: 'action',
      message: 'Tool Registry — What would you like to do?',
      choices: [
        { name: 'List all registered tools', value: 'list', command: 'prlt tools list --json' },
        { name: 'Add an MCP server', value: 'add-mcp', command: 'prlt tools add mcp --json' },
        { name: 'Add a CLI tool', value: 'add-cli', command: 'prlt tools add cli --json' },
        { name: 'Remove a tool', value: 'remove', command: 'prlt tools remove --json' },
        { name: 'Check tool availability', value: 'check', command: 'prlt tools check --json' },
        { name: 'Auto-detect CLI tools', value: 'detect', command: 'prlt tools detect --json' },
        { name: 'Cancel', value: 'cancel' },
      ],
    }], jsonModeConfig)

    if (action === 'cancel') {
      return
    }

    switch (action) {
      case 'list':
        await this.config.runCommand('tools:list', [])
        break
      case 'add-mcp':
        await this.config.runCommand('tools:add:mcp', [])
        break
      case 'add-cli':
        await this.config.runCommand('tools:add:cli', [])
        break
      case 'remove':
        await this.config.runCommand('tools:remove', [])
        break
      case 'check':
        await this.config.runCommand('tools:check', [])
        break
      case 'detect':
        await this.config.runCommand('tools:detect', [])
        break
    }
  }
}
