import { Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../../lib/pmo/index.js';
import { shouldOutputJson } from '../../../lib/prompt-json.js';
import { styles } from '../../../lib/styles.js';
import { TicketTemplate } from '../../../lib/pmo/types.js';

export default class TicketTemplateList extends PMOCommand {
  static description = 'List ticket templates';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --builtin',
    '<%= config.bin %> <%= command.id %> --json',
  ];

  static flags = {
    ...pmoBaseFlags,
    builtin: Flags.boolean({
      description: 'Show only built-in templates',
      exclusive: ['custom'],
    }),
    custom: Flags.boolean({
      description: 'Show only custom templates',
      exclusive: ['builtin'],
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(TicketTemplateList);

    let builtinFilter: { isBuiltin?: boolean } | undefined;
    if (flags.builtin) builtinFilter = { isBuiltin: true };
    if (flags.custom) builtinFilter = { isBuiltin: false };

    const templates = await this.storage.listTicketTemplates(builtinFilter);

    if (shouldOutputJson(flags)) {
      this.log(JSON.stringify(templates, null, 2));
      return;
    }

    if (templates.length === 0) {
      this.log(styles.muted('\nNo ticket templates found.'));
      return;
    }

    this.log(`\n${styles.emphasis('Ticket Templates')}`);
    this.log('═'.repeat(60));

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
  }

  private printTemplate(template: TicketTemplate): void {
    this.log(`  ${styles.emphasis(template.name)} ${styles.muted(`(${template.id})`)}`);
    if (template.description) {
      this.log(`    ${styles.muted(template.description)}`);
    }
    const details: string[] = [];
    if (template.defaultPriority) details.push(`Priority: ${template.defaultPriority}`);
    if (template.defaultCategory) details.push(`Category: ${template.defaultCategory}`);
    if (template.suggestedSubtasks.length > 0) details.push(`Subtasks: ${template.suggestedSubtasks.length}`);
    if (details.length > 0) {
      this.log(`    ${styles.muted(details.join(' | '))}`);
    }
  }
}
