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
  buildFormPromptConfig,
  FormField,
} from '../../lib/prompt-json.js';

export default class RoadmapUpdate extends PMOCommand {
  static description = 'Update a roadmap';

  static examples = [
    '<%= config.bin %> <%= command.id %> my-roadmap --name "New Name"',
    '<%= config.bin %> <%= command.id %> my-roadmap --default',
    '<%= config.bin %> <%= command.id %>  # Interactive selection',
  ];

  static args = {
    id: Args.string({
      description: 'Roadmap ID to update',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    name: Flags.string({
      char: 'n',
      description: 'New roadmap name',
    }),
    description: Flags.string({
      char: 'd',
      description: 'New roadmap description',
    }),
    default: Flags.boolean({
      description: 'Set as the default roadmap',
      allowNo: true,
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
    const { args, flags } = await this.parse(RoadmapUpdate);
    const jsonMode = shouldOutputJson(flags);

    let roadmapId = args.id;

    if (!roadmapId) {
      const roadmaps = await this.storage.listRoadmaps();

      if (roadmaps.length === 0) {
        if (jsonMode) {
          outputErrorAsJson('NO_ROADMAPS', 'No roadmaps found', createMetadata('roadmap update', flags));
          return;
        }
        this.error('No roadmaps found. Create one with: prlt roadmap create');
      }

      if (jsonMode) {
        const choices = roadmaps.map(r => ({
          name: `${r.name}${r.isDefault ? ' (default)' : ''}`,
          value: r.id,
        }));
        outputPromptAsJson(
          buildPromptConfig('list', 'id', 'Select roadmap to update:', choices),
          createMetadata('roadmap update', flags)
        );
        return;
      }

      const { selected } = await inquirer.prompt<{ selected: string }>([{
        type: 'list',
        name: 'selected',
        message: 'Select roadmap to update:',
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
        outputErrorAsJson('NOT_FOUND', `Roadmap not found: ${roadmapId}`, createMetadata('roadmap update', flags));
        return;
      }
      this.error(`Roadmap not found: ${roadmapId}`);
    }

    // If no flags provided, prompt for updates
    const hasUpdateFlags = flags.name !== undefined || flags.description !== undefined || flags.default !== undefined;

    if (!hasUpdateFlags) {
      const fields: FormField[] = [
        { type: 'input', name: 'name', message: 'New name (leave blank to keep current):', default: roadmap.name },
        { type: 'input', name: 'description', message: 'New description (leave blank to keep current):', default: roadmap.description || '' },
        {
          type: 'list',
          name: 'isDefault',
          message: 'Set as default roadmap?',
          choices: [
            { name: 'No change', value: 'no-change' },
            { name: 'Yes', value: 'yes' },
            { name: 'No', value: 'no' },
          ],
        },
      ];

      if (jsonMode) {
        outputPromptAsJson(
          buildFormPromptConfig(fields),
          createMetadata('roadmap update', flags)
        );
        return;
      }

      const answers = await inquirer.prompt<{
        name: string;
        description: string;
        isDefault: string;
      }>(fields);

      const changes: { name?: string; description?: string; isDefault?: boolean } = {};
      if (answers.name && answers.name !== roadmap.name) {
        changes.name = answers.name;
      }
      if (answers.description !== (roadmap.description || '')) {
        changes.description = answers.description || undefined;
      }
      if (answers.isDefault === 'yes') {
        changes.isDefault = true;
      } else if (answers.isDefault === 'no') {
        changes.isDefault = false;
      }

      if (Object.keys(changes).length === 0) {
        this.log(styles.muted('No changes made.'));
        return;
      }

      const updated = await this.storage.updateRoadmap(roadmapId, changes);
      this.log(styles.success(`Updated roadmap "${updated.name}"`));
    } else {
      // Use flags
      const changes: { name?: string; description?: string; isDefault?: boolean } = {};
      if (flags.name !== undefined) changes.name = flags.name;
      if (flags.description !== undefined) changes.description = flags.description;
      if (flags.default !== undefined) changes.isDefault = flags.default;

      const updated = await this.storage.updateRoadmap(roadmapId, changes);
      this.log(styles.success(`Updated roadmap "${updated.name}"`));
    }
  }
}
