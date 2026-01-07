// Git-based PMO workflow example
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

interface Ticket {
  id: string;
  title: string;
  status: 'backlog' | 'in-progress' | 'in-review' | 'done';
  priority: 'high' | 'medium' | 'low';
  queue: string;
  assignee?: string;
  description: string;
}

class GitPMO {
  constructor(private pmoPath: string) {}

  // Always start with git pull
  private syncFromRemote() {
    try {
      execSync('git pull origin main', { cwd: this.pmoPath, stdio: 'pipe' });
    } catch {
      console.warn('Git pull failed, continuing...');
    }
  }

  // Always end with git commit + push
  private syncToRemote(message: string) {
    try {
      execSync('git add .', { cwd: this.pmoPath, stdio: 'pipe' });
      execSync(`git commit -m "${message}"`, { cwd: this.pmoPath, stdio: 'pipe' });
      execSync('git push origin main', { cwd: this.pmoPath, stdio: 'pipe' });
    } catch {
      console.warn('Git push failed, changes saved locally');
    }
  }

  // Create ticket (agent-friendly)
  createTicket(ticket: Ticket): void {
    this.syncFromRemote();

    // 1. Create individual ticket file
    const ticketFile = path.join(this.pmoPath, 'tickets', `${ticket.id}-${slugify(ticket.title)}.md`);
    const ticketContent = `# ${ticket.id}: ${ticket.title}

**Status:** ${ticket.status}
**Priority:** ${ticket.priority}  
**Queue:** ${ticket.queue}
**Assignee:** ${ticket.assignee || 'unassigned'}

## Description
${ticket.description}

## Work Log
- Created: ${new Date().toISOString()}
`;
    fs.writeFileSync(ticketFile, ticketContent);

    // 2. Regenerate board.md from all tickets
    this.regenerateBoard();

    // 3. Commit and push
    this.syncToRemote(`Create ${ticket.id}: ${ticket.title}`);
  }

  // Parse Obsidian edits back to ticket files
  syncObsidianChanges(): void {
    this.syncFromRemote();

    const boardPath = path.join(this.pmoPath, 'board.md');
    const boardContent = fs.readFileSync(boardPath, 'utf-8');
    
    // Simple parsing: extract ticket moves
    const changes = this.parseKanbanChanges(boardContent);
    
    // Apply changes to individual ticket files
    for (const change of changes) {
      this.updateTicketFile(change.ticketId, { status: change.newStatus, assignee: change.assignee });
    }

    // Regenerate clean board
    this.regenerateBoard();

    this.syncToRemote('Sync Obsidian changes');
  }

  // Agent generates board.md (your strength!)
  private regenerateBoard(): void {
    const tickets = this.loadAllTickets();
    const boardContent = `# Project Kanban

## 📥 Backlog
${this.renderTicketsInColumn(tickets, 'backlog')}

## 🚀 In Progress
${this.renderTicketsInColumn(tickets, 'in-progress')}

## 👀 In Review
${this.renderTicketsInColumn(tickets, 'in-review')}

## ✅ Done
${this.renderTicketsInColumn(tickets, 'done')}

---
*Last updated: ${new Date().toISOString()}*
`;

    fs.writeFileSync(path.join(this.pmoPath, 'board.md'), boardContent);
  }

  private renderTicketsInColumn(tickets: Ticket[], status: string): string {
    return tickets
      .filter(t => t.status === status)
      .map(ticket => {
        const checkbox = ticket.status === 'done' ? '[x]' : '[ ]';
        const assignee = ticket.assignee ? `@${ticket.assignee}` : '@unassigned';
        return `- ${checkbox} **${ticket.id}** ${ticket.title} #${ticket.priority} +${ticket.queue} ${assignee}`;
      })
      .join('\n');
  }

  private loadAllTickets(): Ticket[] {
    const ticketsDir = path.join(this.pmoPath, 'tickets');
    const files = fs.readdirSync(ticketsDir).filter(f => f.endsWith('.md'));
    
    return files.map(file => {
      // Parse ticket metadata from file
      const content = fs.readFileSync(path.join(ticketsDir, file), 'utf-8');
      return this.parseTicketFile(content);
    });
  }

  private parseKanbanChanges(boardContent: string): Array<{ticketId: string, newStatus: string, assignee?: string}> {
    // Simple parsing logic for detecting moves
    const lines = boardContent.split('\n');
    const changes: Array<{ticketId: string, newStatus: string, assignee?: string}> = [];
    let currentStatus = 'backlog';

    for (const line of lines) {
      if (line.startsWith('## 📥 Backlog')) currentStatus = 'backlog';
      else if (line.startsWith('## 🚀 In Progress')) currentStatus = 'in-progress';
      else if (line.startsWith('## 👀 In Review')) currentStatus = 'in-review';
      else if (line.startsWith('## ✅ Done')) currentStatus = 'done';
      else if (line.match(/^- \[([ x])\]/)) {
        const ticketMatch = line.match(/\*\*(T\d+)\*\*/);
        const assigneeMatch = line.match(/@(\w+)/);
        
        if (ticketMatch) {
          changes.push({
            ticketId: ticketMatch[1],
            newStatus: currentStatus,
            assignee: assigneeMatch?.[1]
          });
        }
      }
    }

    return changes;
  }

  private parseTicketFile(_content: string): Ticket {
    // Parse markdown ticket file back to Ticket object
    // Implementation details...
    throw new Error('Not implemented');
  }

  private updateTicketFile(_ticketId: string, _updates: Partial<Ticket>): void {
    // Update specific ticket file
    // Implementation details...  
  }
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Usage
const pmo = new GitPMO('/path/to/pmo-repo');

// Agent operations
pmo.createTicket({
  id: 'T0001',
  title: 'Fix authentication bug',
  status: 'backlog',
  priority: 'high', 
  queue: 'bug',
  description: 'Users cannot login after recent update'
});

// Human Obsidian edits
pmo.syncObsidianChanges();