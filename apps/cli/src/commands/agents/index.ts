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
    '<%= config.bin %> <%= command.id %> restart',
    '<%= config.bin %> <%= command.id %> rebuild',
    '<%= config.bin %> <%= command.id %> shell',
  ];

  async run(): Promise<void> {
    this.log(colors.primary('👥 Agents Management (Bulk Operations)'));
    this.log('');

    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        new inquirer.Separator('── View ──'),
        { name: '📋 List all agents', value: 'list' },
        { name: '📊 Show status overview', value: 'status' },
        new inquirer.Separator('── Manage ──'),
        { name: '➕ Add agents', value: 'add' },
        { name: '➖ Remove agents', value: 'remove' },
        new inquirer.Separator('── Containers ──'),
        { name: '🐚 Open shell', value: 'shell' },
        { name: '🔄 Restart', value: 'restart' },
        { name: '🔨 Rebuild', value: 'rebuild' },
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
          const { default: ListCommand } = await import('./list.js');
          const cmd = new ListCommand([], this.config);
          await cmd.run();
          break;
        }
        case 'status': {
          const { default: StatusCommand } = await import('./status.js');
          const cmd = new StatusCommand([], this.config);
          await cmd.run();
          break;
        }
        case 'add': {
          const { default: AddCommand } = await import('./add.js');
          const cmd = new AddCommand([], this.config);
          await cmd.run();
          break;
        }
        case 'remove': {
          const { default: RemoveCommand } = await import('./remove.js');
          const cmd = new RemoveCommand([], this.config);
          await cmd.run();
          break;
        }
        case 'restart': {
          const { default: RestartCommand } = await import('./restart.js');
          const cmd = new RestartCommand([], this.config);
          await cmd.run();
          break;
        }
        case 'rebuild': {
          const { default: RebuildCommand } = await import('./rebuild.js');
          const cmd = new RebuildCommand([], this.config);
          await cmd.run();
          break;
        }
        case 'shell': {
          const { default: ShellCommand } = await import('./shell.js');
          const cmd = new ShellCommand([], this.config);
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