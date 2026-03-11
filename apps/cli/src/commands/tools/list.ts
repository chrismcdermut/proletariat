import { Flags } from '@oclif/core'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import { shouldOutputJson } from '../../lib/prompt-json.js'
import { readToolRegistry } from '../../lib/tool-registry.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import { styles } from '../../lib/styles.js'

export default class ToolsList extends PMOCommand {
  static description = 'List all registered MCP servers and CLI tools'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --type mcp',
    '<%= config.bin %> <%= command.id %> --type cli',
  ]

  static flags = {
    ...pmoBaseFlags,
    type: Flags.string({
      char: 't',
      description: 'Filter by tool type',
      options: ['mcp', 'cli', 'all'],
      default: 'all',
    }),
  }

  protected getPMOOptions() {
    return { promptIfMultiple: false }
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(ToolsList)
    const jsonMode = shouldOutputJson(flags)

    const workspaceInfo = getWorkspaceInfo()
    const registry = readToolRegistry(workspaceInfo.path)

    const mcpServers = Object.entries(registry['mcp-servers'])
    const cliTools = Object.entries(registry['cli-tools'])

    if (jsonMode) {
      this.log(JSON.stringify({
        success: true,
        'mcp-servers': registry['mcp-servers'],
        'cli-tools': registry['cli-tools'],
      }, null, 2))
      return
    }

    this.log('')

    // MCP Servers
    if (flags.type === 'all' || flags.type === 'mcp') {
      this.logPlain(styles.header('MCP Servers'))
      if (mcpServers.length === 0) {
        this.logPlain(styles.muted('  No MCP servers registered.'))
      } else {
        for (const [name, config] of mcpServers) {
          const endpoint = config.url || config.command || 'unknown'
          const auth = config.auth ? ` [auth: ${config.auth}]` : ''
          this.logPlain(`  ${styles.code(name)} — ${config.description}`)
          this.logPlain(styles.muted(`    ${endpoint}${auth}`))
        }
      }
      this.log('')
    }

    // CLI Tools
    if (flags.type === 'all' || flags.type === 'cli') {
      this.logPlain(styles.header('CLI Tools'))
      if (cliTools.length === 0) {
        this.logPlain(styles.muted('  No CLI tools registered.'))
      } else {
        for (const [name, config] of cliTools) {
          const builtin = config.builtin ? styles.muted(' (built-in)') : ''
          this.logPlain(`  ${styles.code(name)} — ${config.description}${builtin}`)
          this.logPlain(styles.muted(`    command: ${config.command}`))
        }
      }
      this.log('')
    }

    const totalCount = mcpServers.length + cliTools.length
    this.logPlain(styles.muted(`${totalCount} tool(s) registered.`))
    this.log('')
  }
}
