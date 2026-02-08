import { Args, Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';

export default class RoadmapDelete extends PMOCommand {
  static description = 'Delete a roadmap';

  static examples = [
    '<%= config.bin %> <%= command.id %> my-roadmap',
    '<%= config.bin %> <%= command.id %> my-roadmap --force',
    '<%= config.bin %> <%= command.id %> default-roadmap --force  # Required for default',
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
      description: 'Skip confirmation (required for default roadmap)',
      default: false,
    }),
    json: Flags.boolean({
      char: 'm',
      aliases: ['machine'],
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

      const jsonModeConfig = jsonMode ? { flags, commandName: 'roadmap delete' } : null;
      const { selected } = await this.prompt<{ selected: string }>([{
        type: 'list',
        name: 'selected',
        message: 'Select roadmap to delete:',
        choices: roadmaps.map(r => ({
          name: `${r.name}${r.isDefault ? ' (default)' : ''}`,
          value: r.id,
          command: `prlt roadmap delete "${r.id}" --json`,
        })),
      }], jsonModeConfig);
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

    // Require --force to delete the default roadmap
    if (roadmap.isDefault && !flags.force) {
      if (jsonMode) {
        outputErrorAsJson(
          'DEFAULT_ROADMAP',
          `Cannot delete the default roadmap "${roadmap.name}" without --force. Use --force to confirm deletion.`,
          createMetadata('roadmap delete', flags)
        );
        return;
      }
      this.error(`Cannot delete the default roadmap "${roadmap.name}" without --force.\nUse: prlt roadmap delete ${roadmapId} --force`);
    }

    // Get project count for context
    const projects = await this.storage.listRoadmapProjects(roadmapId);

    // Confirm deletion
    if (!flags.force) {
      const message = `Delete roadmap "${roadmap.name}"${projects.length > 0 ? ` (contains ${projects.length} project reference${projects.length > 1 ? 's' : ''})` : ''}?`;

      const confirmJsonModeConfig = jsonMode ? { flags, commandName: 'roadmap delete' } : null;
      const { confirm } = await this.prompt<{ confirm: boolean }>([{
        type: 'list',
        name: 'confirm',
        message,
        choices: [
          { name: 'No, cancel', value: false, command: '' },
          { name: 'Yes, delete', value: true, command: `prlt roadmap delete "${roadmapId}" --force --json` },
        ],
      }], confirmJsonModeConfig);

      if (!confirm) {
        this.log(styles.muted('Cancelled.'));
        return;
      }
    }

    await this.storage.deleteRoadmap(roadmapId);
    this.log(styles.success(`Deleted roadmap "${roadmap.name}"`));
  }
}
