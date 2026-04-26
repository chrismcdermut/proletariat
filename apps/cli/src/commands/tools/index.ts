import { Command } from '@oclif/core'
import chalk from 'chalk'
import { findHQRoot } from '../../lib/workspace.js'
import { shouldOutputJson } from '../../lib/prompt-json.js'
import { machineOutputFlags } from '../../lib/pmo/index.js'
import {
  loadToolRegistry,
  getMcpServers,
  getCliTools,
  getApiTools,
} from '../../lib/tool-registry/index.js'

export default class ToolsList extends Command {
  static description = 'Show all registered MCP servers and CLI tools'

  static aliases = ['tools:list']

  static examples = [
    '<%= config.bin %> tools',
    '<%= config.bin %> tools --json',
  ]

  static flags = {
    ...machineOutputFlags,
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(ToolsList)
    const jsonMode = shouldOutputJson(flags)

    const hqPath = findHQRoot()
    if (!hqPath) {
      if (jsonMode) {
        this.log(JSON.stringify({ error: 'Not in a proletariat workspace' }))
      } else {
        this.error('Not in a proletariat workspace. Run `prlt init` first.')
      }
      return
    }

    const registry = loadToolRegistry(hqPath)
    const mcpServers = getMcpServers(registry)
    const cliTools = getCliTools(registry)
    const apiTools = getApiTools(registry)

    if (jsonMode) {
      this.log(JSON.stringify({
        mcpServers: mcpServers.map(s => ({
          name: s.name,
          type: 'mcp',
          url: s.url,
          command: s.command,
          description: s.description,
        })),
        cliTools: cliTools.map(t => ({
          name: t.name,
          type: 'cli',
          command: t.command,
          description: t.description,
          builtin: t.builtin || false,
        })),
        apiTools: apiTools.map(a => ({
          name: a.name,
          type: 'api',
          url: a.url,
          auth: a.auth,
          auth_header: a.auth_header,
          description: a.description,
          docs: a.docs,
        })),
      }, null, 2))
      return
    }

    this.log('')
    this.log(chalk.bold('Tool Registry'))
    this.log('═'.repeat(60))

    // MCP Servers
    this.log(`\n${chalk.bold('MCP Servers')}`)
    this.log('─'.repeat(40))
    if (mcpServers.length === 0) {
      this.log(chalk.dim('  No MCP servers registered'))
      this.log(chalk.dim('  Add one: prlt tools add mcp <name> --url <url>'))
    } else {
      for (const server of mcpServers) {
        const endpoint = server.url || server.command || ''
        const auth = server.auth ? chalk.dim(` [auth: ${server.auth}]`) : ''
        this.log(`  ${chalk.cyan(server.name)} — ${server.description}`)
        this.log(`    ${chalk.dim(endpoint)}${auth}`)
      }
    }

    // CLI Tools
    this.log(`\n${chalk.bold('CLI Tools')}`)
    this.log('─'.repeat(40))
    if (cliTools.length === 0) {
      this.log(chalk.dim('  No CLI tools registered'))
    } else {
      for (const tool of cliTools) {
        const builtin = tool.builtin ? chalk.dim(' [built-in]') : ''
        this.log(`  ${chalk.green(tool.name)} (${tool.command}) — ${tool.description}${builtin}`)
      }
    }

    // API Tools
    this.log(`\n${chalk.bold('REST APIs')}`)
    this.log('─'.repeat(40))
    if (apiTools.length === 0) {
      this.log(chalk.dim('  No REST APIs registered'))
      this.log(chalk.dim('  Add one: prlt tools add api <name> --url <url> --description "..."'))
    } else {
      for (const api of apiTools) {
        const auth = api.auth ? chalk.dim(` [auth: $${api.auth}]`) : ''
        const docs = api.docs ? chalk.dim(` [docs: ${api.docs}]`) : ''
        this.log(`  ${chalk.yellow(api.name)} — ${api.description}`)
        this.log(`    ${chalk.dim(api.url)}${auth}${docs}`)
      }
    }

    this.log('')
    this.log(chalk.dim('Manage: prlt tools add | prlt tools remove | prlt tools detect'))
    this.log('')
  }
}
