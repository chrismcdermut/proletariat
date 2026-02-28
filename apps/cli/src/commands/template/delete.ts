import { Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { FlagResolver, shouldOutputJson } from '../../lib/flags/index.js';
import { outputErrorAsJson, createMetadata } from '../../lib/prompt-json.js';

type TemplateType = 'ticket' | 'phase';

export default class TemplateDelete extends PMOCommand {
  static description = 'Delete templates (ticket or phase)';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --type ticket',
    '<%= config.bin %> <%= command.id %> --type phase',
    '<%= config.bin %> <%= command.id %> --force',
  ];

  static flags = {
    ...pmoBaseFlags,
    type: Flags.string({
      char: 't',
      description: 'Template type to delete',
      options: ['ticket', 'phase'],
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Skip confirmation',
      default: false,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(TemplateDelete);

    const jsonMode = shouldOutputJson(flags);

    // Create resolver for type and template selection
    const resolver = new FlagResolver<{ type?: string; templateIds?: string[] }>({
      commandName: 'template delete',
      baseCommand: 'prlt template delete',
      jsonMode,
      flags,
    });

    // Prompt for template type if not provided
    resolver.addPrompt({
      flagName: 'type',
      type: 'list',
      message: 'Which template type would you like to delete?',
      choices: () => [
        { name: 'Ticket templates', value: 'ticket', command: 'prlt template delete --type ticket --json' },
        { name: 'Phase templates', value: 'phase', command: 'prlt template delete --type phase --json' },
      ],
      when: (ctx) => !ctx.flags.type,
    });

    // First resolve type
    const resolvedType = await resolver.resolve();
    const templateType = resolvedType.type as TemplateType;

    // Get custom templates of the selected type
    let templates: Array<{ id: string; name: string }> = [];
    let typeName = '';

    switch (templateType) {
      case 'ticket': {
        typeName = 'ticket';
        const ticketTemplates = await this.storage.listTicketTemplates({ isBuiltin: false });
        templates = ticketTemplates.map(t => ({ id: t.id, name: t.name }));
        break;
      }
      case 'phase': {
        typeName = 'phase';
        const phaseTemplates = await this.storage.listPhaseTemplates({ isBuiltin: false });
        templates = phaseTemplates.map(t => ({ id: t.id, name: t.name }));
        break;
      }
    }

    if (templates.length === 0) {
      if (jsonMode) {
        outputErrorAsJson('NO_TEMPLATES', `No custom ${typeName} templates to delete.`, createMetadata('template delete', flags));
      }
      this.log(styles.muted(`\nNo custom ${typeName} templates to delete.`));
      return;
    }

    // Create new resolver for template selection (needs templates data)
    const templateResolver = new FlagResolver<{ templateIds?: string[] }>({
      commandName: 'template delete',
      baseCommand: 'prlt template delete',
      jsonMode,
      flags: {} as { templateIds?: string[] },
    });

    templateResolver.addPrompt({
      flagName: 'templateIds',
      type: 'checkbox',
      message: `Select ${typeName} templates to delete:`,
      choices: () => templates.map(t => ({
        name: t.name,
        value: t.id,
        command: `prlt template delete --type ${templateType} --templateIds "${t.id}" --json`,
      })),
    });

    const resolvedTemplates = await templateResolver.resolve();
    const selected = resolvedTemplates.templateIds || [];

    if (selected.length === 0) {
      this.log(styles.muted('\nNo templates selected.'));
      return;
    }

    // Confirm deletion (using agentPrompt for confirmation)
    if (!flags.force) {
      const { confirm } = await this.prompt<{ confirm: boolean }>([{
        type: 'list',
        name: 'confirm',
        message: `Delete ${selected.length} ${typeName} template(s)?`,
        choices: [
          { name: 'No', value: false, command: '' },
          { name: 'Yes', value: true, command: `prlt template delete --type ${templateType} --templateIds "${selected.join(',')}" --force --json` },
        ],
      }], jsonMode ? { flags, commandName: 'template delete' } : null);

      if (!confirm) {
        this.log(styles.muted('Cancelled.'));
        return;
      }
    }

    // Delete selected templates
    let deleted = 0;
    for (const id of selected) {
      try {
        switch (templateType) {
          case 'ticket':
            // eslint-disable-next-line no-await-in-loop -- Sequential deletes with error handling
            await this.storage.deleteTicketTemplate(id);
            break;
          case 'phase':
            // eslint-disable-next-line no-await-in-loop -- Sequential deletes with error handling
            await this.storage.deletePhaseTemplate(id);
            break;
        }
        deleted++;
      } catch (error) {
        this.warn(`Failed to delete "${id}": ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    this.log(styles.success(`\nDeleted ${deleted} ${typeName} template(s)`));
  }
}
