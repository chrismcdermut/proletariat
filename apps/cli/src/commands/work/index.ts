import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { isInteractive } from '../../lib/prompt.js';

export default class Work extends PMOCommand {
  static description = 'Interactive menu for work operations (ownership, assignment, execution)';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ];

  static flags = {
    ...pmoBaseFlags,
  };

  protected getPMOOptions() {
    // Prompt for project selection so we can pass it to subcommands
    return { promptIfMultiple: true };
  }

  async execute(): Promise<void> {
    // Check for non-interactive mode (Claude Code, pipes, etc.)
    if (!isInteractive()) {
      this.error(
        'Non-interactive mode detected. Use specific subcommands:\n' +
        '  prlt work start TKT-001 --agent <agent-name>\n' +
        '  prlt work ready TKT-001 --pr\n' +
        '  prlt work spawn --column "To Do" --project <project>\n' +
        '  prlt work claim TKT-001 --project <project>'
      );
    }

    // Show interactive menu
    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: '🔨 Work Operations - What would you like to do?',
      choices: [
        new inquirer.Separator('── Execution ──'),
        { name: 'Spawn work (batch by column)', value: 'spawn' },
        { name: 'Watch column (auto-spawn)', value: 'watch' },
        { name: 'Start work (launch single agent)', value: 'start' },
        new inquirer.Separator('── Ownership ──'),
        { name: 'Claim work (own + assign)', value: 'claim' },
        { name: 'Assign work to agent/person', value: 'assign' },
        { name: 'Take ownership (accountable)', value: 'own' },
        new inquirer.Separator('── Lifecycle ──'),
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
    // Pass --project to avoid re-prompting for project selection
    const projectArgs = ['--project', this.projectId];
    switch (action) {
      case 'claim':
        await this.config.runCommand('work:claim', projectArgs);
        break;
      case 'assign':
        await this.config.runCommand('work:assign', projectArgs);
        break;
      case 'own':
        await this.config.runCommand('work:own', projectArgs);
        break;
      case 'start':
        await this.config.runCommand('work:start', projectArgs);
        break;
      case 'spawn':
        await this.config.runCommand('work:spawn', projectArgs);
        break;
      case 'watch':
        await this.config.runCommand('work:watch', projectArgs);
        break;
      case 'ready':
        await this.config.runCommand('work:ready', projectArgs);
        break;
      case 'complete':
        await this.config.runCommand('work:complete', projectArgs);
        break;
    }
  }
}
