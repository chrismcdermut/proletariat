import { Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { EpicStatus } from '../../lib/pmo/types.js';
import { createEpicFile, getRelativeEpicPath } from '../../lib/pmo/epic-files.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  outputDryRunSuccessAsJson,
  outputDryRunErrorsAsJson,
  createMetadata,
  buildFormPromptConfig,
  FormField,
  type JsonFlags,
} from '../../lib/prompt-json.js';

export default class EpicCreate extends PMOCommand {
  static description = 'Create a new epic';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --title "User Authentication System"',
    '<%= config.bin %> <%= command.id %> -t "API Design" --status draft',
    '<%= config.bin %> <%= command.id %> -t "Implement Auth" --spec SPEC-001',
    '<%= config.bin %> <%= command.id %> --title "Test" -P PROJ-001 --dry-run --json  # Validate without creating',
  ];

  static flags = {
    ...pmoBaseFlags,
    title: Flags.string({
      char: 't',
      description: 'Epic title [required for non-interactive]',
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
    'dry-run': Flags.boolean({
      description: 'Validate inputs without creating epic (use with --json for structured output)',
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

      epicData = await this.promptEpicData(fields, specChoices.length > 1, jsonMode ? { flags, commandName: 'epic create' } : null);
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
        if (flags['dry-run']) {
          if (jsonMode) {
            outputDryRunErrorsAsJson(
              [{ field: 'spec', error: `Spec not found: ${epicData.specId}` }],
              createMetadata('epic create', flags)
            );
          }
        }
        this.error(`Spec not found: ${epicData.specId}`);
      }
    }

    // Handle dry-run: show what would be created without actually creating
    if (flags['dry-run']) {
      const projectName = await this.getProjectName(projectId);
      const wouldCreate = {
        title: epicData.title,
        project: projectId,
        status: epicData.status,
        ...(epicData.description && { description: epicData.description }),
        ...(epicData.specId && { spec: epicData.specId }),
      };

      if (jsonMode) {
        outputDryRunSuccessAsJson('epic', wouldCreate, createMetadata('epic create', flags));
      }

      // Human-readable dry-run output
      this.log(styles.warning('\n[DRY RUN] Would create epic:'));
      this.log(styles.muted(`   Title: ${epicData.title}`));
      this.log(styles.muted(`   Project: ${projectName}`));
      this.log(styles.muted(`   Status: ${epicData.status}`));
      if (epicData.description) {
        this.log(styles.muted(`   Description: ${epicData.description}`));
      }
      if (epicData.specId) {
        this.log(styles.muted(`   Spec: ${epicData.specId}`));
      }
      this.log(styles.muted('\n(No epic was created)'));
      return;
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
    hasSpecs: boolean,
    jsonModeConfig: { flags: JsonFlags & Record<string, unknown>; commandName: string } | null
  ): Promise<{
    title: string;
    status: EpicStatus;
    description?: string;
    specId?: string;
  }> {
    // Build inquirer prompts from fields, adding validators and conditionals
    const promptFields = fields
      .filter(field => field.name !== 'specId' || hasSpecs)
      .map(field => ({
        ...field,
        validate: field.name === 'title'
          ? ((input: unknown) => (input as string).trim() ? true : 'Title cannot be empty')
          : undefined,
      }));

    const answers = await this.prompt<{
      title: string;
      status: string;
      description?: string;
      specId?: string;
    }>(promptFields, jsonModeConfig);

    return {
      title: answers.title,
      status: answers.status as EpicStatus,
      description: answers.description || undefined,
      specId: answers.specId || undefined,
    };
  }
}
