/**
 * Ticket management class for PMO
 * Handles creating, claiming, and managing tickets
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { log } from '../utils/logger.js';
import { HQConfig, ITicketManager } from './types.js';

interface Ticket {
  id: string;
  title: string;
  description: string;
  queue: 'build' | 'grow' | 'support' | 'bizops' | 'strategy';
  priority: 'low' | 'medium' | 'high';
  status: 'todo' | 'in-progress' | 'done';
  assignee?: string;
  created: string;
  updated: string;
}

export class TicketManager implements ITicketManager {
  private pmoDir: string;
  private ticketsFile: string;
  private kanbanFile: string;

  constructor(
    private hqRoot: string,
    private config: HQConfig
  ) {
    this.pmoDir = path.join(hqRoot, 'pmo');
    this.ticketsFile = path.join(this.pmoDir, 'tickets.json');
    this.kanbanFile = path.join(this.pmoDir, 'kanban.md');
  }

  /**
   * Create a new ticket
   */
  async create(): Promise<void> {
    if (!fs.existsSync(this.pmoDir)) {
      log.error('PMO not initialized! Run `prlt pmo:init` first.');
      return;
    }

    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'title',
        message: 'Ticket title:',
        validate: (input) => input.length > 0 || 'Title is required'
      },
      {
        type: 'editor',
        name: 'description',
        message: 'Ticket description (opens in editor):'
      },
      {
        type: 'list',
        name: 'queue',
        message: 'Which queue does this belong to?',
        choices: [
          { name: '🔨 Build - Feature development', value: 'build' },
          { name: '📈 Grow - Growth & optimization', value: 'grow' },
          { name: '🛠️ Support - Bug fixes & maintenance', value: 'support' },
          { name: '📊 BizOps - Business operations', value: 'bizops' },
          { name: '🎯 Strategy - Strategic initiatives', value: 'strategy' }
        ]
      },
      {
        type: 'list',
        name: 'priority',
        message: 'Priority:',
        choices: [
          { name: '🟢 Low', value: 'low' },
          { name: '🟡 Medium', value: 'medium' },
          { name: '🔴 High', value: 'high' }
        ]
      }
    ]);

    const tickets = this.loadTickets();
    const ticketId = `T${String(tickets.length + 1).padStart(4, '0')}`;

    const newTicket: Ticket = {
      id: ticketId,
      title: answers.title,
      description: answers.description,
      queue: answers.queue,
      priority: answers.priority,
      status: 'todo',
      created: new Date().toISOString(),
      updated: new Date().toISOString()
    };

    tickets.push(newTicket);
    this.saveTickets(tickets);
    this.updateKanban(tickets);

    log.success(`✅ Created ticket ${chalk.bold(ticketId)}: ${answers.title}`);
    
    const { claimNow } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'claimNow',
        message: 'Would you like to claim this ticket now?',
        default: true
      }
    ]);

    if (claimNow) {
      await this.claim(ticketId);
    }
  }

  /**
   * Claim a ticket and launch Claude with context
   */
  async claim(ticketId?: string): Promise<void> {
    const tickets = this.loadTickets();
    const availableTickets = tickets.filter(t => t.status === 'todo');

    if (availableTickets.length === 0) {
      log.info('No tickets available to claim!');
      return;
    }

    let ticket: Ticket | undefined;

    if (ticketId) {
      ticket = tickets.find(t => t.id === ticketId);
      if (!ticket) {
        log.error(`Ticket ${ticketId} not found`);
        return;
      }
      if (ticket.status !== 'todo') {
        log.warning(`Ticket ${ticketId} is already ${ticket.status}`);
        return;
      }
    } else {
      // Interactive selection
      const { selectedTicket } = await inquirer.prompt([
        {
          type: 'list',
          name: 'selectedTicket',
          message: 'Select a ticket to claim:',
          choices: availableTickets.map(t => ({
            name: `${t.id} - ${t.title} (${t.queue}, ${t.priority})`,
            value: t
          }))
        }
      ]);
      ticket = selectedTicket;
    }

    // Select agent to assign
    let assignee: string | undefined;
    
    if (this.config.agents.length > 0) {
      const { selectedAgent } = await inquirer.prompt([
        {
          type: 'list',
          name: 'selectedAgent',
          message: 'Which agent will work on this ticket?',
          choices: [
            ...this.config.agents.map(a => ({ name: a, value: a })),
            { name: '(Unassigned)', value: undefined }
          ]
        }
      ]);
      assignee = selectedAgent;
    }

    if (!ticket) {
      log.error('Ticket not found');
      return;
    }

    // Update ticket
    ticket.status = 'in-progress';
    ticket.assignee = assignee;
    ticket.updated = new Date().toISOString();

    this.saveTickets(tickets);
    this.updateKanban(tickets);

    log.success(`✅ Claimed ticket ${chalk.bold(ticket.id)}${assignee ? ` for ${assignee}` : ''}`);

    // Launch Claude if requested
    const { launchClaude } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'launchClaude',
        message: 'Launch Claude with ticket context?',
        default: true
      }
    ]);

    if (launchClaude) {
      await this.launchClaudeWithContext(ticket, assignee);
    }
  }

  /**
   * Complete a ticket
   */
  async complete(ticketId: string): Promise<void> {
    const tickets = this.loadTickets();
    const ticket = tickets.find(t => t.id === ticketId);

    if (!ticket) {
      log.error(`Ticket ${ticketId} not found`);
      return;
    }

    if (ticket.status === 'done') {
      log.warning(`Ticket ${ticketId} is already completed`);
      return;
    }

    const { confirmComplete } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmComplete',
        message: `Complete ticket ${ticketId}: ${ticket.title}?`,
        default: true
      }
    ]);

    if (!confirmComplete) {
      return;
    }

    ticket.status = 'done';
    ticket.updated = new Date().toISOString();

    this.saveTickets(tickets);
    this.updateKanban(tickets);

    log.success(`✅ Completed ticket ${chalk.bold(ticketId)}`);
  }

  /**
   * List all tickets
   */
  async list(): Promise<void> {
    const tickets = this.loadTickets();

    if (tickets.length === 0) {
      log.info('No tickets yet! Create one with `prlt add-ticket`');
      return;
    }

    console.log(chalk.blue('\n🎯 PMO Tickets\n'));

    // Group by queue
    const queues = ['build', 'grow', 'support', 'bizops', 'strategy'];
    const queueNames: Record<string, string> = {
      build: '🔨 Build',
      grow: '📈 Grow',
      support: '🛠️ Support',
      bizops: '📊 BizOps',
      strategy: '🎯 Strategy'
    };

    for (const queue of queues) {
      const queueTickets = tickets.filter(t => t.queue === queue);
      
      if (queueTickets.length === 0) continue;
      
      console.log(chalk.bold(`\n${queueNames[queue]}:`));
      
      for (const ticket of queueTickets) {
        const statusIcon = ticket.status === 'done' ? '✅' : 
                          ticket.status === 'in-progress' ? '🔄' : '⭕';
        const priorityIcon = ticket.priority === 'high' ? '🔴' :
                            ticket.priority === 'medium' ? '🟡' : '🟢';
        
        console.log(`  ${statusIcon} ${ticket.id} - ${ticket.title} ${priorityIcon}`);
        
        if (ticket.assignee) {
          console.log(chalk.dim(`     Assigned to: ${ticket.assignee}`));
        }
      }
    }
    
    console.log('');
  }

  // Private helper methods

  private loadTickets(): Ticket[] {
    if (!fs.existsSync(this.ticketsFile)) {
      return [];
    }
    try {
      return JSON.parse(fs.readFileSync(this.ticketsFile, 'utf-8'));
    } catch {
      return [];
    }
  }

  private saveTickets(tickets: Ticket[]): void {
    fs.writeFileSync(this.ticketsFile, JSON.stringify(tickets, null, 2));
  }

  private updateKanban(tickets: Ticket[]): void {
    const kanbanTemplate = fs.readFileSync(
      path.join(__dirname, '../../../templates/pmo/kanban-template.md'),
      'utf-8'
    );

    let content = kanbanTemplate;

    // Group tickets by queue and status
    const queues = ['build', 'grow', 'support', 'bizops', 'strategy'];
    
    for (const queue of queues) {
      const queueTickets = tickets.filter(t => t.queue === queue);
      
      const todoItems = queueTickets
        .filter(t => t.status === 'todo')
        .map(t => `- [ ] ${t.id}: ${t.title}`)
        .join('\n');
      
      const inProgressItems = queueTickets
        .filter(t => t.status === 'in-progress')
        .map(t => `- [~] ${t.id}: ${t.title}${t.assignee ? ` (@${t.assignee})` : ''}`)
        .join('\n');
      
      const doneItems = queueTickets
        .filter(t => t.status === 'done')
        .slice(-5) // Keep last 5 done items
        .map(t => `- [x] ${t.id}: ${t.title}`)
        .join('\n');

      // Update placeholders
      content = content
        .replace(`<!-- ${queue.toUpperCase()}_TODO -->`, todoItems || '(empty)')
        .replace(`<!-- ${queue.toUpperCase()}_DOING -->`, inProgressItems || '(empty)')
        .replace(`<!-- ${queue.toUpperCase()}_DONE -->`, doneItems || '(empty)');
    }

    fs.writeFileSync(this.kanbanFile, content);
  }

  private async launchClaudeWithContext(ticket: Ticket, assignee?: string): Promise<void> {
    // Create context file
    const contextPath = path.join(this.pmoDir, `.claude-context-${ticket.id}.md`);
    
    let contextContent = `# Ticket: ${ticket.id} - ${ticket.title}\n\n`;
    contextContent += `## Details\n`;
    contextContent += `- Queue: ${ticket.queue}\n`;
    contextContent += `- Priority: ${ticket.priority}\n`;
    contextContent += `- Status: ${ticket.status}\n`;
    if (assignee) {
      contextContent += `- Assignee: ${assignee}\n`;
    }
    contextContent += `\n## Description\n${ticket.description}\n\n`;
    
    // Add agent workspace info if assigned
    if (assignee) {
      const { getAllThemes } = await import('../themes/index.js');
      const themes = getAllThemes();
      const theme = themes[this.config.theme];
      
      if (theme) {
        const agentPath = path.join(
          this.hqRoot,
          '.proletariat',
          'agents',
          theme.directory,
          assignee
        );
        
        contextContent += `## Agent Workspace\n`;
        contextContent += `Location: ${agentPath}\n\n`;
        
        const repos = this.config.agentAccess?.[assignee] || [];
        if (repos.length > 0) {
          contextContent += `## Available Repositories\n`;
          for (const repo of repos) {
            contextContent += `- ${repo}: ${path.join(agentPath, repo)}\n`;
          }
        }
      }
    }

    fs.writeFileSync(contextPath, contextContent);

    log.info(`Context file created: ${contextPath}`);
    
    try {
      // Try to open in Claude desktop app or VSCode
      if (process.platform === 'darwin') {
        execSync(`open "${contextPath}"`);
      } else if (process.platform === 'win32') {
        execSync(`start "${contextPath}"`);
      } else {
        execSync(`xdg-open "${contextPath}"`);
      }
      
      log.success('Opened context in default editor');
    } catch {
      log.info('Please open the context file manually to start working on the ticket');
    }
  }
}