
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { shouldOutputJson } from '../../lib/prompt-json.js';

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
    const { flags } = await this.parse(Work);
    // This command requires project context - get it once and reuse
    const projectId = await this.requireProject();

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Define choices: 7 work primitives first, then utilities
    const menuChoices = [
      // --- Actions (4 primitives) ---
      { id: 'groom', name: 'Groom — enrich ticket with requirements/AC', command: `prlt work groom -P ${projectId} --json` },
      { id: 'resolve', name: 'Resolve — answer ambiguity questions from groom', command: `prlt work resolve -P ${projectId} --json` },
      { id: 'implement', name: 'Implement — spawn agent to do the work', command: `prlt work implement -P ${projectId} --json` },
      { id: 'review', name: 'Review — evaluate the output/PR', command: `prlt work review -P ${projectId} --json` },
      // --- Controls (3 primitives) ---
      { id: 'peek', name: 'Peek — view what agent is doing', command: `prlt work peek -P ${projectId} --json` },
      { id: 'poke', name: 'Poke — send message to steer agent', command: `prlt work poke -P ${projectId} --json` },
      { id: 'stop', name: 'Stop — kill running agent', command: `prlt work stop -P ${projectId} --json` },
      // --- Utilities ---
      { id: 'status', name: 'Status — view in-progress tickets', command: `prlt work status -P ${projectId} --json` },
      { id: 'spawn', name: 'Spawn — batch by column', command: `prlt work spawn -P ${projectId} --json` },
      { id: 'ready', name: 'Ready — mark work ready for review', command: `prlt work ready -P ${projectId} --json` },
      { id: 'ship', name: 'Ship — rebase, merge PR, move to Done', command: `prlt work ship -P ${projectId} --json` },
      { id: 'complete', name: 'Complete — mark work done', command: `prlt work complete -P ${projectId} --json` },
      { id: 'hooks', name: 'Hooks — manage lifecycle hooks', command: 'prlt work hooks --json' },
      { id: 'cancel', name: 'Cancel', command: '' },
    ];
    const message = 'Work Primitives - What would you like to do?';

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
      // 7 work primitives
      case 'groom':
        await this.config.runCommand('work:groom', projectArgs);
        break;
      case 'resolve':
        await this.config.runCommand('work:resolve', projectArgs);
        break;
      case 'implement':
        await this.config.runCommand('work:implement', projectArgs);
        break;
      case 'review':
        await this.config.runCommand('work:review', projectArgs);
        break;
      case 'peek':
        await this.config.runCommand('work:peek', projectArgs);
        break;
      case 'poke':
        await this.config.runCommand('work:poke', projectArgs);
        break;
      case 'stop':
        await this.config.runCommand('work:stop', projectArgs);
        break;
      // Utilities
      case 'status':
        await this.config.runCommand('work:status', projectArgs);
        break;
      case 'spawn':
        await this.config.runCommand('work:spawn', projectArgs);
        break;
      case 'ready':
        await this.config.runCommand('work:ready', projectArgs);
        break;
      case 'ship':
        await this.config.runCommand('work:ship', projectArgs);
        break;
      case 'complete':
        await this.config.runCommand('work:complete', projectArgs);
        break;
      case 'hooks':
        await this.config.runCommand('work:hooks');
        break;
    }
  }
}
