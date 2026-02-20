import { Args } from '@oclif/core';
import { pmoBaseFlags } from '../../lib/pmo/index.js';
import TicketView from './view.js';

export default class TicketShow extends TicketView {
  static description = 'View detailed ticket information (alias for ticket view)';
  static hidden = true;

  static args = {
    ticketId: Args.string({
      description: 'Ticket ID to view - prompts with dropdown if not provided',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
  };
}
