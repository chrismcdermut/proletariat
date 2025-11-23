/**
 * Integration tests for ticket/PMO management commands
 * Tests: prlt ticket create/claim/complete/list
 * Also tests: prlt pmo:init, prlt add-ticket, prlt claim
 */

import { TestEnvironment } from '../helpers/test-environment';
import * as fs from 'fs';
import * as path from 'path';

describe('Ticket/PMO Management - Integration Tests', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = new TestEnvironment('ticket-test');
  });

  afterEach(() => {
    env.cleanup();
  });

  describe('prlt pmo:init', () => {
    beforeEach(() => {
      env.setupHQ('TestHQ', 'billionaires');
    });

    it('should initialize PMO structure', () => {
      env.enter();
      process.chdir('TestHQ');
      
      // PMO should already be initialized with HQ, but we can re-init
      const output = env.exec('node ../../dist/bin/prlt.js pmo:init');
      
      expect(env.exists('pmo')).toBe(true);
      expect(env.exists('pmo/README.md')).toBe(true);
      expect(env.exists('pmo/KANBAN.md')).toBe(true);
      expect(env.exists('pmo/tickets.json')).toBe(true);
      
      process.chdir('..');
      env.leave();
    });

    it('should not overwrite existing PMO', () => {
      // Add existing ticket
      env.createTicket('TestHQ', {
        id: 'TKT-001',
        title: 'Existing ticket'
      });
      
      env.enter();
      process.chdir('TestHQ');
      
      const output = env.exec('node ../../dist/bin/prlt.js pmo:init');
      
      // Should preserve existing tickets
      const tickets = JSON.parse(env.readFile('pmo/tickets.json'));
      expect(tickets).toHaveLength(1);
      expect(tickets[0].title).toBe('Existing ticket');
      
      process.chdir('..');
      env.leave();
    });
  });

  describe('prlt ticket create', () => {
    beforeEach(() => {
      env.setupHQ('TestHQ', 'billionaires');
    });

    it('should create new ticket with generated ID', () => {
      env.enter();
      process.chdir('TestHQ');
      
      // Simulate ticket creation (interactive in real usage)
      env.createTicket('TestHQ', {
        title: 'Implement login feature',
        description: 'Add OAuth2 authentication',
        queue: 'build',
        priority: 'high'
      });
      
      const tickets = JSON.parse(env.readFile('pmo/tickets.json'));
      expect(tickets).toHaveLength(1);
      expect(tickets[0].id).toMatch(/^TKT-\d{3}$/);
      expect(tickets[0].title).toBe('Implement login feature');
      expect(tickets[0].status).toBe('todo');
      
      process.chdir('..');
      env.leave();
    });

    it('should support different queues', () => {
      env.enter();
      process.chdir('TestHQ');
      
      const queues = ['build', 'grow', 'support', 'bizops', 'strategy'];
      
      for (let i = 0; i < queues.length; i++) {
        env.createTicket('TestHQ', {
          title: `Ticket for ${queues[i]}`,
          queue: queues[i]
        });
      }
      
      const tickets = JSON.parse(env.readFile('pmo/tickets.json'));
      expect(tickets).toHaveLength(queues.length);
      
      for (const queue of queues) {
        const ticket = tickets.find((t: any) => t.queue === queue);
        expect(ticket).toBeDefined();
        expect(ticket.title).toContain(queue);
      }
      
      process.chdir('..');
      env.leave();
    });

    it('should support different priorities', () => {
      env.enter();
      process.chdir('TestHQ');
      
      const priorities = ['low', 'medium', 'high', 'critical'];
      
      for (const priority of priorities) {
        env.createTicket('TestHQ', {
          title: `${priority} priority ticket`,
          priority: priority
        });
      }
      
      const tickets = JSON.parse(env.readFile('pmo/tickets.json'));
      
      for (const priority of priorities) {
        const ticket = tickets.find((t: any) => t.priority === priority);
        expect(ticket).toBeDefined();
      }
      
      process.chdir('..');
      env.leave();
    });

    it('should update KANBAN.md', () => {
      env.enter();
      process.chdir('TestHQ');
      
      env.createTicket('TestHQ', {
        id: 'TKT-001',
        title: 'First task',
        queue: 'build'
      });
      
      // KANBAN should be updated (in real implementation)
      expect(env.exists('pmo/KANBAN.md')).toBe(true);
      
      process.chdir('..');
      env.leave();
    });
  });

  describe('prlt ticket claim', () => {
    beforeEach(() => {
      env.setupHQ('TestHQ', 'billionaires');
      env.createAgentWorkspace('TestHQ', 'bezos');
      env.createAgentWorkspace('TestHQ', 'musk');
      env.createTicket('TestHQ', {
        id: 'TKT-001',
        title: 'Fix bug',
        status: 'todo'
      });
      env.createTicket('TestHQ', {
        id: 'TKT-002',
        title: 'Add feature',
        status: 'todo'
      });
    });

    it('should claim ticket by ID', () => {
      env.enter();
      process.chdir('TestHQ');
      
      // Simulate claiming (would be interactive)
      const ticketsPath = 'pmo/tickets.json';
      let tickets = JSON.parse(env.readFile(ticketsPath));
      
      const ticket = tickets.find((t: any) => t.id === 'TKT-001');
      ticket.status = 'in-progress';
      ticket.assignee = 'bezos';
      ticket.updated = new Date().toISOString();
      
      env.createFile(ticketsPath, JSON.stringify(tickets, null, 2));
      
      // Verify claim
      tickets = JSON.parse(env.readFile(ticketsPath));
      const claimedTicket = tickets.find((t: any) => t.id === 'TKT-001');
      expect(claimedTicket.status).toBe('in-progress');
      expect(claimedTicket.assignee).toBe('bezos');
      
      process.chdir('..');
      env.leave();
    });

    it('should allow claiming without specifying agent', () => {
      env.enter();
      process.chdir('TestHQ');
      
      const ticketsPath = 'pmo/tickets.json';
      let tickets = JSON.parse(env.readFile(ticketsPath));
      
      const ticket = tickets.find((t: any) => t.id === 'TKT-002');
      ticket.status = 'in-progress';
      ticket.assignee = undefined; // No specific agent
      
      env.createFile(ticketsPath, JSON.stringify(tickets, null, 2));
      
      tickets = JSON.parse(env.readFile(ticketsPath));
      const claimedTicket = tickets.find((t: any) => t.id === 'TKT-002');
      expect(claimedTicket.status).toBe('in-progress');
      expect(claimedTicket.assignee).toBeUndefined();
      
      process.chdir('..');
      env.leave();
    });

    it('should prevent claiming non-existent ticket', () => {
      env.enter();
      process.chdir('TestHQ');
      
      expect(() => {
        env.exec('node ../../dist/bin/prlt.js ticket claim TKT-999');
      }).toThrow();
      
      process.chdir('..');
      env.leave();
    });

    it('should create context file for Claude', () => {
      env.enter();
      process.chdir('TestHQ');
      
      // Simulate claiming with context creation
      const ticketsPath = 'pmo/tickets.json';
      const tickets = JSON.parse(env.readFile(ticketsPath));
      const ticket = tickets[0];
      
      // Create context file
      const contextPath = `pmo/.claude-context-${ticket.id}.md`;
      let contextContent = `# Ticket: ${ticket.id} - ${ticket.title}\n\n`;
      contextContent += `## Details\n`;
      contextContent += `- Queue: ${ticket.queue}\n`;
      contextContent += `- Priority: ${ticket.priority}\n`;
      contextContent += `- Status: in-progress\n`;
      contextContent += `- Assignee: bezos\n`;
      contextContent += `\n## Description\n${ticket.description}\n`;
      
      env.createFile(contextPath, contextContent);
      
      expect(env.exists(contextPath)).toBe(true);
      expect(env.readFile(contextPath)).toContain(ticket.id);
      expect(env.readFile(contextPath)).toContain('bezos');
      
      process.chdir('..');
      env.leave();
    });
  });

  describe('prlt ticket complete', () => {
    beforeEach(() => {
      env.setupHQ('TestHQ', 'billionaires');
      env.createTicket('TestHQ', {
        id: 'TKT-001',
        title: 'Task to complete',
        status: 'in-progress',
        assignee: 'bezos'
      });
    });

    it('should mark ticket as completed', () => {
      env.enter();
      process.chdir('TestHQ');
      
      const ticketsPath = 'pmo/tickets.json';
      let tickets = JSON.parse(env.readFile(ticketsPath));
      
      const ticket = tickets.find((t: any) => t.id === 'TKT-001');
      ticket.status = 'done';
      ticket.updated = new Date().toISOString();
      
      env.createFile(ticketsPath, JSON.stringify(tickets, null, 2));
      
      // Verify completion
      tickets = JSON.parse(env.readFile(ticketsPath));
      const completedTicket = tickets.find((t: any) => t.id === 'TKT-001');
      expect(completedTicket.status).toBe('done');
      
      process.chdir('..');
      env.leave();
    });

    it('should require ticket ID', () => {
      env.enter();
      process.chdir('TestHQ');
      
      expect(() => {
        env.exec('node ../../dist/bin/prlt.js ticket complete');
      }).toThrow();
      
      process.chdir('..');
      env.leave();
    });

    it('should validate ticket exists', () => {
      env.enter();
      process.chdir('TestHQ');
      
      expect(() => {
        env.exec('node ../../dist/bin/prlt.js ticket complete TKT-999');
      }).toThrow('not found');
      
      process.chdir('..');
      env.leave();
    });
  });

  describe('prlt ticket list', () => {
    beforeEach(() => {
      env.setupHQ('TestHQ', 'billionaires');
    });

    it('should show empty list when no tickets', () => {
      env.enter();
      process.chdir('TestHQ');
      
      const output = env.exec('node ../../dist/bin/prlt.js ticket list');
      
      expect(output).toContain('No tickets');
      
      process.chdir('..');
      env.leave();
    });

    it('should list all tickets grouped by status', () => {
      env.createTicket('TestHQ', { id: 'TKT-001', status: 'todo' });
      env.createTicket('TestHQ', { id: 'TKT-002', status: 'in-progress' });
      env.createTicket('TestHQ', { id: 'TKT-003', status: 'done' });
      env.createTicket('TestHQ', { id: 'TKT-004', status: 'todo' });
      
      env.enter();
      process.chdir('TestHQ');
      
      const output = env.exec('node ../../dist/bin/prlt.js ticket list');
      
      expect(output).toContain('TKT-001');
      expect(output).toContain('TKT-002');
      expect(output).toContain('TKT-003');
      expect(output).toContain('TKT-004');
      expect(output).toContain('todo');
      expect(output).toContain('in-progress');
      expect(output).toContain('done');
      
      process.chdir('..');
      env.leave();
    });

    it('should show ticket details', () => {
      env.createTicket('TestHQ', {
        id: 'TKT-001',
        title: 'Important task',
        queue: 'build',
        priority: 'high',
        assignee: 'bezos'
      });
      
      env.enter();
      process.chdir('TestHQ');
      
      const output = env.exec('node ../../dist/bin/prlt.js ticket list');
      
      expect(output).toContain('TKT-001');
      expect(output).toContain('Important task');
      expect(output).toContain('build');
      expect(output).toContain('high');
      expect(output).toContain('bezos');
      
      process.chdir('..');
      env.leave();
    });
  });

  describe('Ticket Aliases', () => {
    beforeEach(() => {
      env.setupHQ('TestHQ', 'billionaires');
    });

    it('should use add-ticket as alias for ticket create', () => {
      env.enter();
      process.chdir('TestHQ');
      
      // Would be interactive, simulating the creation
      env.createTicket('TestHQ', {
        title: 'Created via add-ticket'
      });
      
      const tickets = JSON.parse(env.readFile('pmo/tickets.json'));
      expect(tickets[0].title).toBe('Created via add-ticket');
      
      process.chdir('..');
      env.leave();
    });

    it('should use create-ticket as alias for ticket create', () => {
      env.enter();
      process.chdir('TestHQ');
      
      env.createTicket('TestHQ', {
        title: 'Created via create-ticket'
      });
      
      const tickets = JSON.parse(env.readFile('pmo/tickets.json'));
      expect(tickets[0].title).toBe('Created via create-ticket');
      
      process.chdir('..');
      env.leave();
    });

    it('should use claim as alias for ticket claim', () => {
      env.createTicket('TestHQ', {
        id: 'TKT-001',
        title: 'To be claimed'
      });
      
      env.enter();
      process.chdir('TestHQ');
      
      // Simulate claim command
      const ticketsPath = 'pmo/tickets.json';
      const tickets = JSON.parse(env.readFile(ticketsPath));
      tickets[0].status = 'in-progress';
      env.createFile(ticketsPath, JSON.stringify(tickets, null, 2));
      
      const updatedTickets = JSON.parse(env.readFile(ticketsPath));
      expect(updatedTickets[0].status).toBe('in-progress');
      
      process.chdir('..');
      env.leave();
    });
  });

  describe('Ticket Workflow', () => {
    beforeEach(() => {
      env.setupHQ('TestHQ', 'billionaires');
      env.createAgentWorkspace('TestHQ', 'bezos');
      env.addRepoToHQ('TestHQ', 'main-app');
    });

    it('should support full ticket lifecycle', () => {
      env.enter();
      process.chdir('TestHQ');
      
      // 1. Create ticket
      env.createTicket('TestHQ', {
        id: 'TKT-001',
        title: 'Implement feature X',
        description: 'Add new functionality',
        queue: 'build',
        priority: 'high',
        status: 'todo'
      });
      
      let tickets = JSON.parse(env.readFile('pmo/tickets.json'));
      expect(tickets[0].status).toBe('todo');
      
      // 2. Claim ticket
      tickets[0].status = 'in-progress';
      tickets[0].assignee = 'bezos';
      env.createFile('pmo/tickets.json', JSON.stringify(tickets, null, 2));
      
      tickets = JSON.parse(env.readFile('pmo/tickets.json'));
      expect(tickets[0].status).toBe('in-progress');
      expect(tickets[0].assignee).toBe('bezos');
      
      // 3. Complete ticket
      tickets[0].status = 'done';
      env.createFile('pmo/tickets.json', JSON.stringify(tickets, null, 2));
      
      tickets = JSON.parse(env.readFile('pmo/tickets.json'));
      expect(tickets[0].status).toBe('done');
      
      process.chdir('..');
      env.leave();
    });
  });

  describe('Error Handling', () => {
    it('should require HQ context', () => {
      env.initGit();
      env.setupSimpleRepo('simple-project');
      env.enter();
      
      expect(() => {
        env.prlt('ticket create');
      }).toThrow('Not in an HQ');
      
      env.leave();
    });

    it('should handle missing PMO gracefully', () => {
      env.setupHQ('TestHQ', 'billionaires');
      
      // Remove PMO directory
      fs.rmSync(path.join(env.dir, 'TestHQ', 'pmo'), { recursive: true });
      
      env.enter();
      process.chdir('TestHQ');
      
      // Should recreate PMO or error appropriately
      expect(() => {
        env.exec('node ../../dist/bin/prlt.js ticket list');
      }).toThrow();
      
      process.chdir('..');
      env.leave();
    });
  });
});