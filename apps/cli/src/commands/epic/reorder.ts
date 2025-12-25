import { Args, Command, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { getPMOContext } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { Epic } from '../../lib/pmo/types.js';

export default class EpicReorder extends Command {
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
    project: Flags.string({
      char: 'P',
      description: 'Project ID (default: "default")',
    }),
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
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(EpicReorder);

    const { storage, projectName } = await getPMOContext(
      flags.project,
      (msg) => this.log(styles.muted(msg)),
      true
    );

    try {
      // Get all epics for context
      const epics = await storage.listEpics({ status: 'active' });
      if (epics.length === 0) {
        this.log(styles.muted('\nNo active epics to reorder.'));
        await storage.close();
        return;
      }

      let epicId = args.id;

      // If no ID provided, prompt for selection
      if (!epicId) {
        const choices = epics.map((e, i) => ({
          name: `#${i + 1} ${e.id} - ${e.title}`,
          value: e.id,
        }));

        const { selected } = await inquirer.prompt([{
          type: 'list',
          name: 'selected',
          message: 'Select epic to reorder:',
          choices,
        }]);
        epicId = selected;
      }

      const epic = await storage.getEpic(epicId!);
      if (!epic) {
        this.error(`Epic not found: ${epicId}`);
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
      await storage.reorderEpic(epicId!, newPosition);

      // Show new order
      const updatedEpics = await storage.listEpics({ status: 'active' });
      this.log(styles.success(`\n✅ Reordered ${epicId}`));
      this.log(`\nNew priority order:`);
      updatedEpics.forEach((e, i) => {
        const marker = e.id === epicId ? styles.emphasis(' ◀') : '';
        this.log(`  #${i + 1} ${e.id} - ${e.title}${marker}`);
      });

      await storage.close();
    } catch (error) {
      await storage.close();
      throw error;
    }
  }
}
