import { Args } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../../lib/pmo/index.js';
import { styles } from '../../../lib/styles.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../../lib/prompt-json.js';

export default class TicketLink extends PMOCommand {
  static description = 'Manage links (dependencies) for a ticket';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> TKT-001',
    '<%= config.bin %> <%= command.id %> TKT-001 --json',
  ];

  static args = {
    ticket: Args.string({
      description: 'Ticket ID',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(TicketLink);
    const jsonMode = shouldOutputJson(flags);

    const projectId = await this.requireProject();

    // If no ticket ID provided, prompt for selection
    if (!args.ticket) {
      const tickets = await this.storage.listTickets(projectId);
      if (tickets.length === 0) {
        this.log(styles.muted('No tickets found.'));
        return;
      }

      const choices = tickets.map(t => ({
        name: `${t.id} - ${t.title}`,
        value: t.id,
        command: `prlt ticket link ${t.id}${flags.project ? ` -P ${flags.project}` : ''} --json`,
      }));
      const message = 'Select a ticket to manage links:';

      if (jsonMode) {
        outputPromptAsJson(
          buildPromptConfig('list', 'ticket', message, choices),
          createMetadata('ticket link', flags)
        );
        return;
      }

      const { selected } = await this.prompt<{ selected: string }>([{
        type: 'list',
        name: 'selected',
        message,
        choices,
      }], null);

      args.ticket = selected;
    }

    const ticket = await this.storage.getTicket(args.ticket!);
    if (!ticket) {
      this.error(`Ticket not found: ${args.ticket}`);
    }

    // Show link actions submenu
    const projectFlag = flags.project ? ` -P ${flags.project}` : '';
    const menuChoices = [
      { name: 'Add blocker', value: 'block', command: `prlt ticket link block ${args.ticket}${projectFlag} --json` },
      { name: 'Add related ticket', value: 'relates', command: `prlt ticket link relates ${args.ticket}${projectFlag} --json` },
      { name: 'Mark as duplicate', value: 'duplicates', command: `prlt ticket link duplicates ${args.ticket}${projectFlag} --json` },
      { name: 'View links', value: 'view', command: `prlt link list ${args.ticket}${projectFlag} --json` },
      { name: 'Remove link', value: 'remove', command: `prlt link remove ${args.ticket}${projectFlag} --json` },
      { name: 'Cancel', value: 'cancel', command: '' },
    ];
    const message = `Manage links for ${args.ticket}: ${ticket.title}`;

    if (jsonMode) {
      outputPromptAsJson(
        buildPromptConfig('list', 'action', message, menuChoices),
        createMetadata('ticket link', flags)
      );
      return;
    }

    const { action } = await this.prompt<{ action: string }>([{
      type: 'list',
      name: 'action',
      message,
      choices: menuChoices,
    }], null);

    if (action === 'cancel') {
      this.log(styles.muted('Cancelled.'));
      return;
    }

    switch (action) {
      case 'block': {
        const { default: BlockCommand } = await import('./block.js');
        const cmd = new BlockCommand([args.ticket!, ...(flags.project ? ['-P', flags.project] : [])], this.config);
        await cmd.run();
        break;
      }
      case 'relates': {
        const { default: RelatesCommand } = await import('./relates.js');
        const cmd = new RelatesCommand([args.ticket!, ...(flags.project ? ['-P', flags.project] : [])], this.config);
        await cmd.run();
        break;
      }
      case 'duplicates': {
        const { default: DuplicatesCommand } = await import('./duplicates.js');
        const cmd = new DuplicatesCommand([args.ticket!, ...(flags.project ? ['-P', flags.project] : [])], this.config);
        await cmd.run();
        break;
      }
      case 'view': {
        const { default: LinkListCommand } = await import('../../link/list.js');
        const cmd = new LinkListCommand([args.ticket!, ...(flags.project ? ['-P', flags.project] : [])], this.config);
        await cmd.run();
        break;
      }
      case 'remove': {
        this.log(styles.muted('Use: prlt link remove <from> <to>'));
        break;
      }
    }
  }
}
