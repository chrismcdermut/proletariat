import { Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { StateCategory, TicketTemplate, PhaseTemplate } from '../../lib/pmo/types.js';

type TemplateType = 'ticket' | 'phase';

export default class TemplateList extends PMOCommand {
  static description = 'List all templates (ticket and phase)';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --type ticket',
    '<%= config.bin %> <%= command.id %> --type phase',
    '<%= config.bin %> <%= command.id %> --builtin',
    '<%= config.bin %> <%= command.id %> --json',
  ];

  static flags = {
    ...pmoBaseFlags,
    type: Flags.string({
      char: 't',
      description: 'Filter by template type',
      options: ['ticket', 'phase'],
    }),
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

    let builtinFilter: { isBuiltin?: boolean } | undefined;
    if (flags.builtin) builtinFilter = { isBuiltin: true };
    if (flags.custom) builtinFilter = { isBuiltin: false };

    const typeFilter = flags.type as TemplateType | undefined;
    const showTicket = !typeFilter || typeFilter === 'ticket';
    const showPhase = !typeFilter || typeFilter === 'phase';

    // Fetch all requested template types
    const [ticketTemplates, phaseTemplates] = await Promise.all([
      showTicket ? this.storage.listTicketTemplates(builtinFilter) : Promise.resolve([]),
      showPhase ? this.storage.listPhaseTemplates(builtinFilter) : Promise.resolve([]),
    ]);

    if (flags.json) {
      const result: Record<string, unknown[]> = {};
      if (showTicket) result.ticket = ticketTemplates;
      if (showPhase) result.phase = phaseTemplates;
      this.log(JSON.stringify(result, null, 2));
      return;
    }

    const totalCount = ticketTemplates.length + phaseTemplates.length;
    if (totalCount === 0) {
      this.log(styles.muted('\nNo templates found.'));
      return;
    }

    this.log(`\n${styles.emphasis('Templates')}`);
    this.log('═'.repeat(60));

    // Ticket templates
    if (showTicket && ticketTemplates.length > 0) {
      this.log(`\n${styles.emphasis('Ticket Templates')} ${styles.muted(`(${ticketTemplates.length})`)}`);
      this.log('─'.repeat(40));
      this.printTicketTemplates(ticketTemplates, flags.builtin, flags.custom);
    }

    // Phase templates
    if (showPhase && phaseTemplates.length > 0) {
      this.log(`\n${styles.emphasis('Phase Templates')} ${styles.muted(`(${phaseTemplates.length})`)}`);
      this.log('─'.repeat(40));
      this.printPhaseTemplates(phaseTemplates, flags.builtin, flags.custom);
    }

    this.log('');
    this.log(styles.muted('Commands:'));
    if (showTicket) this.log(styles.muted('  prlt template ticket apply <id>    - Create ticket from template'));
    if (showPhase) this.log(styles.muted('  prlt template phase apply <id>     - Apply phase template'));
    this.log(styles.muted('  prlt workflow list                 - List available workflows'));
    this.log('');
  }

  private printTicketTemplates(templates: TicketTemplate[], onlyBuiltin?: boolean, onlyCustom?: boolean): void {
    const builtinTemplates = templates.filter(t => t.isBuiltin);
    const customTemplates = templates.filter(t => !t.isBuiltin);

    const printOne = (template: TicketTemplate) => {
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
    };

    if (builtinTemplates.length > 0 && !onlyCustom) {
      for (const template of builtinTemplates) printOne(template);
    }
    if (customTemplates.length > 0 && !onlyBuiltin) {
      if (builtinTemplates.length > 0 && !onlyCustom) this.log('');
      for (const template of customTemplates) printOne(template);
    }
  }

  private printPhaseTemplates(templates: PhaseTemplate[], onlyBuiltin?: boolean, onlyCustom?: boolean): void {
    const builtinTemplates = templates.filter(t => t.isBuiltin);
    const customTemplates = templates.filter(t => !t.isBuiltin);

    const categoryEmoji: Record<StateCategory, string> = {
      triage: '📬',
      backlog: '📥',
      unstarted: '📋',
      started: '🚀',
      completed: '✅',
      canceled: '🚫',
    };

    const printOne = (template: PhaseTemplate) => {
      this.log(`  ${styles.emphasis(template.name)} ${styles.muted(`(${template.id})`)}`);
      if (template.description) {
        this.log(`    ${styles.muted(template.description)}`);
      }
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
    };

    if (builtinTemplates.length > 0 && !onlyCustom) {
      for (const template of builtinTemplates) printOne(template);
    }
    if (customTemplates.length > 0 && !onlyBuiltin) {
      if (builtinTemplates.length > 0 && !onlyCustom) this.log('');
      for (const template of customTemplates) printOne(template);
    }
  }
}
