import { Command } from '@oclif/core'
import chalk from 'chalk'
import { findHQRoot } from '../../lib/workspace.js'
import { shouldOutputJson } from '../../lib/prompt-json.js'
import { machineOutputFlags } from '../../lib/pmo/index.js'
import { loadToolRegistry, checkAllTools } from '../../lib/tool-registry/index.js'

export default class ToolsCheck extends Command {
  static description = 'Verify all registered tools are available and healthy'

  static examples = [
    '<%= config.bin %> tools check',
    '<%= config.bin %> tools check --json',
  ]

  static flags = {
    ...machineOutputFlags,
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(ToolsCheck)
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
    const results = checkAllTools(registry)

    if (jsonMode) {
      this.log(JSON.stringify({ results }, null, 2))
      return
    }

    this.log('')
    this.log(chalk.bold('Tool Health Check'))
    this.log('═'.repeat(60))

    const available = results.filter(r => r.available)
    const unavailable = results.filter(r => !r.available)

    if (available.length > 0) {
      this.log(`\n${chalk.green('Available')}`)
      this.log('─'.repeat(40))
      for (const result of available) {
        const badge = result.type === 'mcp' ? chalk.cyan('[MCP]') : result.type === 'api' ? chalk.yellow('[API]') : chalk.green('[CLI]')
        this.log(`  ${chalk.green('✓')} ${badge} ${result.name}`)
      }
    }

    if (unavailable.length > 0) {
      this.log(`\n${chalk.red('Unavailable')}`)
      this.log('─'.repeat(40))
      for (const result of unavailable) {
        const badge = result.type === 'mcp' ? chalk.cyan('[MCP]') : result.type === 'api' ? chalk.yellow('[API]') : chalk.green('[CLI]')
        this.log(`  ${chalk.red('✗')} ${badge} ${result.name}`)
        if (result.error) this.log(`    ${chalk.dim(result.error)}`)
        if (result.installHint) this.log(`    ${chalk.dim(`Install: ${result.installHint}`)}`)
      }
    }

    if (results.length === 0) {
      this.log(chalk.dim('\n  No tools registered. Run `prlt tools detect` to find available tools.'))
    }

    this.log('')

    const total = results.length
    const okCount = available.length
    if (total > 0) {
      const summary = okCount === total
        ? chalk.green(`All ${total} tools available`)
        : chalk.yellow(`${okCount}/${total} tools available`)
      this.log(summary)
      this.log('')
    }
  }
}
