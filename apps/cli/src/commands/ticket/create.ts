import { Command, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { autoExportToBoard, getPMOContext } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { updateEpicTicketsSection } from '../../lib/pmo/epic-files.js';

export default class TicketCreate extends Command {
  static description = 'Create a new ticket on the PMO board';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --title "Fix login bug" --column Backlog',
    '<%= config.bin %> <%= command.id %> -t "Add feature" -c "In Progress" -p HIGH',
    '<%= config.bin %> <%= command.id %> --project mobile-app -t "New feature"',
    '<%= config.bin %> <%= command.id %> --epic EPIC-001 -t "Implement auth flow"',
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
    epic: Flags.string({
      char: 'e',
      description: 'Link ticket to an epic (e.g., EPIC-001)',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(TicketCreate);

    // Get PMO context (prompt for project if multiple exist and no --project flag)
    const { pmoPath, storage, columns, projectName, projectId } = await getPMOContext(
      flags.project,
      (msg) => this.log(styles.muted(msg)),
      true // prompt if multiple projects
    );

    // Validate epic if provided
    if (flags.epic) {
      const epic = await storage.getEpic(flags.epic);
      if (!epic) {
        await storage.close();
        this.error(`Epic not found: ${flags.epic}. Use 'prlt epic list' to see available epics.`);
      }
    }

    // Get ticket data (interactive or from flags)
    let ticketData: {
      title: string;
      column: string;
      priority?: string;
      category?: string;
      description?: string;
      id?: string;
      epicId?: string;
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
        epicId: flags.epic,
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
        epicId: ticketData.epicId,
      });

      // Auto-export to board.md after write
      await autoExportToBoard(pmoPath, storage, (msg) => this.log(styles.muted(msg)));

      // If linked to an epic, update the epic's markdown file with ticket list
      if (ticketData.epicId) {
        const epic = await storage.getEpic(ticketData.epicId);
        if (epic) {
          const epicTickets = await storage.getTicketsForEpic(ticketData.epicId);
          const ticketInfos = epicTickets.map(t => ({
            id: t.id,
            title: t.title,
            status: t.statusName || t.column || 'Unknown',
            priority: t.priority,
          }));
          updateEpicTicketsSection(pmoPath, ticketData.epicId, epic.status, ticketInfos, projectId);
        }
      }

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
      if (ticketData.epicId) {
        this.log(styles.muted(`   Epic: ${ticketData.epicId}`));
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
      epic?: string;
    }
  ): Promise<{
    title: string;
    column: string;
    priority?: string;
    category?: string;
    description?: string;
    id?: string;
    epicId?: string;
  }> {
    const answers = await inquirer.prompt<{
      title: string;
      column: string;
      priority?: string;
      categoryChoice: string;
      customCategory?: string;
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
          new inquirer.Separator('── Conventional Commits ──'),
          { name: 'feature     - New feature or capability', value: 'feature' },
          { name: 'bug         - Bug fix', value: 'bug' },
          { name: 'refactor    - Code refactoring', value: 'refactor' },
          { name: 'docs        - Documentation', value: 'docs' },
          { name: 'test        - Test additions/fixes', value: 'test' },
          { name: 'chore       - Maintenance tasks', value: 'chore' },
          { name: 'performance - Performance improvements', value: 'performance' },
          { name: 'ci          - CI/CD changes', value: 'ci' },
          { name: 'build       - Build system changes', value: 'build' },
          new inquirer.Separator('── Extended Types ──'),
          { name: 'security    - Security fixes', value: 'security' },
          { name: 'database    - Database migrations', value: 'database' },
          { name: 'release     - Release preparation', value: 'release' },
          new inquirer.Separator('── 5Tool Founder ──'),
          { name: 'ship        - Shipping and deployment', value: 'ship' },
          { name: 'growth      - Growth and marketing', value: 'growth' },
          { name: 'support     - Customer experience', value: 'support' },
          { name: 'strategy    - Strategy and planning', value: 'strategy' },
          { name: 'ops         - Business operations', value: 'ops' },
          new inquirer.Separator('───────────────────'),
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
    ]);

    // Resolve category from choice or custom input
    const category = answers.categoryChoice === '__custom__'
      ? answers.customCategory
      : answers.categoryChoice || undefined;

    // Prompt for structured description
    const description = await this.promptStructuredDescription(flags.description);

    return {
      title: answers.title,
      column: answers.column,
      priority: answers.priority || undefined,
      category,
      description: description || undefined,
      id: flags.id,
      epicId: flags.epic,
    };
  }

  private async promptStructuredDescription(existingDescription?: string): Promise<string> {
    // If description already provided via flag, use it
    if (existingDescription) {
      return existingDescription;
    }

    this.log(styles.muted('\n─── Ticket Description (for agent execution) ───'));

    const descAnswers = await inquirer.prompt<{
      what: string;
      doneWhen: string;
      context: string;
      notInScope: string;
    }>([
      {
        type: 'input',
        name: 'what',
        message: 'What is the concrete outcome? (one sentence):',
        validate: (input: string) => input.length > 0 || 'Outcome is required - what does success look like?',
      },
      {
        type: 'editor',
        name: 'doneWhen',
        message: 'Done when (acceptance criteria, opens editor):',
        default: '- [ ] \n- [ ] ',
        waitForUseInput: false,
      },
      {
        type: 'input',
        name: 'context',
        message: 'Context (files, patterns, hints - optional):',
        default: '',
      },
      {
        type: 'input',
        name: 'notInScope',
        message: 'Not in scope (explicit exclusions - optional):',
        default: '',
      },
    ]);

    // Build structured description
    const parts: string[] = [];

    parts.push(`## What\n${descAnswers.what}`);

    if (descAnswers.doneWhen.trim()) {
      // Ensure each line in doneWhen starts with - [ ] if it doesn't already
      const criteria = descAnswers.doneWhen
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .map(line => {
          if (line.startsWith('- [ ]') || line.startsWith('- [x]')) {
            return line;
          }
          if (line.startsWith('-')) {
            return `- [ ]${line.slice(1)}`;
          }
          return `- [ ] ${line}`;
        })
        .join('\n');
      parts.push(`## Done when\n${criteria}`);
    }

    if (descAnswers.context.trim()) {
      parts.push(`## Context\n${descAnswers.context}`);
    }

    if (descAnswers.notInScope.trim()) {
      parts.push(`## Not in scope\n${descAnswers.notInScope}`);
    }

    return parts.join('\n\n');
  }

}
