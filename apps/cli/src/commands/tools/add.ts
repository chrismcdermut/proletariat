import { Args, Flags } from '@oclif/core'
import chalk from 'chalk'
import { PromptCommand } from '../../lib/prompt-command.js'
import { findHQRoot } from '../../lib/workspace.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'
import { machineOutputFlags } from '../../lib/pmo/index.js'
import {
  addMcpServer,
  addCliTool,
  addApiTool,
  loadToolRegistry,
} from '../../lib/tool-registry/index.js'

export default class ToolsAdd extends PromptCommand {
  static description = 'Register an MCP server, CLI tool, or REST API'

  static examples = [
    '<%= config.bin %> tools add mcp arcade --url https://api.arcade.dev/mcp --auth ARCADE_API_KEY --description "Arcade integrations"',
    '<%= config.bin %> tools add cli gh --command gh --detect "which gh" --install "brew install gh" --description "GitHub CLI"',
    '<%= config.bin %> tools add api posthog --url https://app.posthog.com/api --auth POSTHOG_API_KEY --description "PostHog analytics API" --docs https://posthog.com/docs/api',
  ]

  static args = {
    type: Args.string({
      description: 'Tool type (mcp, cli, or api)',
      required: true,
      options: ['mcp', 'cli', 'api'],
    }),
    name: Args.string({
      description: 'Tool name (unique identifier)',
      required: true,
    }),
  }

  static flags = {
    ...machineOutputFlags,
    url: Flags.string({
      description: 'MCP server URL (for remote servers)',
    }),
    command: Flags.string({
      description: 'Command to run (MCP server command or CLI tool binary)',
    }),
    auth: Flags.string({
      description: 'Environment variable for authentication (e.g., ARCADE_API_KEY)',
    }),
    detect: Flags.string({
      description: 'Shell command to detect if CLI tool is installed',
    }),
    install: Flags.string({
      description: 'Shell command to install the CLI tool',
    }),
    description: Flags.string({
      char: 'd',
      description: 'Human-readable description',
      required: true,
    }),
    docs: Flags.string({
      description: 'Link to API documentation',
    }),
    'auth-header': Flags.string({
      description: 'Auth header format (default: "Authorization: Bearer")',
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ToolsAdd)
    const jsonMode = shouldOutputJson(flags)
    const meta = () => createMetadata('tools add', flags as Record<string, unknown>)

    const hqPath = findHQRoot()
    if (!hqPath) {
      if (jsonMode) {
        outputErrorAsJson('NO_WORKSPACE', 'Not in a proletariat workspace', meta())
        return
      } else {
        this.error('Not in a proletariat workspace. Run `prlt init` first.')
      }
      return
    }

    const registry = loadToolRegistry(hqPath)

    if (args.type === 'mcp') {
      if (!flags.url && !flags.command) {
        if (jsonMode) {
          outputErrorAsJson('MISSING_FLAG', 'MCP server requires --url or --command', meta())
          return
        } else {
          this.error('MCP server requires either --url (remote) or --command (local)')
        }
        return
      }

      if (args.name in registry['mcp-servers']) {
        if (jsonMode) {
          outputErrorAsJson('DUPLICATE', `MCP server '${args.name}' already exists`, meta())
          return
        } else {
          this.error(`MCP server '${args.name}' already exists. Remove it first with: prlt tools remove ${args.name}`)
        }
        return
      }

      const auth = flags.auth ? `\${${flags.auth}}` : undefined
      addMcpServer(hqPath, args.name, {
        url: flags.url,
        command: flags.command,
        auth,
        description: flags.description,
      })

      if (jsonMode) {
        outputSuccessAsJson(
          { name: args.name, type: 'mcp', description: flags.description },
          meta()
        )
        return
      } else {
        this.log(chalk.green(`\nMCP server '${args.name}' registered successfully.`))
        if (flags.url) this.log(chalk.dim(`  URL: ${flags.url}`))
        if (flags.command) this.log(chalk.dim(`  Command: ${flags.command}`))
        this.log('')
      }
    } else if (args.type === 'cli') {
      const command = flags.command || args.name

      if (args.name in registry['cli-tools']) {
        if (jsonMode) {
          outputErrorAsJson('DUPLICATE', `CLI tool '${args.name}' already exists`, meta())
          return
        } else {
          this.error(`CLI tool '${args.name}' already exists. Remove it first with: prlt tools remove ${args.name}`)
        }
        return
      }

      addCliTool(hqPath, args.name, {
        command,
        description: flags.description,
        detect: flags.detect,
        install: flags.install,
      })

      if (jsonMode) {
        outputSuccessAsJson(
          { name: args.name, type: 'cli', command, description: flags.description },
          meta()
        )
        return
      } else {
        this.log(chalk.green(`\nCLI tool '${args.name}' registered successfully.`))
        this.log(chalk.dim(`  Command: ${command}`))
        this.log('')
      }
    } else if (args.type === 'api') {
      if (!flags.url) {
        if (jsonMode) {
          outputErrorAsJson('MISSING_FLAG', 'API tool requires --url', meta())
          return
        } else {
          this.error('API tool requires --url (base URL of the REST API)')
        }
        return
      }

      if (args.name in registry['api-tools']) {
        if (jsonMode) {
          outputErrorAsJson('DUPLICATE', `API tool '${args.name}' already exists`, meta())
          return
        } else {
          this.error(`API tool '${args.name}' already exists. Remove it first with: prlt tools remove ${args.name}`)
        }
        return
      }

      addApiTool(hqPath, args.name, {
        url: flags.url,
        auth: flags.auth,
        auth_header: flags['auth-header'],
        description: flags.description,
        docs: flags.docs,
      })

      if (jsonMode) {
        outputSuccessAsJson(
          { name: args.name, type: 'api', url: flags.url, description: flags.description },
          meta()
        )
        return
      } else {
        this.log(chalk.green(`\nAPI tool '${args.name}' registered successfully.`))
        this.log(chalk.dim(`  URL: ${flags.url}`))
        if (flags.auth) this.log(chalk.dim(`  Auth: ${flags.auth}`))
        if (flags.docs) this.log(chalk.dim(`  Docs: ${flags.docs}`))
        this.log('')
      }
    }
  }
}
