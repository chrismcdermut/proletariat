import { Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { EpicStatus } from '../../lib/pmo/types.js';
import { createEpicFile, getRelativeEpicPath } from '../../lib/pmo/epic-files.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  createMetadata,
  buildFormPromptConfig,
  FormField,
} from '../../lib/prompt-json.js';

export default class EpicCreate extends PMOCommand {
  static description = 'Create a new epic';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --title "User Authentication System"',
    '<%= config.bin %> <%= command.id %> -t "API Design" --status draft',
    '<%= config.bin %> <%= command.id %> -t "Implement Auth" --spec SPEC-001',
  ];

  static flags = {
    ...pmoBaseFlags,
    title: Flags.string({
      char: 't',
      description: 'Epic title',
    }),
    status: Flags.string({
      char: 's',
      description: 'Initial status',
      options: ['active', 'draft'],
      default: 'active',
    }),
    description: Flags.string({
      char: 'd',
      description: 'Epic description',
    }),
    spec: Flags.string({
      description: 'Link to spec ID (the design spec that describes this epic)',
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
    const { flags } = await this.parse(EpicCreate);
    const projectId = await this.requireProject();

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Build choices once, use for both JSON and interactive modes
    const statusChoices = [
      { name: 'Active (currently working on)', value: 'active' },
      { name: 'Draft (planning phase)', value: 'draft' },
    ];

    // Get epic data
    let epicData: {
      title: string;
      status: EpicStatus;
      description?: string;
      specId?: string;
    };

    if (!flags.title) {
      // Get specs once, use for both modes
      const specs = await this.storage.listSpecs();
      const specChoices = [
        { name: 'None (no spec linked)', value: '' },
        ...specs.map(s => ({
          name: `${s.id} - ${s.title}`,
          value: s.id,
        })),
      ];

      // Define fields once - single source of truth for both JSON and interactive modes
      const fields: FormField[] = [
        { type: 'input', name: 'title', message: 'Epic title:', default: flags.title },
        { type: 'list', name: 'status', message: 'Initial status:', choices: statusChoices, default: flags.status || 'active' },
        { type: 'input', name: 'description', message: 'Description (optional):', default: flags.description },
      ];

      if (specs.length > 0) {
        fields.push({
          type: 'list', name: 'specId', message: 'Link to spec (design document):',
          choices: specChoices, default: flags.spec || ''
        });
      }

      // In JSON mode, output form prompt for epic creation
      if (jsonMode) {
        outputPromptAsJson(
          buildFormPromptConfig(fields),
          createMetadata('epic create', flags)
        );
      }

      epicData = await this.promptEpicData(fields, specChoices.length > 1);
    } else {
      epicData = {
        title: flags.title,
        status: (flags.status || 'active') as EpicStatus,
        description: flags.description,
        specId: flags.spec,
      };
    }

    // Validate spec exists if provided
    if (epicData.specId) {
      const spec = await this.storage.getSpec(epicData.specId);
      if (!spec) {
        this.error(`Spec not found: ${epicData.specId}`);
      }
    }

    const epic = await this.storage.createEpic(projectId, {
      title: epicData.title,
      status: epicData.status,
      description: epicData.description,
      specId: epicData.specId,
    });

    // Create markdown file for the epic
    const filePath = createEpicFile(this.pmoPath, epic, projectId);
    const relativePath = getRelativeEpicPath(this.pmoPath, epic.id, epic.status, projectId);

    // Update epic with file path
    await this.storage.updateEpic(epic.id, { filePath });

    const projectName = await this.getProjectName(projectId);
    this.log(styles.success(`\n✅ Created epic ${styles.emphasis(epic.id)} "${epic.title}"`));
    this.log(styles.muted(`   Project: ${projectName}`));
    this.log(styles.muted(`   Status: ${epic.status}`));
    if (epic.specId) {
      this.log(styles.muted(`   Spec: ${epic.specId}`));
    }
    this.log(styles.muted(`   File: ${relativePath}`));
    this.log('');
    this.log(styles.muted('Next steps:'));
    this.log(styles.muted(`  1. Edit the epic file to add details:`));
    this.log(styles.muted(`     ${relativePath}`));
    this.log(styles.muted(`  2. Create tickets linked to this epic:`));
    this.log(styles.muted(`     prlt ticket create --epic ${epic.id} "Design auth flow"`));
    this.log(styles.muted(`  3. View progress: prlt epic progress ${epic.id}`));
  }

  private async promptEpicData(
    fields: FormField[],
    hasSpecs: boolean
  ): Promise<{
    title: string;
    status: EpicStatus;
    description?: string;
    specId?: string;
  }> {
    // Build inquirer prompts from fields, adding validators and conditionals
    const answers = await inquirer.prompt<{
      title: string;
      status: string;
      description?: string;
      specId?: string;
    }>(fields.map(field => ({
      ...field,
      validate: field.name === 'title'
        ? ((input: string) => input.length > 0 || 'Title is required')
        : undefined,
      when: field.name === 'specId' ? () => hasSpecs : undefined,
    })));

    return {
      title: answers.title,
      status: answers.status as EpicStatus,
      description: answers.description || undefined,
      specId: answers.specId || undefined,
    };
  }
}
