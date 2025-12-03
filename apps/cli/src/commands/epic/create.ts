import { Command, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { getPMOContext } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { EpicStatus } from '../../lib/pmo/types.js';
import { createEpicFile, getRelativeEpicPath } from '../../lib/pmo/epic-files.js';

export default class EpicCreate extends Command {
  static description = 'Create a new epic';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --title "User Authentication System"',
    '<%= config.bin %> <%= command.id %> -t "API Design" --status draft',
  ];

  static flags = {
    project: Flags.string({
      char: 'P',
      description: 'Project ID (default: "default")',
    }),
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
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(EpicCreate);

    // Get PMO context
    const { storage, projectName, pmoPath, projectId } = await getPMOContext(
      flags.project,
      (msg) => this.log(styles.muted(msg)),
      true
    );

    // Get epic data
    let epicData: {
      title: string;
      status: EpicStatus;
      description?: string;
    };

    if (!flags.title) {
      epicData = await this.promptEpicData(flags);
    } else {
      epicData = {
        title: flags.title,
        status: (flags.status || 'active') as EpicStatus,
        description: flags.description,
      };
    }

    try {
      const epic = await storage.createEpic({
        title: epicData.title,
        status: epicData.status,
        description: epicData.description,
      });

      // Create markdown file for the epic
      const filePath = createEpicFile(pmoPath, epic, projectId);
      const relativePath = getRelativeEpicPath(pmoPath, epic.id, epic.status, projectId);

      // Update epic with file path
      await storage.updateEpic(epic.id, { filePath });

      await storage.close();

      this.log(styles.success(`\n✅ Created epic ${styles.emphasis(epic.id)} "${epic.title}"`));
      this.log(styles.muted(`   Project: ${projectName}`));
      this.log(styles.muted(`   Status: ${epic.status}`));
      this.log(styles.muted(`   File: ${relativePath}`));
      this.log('');
      this.log(styles.muted('Next steps:'));
      this.log(styles.muted(`  1. Edit the epic file to add details:`));
      this.log(styles.muted(`     ${relativePath}`));
      this.log(styles.muted(`  2. Create tickets linked to this epic:`));
      this.log(styles.muted(`     prlt ticket create --epic ${epic.id} "Design auth flow"`));
      this.log(styles.muted(`  3. View progress: prlt epic progress ${epic.id}`));
    } catch (error) {
      await storage.close();
      throw error;
    }
  }

  private async promptEpicData(flags: {
    title?: string;
    status?: string;
    description?: string;
  }): Promise<{
    title: string;
    status: EpicStatus;
    description?: string;
  }> {
    const answers = await inquirer.prompt<{
      title: string;
      status: string;
      description?: string;
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
    ]);

    return {
      title: answers.title,
      status: answers.status as EpicStatus,
      description: answers.description || undefined,
    };
  }
}
