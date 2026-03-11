import { Args, Flags } from '@oclif/core'
import { PMOCommand, pmoBaseFlags } from '../../../lib/pmo/index.js'
import { shouldOutputJson, outputSuccessAsJson, createMetadata } from '../../../lib/prompt-json.js'
import { addMcpServer } from '../../../lib/tool-registry.js'
import { getWorkspaceInfo } from '../../../lib/agents/commands.js'
import { styles } from '../../../lib/styles.js'

export default class ToolsAddMcp extends PMOCommand {
  static description = 'Register an MCP server'

  static examples = [
    '<%= config.bin %> <%= command.id %> arcade --url https://api.arcade.dev/mcp --auth \'${ARCADE_API_KEY}\' --description "Arcade integrations"',
    '<%= config.bin %> <%= command.id %> custom-internal --command "node ./tools/my-mcp-server.js" --description "Internal tools"',
  ]

  static args = {
    name: Args.string({
      description: 'Name for the MCP server',
      required: true,
    }),
  }

  static flags = {
    ...pmoBaseFlags,
    url: Flags.string({
      description: 'Remote server URL (for HTTP-based MCP servers)',
    }),
    command: Flags.string({
      description: 'Local command to run (for stdio-based MCP servers)',
    }),
    auth: Flags.string({
      description: 'Auth environment variable (e.g., ${ARCADE_API_KEY})',
    }),
    description: Flags.string({
      char: 'd',
      description: 'Human-readable description',
      required: true,
    }),
  }

  protected getPMOOptions() {
    return { promptIfMultiple: false }
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(ToolsAddMcp)
    const jsonMode = shouldOutputJson(flags)

    if (!flags.url && !flags.command) {
      const msg = 'Either --url or --command is required for MCP server registration.'
      if (jsonMode) {
        this.error(msg)
      }
      this.error(msg)
    }

    const workspaceInfo = getWorkspaceInfo()

    const config = {
      ...(flags.url ? { url: flags.url } : {}),
      ...(flags.command ? { command: flags.command } : {}),
      ...(flags.auth ? { auth: flags.auth } : {}),
      description: flags.description,
    }

    addMcpServer(workspaceInfo.path, args.name, config)

    if (jsonMode) {
      outputSuccessAsJson(
        { name: args.name, type: 'mcp', config },
        createMetadata('tools add mcp', flags)
      )
      return
    }

    this.logPlain(`${styles.success('Added MCP server:')} ${styles.code(args.name)}`)
    this.logPlain(styles.muted(`  ${config.url || config.command}`))
  }
}
