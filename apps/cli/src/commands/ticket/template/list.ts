import { Command, Flags } from '@oclif/core';
import { getPMOContext } from '../../../lib/pmo/index.js';
import { styles } from '../../../lib/styles.js';
import { TicketTemplate } from '../../../lib/pmo/types.js';

export default class TicketTemplateList extends Command {
  static description = 'List available ticket templates';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --builtin  # Only built-in templates',
    '<%= config.bin %> <%= command.id %> --custom   # Only custom templates',
    '<%= config.bin %> <%= command.id %> --json     # Output as JSON',
  ];

  static flags = {
    builtin: Flags.boolean({
      description: 'Show only built-in templates',
      exclusive: ['custom'],
    }),
    custom: Flags.boolean({
      description: 'Show only custom templates',
      exclusive: ['builtin'],
    }),
    json: Flags.boolean({
      description: 'Output as JSON',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(TicketTemplateList);

    const { storage } = await getPMOContext(
      undefined,
      (msg) => this.log(styles.muted(msg)),
      false
    );

    try {
      let filter: { isBuiltin?: boolean } | undefined;
      if (flags.builtin) filter = { isBuiltin: true };
      if (flags.custom) filter = { isBuiltin: false };

      const templates = await storage.listTicketTemplates(filter);

      if (flags.json) {
        this.log(JSON.stringify(templates, null, 2));
        await storage.close();
        return;
      }

      if (templates.length === 0) {
        this.log(styles.muted('\nNo ticket templates found.'));
        this.log(styles.muted('Create one: prlt ticket template save <ticket-id> "Template Name"'));
        await storage.close();
        return;
      }

      this.log(`\n📋 ${styles.emphasis('Ticket Templates')}`);
      this.log('═'.repeat(60));

      // Group by builtin vs custom
      const builtinTemplates = templates.filter(t => t.isBuiltin);
      const customTemplates = templates.filter(t => !t.isBuiltin);

      if (builtinTemplates.length > 0 && !flags.custom) {
        this.log(`\n${styles.emphasis('Built-in Templates')}`);
        this.log('─'.repeat(40));
        for (const template of builtinTemplates) {
          this.printTemplate(template);
        }
      }

      if (customTemplates.length > 0 && !flags.builtin) {
        this.log(`\n${styles.emphasis('Custom Templates')}`);
        this.log('─'.repeat(40));
        for (const template of customTemplates) {
          this.printTemplate(template);
        }
      }

      this.log('');
      this.log(styles.muted('Create ticket from template: prlt ticket template apply <template-id>'));
      this.log('');

      await storage.close();
    } catch (error) {
      await storage.close();
      throw error;
    }
  }

  private printTemplate(template: TicketTemplate): void {
    this.log(`\n  ${styles.emphasis(template.name)} ${styles.muted(`(${template.id})`)}`);
    if (template.description) {
      this.log(`    ${styles.muted(template.description)}`);
    }

    // Show template details - first line
    const details: string[] = [];
    if (template.defaultPriority) {
      details.push(`Priority: ${template.defaultPriority}`);
    }
    if (template.defaultCategory) {
      details.push(`Category: ${template.defaultCategory}`);
    }
    if (template.suggestedSubtasks.length > 0) {
      details.push(`Subtasks: ${template.suggestedSubtasks.length}`);
    }

    if (details.length > 0) {
      this.log(`    ${styles.muted(details.join(' | '))}`);
    }

    // Show additional details - second line
    const details2: string[] = [];
    if (template.defaultStatusId) {
      details2.push(`Status: ${template.defaultStatusId}`);
    }
    if (template.defaultAssignee) {
      details2.push(`Assignee: ${template.defaultAssignee}`);
    }
    if (template.defaultOwner) {
      details2.push(`Owner: ${template.defaultOwner}`);
    }
    if (template.defaultLabels && template.defaultLabels.length > 0) {
      details2.push(`Labels: ${template.defaultLabels.join(', ')}`);
    }

    if (details2.length > 0) {
      this.log(`    ${styles.muted(details2.join(' | '))}`);
    }

    if (template.titlePattern) {
      this.log(`    ${styles.muted(`Title: "${template.titlePattern}"`)}`);
    }
  }
}
