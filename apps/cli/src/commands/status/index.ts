import { Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { FlagResolver, shouldOutputJson } from '../../lib/flags/index.js';

interface MenuFlags {
  action?: string;
  project?: string;
  json?: boolean;
  machine?: boolean;
  [key: string]: unknown;
}

export default class Status extends PMOCommand {
  static description = 'Interactive menu for workflow status operations';

  static aliases = ['statuses'];

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ];

  static flags = {
    ...pmoBaseFlags,
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(Status);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Define choices once, use for both JSON and interactive modes
    // Each choice includes the full command for AI agents to execute
    const menuChoices = [
      { id: 'list', name: 'List all statuses', command: 'prlt status list --machine' },
      { id: 'create', name: 'Create new status', command: 'prlt status create --machine' },
      { id: 'update', name: 'Update status', command: 'prlt status update --machine' },
      { id: 'move', name: 'Move status (change order)', command: 'prlt status move --machine' },
      { id: 'delete', name: 'Delete status', command: 'prlt status delete --machine' },
      { id: 'cancel', name: 'Cancel', command: '' },
    ];

    // Create FlagResolver for menu selection
    const resolver = new FlagResolver<MenuFlags>({
      commandName: 'status',
      baseCommand: 'prlt status',
      jsonMode,
      flags,
    });

    // Add menu prompt
    resolver.addPrompt({
      flagName: 'action',
      type: 'list',
      message: '📊 Workflow Statuses - What would you like to do?',
      choices: () => menuChoices.map(c => ({
        name: c.name,
        value: c.id,
        command: c.command,
      })),
      when: (ctx) => !ctx.flags.action,
    });

    const resolved = await resolver.resolve();
    const action = resolved.action;

    if (action === 'cancel' || !action) {
      return;
    }

    // Run the selected subcommand
    switch (action) {
      case 'list':
        await this.config.runCommand('status:list', []);
        break;
      case 'create':
        await this.config.runCommand('status:create', ['--interactive']);
        break;
      case 'update': {
        // First list statuses, then prompt for selection
        await this.config.runCommand('status:list', []);
        const { statusId } = await inquirer.prompt([{
          type: 'input',
          name: 'statusId',
          message: 'Status ID to update:',
          validate: (input: string) => input.length > 0 || 'Status ID is required',
        }]);
        await this.config.runCommand('status:update', [statusId]);
        break;
      }
      case 'move': {
        await this.config.runCommand('status:list', []);
        const { statusId } = await inquirer.prompt([{
          type: 'input',
          name: 'statusId',
          message: 'Status ID to move:',
          validate: (input: string) => input.length > 0 || 'Status ID is required',
        }]);
        await this.config.runCommand('status:move', [statusId]);
        break;
      }
      case 'delete': {
        await this.config.runCommand('status:list', []);
        const { statusId } = await inquirer.prompt([{
          type: 'input',
          name: 'statusId',
          message: 'Status ID to delete:',
          validate: (input: string) => input.length > 0 || 'Status ID is required',
        }]);
        await this.config.runCommand('status:delete', [statusId]);
        break;
      }
    }
  }
}
