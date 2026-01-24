import { Flags, Args } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { slugify } from '../../lib/pmo/utils.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  createMetadata,
  buildFormPromptConfig,
  FormField,
} from '../../lib/prompt-json.js';

export default class RoadmapCreate extends PMOCommand {
  static description = 'Create a new roadmap';

  static examples = [
    '<%= config.bin %> <%= command.id %> "Public Roadmap"',
    '<%= config.bin %> <%= command.id %> --name "Internal Roadmap" --description "Full project list"',
    '<%= config.bin %> <%= command.id %> -i  # Interactive mode',
  ];

  static args = {
    name: Args.string({
      description: 'Roadmap name',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    name: Flags.string({
      char: 'n',
      description: 'Roadmap name',
    }),
    id: Flags.string({
      description: 'Custom roadmap ID (auto-generated from name if not provided)',
    }),
    description: Flags.string({
      char: 'd',
      description: 'Roadmap description',
    }),
    default: Flags.boolean({
      description: 'Set as the default roadmap',
      default: false,
    }),
    interactive: Flags.boolean({
      char: 'i',
      description: 'Interactive mode',
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
    const { args, flags } = await this.parse(RoadmapCreate);
    const jsonMode = shouldOutputJson(flags);

    let roadmapData: {
      name: string;
      id?: string;
      description?: string;
      isDefault: boolean;
    };

    if (flags.interactive || (!args.name && !flags.name)) {
      const fields: FormField[] = [
        { type: 'input', name: 'name', message: 'Roadmap name:', default: flags.name },
        { type: 'input', name: 'id', message: 'Roadmap ID (leave blank to auto-generate):' },
        { type: 'input', name: 'description', message: 'Description (optional):', default: flags.description },
        {
          type: 'list',
          name: 'isDefault',
          message: 'Set as default roadmap?',
          choices: [
            { name: 'No', value: 'false' },
            { name: 'Yes', value: 'true' },
          ],
          default: flags.default ? 'true' : 'false',
        },
      ];

      if (jsonMode) {
        outputPromptAsJson(
          buildFormPromptConfig(fields),
          createMetadata('roadmap create', flags)
        );
        return;
      }

      roadmapData = await this.promptRoadmapData(fields);
    } else {
      roadmapData = {
        name: args.name || flags.name!,
        id: flags.id,
        description: flags.description,
        isDefault: flags.default,
      };
    }

    const roadmapId = roadmapData.id || `roadmap-${slugify(roadmapData.name)}`;

    // Check if roadmap already exists
    const existing = await this.storage.getRoadmap(roadmapId);
    if (existing) {
      this.error(`Roadmap "${roadmapId}" already exists.`);
    }

    // Create roadmap in database
    const roadmap = await this.storage.createRoadmap({
      id: roadmapId,
      name: roadmapData.name,
      description: roadmapData.description,
      isDefault: roadmapData.isDefault,
    });

    this.log(styles.success(`\nCreated roadmap "${styles.emphasis(roadmap.name)}"`));
    this.log(styles.muted(`  ID: ${roadmap.id}`));
    if (roadmap.description) {
      this.log(styles.muted(`  Description: ${roadmap.description}`));
    }
    if (roadmap.isDefault) {
      this.log(styles.muted(`  Default: Yes`));
    }

    // Prompt to add projects
    const projects = await this.storage.listProjects({ isArchived: false });
    if (projects.length > 0) {
      this.log('');
      const { addProjects } = await inquirer.prompt<{ addProjects: boolean }>([{
        type: 'list',
        name: 'addProjects',
        message: 'Add projects to this roadmap now?',
        choices: [
          { name: 'Yes', value: true },
          { name: 'No, I\'ll add them later', value: false },
        ],
      }]);

      if (addProjects) {
        const { selectedProjects } = await inquirer.prompt<{ selectedProjects: string[] }>([{
          type: 'checkbox',
          name: 'selectedProjects',
          message: 'Select projects to include:',
          choices: projects.map(p => ({ name: p.name, value: p.id })),
        }]);

        for (const projectId of selectedProjects) {
          // eslint-disable-next-line no-await-in-loop -- Sequential updates
          await this.storage.addProjectToRoadmap(roadmap.id, projectId);
        }

        if (selectedProjects.length > 0) {
          this.log(styles.success(`Added ${selectedProjects.length} project(s) to roadmap`));
        }
      }
    }

    this.log(styles.muted(`\nNext steps:`));
    this.log(styles.muted(`  prlt roadmap view ${roadmap.id}`));
    this.log(styles.muted(`  prlt roadmap add-project ${roadmap.id}`));
    this.log(styles.muted(`  prlt roadmap generate ${roadmap.id}`));
  }

  private async promptRoadmapData(
    fields: FormField[]
  ): Promise<{
    name: string;
    id?: string;
    description?: string;
    isDefault: boolean;
  }> {
    const answers = await inquirer.prompt<{
      name: string;
      id: string;
      description: string;
      isDefault: string | boolean;
    }>(fields.map(field => ({
      ...field,
      validate: field.name === 'name'
        ? ((input: string) => input.length > 0 || 'Name is required')
        : undefined,
      default: field.name === 'id'
        ? ((answers: { name: string }) => `roadmap-${slugify(answers.name)}`)
        : field.default,
    })));

    return {
      name: answers.name,
      id: answers.id || undefined,
      description: answers.description || undefined,
      isDefault: answers.isDefault === true || answers.isDefault === 'true',
    };
  }
}
