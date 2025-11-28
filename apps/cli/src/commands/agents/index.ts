import { Command } from '@oclif/core';
import inquirer from 'inquirer';
import { colors } from '../../lib/colors.js';

export default class Agents extends Command {
  static description = 'Manage agents in bulk (overview and batch operations)';

  static examples = [
    '<%= config.bin %> <%= command.id %> list',
    '<%= config.bin %> <%= command.id %> status',
    '<%= config.bin %> <%= command.id %> add',
    '<%= config.bin %> <%= command.id %> remove',
  ];

  async run(): Promise<void> {
    this.log(colors.primary('👥 Agents Management (Bulk Operations)'));
    this.log('');

    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        { name: '📋 List all agents', value: 'list' },
        { name: '📊 Show status overview', value: 'status' },
        { name: '➕ Add agents (bulk)', value: 'add' },
        { name: '➖ Remove agents (bulk)', value: 'remove' },
        new inquirer.Separator(),
        { name: '❌ Cancel', value: 'cancel' }
      ]
    }]);

    if (action === 'cancel') {
      this.log(colors.textMuted('Operation cancelled.'));
      return;
    }

    // Execute the selected command directly (no subprocess)
    try {
      this.log(colors.primary(`\nExecuting: agents ${action}`));
      
      switch (action) {
        case 'list': {
          const { default: ListCommand } = await import('../agents/list.js');
          const cmd = new ListCommand([], this.config);
          await cmd.run();
          break;
        }
        case 'status': {
          const { default: StatusCommand } = await import('../agents/status.js');
          const cmd = new StatusCommand([], this.config);
          await cmd.run();
          break;
        }
        case 'add': {
          const { default: AddCommand } = await import('../agents/add.js');
          const cmd = new AddCommand([], this.config);
          await cmd.run();
          break;
        }
        case 'remove': {
          const { default: RemoveCommand } = await import('../agents/remove.js');
          const cmd = new RemoveCommand([], this.config);
          await cmd.run();
          break;
        }
        default:
          this.error(`Unknown action: ${action}`);
      }
    } catch (error) {
      this.error(`Failed to execute agents ${action}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}