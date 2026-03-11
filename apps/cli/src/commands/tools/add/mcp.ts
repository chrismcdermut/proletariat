import { Args, Command, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { findHQRoot } from '../../../lib/workspace.js';
import { addMcpServer } from '../../../lib/tools/registry.js';
import { styles } from '../../../lib/styles.js';
import { shouldOutputJson } from '../../../lib/prompt-json.js';

export default class ToolsAddMcp extends Command {
  static description = 'Register an MCP server';

  static examples = [
    '<%= config.bin %> tools add mcp arcade --url https://api.arcade.dev/mcp --auth ARCADE_API_KEY',
    '<%= config.bin %> tools add mcp composio --url https://mcp.composio.dev --auth COMPOSIO_API_KEY',
    '<%= config.bin %> tools add mcp custom-internal --command "node ./tools/my-mcp-server.js"',
  ];

  static args = {
    name: Args.string({
      description: 'Name for the MCP server',
      required: false,
    }),
  };

  static flags = {
    url: Flags.string({
      description: 'Server URL (for remote servers)',
    }),
    command: Flags.string({
      description: 'Command to start local server',
    }),
    auth: Flags.string({
      description: 'Environment variable name for auth (e.g., ARCADE_API_KEY)',
    }),
    description: Flags.string({
      char: 'd',
      description: 'Human-readable description',
    }),
    json: Flags.boolean({
      description: 'Output as JSON',
      default: false,
    }),
    machine: Flags.boolean({
      char: 'm',
      description: 'Output as JSON',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ToolsAddMcp);

    const hqPath = findHQRoot();
    if (!hqPath) {
      this.error('Not in a prlt workspace. Run `prlt new` or `prlt init` first.');
    }

    const jsonMode = shouldOutputJson(flags);

    let name = args.name;
    let url = flags.url;
    let command = flags.command;
    let auth = flags.auth;
    let description = flags.description;

    // Interactive prompts for missing values
    if (!name) {
      if (jsonMode) {
        this.error('Name argument is required in JSON mode');
      }
      const response = await inquirer.prompt([{
        type: 'input',
        name: 'name',
        message: 'MCP server name:',
        validate: (input: string) => input.trim() ? true : 'Name is required',
      }]);
      name = response.name;
    }

    if (!url && !command) {
      if (jsonMode) {
        this.error('Either --url or --command is required');
      }
      const { connectionType } = await inquirer.prompt([{
        type: 'list',
        name: 'connectionType',
        message: 'Connection type:',
        choices: [
          { name: 'Remote URL', value: 'url' },
          { name: 'Local command', value: 'command' },
        ],
      }]);

      if (connectionType === 'url') {
        const response = await inquirer.prompt([{
          type: 'input',
          name: 'url',
          message: 'Server URL:',
          validate: (input: string) => input.trim() ? true : 'URL is required',
        }]);
        url = response.url;
      } else {
        const response = await inquirer.prompt([{
          type: 'input',
          name: 'command',
          message: 'Command to start server:',
          validate: (input: string) => input.trim() ? true : 'Command is required',
        }]);
        command = response.command;
      }
    }

    if (!auth) {
      if (!jsonMode) {
        const response = await inquirer.prompt([{
          type: 'input',
          name: 'auth',
          message: 'Auth env variable (leave empty for none):',
        }]);
        if (response.auth.trim()) {
          auth = response.auth.trim();
        }
      }
    }

    if (!description && !jsonMode) {
      const response = await inquirer.prompt([{
        type: 'input',
        name: 'description',
        message: 'Description (optional):',
      }]);
      if (response.description.trim()) {
        description = response.description.trim();
      }
    }

    const entry: Record<string, unknown> = {};
    if (url) entry.url = url;
    if (command) entry.command = command;
    if (auth) entry.auth = `\${${auth}}`;
    if (description) entry.description = description;

    addMcpServer(hqPath, name!, entry as any);

    if (jsonMode) {
      this.log(JSON.stringify({ success: true, name, type: 'mcp', entry }, null, 2));
    } else {
      this.log(`\n${styles.success(`MCP server '${name}' registered successfully.`)}\n`);
    }
  }
}
