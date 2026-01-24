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

export default class RoadmapDelete extends PMOCommand {
  static description = 'Delete a roadmap';

  static examples = [
    '<%= config.bin %> <%= command.id %> my-roadmap',
    '<%= config.bin %> <%= command.id %> my-roadmap --force',
    '<%= config.bin %> <%= command.id %>  # Interactive selection',
  ];

  static args = {
    id: Args.string({
      description: 'Roadmap ID to delete',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    force: Flags.boolean({
      char: 'f',
      description: 'Skip confirmation',
      default: false,
    }),
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(RoadmapDelete);
    const jsonMode = shouldOutputJson(flags);

    let roadmapId = args.id;

    if (!roadmapId) {
      const roadmaps = await this.storage.listRoadmaps();

      if (roadmaps.length === 0) {
        if (jsonMode) {
          outputErrorAsJson('NO_ROADMAPS', 'No roadmaps found', createMetadata('roadmap delete', flags));
          return;
        }
        this.error('No roadmaps found.');
      }

      if (jsonMode) {
        const choices = roadmaps.map(r => ({
          name: `${r.name}${r.isDefault ? ' (default)' : ''}`,
          value: r.id,
        }));
        outputPromptAsJson(
          buildPromptConfig('list', 'id', 'Select roadmap to delete:', choices),
          createMetadata('roadmap delete', flags)
        );
        return;
      }

      const { selected } = await inquirer.prompt<{ selected: string }>([{
        type: 'list',
        name: 'selected',
        message: 'Select roadmap to delete:',
        choices: roadmaps.map(r => ({
          name: `${r.name}${r.isDefault ? ' (default)' : ''}`,
          value: r.id,
        })),
      }]);
      roadmapId = selected;
    }

    const roadmap = await this.storage.getRoadmap(roadmapId);
    if (!roadmap) {
      if (jsonMode) {
        outputErrorAsJson('NOT_FOUND', `Roadmap not found: ${roadmapId}`, createMetadata('roadmap delete', flags));
        return;
      }
      this.error(`Roadmap not found: ${roadmapId}`);
    }

    // Get project count for context
    const projects = await this.storage.listRoadmapProjects(roadmapId);

    // Confirm deletion
    if (!flags.force) {
      const message = `Delete roadmap "${roadmap.name}"${projects.length > 0 ? ` (contains ${projects.length} project reference${projects.length > 1 ? 's' : ''})` : ''}?`;

      if (jsonMode) {
        const confirmChoices = [
          { name: 'No, cancel', value: 'false' },
          { name: 'Yes, delete', value: 'true' },
        ];
        outputPromptAsJson(
          buildPromptConfig('list', 'confirmed', message, confirmChoices),
          createMetadata('roadmap delete', flags)
        );
        return;
      }

      const { confirm } = await inquirer.prompt<{ confirm: boolean }>([{
        type: 'list',
        name: 'confirm',
        message,
        choices: [
          { name: 'No, cancel', value: false },
          { name: 'Yes, delete', value: true },
        ],
      }]);

      if (!confirm) {
        this.log(styles.muted('Cancelled.'));
        return;
      }
    }

    await this.storage.deleteRoadmap(roadmapId);
    this.log(styles.success(`Deleted roadmap "${roadmap.name}"`));
  }
}
