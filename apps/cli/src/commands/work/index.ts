import { Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../lib/prompt-json.js';

export default class Work extends PMOCommand {
  static description = 'Interactive menu for work operations (ownership, assignment, execution)';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ];

  static flags = {
    ...pmoBaseFlags,
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
    'no-interactive': Flags.boolean({
      description: 'Alias for --json flag',
      default: false,
    }),
  };

  protected getPMOOptions() {
    // Prompt for project selection so we can pass it to subcommands
    return { promptIfMultiple: true };
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(Work);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Define choices once, use for both JSON and interactive modes
    const menuChoices = [
      { name: 'Claim work (own + assign)', value: 'claim' },
      { name: 'Assign work to agent/person', value: 'assign' },
      { name: 'Take ownership (accountable)', value: 'own' },
      { name: 'Start work (launch single agent)', value: 'start' },
      { name: 'Spawn work (batch by column)', value: 'spawn' },
      { name: 'Watch column (auto-spawn)', value: 'watch' },
      { name: 'Mark work ready for review', value: 'ready' },
      { name: 'Mark work complete', value: 'complete' },
      { name: 'Cancel', value: 'cancel' },
    ];
    const message = 'Work Operations - What would you like to do?';

    // In JSON mode, output action selection prompt
    if (jsonMode) {
      outputPromptAsJson(
        buildPromptConfig('list', 'action', message, menuChoices),
        createMetadata('work', flags)
      );
      return;
    }

    // Show interactive menu
    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: '🔨 ' + message,
      choices: [
        new inquirer.Separator('── Ownership ──'),
        menuChoices[0],
        menuChoices[1],
        menuChoices[2],
        new inquirer.Separator('── Execution ──'),
        menuChoices[3],
        menuChoices[4],
        menuChoices[5],
        menuChoices[6],
        menuChoices[7],
        new inquirer.Separator('──────────────'),
        menuChoices[8],
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
