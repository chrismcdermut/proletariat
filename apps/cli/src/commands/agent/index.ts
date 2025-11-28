import { Command } from '@oclif/core';
import inquirer from 'inquirer';
import { colors } from '../../lib/colors.js';

export default class Agent extends Command {
  static description = 'Individual agent operations';

  static examples = [
    '<%= config.bin %> <%= command.id %> status camry',
    '<%= config.bin %> <%= command.id %> visit tacoma',
    '<%= config.bin %> <%= command.id %> add',
    '<%= config.bin %> <%= command.id %> remove camry',
  ];

  async run(): Promise<void> {
    this.log(colors.primary('🤖 Individual Agent Operations'));
    this.log('');

    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        { name: '📊 Show agent status', value: 'status' },
        { name: '📁 Visit agent directory', value: 'visit' },
        { name: '➕ Add new agent', value: 'add' },
        { name: '🗑️  Remove agent', value: 'remove' },
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
      this.log(colors.primary(`\nExecuting: agent ${action}`));
      
      switch (action) {
        case 'status': {
          const { default: StatusCommand } = await import('../agent/status.js');
          const cmd = new StatusCommand([], this.config);
          await cmd.run();
          break;
        }
        case 'visit': {
          const { default: VisitCommand } = await import('../agent/visit.js');
          const cmd = new VisitCommand([], this.config);
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
          const { default: RemoveCommand } = await import('../agent/remove.js');
          const cmd = new RemoveCommand([], this.config);
          await cmd.run();
          break;
        }
        default:
          this.error(`Unknown action: ${action}`);
      }
    } catch (error) {
      this.error(`Failed to execute agent ${action}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}