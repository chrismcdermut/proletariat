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
  };

  protected getPMOOptions() {
    // Prompt for project selection so we can pass it to subcommands
    return { promptIfMultiple: true };
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(Work);
    // This command requires project context - get it once and reuse
    const projectId = await this.requireProject();

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Define choices once, use for both JSON and interactive modes
    // Execution actions first (most common), then ownership
    // Each choice includes the full command for AI agents to execute
    const menuChoices = [
      { id: 'start', name: 'Start work (launch single agent)', command: `prlt work start -P ${projectId} --json` },
      { id: 'spawn', name: 'Spawn work (batch by column)', command: `prlt work spawn -P ${projectId} --json` },
      { id: 'watch', name: 'Watch column (auto-spawn)', command: `prlt work watch -P ${projectId} --json` },
      { id: 'ready', name: 'Mark work ready for review', command: `prlt work ready -P ${projectId} --json` },
      { id: 'complete', name: 'Mark work complete', command: `prlt work complete -P ${projectId} --json` },
      { id: 'cancel', name: 'Cancel', command: '' },
    ];
    const message = 'Work Operations - What would you like to do?';

    const action = await this.selectFromList({
      message: '🔨 ' + message,
      items: menuChoices,
      getName: (c) => c.name,
      getValue: (c) => c.id,
      getCommand: (c) => c.command,
      jsonMode: jsonMode ? { flags, commandName: 'work' } : null,
    });

    if (action === 'cancel' || !action) {
      return;
    }

    // Run the selected subcommand
    // Pass --project to avoid re-prompting for project selection
    const projectArgs = ['--project', projectId];
    switch (action) {
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
