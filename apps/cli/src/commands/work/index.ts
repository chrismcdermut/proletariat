import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';

export default class Work extends PMOCommand {
  static description = 'Interactive menu for work operations (ownership, assignment, execution)';

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
    // Show interactive menu
    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: '🔨 Work Operations - What would you like to do?',
      choices: [
        new inquirer.Separator('── Ownership ──'),
        { name: 'Claim work (own + assign)', value: 'claim' },
        { name: 'Assign work to agent/person', value: 'assign' },
        { name: 'Take ownership (accountable)', value: 'own' },
        new inquirer.Separator('── Execution ──'),
        { name: 'Start work (launch single agent)', value: 'start' },
        { name: 'Spawn work (batch by column)', value: 'spawn' },
        { name: 'Watch column (auto-spawn)', value: 'watch' },
        { name: 'Mark work ready for review', value: 'ready' },
        { name: 'Mark work complete', value: 'complete' },
        new inquirer.Separator('──────────────'),
        { name: 'Cancel', value: 'cancel' },
      ],
    }]);

    if (action === 'cancel') {
      return;
    }

    // Run the selected subcommand
    switch (action) {
      case 'claim':
        await this.config.runCommand('work:claim', []);
        break;
      case 'assign':
        await this.config.runCommand('work:assign', []);
        break;
      case 'own':
        await this.config.runCommand('work:own', []);
        break;
      case 'start':
        await this.config.runCommand('work:start', []);
        break;
      case 'spawn':
        await this.config.runCommand('work:spawn', []);
        break;
      case 'watch':
        await this.config.runCommand('work:watch', []);
        break;
      case 'ready':
        await this.config.runCommand('work:ready', []);
        break;
      case 'complete':
        await this.config.runCommand('work:complete', []);
        break;
    }
  }
}
