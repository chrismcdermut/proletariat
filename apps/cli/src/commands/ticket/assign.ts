import { Command, Args } from '@oclif/core';
import inquirer from 'inquirer';
import {
  getPMOContext,
  autoExportToBoard,
} from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';

export default class TicketAssign extends Command {
  static description = 'Assign ticket to specific user/agent';

  static examples = [
    '<%= config.bin %> <%= command.id %> TICK-001 alice',
    '<%= config.bin %> <%= command.id %>  # Interactive mode',
  ];

  static args = {
    ticketId: Args.string({
      description: 'Ticket ID - prompts with dropdown if not provided',
      required: false,
    }),
    agent: Args.string({
      description: 'Agent/user to assign - prompts with dropdown if not provided',
      required: false,
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(TicketAssign);

    // Get PMO context (prompts for project if multiple exist)
    const { pmoPath, storage } = await getPMOContext(
      undefined,
      (msg) => this.log(styles.muted(msg)),
      true // prompt if multiple projects
    );

    try {
      // Get ticketId - prompt if not provided
      let ticketId = args.ticketId;

      if (!ticketId) {
        // Get all tickets for selection
        const allTickets = await storage.listTickets();

        if (allTickets.length === 0) {
          await storage.close();
          this.error('No tickets found. Create a ticket first with "prlt ticket create".');
        }

        const { selectedTicketId } = await inquirer.prompt([{
          type: 'list',
          name: 'selectedTicketId',
          message: 'Select ticket to assign:',
          choices: allTickets.map(t => ({
            name: `${t.id} - ${t.title} (${t.column}, unassigned)`,  // TODO: Show current assignment
            value: t.id,
          })),
        }]);
        ticketId = selectedTicketId;
      }

      // Get ticket
      const ticket = await storage.getTicket(ticketId!);
      if (!ticket) {
        await storage.close();
        this.error(`Ticket "${ticketId}" not found.`);
      }

      // Get agent - prompt if not provided
      let agent = args.agent;

      if (!agent) {
        // Interactive dropdown with common options
        const { selectedAgent } = await inquirer.prompt([{
          type: 'list',
          name: 'selectedAgent',
          message: `Assign ${ticketId} to:`,
          choices: [
            { name: 'Unassign (remove assignee)', value: '' },
            new inquirer.Separator('── Common Agents ──'),
            { name: 'alice', value: 'alice' },
            { name: 'bob', value: 'bob' },
            { name: 'charlie', value: 'charlie' },
            new inquirer.Separator('────────────────────'),
            { name: 'Enter custom name...', value: '__custom__' },
          ],
        }]);

        if (selectedAgent === '__custom__') {
          const { customAgent } = await inquirer.prompt([{
            type: 'input',
            name: 'customAgent',
            message: 'Enter agent name:',
            validate: (input: string) => {
              if (!input.trim()) {
                return 'Agent name cannot be empty';
              }
              return true;
            },
          }]);
          agent = customAgent.trim();
        } else {
          agent = selectedAgent;
        }
      }

      // TODO: Implement assignTicket and unassignTicket methods in PMOStorage
      // For now, show error message
      await storage.close();
      this.error(
        'Ticket assignment is not yet implemented.\n' +
        'TODO: Implement assignTicket() and unassignTicket() in PMOStorage interface.'
      );

      // When implemented, the code should look like:
      /*
      if (agent) {
        await storage.assignTicket(ticketId, agent);
        await autoExportToBoard(pmoPath, storage, (msg) => this.log(styles.muted(msg)));
        await storage.close();
        this.log(styles.success(`\n✅ Assigned ${styles.emphasis(ticketId)} to ${styles.emphasis(agent)}`));
        this.log(styles.muted(`   Title: ${ticket.title}`));
      } else {
        await storage.unassignTicket(ticketId);
        await autoExportToBoard(pmoPath, storage, (msg) => this.log(styles.muted(msg)));
        await storage.close();
        this.log(styles.success(`\n✅ Unassigned ${styles.emphasis(ticketId)}`));
        this.log(styles.muted(`   Title: ${ticket.title}`));
      }
      */
    } catch (error) {
      await storage.close();
      throw error;
    }
  }

}
