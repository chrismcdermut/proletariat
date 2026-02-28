import { Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../../lib/pmo/index.js';
import { shouldOutputJson } from '../../../lib/prompt-json.js';
import { styles } from '../../../lib/styles.js';
import { StateCategory, PhaseTemplate } from '../../../lib/pmo/types.js';

export default class PhaseTemplateList extends PMOCommand {
  static description = 'List phase templates';

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
    const { flags } = await this.parse(PhaseTemplateList);

    let builtinFilter: { isBuiltin?: boolean } | undefined;
    if (flags.builtin) builtinFilter = { isBuiltin: true };
    if (flags.custom) builtinFilter = { isBuiltin: false };

    const templates = await this.storage.listPhaseTemplates(builtinFilter);

    if (shouldOutputJson(flags)) {
      this.log(JSON.stringify(templates, null, 2));
      return;
    }

    if (templates.length === 0) {
      this.log(styles.muted('\nNo phase templates found.'));
      return;
    }

    this.log(`\n${styles.emphasis('Phase Templates')}`);
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

  private printTemplate(template: PhaseTemplate): void {
    const categoryEmoji: Record<StateCategory, string> = {
      triage: '📬',
      backlog: '📥',
      unstarted: '📋',
      started: '🚀',
      completed: '✅',
      canceled: '🚫',
    };

    this.log(`  ${styles.emphasis(template.name)} ${styles.muted(`(${template.id})`)}`);
    if (template.description) {
      this.log(`    ${styles.muted(template.description)}`);
    }
    if (template.phases && template.phases.length > 0) {
      const phasesByCategory = new Map<StateCategory, string[]>();
      for (const phase of template.phases) {
        const existing = phasesByCategory.get(phase.category) || [];
        existing.push(phase.name);
        phasesByCategory.set(phase.category, existing);
      }
      const phaseParts: string[] = [];
      for (const [category, names] of phasesByCategory) {
        phaseParts.push(`${categoryEmoji[category]} ${names.join(', ')}`);
      }
      this.log(`    ${styles.muted(phaseParts.join(' → '))}`);
    }
  }
}
