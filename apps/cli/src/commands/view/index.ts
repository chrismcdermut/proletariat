import { Command, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { getPMOContext } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';

export default class View extends Command {
  static description = 'Interactive menu for board views';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ];

  static flags = {
    project: Flags.string({
      char: 'P',
      description: 'Project ID',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(View);

    const { storage, projectName, projectId } = await getPMOContext(
      flags.project,
      (msg) => this.log(styles.muted(msg)),
      true
    );

    try {
      const views = await storage.listViews(projectId);

      // Build choices
      const choices: Array<{ name: string; value: string }> = [
        { name: 'Create new view', value: 'create' },
        { name: 'List all views', value: 'list' },
      ];

      if (views.length > 0) {
        choices.push(new inquirer.Separator() as any);
        for (const view of views) {
          const defaultBadge = view.isDefault ? ' (default)' : '';
          choices.push({
            name: `${view.name}${defaultBadge}`,
            value: `view:${view.id}`,
          });
        }
      }

      choices.push(new inquirer.Separator() as any);
      choices.push({ name: 'Cancel', value: 'cancel' });

      const { action } = await inquirer.prompt([
        {
          type: 'list',
          name: 'action',
          message: `👁️ Board Views - ${projectName}`,
          choices,
        },
      ]);

      await storage.close();

      if (action === 'cancel') {
        return;
      }

      if (action === 'create') {
        this.log(styles.muted('\nRun: prlt view create "View Name" --filter-assignee alice\n'));
        return;
      }

      if (action === 'list') {
        // Re-run list command
        await this.config.runCommand('view:list', ['--project', projectId]);
        return;
      }

      if (action.startsWith('view:')) {
        const viewId = action.replace('view:', '');

        // Show view actions
        const { viewAction } = await inquirer.prompt([
          {
            type: 'list',
            name: 'viewAction',
            message: 'What would you like to do?',
            choices: [
              { name: 'View board with this view', value: 'use' },
              { name: 'Update view', value: 'update' },
              { name: 'Set as default', value: 'default' },
              { name: 'Delete view', value: 'delete' },
              { name: 'Cancel', value: 'cancel' },
            ],
          },
        ]);

        if (viewAction === 'cancel') {
          return;
        }

        if (viewAction === 'use') {
          await this.config.runCommand('board', ['--view', viewId]);
          return;
        }

        if (viewAction === 'update') {
          this.log(styles.muted(`\nRun: prlt view update ${viewId} --name "New Name"\n`));
          return;
        }

        if (viewAction === 'default') {
          await this.config.runCommand('view:update', [viewId, '--default']);
          return;
        }

        if (viewAction === 'delete') {
          await this.config.runCommand('view:delete', [viewId]);
          return;
        }
      }
    } catch (error) {
      await storage.close();
      throw error;
    }
  }
}
