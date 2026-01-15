import { Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { StateCategory, WorkflowTemplate } from '../../lib/pmo/types.js';

export default class TemplateList extends PMOCommand {
  static description = 'List all workflow templates';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --builtin',
    '<%= config.bin %> <%= command.id %> --custom',
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
    json: Flags.boolean({
      description: 'Output as JSON',
      default: false,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(TemplateList);

    let filter: { isBuiltin?: boolean } | undefined;
    if (flags.builtin) filter = { isBuiltin: true };
    if (flags.custom) filter = { isBuiltin: false };

    const templates = await this.storage.listTemplates(filter);

    if (flags.json) {
      this.log(JSON.stringify(templates, null, 2));
      return;
    }

    if (templates.length === 0) {
      this.log(styles.muted('\nNo templates found.'));
      return;
    }

    this.log(`\n📋 ${styles.emphasis('Workflow Templates')}`);
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
    this.log(styles.muted('Apply a template: prlt template apply <template-id>'));
    this.log('');
  }

  private printTemplate(template: WorkflowTemplate): void {
    this.log(`\n  ${styles.emphasis(template.name)} ${styles.muted(`(${template.id})`)}`);
    if (template.description) {
      this.log(`    ${styles.muted(template.description)}`);
    }

    // Group statuses by category for display
    const categoryEmoji: Record<StateCategory, string> = {
      backlog: '📥',
      unstarted: '📋',
      started: '🚀',
      completed: '✅',
      canceled: '🚫',
    };

    const statusesByCategory = new Map<StateCategory, string[]>();
    for (const status of template.statuses) {
      const existing = statusesByCategory.get(status.category) || [];
      existing.push(status.name);
      statusesByCategory.set(status.category, existing);
    }

    const statusParts: string[] = [];
    for (const [category, names] of statusesByCategory) {
      const emoji = categoryEmoji[category];
      statusParts.push(`${emoji} ${names.join(', ')}`);
    }

    this.log(`    ${styles.muted(statusParts.join(' → '))}`);
  }
}
