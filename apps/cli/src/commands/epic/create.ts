import { Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { EpicStatus } from '../../lib/pmo/types.js';
import { createEpicFile, getRelativeEpicPath } from '../../lib/pmo/epic-files.js';

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
  };

  async execute(): Promise<void> {
    const { flags } = await this.parse(EpicCreate);

    // Get epic data
    let epicData: {
      title: string;
      status: EpicStatus;
      description?: string;
      specId?: string;
    };

    if (!flags.title) {
      epicData = await this.promptEpicData(flags);
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

    const epic = await this.storage.createEpic({
      title: epicData.title,
      status: epicData.status,
      description: epicData.description,
      specId: epicData.specId,
    });

    // Create markdown file for the epic
    const filePath = createEpicFile(this.pmoPath, epic, this.projectId);
    const relativePath = getRelativeEpicPath(this.pmoPath, epic.id, epic.status, this.projectId);

    // Update epic with file path
    await this.storage.updateEpic(epic.id, { filePath });

    this.log(styles.success(`\n✅ Created epic ${styles.emphasis(epic.id)} "${epic.title}"`));
    this.log(styles.muted(`   Project: ${this.projectName}`));
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
    flags: {
      title?: string;
      status?: string;
      description?: string;
      spec?: string;
    }
  ): Promise<{
    title: string;
    status: EpicStatus;
    description?: string;
    specId?: string;
  }> {
    // Get available specs for linking
    const specs = await this.storage.listSpecs();
    const specChoices = [
      { name: 'None (no spec linked)', value: '' },
      ...specs.map(s => ({
        name: `${s.id} - ${s.title}`,
        value: s.id,
      })),
    ];

    const answers = await inquirer.prompt<{
      title: string;
      status: string;
      description?: string;
      specId?: string;
    }>([
      {
        type: 'input',
        name: 'title',
        message: 'Epic title:',
        default: flags.title,
        validate: (input: string) => input.length > 0 || 'Title is required',
      },
      {
        type: 'list',
        name: 'status',
        message: 'Initial status:',
        choices: [
          { name: 'Active (currently working on)', value: 'active' },
          { name: 'Draft (planning phase)', value: 'draft' },
        ],
        default: flags.status || 'active',
      },
      {
        type: 'input',
        name: 'description',
        message: 'Description (optional):',
        default: flags.description,
      },
      {
        type: 'list',
        name: 'specId',
        message: 'Link to spec (design document):',
        choices: specChoices,
        default: flags.spec || '',
        when: () => specs.length > 0,
      },
    ]);

    return {
      title: answers.title,
      status: answers.status as EpicStatus,
      description: answers.description || undefined,
      specId: answers.specId || flags.spec || undefined,
    };
  }
}
