import { Command, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { autoExportToBoard, getPMOContext } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';

export default class TicketCreate extends Command {
  static description = 'Create a new ticket on the PMO board';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --title "Fix login bug" --column Backlog',
    '<%= config.bin %> <%= command.id %> -t "Add feature" -c "In Progress" -p HIGH',
    '<%= config.bin %> <%= command.id %> --project mobile-app -t "New feature"',
  ];

  static flags = {
    project: Flags.string({
      char: 'P',
      description: 'Project ID (default: "default")',
    }),
    title: Flags.string({
      char: 't',
      description: 'Ticket title',
    }),
    column: Flags.string({
      char: 'c',
      description: 'Column to place the ticket in',
    }),
    priority: Flags.string({
      char: 'p',
      description: 'Ticket priority',
      options: ['URGENT', 'HIGH', 'MEDIUM', 'LOW'],
    }),
    category: Flags.string({
      description: 'Ticket category (e.g., bug, feature, refactor)',
    }),
    description: Flags.string({
      char: 'd',
      description: 'Ticket description',
    }),
    id: Flags.string({
      description: 'Custom ticket ID (auto-generated if not provided)',
    }),
    interactive: Flags.boolean({
      char: 'i',
      description: 'Interactive mode',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(TicketCreate);

    // Get PMO context (prompt for project if multiple exist and no --project flag)
    const { pmoPath, storage, columns, projectName } = await getPMOContext(
      flags.project,
      (msg) => this.log(styles.muted(msg)),
      true // prompt if multiple projects
    );

    // Get ticket data (interactive or from flags)
    let ticketData: {
      title: string;
      column: string;
      priority?: string;
      category?: string;
      description?: string;
      id?: string;
    };

    if (flags.interactive || !flags.title) {
      ticketData = await this.promptTicketData(columns, flags);
    } else {
      if (!flags.title) {
        this.error('Title is required. Use --title or -t flag, or use --interactive mode.');
      }
      ticketData = {
        title: flags.title,
        column: flags.column || columns[0],
        priority: flags.priority,
        category: flags.category,
        description: flags.description,
        id: flags.id,
      };
    }

    // Validate column
    if (!columns.includes(ticketData.column)) {
      this.error(`Invalid column "${ticketData.column}". Available columns: ${columns.join(', ')}`);
    }

    try {
      const ticket = await storage.createTicket({
        id: ticketData.id,
        title: ticketData.title,
        column: ticketData.column,
        priority: ticketData.priority,
        category: ticketData.category,
        description: ticketData.description,
      });

      // Auto-export to board.md after write
      await autoExportToBoard(pmoPath, storage, (msg) => this.log(styles.muted(msg)));

      await storage.close();

      this.log(styles.success(`\n✅ Created ticket ${styles.emphasis(ticket.id)} in project ${styles.emphasis(projectName)}`));
      this.log(styles.muted(`   Title: ${ticket.title}`));
      this.log(styles.muted(`   Column: ${ticket.column}`));
      if (ticket.priority) {
        this.log(styles.muted(`   Priority: ${ticket.priority}`));
      }
      if (ticket.category) {
        this.log(styles.muted(`   Category: ${ticket.category}`));
      }
      this.log(styles.muted(`\n   View board: prlt board`));
      this.log(styles.muted(`   List tickets: prlt ticket list`));
    } catch (error) {
      await storage.close();
      throw error;
    }
  }

  private async promptTicketData(
    columns: string[],
    flags: {
      title?: string;
      column?: string;
      priority?: string;
      category?: string;
      description?: string;
      id?: string;
    }
  ): Promise<{
    title: string;
    column: string;
    priority?: string;
    category?: string;
    description?: string;
    id?: string;
  }> {
    const answers = await inquirer.prompt<{
      title: string;
      column: string;
      priority?: string;
      categoryChoice: string;
      customCategory?: string;
      description?: string;
    }>([
      {
        type: 'input',
        name: 'title',
        message: 'Ticket title:',
        default: flags.title,
        validate: (input: string) => input.length > 0 || 'Title is required',
      },
      {
        type: 'list',
        name: 'column',
        message: 'Column:',
        choices: columns,
        default: flags.column || columns[0],
      },
      {
        type: 'list',
        name: 'priority',
        message: 'Priority:',
        choices: [
          { name: 'None', value: undefined },
          { name: 'URGENT', value: 'URGENT' },
          { name: 'HIGH', value: 'HIGH' },
          { name: 'MEDIUM', value: 'MEDIUM' },
          { name: 'LOW', value: 'LOW' },
        ],
        default: flags.priority,
      },
      {
        type: 'list',
        name: 'categoryChoice',
        message: 'Category:',
        choices: [
          { name: 'Skip (none)', value: '' },
          { name: 'feature', value: 'feature' },
          { name: 'bug', value: 'bug' },
          { name: 'refactor', value: 'refactor' },
          { name: 'docs', value: 'docs' },
          { name: 'test', value: 'test' },
          { name: 'chore', value: 'chore' },
          { name: 'Custom...', value: '__custom__' },
        ],
        default: flags.category || '',
      },
      {
        type: 'input',
        name: 'customCategory',
        message: 'Enter custom category:',
        when: (answers: { categoryChoice: string }) => answers.categoryChoice === '__custom__',
        validate: (input: string) => input.length > 0 || 'Category is required when choosing custom',
      },
      {
        type: 'input',
        name: 'description',
        message: 'Description (optional):',
        default: flags.description,
      },
    ]);

    // Resolve category from choice or custom input
    const category = answers.categoryChoice === '__custom__'
      ? answers.customCategory
      : answers.categoryChoice || undefined;

    return {
      title: answers.title,
      column: answers.column,
      priority: answers.priority || undefined,
      category,
      description: answers.description || undefined,
      id: flags.id,
    };
  }

}
