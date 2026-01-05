import { Command, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { getPMOContext } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';

export default class TemplatesDelete extends Command {
  static description = 'Delete multiple workflow templates';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --force',
  ];

  static flags = {
    force: Flags.boolean({
      char: 'f',
      description: 'Skip confirmation',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(TemplatesDelete);

    const { storage } = await getPMOContext(
      undefined,
      (msg) => this.log(styles.muted(msg)),
      false
    );

    try {
      // Get only custom templates (can't delete built-in)
      const templates = await storage.listTemplates({ isBuiltin: false });

      if (templates.length === 0) {
        this.log(styles.muted('\nNo custom templates to delete.'));
        await storage.close();
        return;
      }

      // Select templates to delete
      const { selected } = await inquirer.prompt<{ selected: string[] }>([{
        type: 'checkbox',
        name: 'selected',
        message: 'Select templates to delete:',
        choices: templates.map(t => ({
          name: `${t.name} (${t.statuses.length} statuses)`,
          value: t.id,
        })),
      }]);

      if (selected.length === 0) {
        this.log(styles.muted('\nNo templates selected.'));
        await storage.close();
        return;
      }

      // Confirm deletion
      if (!flags.force) {
        const { confirm } = await inquirer.prompt<{ confirm: boolean }>([{
          type: 'confirm',
          name: 'confirm',
          message: `Delete ${selected.length} template(s)?`,
          default: false,
        }]);

        if (!confirm) {
          this.log(styles.muted('Cancelled.'));
          await storage.close();
          return;
        }
      }

      // Delete selected templates
      let deleted = 0;
      for (const id of selected) {
        try {
          await storage.deleteTemplate(id);
          deleted++;
        } catch (error) {
          this.warn(`Failed to delete "${id}": ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      await storage.close();

      this.log(styles.success(`\nDeleted ${deleted} template(s)`));
    } catch (error) {
      await storage.close();
      throw error;
    }
  }
}
