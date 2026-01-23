import { Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../lib/prompt-json.js';

export default class Status extends PMOCommand {
  static description = 'Interactive menu for workflow status operations';

  static aliases = ['statuses'];

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ];

  static flags = {
    ...pmoBaseFlags,
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
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
      { id: 'list', name: 'List all statuses', command: 'prlt status list --format json' },
      { id: 'create', name: 'Create new status', command: 'prlt status create --json' },
      { id: 'update', name: 'Update status', command: 'prlt status update --json' },
      { id: 'move', name: 'Move status (change order)', command: 'prlt status move --json' },
      { id: 'delete', name: 'Delete status', command: 'prlt status delete --json' },
      { id: 'cancel', name: 'Cancel', command: '' },
    ];
    const message = 'Workflow Statuses - What would you like to do?';

    const action = await this.selectFromList({
      message: '📊 ' + message,
      items: menuChoices,
      getName: (c) => c.name,
      getValue: (c) => c.id,
      getCommand: (c) => c.command,
      jsonMode: jsonMode ? { flags, commandName: 'status' } : null,
    });

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
