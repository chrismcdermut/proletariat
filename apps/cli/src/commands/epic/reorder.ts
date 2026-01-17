import { Args, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  outputErrorAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../lib/prompt-json.js';

export default class EpicReorder extends PMOCommand {
  static description = 'Reorder epic priority/rank';

  static examples = [
    '<%= config.bin %> <%= command.id %> EPIC-001 1',
    '<%= config.bin %> <%= command.id %> EPIC-003 --first',
    '<%= config.bin %> <%= command.id %> EPIC-002 --after EPIC-001',
  ];

  static args = {
    id: Args.string({
      description: 'Epic ID to reorder',
      required: false,
    }),
    position: Args.integer({
      description: 'New position (1-based rank)',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    first: Flags.boolean({
      description: 'Move to first position (highest priority)',
      exclusive: ['last', 'after', 'before'],
    }),
    last: Flags.boolean({
      description: 'Move to last position (lowest priority)',
      exclusive: ['first', 'after', 'before'],
    }),
    after: Flags.string({
      description: 'Move after this epic ID',
      exclusive: ['first', 'last', 'before'],
    }),
    before: Flags.string({
      description: 'Move before this epic ID',
      exclusive: ['first', 'last', 'after'],
    }),
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
    'no-interactive': Flags.boolean({
      description: 'Alias for --json flag',
      default: false,
    }),
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(EpicReorder);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('epic reorder', flags));
        this.exit(1);
      }
      this.error(message);
    };

    const projectId = await this.requireProject();

    // Get all epics for context
    const epics = await this.storage.listEpics(projectId, { status: 'active' });
    if (epics.length === 0) {
      if (jsonMode) {
        outputErrorAsJson('NO_ACTIVE_EPICS', 'No active epics to reorder.', createMetadata('epic reorder', flags));
        return;
      }
      this.log(styles.muted('\nNo active epics to reorder.'));
      return;
    }

    let epicId = args.id;

    // If no ID provided, prompt for selection
    if (!epicId) {
      const choices = epics.map((e, i) => ({
        name: `#${i + 1} ${e.id} - ${e.title}`,
        value: e.id,
      }));

      // In JSON mode, output epic selection prompt
      if (jsonMode) {
        outputPromptAsJson(
          buildPromptConfig('list', 'id', 'Select epic to reorder:', choices),
          createMetadata('epic reorder', flags)
        );
        return;
      }

      const { selected } = await inquirer.prompt([{
        type: 'list',
        name: 'selected',
        message: 'Select epic to reorder:',
        choices,
      }]);
      epicId = selected;
    }

    const epic = await this.storage.getEpic(epicId!);
    if (!epic) {
      return handleError('EPIC_NOT_FOUND', `Epic not found: ${epicId}`);
    }

    // Determine new position
    let newPosition: number;

    if (flags.first) {
      newPosition = 0;
    } else if (flags.last) {
      newPosition = epics.length - 1;
    } else if (flags.after) {
      const afterEpic = epics.find(e => e.id === flags.after);
      if (!afterEpic) {
        this.error(`Epic not found: ${flags.after}`);
      }
      newPosition = afterEpic.position + 1;
    } else if (flags.before) {
      const beforeEpic = epics.find(e => e.id === flags.before);
      if (!beforeEpic) {
        this.error(`Epic not found: ${flags.before}`);
      }
      newPosition = beforeEpic.position;
    } else if (args.position !== undefined) {
      // Convert 1-based rank to 0-based position
      newPosition = args.position - 1;
      if (newPosition < 0) newPosition = 0;
      if (newPosition >= epics.length) newPosition = epics.length - 1;
    } else {
      // In JSON mode, output rank input prompt
      if (jsonMode) {
        outputPromptAsJson(
          buildPromptConfig('input', 'rank', `New rank for ${epicId} (1-${epics.length}):`, undefined, String(epic.position + 1)),
          createMetadata('epic reorder', flags)
        );
        return;
      }

      // Interactive: show current order and ask for new position
      this.log(`\nCurrent order:`);
      epics.forEach((e, i) => {
        const marker = e.id === epicId ? ' ◀' : '';
        this.log(`  #${i + 1} ${e.id} - ${e.title}${marker}`);
      });

      const { rank } = await inquirer.prompt([{
        type: 'number',
        name: 'rank',
        message: `New rank for ${epicId} (1-${epics.length}):`,
        default: epic.position + 1,
        validate: (input: number) => {
          if (input < 1 || input > epics.length) {
            return `Please enter a number between 1 and ${epics.length}`;
          }
          return true;
        },
      }]);
      newPosition = rank - 1;
    }

    // Perform reorder
    await this.storage.reorderEpic(projectId, epicId!, newPosition);

    // Show new order
    const updatedEpics = await this.storage.listEpics(projectId, { status: 'active' });
    this.log(styles.success(`\n✅ Reordered ${epicId}`));
    this.log(`\nNew priority order:`);
    updatedEpics.forEach((e, i) => {
      const marker = e.id === epicId ? styles.emphasis(' ◀') : '';
      this.log(`  #${i + 1} ${e.id} - ${e.title}${marker}`);
    });
  }
}
