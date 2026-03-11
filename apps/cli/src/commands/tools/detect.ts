import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import { shouldOutputJson, outputSuccessAsJson, createMetadata } from '../../lib/prompt-json.js'
import { detectCliTools, readToolRegistry, addCliTool } from '../../lib/tool-registry.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import { styles } from '../../lib/styles.js'

export default class ToolsDetect extends PMOCommand {
  static description = 'Auto-detect common CLI tools on the system and register them'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ]

  static flags = {
    ...pmoBaseFlags,
  }

  protected getPMOOptions() {
    return { promptIfMultiple: false }
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(ToolsDetect)
    const jsonMode = shouldOutputJson(flags)

    const workspaceInfo = getWorkspaceInfo()
    const registry = readToolRegistry(workspaceInfo.path)
    const detected = detectCliTools()

    // Filter out already-registered tools
    const newTools = detected.filter(t => !(t.name in registry['cli-tools']))

    if (jsonMode) {
      // Auto-register all detected new tools
      for (const tool of newTools) {
        addCliTool(workspaceInfo.path, tool.name, tool.config)
      }
      outputSuccessAsJson(
        {
          detected: detected.map(t => t.name),
          registered: newTools.map(t => t.name),
          alreadyRegistered: detected.filter(t => t.name in registry['cli-tools']).map(t => t.name),
        },
        createMetadata('tools detect', flags)
      )
      return
    }

    this.log('')
    this.logPlain(styles.header('CLI Tool Detection'))
    this.log('')

    if (detected.length === 0) {
      this.logPlain(styles.muted('No common CLI tools detected on this system.'))
      this.log('')
      return
    }

    // Show all detected tools
    this.logPlain(styles.code(`Found ${detected.length} CLI tool(s):`))
    this.log('')

    for (const tool of detected) {
      const alreadyRegistered = tool.name in registry['cli-tools']
      const status = alreadyRegistered ? styles.muted(' (already registered)') : ''
      this.logPlain(`  ${styles.success('+')} ${styles.code(tool.name)} — ${tool.config.description}${status}`)
    }

    if (newTools.length === 0) {
      this.log('')
      this.logPlain(styles.muted('All detected tools are already registered.'))
      this.log('')
      return
    }

    this.log('')

    // Prompt to register new tools
    const choices = [
      { name: 'Yes — register all new tools', value: 'all' },
      { name: 'No — skip', value: 'none' },
    ]
    const message = `Register ${newTools.length} new tool(s)?`

    const { action } = await this.prompt<{ action: string }>([{
      type: 'list',
      name: 'action',
      message,
      choices,
    }])

    if (action === 'all') {
      for (const tool of newTools) {
        addCliTool(workspaceInfo.path, tool.name, tool.config)
      }
      this.log('')
      this.logPlain(styles.success(`Registered ${newTools.length} tool(s).`))
    }

    this.log('')
  }
}
