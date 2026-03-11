import { Command, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { findHQRoot } from '../../lib/workspace.js';
import { shouldOutputJson } from '../../lib/prompt-json.js';

export default class Tools extends Command {
  static description = 'Manage tool registry (MCP servers and CLI tools)';

  static aliases = ['tool'];

  static examples = [
    '<%= config.bin %> tools',
    '<%= config.bin %> tools list',
    '<%= config.bin %> tools add mcp arcade --url https://api.arcade.dev/mcp',
    '<%= config.bin %> tools add cli gh --command gh',
    '<%= config.bin %> tools remove arcade',
    '<%= config.bin %> tools check',
    '<%= config.bin %> tools detect',
  ];

  static flags = {
    json: Flags.boolean({
      description: 'Output as JSON',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Tools);

    const hqPath = findHQRoot();
    if (!hqPath) {
      this.error('Not in a prlt workspace. Run `prlt new` or `prlt init` first.');
    }

    if (shouldOutputJson(flags)) {
      this.log(JSON.stringify({
        commands: [
          { id: 'list', name: 'List all registered tools', command: 'prlt tools list --json' },
          { id: 'add-mcp', name: 'Register MCP server', command: 'prlt tools add mcp <name> --url <url> --json' },
          { id: 'add-cli', name: 'Register CLI tool', command: 'prlt tools add cli <name> --command <cmd> --json' },
          { id: 'remove', name: 'Remove a tool', command: 'prlt tools remove <name> --json' },
          { id: 'check', name: 'Verify all tools', command: 'prlt tools check --json' },
          { id: 'detect', name: 'Auto-detect CLI tools', command: 'prlt tools detect --json' },
        ],
      }, null, 2));
      return;
    }

    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: 'Tool Registry - What would you like to do?',
      choices: [
        { name: 'List all registered tools', value: 'list' },
        { name: 'Add MCP server', value: 'add-mcp' },
        { name: 'Add CLI tool', value: 'add-cli' },
        { name: 'Remove a tool', value: 'remove' },
        { name: 'Check tool availability', value: 'check' },
        { name: 'Auto-detect CLI tools', value: 'detect' },
        { name: 'Cancel', value: 'cancel' },
      ],
    }]);

    if (action === 'cancel') return;

    switch (action) {
      case 'list':
        await this.config.runCommand('tools:list', []);
        break;
      case 'add-mcp':
        await this.config.runCommand('tools:add:mcp', []);
        break;
      case 'add-cli':
        await this.config.runCommand('tools:add:cli', []);
        break;
      case 'remove':
        await this.config.runCommand('tools:remove', []);
        break;
      case 'check':
        await this.config.runCommand('tools:check', []);
        break;
      case 'detect':
        await this.config.runCommand('tools:detect', []);
        break;
    }
  }
}
