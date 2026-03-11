import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import { shouldOutputJson } from '../../lib/prompt-json.js'
import { checkTools } from '../../lib/tool-registry.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import { styles } from '../../lib/styles.js'

export default class ToolsCheck extends PMOCommand {
  static description = 'Verify all registered tools are available and healthy'

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
    const { flags } = await this.parse(ToolsCheck)
    const jsonMode = shouldOutputJson(flags)

    const workspaceInfo = getWorkspaceInfo()
    const results = checkTools(workspaceInfo.path)

    if (jsonMode) {
      this.log(JSON.stringify({ success: true, results }, null, 2))
      return
    }

    this.log('')
    this.logPlain(styles.header('Tool Health Check'))
    this.log('')

    const mcpResults = results.filter(r => r.type === 'mcp')
    const cliResults = results.filter(r => r.type === 'cli')

    if (mcpResults.length > 0) {
      this.logPlain(styles.code('MCP Servers:'))
      for (const result of mcpResults) {
        const icon = result.available ? styles.success('[OK]') : styles.error('[FAIL]')
        const detail = result.error ? styles.muted(` — ${result.error}`) : ''
        this.logPlain(`  ${icon} ${result.name}${detail}`)
      }
      this.log('')
    }

    if (cliResults.length > 0) {
      this.logPlain(styles.code('CLI Tools:'))
      for (const result of cliResults) {
        const icon = result.available ? styles.success('[OK]') : styles.error('[FAIL]')
        const detail = result.error ? styles.muted(` — ${result.error}`) : ''
        this.logPlain(`  ${icon} ${result.name}${detail}`)
      }
      this.log('')
    }

    const available = results.filter(r => r.available).length
    const total = results.length
    if (available === total) {
      this.logPlain(styles.success(`All ${total} tool(s) available.`))
    } else {
      this.logPlain(styles.warning(`${available}/${total} tool(s) available.`))
    }
    this.log('')
  }
}
