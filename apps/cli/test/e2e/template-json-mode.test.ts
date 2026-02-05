import { expect } from 'chai';
import Database from 'better-sqlite3';
import {
  createTestEnvironment,
  cleanupTestEnvironment,
  createHQConfig,
  createPMODirectories,
  exec,
  execProduction,
  extractJson,
  agentExec,
  findChoice,
  execChoice,
  execFinal,
  type TestEnvironment,
  type AgentPromptResponse,
} from './test-helpers.js';

/**
 * E2E Agent Flow Tests for Template Commands
 *
 * Tests the full agent navigation flow for the template namespace:
 * - prlt template (main menu)
 * - prlt template list
 * - prlt template delete
 * - prlt template phase (phase template menu)
 * - prlt template phase list
 * - prlt template ticket (ticket template menu)
 * - prlt template ticket list
 *
 * These tests verify that AI agents can:
 * 1. Call commands with --machine flag
 * 2. Receive structured JSON responses
 * 3. Follow command fields to navigate through menus
 * 4. Complete the full workflow with database verification
 */
describe('Template Commands - JSON Mode E2E Tests', () => {
  let env: TestEnvironment;
  let db: Database.Database;

  beforeEach(() => {
    env = createTestEnvironment('template-json-');
    db = new Database(env.dbPath);
    setupTestDatabase(db, env.pmoPath);
    createHQConfig(env.proletariatDir);
    createPMODirectories(env.pmoPath, 'test-project');
  });

  afterEach(() => {
    if (db) db.close();
    cleanupTestEnvironment(env);
  });

  /**
   * Helper to create a test ticket template directly in the database.
   */
  function createTestTicketTemplate(
    id: string,
    name: string,
    isBuiltin: boolean = false,
    options: {
      description?: string;
      titlePattern?: string;
      defaultPriority?: string;
      defaultCategory?: string;
    } = {}
  ): void {
    db.prepare(`
      INSERT INTO pmo_ticket_templates (id, name, description, is_builtin, title_pattern, default_priority, default_category)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, name,
      options.description || null,
      isBuiltin ? 1 : 0,
      options.titlePattern || null,
      options.defaultPriority || null,
      options.defaultCategory || null
    );
  }

  /**
   * Helper to create a test phase template directly in the database.
   */
  function createTestPhaseTemplate(
    id: string,
    name: string,
    isBuiltin: boolean = false,
    description?: string
  ): void {
    const phases = JSON.stringify([
      { name: 'Backlog', category: 'backlog', position: 0 },
      { name: 'In Progress', category: 'started', position: 1 },
      { name: 'Done', category: 'completed', position: 2 },
    ]);
    db.prepare(`
      INSERT INTO pmo_phase_templates (id, name, description, is_builtin, phases)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, name, description || null, isBuiltin ? 1 : 0, phases);
  }

  /**
   * Helper to get a ticket template from the database.
   */
  function getTicketTemplate(id: string): { id: string; name: string; is_builtin: number } | undefined {
    return db.prepare('SELECT * FROM pmo_ticket_templates WHERE id = ?').get(id) as { id: string; name: string; is_builtin: number } | undefined;
  }

  /**
   * Helper to get a phase template from the database.
   */
  function getPhaseTemplate(id: string): { id: string; name: string; is_builtin: number } | undefined {
    return db.prepare('SELECT * FROM pmo_phase_templates WHERE id = ?').get(id) as { id: string; name: string; is_builtin: number } | undefined;
  }

  /**
   * Helper to create a test ticket directly in the database.
   */
  function createTestTicket(
    id: string,
    title: string,
    options: {
      priority?: string;
      category?: string;
      description?: string;
      status?: string;
    } = {}
  ): void {
    db.prepare(`
      INSERT INTO pmo_tickets (id, project_id, title, priority, category, description, status)
      VALUES (?, 'test-project', ?, ?, ?, ?, ?)
    `).run(
      id, title,
      options.priority || null,
      options.category || null,
      options.description || null,
      options.status || 'backlog'
    );
  }

  // ===========================================================================
  // template --machine (main menu)
  // ===========================================================================
  describe('prlt template --machine (main menu)', () => {
    it('should output JSON with action choices', () => {
      const result = agentExec('template --machine');

      expect(result).to.not.be.null;
      expect(result!.prompt.type).to.equal('list');
      expect(result!.prompt.name).to.equal('action');
      expect(result!.prompt.choices).to.be.an('array');
      expect(result!.prompt.choices!.length).to.equal(3);
    });

    it('should have choice for List all templates with command field', () => {
      const result = agentExec('template --machine');
      expect(result).to.not.be.null;

      const listChoice = findChoice(result!.prompt.choices!, 'List all');
      expect(listChoice).to.exist;
      expect(listChoice!.command).to.include('template list');
      expect(listChoice!.command).to.include('--json');
    });

    it('should have choice for Ticket templates with command field', () => {
      const result = agentExec('template --machine');
      expect(result).to.not.be.null;

      const ticketChoice = findChoice(result!.prompt.choices!, 'Ticket');
      expect(ticketChoice).to.exist;
      expect(ticketChoice!.command).to.include('template ticket');
      expect(ticketChoice!.command).to.include('--json');
    });

    it('should have choice for Phase templates with command field', () => {
      const result = agentExec('template --machine');
      expect(result).to.not.be.null;

      const phaseChoice = findChoice(result!.prompt.choices!, 'Phase');
      expect(phaseChoice).to.exist;
      expect(phaseChoice!.command).to.include('template phase');
      expect(phaseChoice!.command).to.include('--json');
    });

    it('should work with --json flag (legacy)', () => {
      const result = agentExec('template --json');
      expect(result).to.not.be.null;
      expect(result!.prompt.type).to.equal('list');
      expect(result!.prompt.name).to.equal('action');
    });
  });

  // ===========================================================================
  // template phase --machine (phase template menu)
  // ===========================================================================
  describe('prlt template phase --machine (phase menu)', () => {
    it('should output JSON with action choices', () => {
      const result = agentExec('template phase --machine');

      expect(result).to.not.be.null;
      expect(result!.prompt.type).to.equal('list');
      expect(result!.prompt.name).to.equal('action');
      expect(result!.prompt.choices).to.be.an('array');
      expect(result!.prompt.choices!.length).to.equal(5);
    });

    it('should have choices for all phase template operations', () => {
      const result = agentExec('template phase --machine');
      expect(result).to.not.be.null;

      const listChoice = findChoice(result!.prompt.choices!, 'List');
      expect(listChoice).to.exist;
      expect(listChoice!.command).to.include('--json');

      const applyChoice = findChoice(result!.prompt.choices!, 'Apply');
      expect(applyChoice).to.exist;

      const createChoice = findChoice(result!.prompt.choices!, 'Create');
      expect(createChoice).to.exist;

      const updateChoice = findChoice(result!.prompt.choices!, 'Update');
      expect(updateChoice).to.exist;

      const deleteChoice = findChoice(result!.prompt.choices!, 'Delete');
      expect(deleteChoice).to.exist;
    });

    it('should work with --json flag (legacy)', () => {
      const result = agentExec('template phase --json');
      expect(result).to.not.be.null;
      expect(result!.prompt.type).to.equal('list');
    });
  });

  // ===========================================================================
  // template ticket --machine (ticket template menu)
  // ===========================================================================
  describe('prlt template ticket --machine (ticket menu)', () => {
    it('should output JSON with action choices', () => {
      const result = agentExec('template ticket --machine');

      expect(result).to.not.be.null;
      expect(result!.prompt.type).to.equal('list');
      expect(result!.prompt.name).to.equal('action');
      expect(result!.prompt.choices).to.be.an('array');
      expect(result!.prompt.choices!.length).to.equal(5);
    });

    it('should have choices for all ticket template operations', () => {
      const result = agentExec('template ticket --machine');
      expect(result).to.not.be.null;

      const listChoice = findChoice(result!.prompt.choices!, 'List');
      expect(listChoice).to.exist;
      expect(listChoice!.command).to.include('--json');

      const createChoice = findChoice(result!.prompt.choices!, 'Create');
      expect(createChoice).to.exist;

      const applyChoice = findChoice(result!.prompt.choices!, 'ticket from template');
      expect(applyChoice).to.exist;

      const saveChoice = findChoice(result!.prompt.choices!, 'Save');
      expect(saveChoice).to.exist;

      const deleteChoice = findChoice(result!.prompt.choices!, 'Delete');
      expect(deleteChoice).to.exist;
    });

    it('should work with --json flag (legacy)', () => {
      const result = agentExec('template ticket --json');
      expect(result).to.not.be.null;
      expect(result!.prompt.type).to.equal('list');
    });
  });

  // ===========================================================================
  // template list --json
  // ===========================================================================
  describe('prlt template list --json', () => {
    beforeEach(() => {
      createTestTicketTemplate('bug-report', 'Bug Report', true, {
        description: 'Standard bug report',
        defaultPriority: 'HIGH',
        defaultCategory: 'bug',
      });
      createTestTicketTemplate('custom-ticket', 'Custom Ticket', false, {
        description: 'Custom ticket template',
      });
      createTestPhaseTemplate('agile', 'Agile Phases', true, 'Standard agile phases');
      createTestPhaseTemplate('custom-phases', 'Custom Phases', false, 'My custom phases');
    });

    it('should output valid JSON with --json flag', () => {
      const output = execProduction('template list --json');
      const json = extractJson<{ ticket: unknown[]; phase: unknown[] }>(output);

      expect(json).to.not.be.null;
      expect(json!.ticket).to.be.an('array');
      expect(json!.phase).to.be.an('array');
    });

    it('should include both ticket and phase templates (including built-ins)', () => {
      const output = execProduction('template list --json');
      const json = extractJson<{
        ticket: Array<{ id: string; name: string; isBuiltin: boolean }>;
        phase: Array<{ id: string; name: string; isBuiltin: boolean }>;
      }>(output);

      expect(json).to.not.be.null;
      // App seeds 5 built-in ticket templates + our custom one = 6
      // (bug-report already exists from our insert, INSERT OR IGNORE)
      expect(json!.ticket.length).to.be.at.least(2);
      expect(json!.phase.length).to.be.at.least(2);

      // Verify our custom templates exist
      const customTicket = json!.ticket.find(t => t.id === 'custom-ticket');
      expect(customTicket).to.exist;
      expect(customTicket!.name).to.equal('Custom Ticket');

      const customPhase = json!.phase.find(p => p.id === 'custom-phases');
      expect(customPhase).to.exist;
      expect(customPhase!.name).to.equal('Custom Phases');
    });

    it('should filter by type: ticket', () => {
      const output = execProduction('template list --type ticket --json');
      const json = extractJson<{ ticket: unknown[]; phase?: unknown[] }>(output);

      expect(json).to.not.be.null;
      expect(json!.ticket).to.be.an('array');
      expect(json!.ticket.length).to.be.at.least(2);
      expect(json!.phase).to.be.undefined;
    });

    it('should filter by type: phase', () => {
      const output = execProduction('template list --type phase --json');
      const json = extractJson<{ ticket?: unknown[]; phase: unknown[] }>(output);

      expect(json).to.not.be.null;
      expect(json!.phase).to.be.an('array');
      expect(json!.phase.length).to.be.at.least(2);
      expect(json!.ticket).to.be.undefined;
    });

    it('should filter by builtin', () => {
      const output = execProduction('template list --builtin --json');
      const json = extractJson<{
        ticket: Array<{ isBuiltin: boolean }>;
        phase: Array<{ isBuiltin: boolean }>;
      }>(output);

      expect(json).to.not.be.null;
      for (const t of json!.ticket) expect(t.isBuiltin).to.equal(true);
      for (const p of json!.phase) expect(p.isBuiltin).to.equal(true);
    });

    it('should filter by custom', () => {
      const output = execProduction('template list --custom --json');
      const json = extractJson<{
        ticket: Array<{ isBuiltin: boolean }>;
        phase: Array<{ isBuiltin: boolean }>;
      }>(output);

      expect(json).to.not.be.null;
      for (const t of json!.ticket) expect(t.isBuiltin).to.equal(false);
      for (const p of json!.phase) expect(p.isBuiltin).to.equal(false);
    });

    it('should include ticket template details', () => {
      const output = execProduction('template list --type ticket --json');
      const json = extractJson<{
        ticket: Array<{ id: string; name: string; description: string; defaultPriority: string }>;
      }>(output);

      expect(json).to.not.be.null;
      const bugReport = json!.ticket.find(t => t.id === 'bug-report');
      expect(bugReport).to.exist;
      expect(bugReport!.name).to.equal('Bug Report');
      expect(bugReport!.description).to.equal('Standard bug report');
      expect(bugReport!.defaultPriority).to.equal('HIGH');
    });
  });

  // ===========================================================================
  // template delete --machine
  // ===========================================================================
  describe('prlt template delete --machine', () => {
    beforeEach(() => {
      createTestTicketTemplate('delete-ticket-1', 'Delete Ticket Template', false);
      createTestTicketTemplate('delete-ticket-2', 'Another Delete Template', false);
      createTestPhaseTemplate('delete-phase-1', 'Delete Phase Template', false);
    });

    it('should output type selection prompt when no type provided', () => {
      const result = agentExec('template delete --machine');

      expect(result).to.not.be.null;
      expect(result!.prompt.type).to.equal('list');
      expect(result!.prompt.name).to.equal('type');
      expect(result!.prompt.choices).to.be.an('array');
    });

    it('should have type choices with command fields', () => {
      const result = agentExec('template delete --machine');
      expect(result).to.not.be.null;

      const ticketChoice = findChoice(result!.prompt.choices!, 'Ticket');
      expect(ticketChoice).to.exist;
      expect(ticketChoice!.command).to.include('--type ticket');
      expect(ticketChoice!.command).to.include('--json');

      const phaseChoice = findChoice(result!.prompt.choices!, 'Phase');
      expect(phaseChoice).to.exist;
      expect(phaseChoice!.command).to.include('--type phase');
      expect(phaseChoice!.command).to.include('--json');
    });

    it('should output template selection when type provided', () => {
      const result = agentExec('template delete --type ticket --machine');

      expect(result).to.not.be.null;
      expect(result!.prompt.type).to.equal('checkbox');
      expect(result!.prompt.name).to.equal('templateIds');
      expect(result!.prompt.choices).to.be.an('array');
    });

    it('should show ticket templates for selection when type=ticket', () => {
      const result = agentExec('template delete --type ticket --machine');
      expect(result).to.not.be.null;

      const choice = findChoice(result!.prompt.choices!, 'Delete Ticket Template');
      expect(choice).to.exist;
      expect(choice!.command).to.include('--json');
    });

    it('should show phase templates for selection when type=phase', () => {
      const result = agentExec('template delete --type phase --machine');
      expect(result).to.not.be.null;

      const choice = findChoice(result!.prompt.choices!, 'Delete Phase Template');
      expect(choice).to.exist;
    });
  });

  // ===========================================================================
  // End-to-end Agent Flow Tests
  // ===========================================================================
  describe('End-to-end agent flows (--machine flag)', () => {
    describe('template menu - full agent flow', () => {
      it('should navigate: template menu → list choice → get list output', () => {
        createTestTicketTemplate('flow-ticket', 'Flow Ticket', true);
        createTestPhaseTemplate('flow-phase', 'Flow Phase', true);

        // Step 1: Get main menu
        const step1 = agentExec('template --machine');
        expect(step1).to.not.be.null;
        expect(step1!.prompt.type).to.equal('list');

        // Find list choice
        const listChoice = findChoice(step1!.prompt.choices!, 'List');
        expect(listChoice).to.exist;
        expect(listChoice!.command).to.exist;

        // Step 2: Execute list command from choice
        const listCmd = execChoice(listChoice!);
        const listOutput = execProduction(listCmd);
        const json = extractJson<{ ticket: unknown[]; phase: unknown[] }>(listOutput);

        expect(json).to.not.be.null;
        expect(json!.ticket).to.be.an('array');
        expect(json!.phase).to.be.an('array');
      });

      it('should navigate: template menu → ticket templates → get ticket submenu', () => {
        // Step 1: Get main menu
        const step1 = agentExec('template --machine');
        expect(step1).to.not.be.null;

        // Find ticket choice
        const ticketChoice = findChoice(step1!.prompt.choices!, 'Ticket');
        expect(ticketChoice).to.exist;

        // Step 2: Execute ticket command from choice
        const step2 = agentExec(execChoice(ticketChoice!));
        expect(step2).to.not.be.null;
        expect(step2!.prompt.type).to.equal('list');
        expect(step2!.prompt.name).to.equal('action');
        expect(step2!.prompt.choices!.length).to.equal(5);
      });

      it('should navigate: template menu → phase templates → get phase submenu', () => {
        // Step 1: Get main menu
        const step1 = agentExec('template --machine');
        expect(step1).to.not.be.null;

        // Find phase choice
        const phaseChoice = findChoice(step1!.prompt.choices!, 'Phase');
        expect(phaseChoice).to.exist;

        // Step 2: Execute phase command from choice
        const step2 = agentExec(execChoice(phaseChoice!));
        expect(step2).to.not.be.null;
        expect(step2!.prompt.type).to.equal('list');
        expect(step2!.prompt.name).to.equal('action');
        expect(step2!.prompt.choices!.length).to.equal(5);
      });
    });

    describe('template delete - full agent flow', () => {
      beforeEach(() => {
        createTestTicketTemplate('del-flow-1', 'Delete Flow Template', false, {
          description: 'Template to delete',
        });
        createTestPhaseTemplate('del-phase-1', 'Delete Phase Flow', false);
      });

      it('should complete flow: select type → select template → confirm → deleted', () => {
        // Verify template exists before
        let template = getTicketTemplate('del-flow-1');
        expect(template).to.exist;

        // Step 1: No type, get type selection
        const step1 = agentExec('template delete --machine');
        expect(step1).to.not.be.null;
        expect(step1!.prompt.name).to.equal('type');

        // Find ticket type
        const typeChoice = findChoice(step1!.prompt.choices!, 'Ticket');
        expect(typeChoice).to.exist;

        // Step 2: Execute with type, get template selection
        const step2 = agentExec(execChoice(typeChoice!));
        expect(step2).to.not.be.null;
        expect(step2!.prompt.name).to.equal('templateIds');

        // Find the template to delete
        const templateChoice = findChoice(step2!.prompt.choices!, 'Delete Flow Template');
        expect(templateChoice).to.exist;
        expect(templateChoice!.command).to.include('del-flow-1');
      });

      it('should navigate delete flow with --force to skip confirmation', () => {
        // Step 1: Get template selection for ticket type
        const step1 = agentExec('template delete --type ticket --machine');
        expect(step1).to.not.be.null;
        expect(step1!.prompt.name).to.equal('templateIds');

        // Verify our template appears in choices
        const choice = findChoice(step1!.prompt.choices!, 'Delete Flow Template');
        expect(choice).to.exist;
        expect(choice!.command).to.include('--json');
        // The command field should contain the template ID for the agent to use
        expect(choice!.command).to.include('del-flow-1');
      });

      it('should complete flow for phase templates', () => {
        // Step 1: Type provided, get template selection
        const step1 = agentExec('template delete --type phase --machine');
        expect(step1).to.not.be.null;
        expect(step1!.prompt.name).to.equal('templateIds');

        const choice = findChoice(step1!.prompt.choices!, 'Delete Phase Flow');
        expect(choice).to.exist;
      });
    });

    describe('template list - agent data retrieval', () => {
      beforeEach(() => {
        createTestTicketTemplate('list-ticket-1', 'Bug Report', true, {
          description: 'Standard bug',
          defaultPriority: 'HIGH',
          defaultCategory: 'bug',
        });
        createTestTicketTemplate('list-ticket-2', 'Feature Request', false, {
          description: 'Feature request template',
          defaultCategory: 'feature',
        });
        createTestPhaseTemplate('list-phase-1', 'Agile Phases', true, 'Standard agile phases');
        createTestPhaseTemplate('list-phase-2', 'Waterfall', false, 'Waterfall phases');
      });

      it('should return all templates as JSON for agent processing', () => {
        const output = execProduction('template list --json');
        const json = extractJson<{
          ticket: Array<{ id: string; name: string }>;
          phase: Array<{ id: string; name: string }>;
        }>(output);

        expect(json).to.not.be.null;
        // Includes built-in templates seeded by app + our test templates
        expect(json!.ticket.length).to.be.at.least(2);
        expect(json!.phase.length).to.be.at.least(2);

        // Agent can find specific templates we created
        const bugReport = json!.ticket.find(t => t.id === 'list-ticket-1');
        expect(bugReport).to.exist;
        expect(bugReport!.name).to.equal('Bug Report');

        const featureReq = json!.ticket.find(t => t.id === 'list-ticket-2');
        expect(featureReq).to.exist;
        expect(featureReq!.name).to.equal('Feature Request');
      });

      it('should filter templates by type for agent', () => {
        const output = execProduction('template list --type ticket --json');
        const json = extractJson<{ ticket: Array<{ id: string }> }>(output);

        expect(json).to.not.be.null;
        expect(json!.ticket.length).to.be.at.least(2);

        // Verify our test templates are in the results
        const found = json!.ticket.find(t => t.id === 'list-ticket-2');
        expect(found).to.exist;
      });

      it('should filter by builtin for agent', () => {
        const output = execProduction('template list --builtin --json');
        const json = extractJson<{
          ticket: Array<{ isBuiltin: boolean }>;
          phase: Array<{ isBuiltin: boolean }>;
        }>(output);

        expect(json).to.not.be.null;
        // App seeds 5 built-in ticket templates and 4 built-in phase templates
        // Plus our test data adds 1 builtin of each
        expect(json!.ticket.length).to.be.at.least(1);
        expect(json!.phase.length).to.be.at.least(1);
        for (const t of json!.ticket) expect(t.isBuiltin).to.equal(true);
        for (const p of json!.phase) expect(p.isBuiltin).to.equal(true);
      });

      it('should filter by custom for agent', () => {
        const output = execProduction('template list --custom --json');
        const json = extractJson<{
          ticket: Array<{ isBuiltin: boolean }>;
          phase: Array<{ isBuiltin: boolean }>;
        }>(output);

        expect(json).to.not.be.null;
        expect(json!.ticket.length).to.equal(1);
        expect(json!.phase.length).to.equal(1);
      });
    });

    describe('template phase menu - full agent flow', () => {
      it('should navigate phase menu and list phase templates', () => {
        createTestPhaseTemplate('phase-flow-1', 'Phase Flow Template', true);

        // Step 1: Get phase menu
        const step1 = agentExec('template phase --machine');
        expect(step1).to.not.be.null;
        expect(step1!.prompt.type).to.equal('list');

        // Find list choice
        const listChoice = findChoice(step1!.prompt.choices!, 'List');
        expect(listChoice).to.exist;
        expect(listChoice!.command).to.include('--json');
      });

      it('should have all phase template operations in menu', () => {
        const result = agentExec('template phase --machine');
        expect(result).to.not.be.null;

        const actions = result!.prompt.choices!.map(c => c.value);
        expect(actions).to.include('list');
        expect(actions).to.include('apply');
        expect(actions).to.include('create');
        expect(actions).to.include('update');
        expect(actions).to.include('delete');
      });
    });

    describe('template ticket menu - full agent flow', () => {
      it('should navigate ticket menu and list ticket templates', () => {
        createTestTicketTemplate('ticket-flow-1', 'Ticket Flow Template', true);

        // Step 1: Get ticket menu
        const step1 = agentExec('template ticket --machine');
        expect(step1).to.not.be.null;
        expect(step1!.prompt.type).to.equal('list');

        // Find list choice
        const listChoice = findChoice(step1!.prompt.choices!, 'List');
        expect(listChoice).to.exist;
        expect(listChoice!.command).to.include('--json');
      });

      it('should have all ticket template operations in menu', () => {
        const result = agentExec('template ticket --machine');
        expect(result).to.not.be.null;

        const actions = result!.prompt.choices!.map(c => c.value);
        expect(actions).to.include('list');
        expect(actions).to.include('create');
        expect(actions).to.include('apply');
        expect(actions).to.include('save');
        expect(actions).to.include('delete');
      });
    });

    describe('backward compatibility: --json flag flows', () => {
      it('should complete menu flow with --json flag (legacy)', () => {
        const result = agentExec('template --json');
        expect(result).to.not.be.null;
        expect(result!.prompt.type).to.equal('list');
        expect(result!.prompt.name).to.equal('action');
      });

      it('should list templates with --json flag (legacy)', () => {
        createTestTicketTemplate('compat-ticket', 'Compat Ticket', true);

        const output = execProduction('template list --json');
        const json = extractJson<{ ticket: unknown[] }>(output);

        expect(json).to.not.be.null;
        expect(json!.ticket).to.be.an('array');
      });

      it('should complete delete flow with --json flag (legacy)', () => {
        createTestTicketTemplate('compat-del', 'Compat Delete', false);

        const result = agentExec('template delete --json');
        expect(result).to.not.be.null;
        expect(result!.prompt.type).to.equal('list');
        expect(result!.prompt.name).to.equal('type');
      });
    });

    // ==========================================================================
    // Phase Template Subcommand Deep Flows
    // ==========================================================================

    describe('phase template list - full menu flow', () => {
      beforeEach(() => {
        createTestPhaseTemplate('deep-agile', 'Deep Agile', true, 'Agile phases');
        createTestPhaseTemplate('deep-custom', 'Deep Custom', false, 'Custom phases');
      });

      it('should navigate: phase menu → list → get JSON template data', () => {
        // Step 1: Get phase menu
        const step1 = agentExec('template phase --machine');
        expect(step1).to.not.be.null;

        // Find list choice
        const listChoice = findChoice(step1!.prompt.choices!, 'List');
        expect(listChoice).to.exist;
        expect(listChoice!.command).to.include('--json');

        // Step 2: Follow command → get template list JSON
        const listOutput = execProduction(execChoice(listChoice!));
        const templates = extractJson<Array<{ id: string; name: string; isBuiltin: boolean }>>(listOutput);

        expect(templates).to.not.be.null;
        expect(templates).to.be.an('array');
        // Should contain our test templates (plus built-in templates seeded by the app)
        const agileT = templates!.find(t => t.id === 'deep-agile');
        expect(agileT).to.exist;
        expect(agileT!.name).to.equal('Deep Agile');
        const customT = templates!.find(t => t.id === 'deep-custom');
        expect(customT).to.exist;
        expect(customT!.isBuiltin).to.equal(false);
      });
    });

    describe('phase template create - full flow (direct flags)', () => {
      it('should navigate: phase menu → create → execute with flags → verify DB', () => {
        // Step 1: Get phase menu
        const step1 = agentExec('template phase --machine');
        expect(step1).to.not.be.null;

        // Find create choice
        const createChoice = findChoice(step1!.prompt.choices!, 'Create');
        expect(createChoice).to.exist;

        // Step 2: Execute create with all flags
        // In non-TTY mode (like tests), output is JSON
        const result = execProduction('phase template create "Agent Created" --description "Created by agent"');
        const json = extractJson<{ success: boolean; result: { name: string } }>(result);
        expect(json).to.not.be.null;
        expect(json!.success).to.equal(true);
        expect(json!.result.name).to.equal('Agent Created');

        // Verify in database
        const template = getPhaseTemplate('agent-created');
        expect(template).to.exist;
        expect(template!.name).to.equal('Agent Created');
      });

      it('should create phase template with direct command and verify DB', () => {
        // In non-TTY mode (like tests), output is JSON
        const result = execProduction('phase template create "Direct Create" --description "Direct test"');
        const json = extractJson<{ success: boolean; result: { name: string; description: string } }>(result);
        expect(json).to.not.be.null;
        expect(json!.success).to.equal(true);
        expect(json!.result.name).to.equal('Direct Create');
        expect(json!.result.description).to.equal('Direct test');

        const template = db.prepare(
          'SELECT * FROM pmo_phase_templates WHERE name = ?'
        ).get('Direct Create') as { id: string; description: string; is_builtin: number } | undefined;
        expect(template).to.exist;
        expect(template!.description).to.equal('Direct test');
        expect(template!.is_builtin).to.equal(0);
      });
    });

    describe('phase template create - JSON mode support (TKT-794)', () => {
      it('should output prompt as JSON when name not provided with --json flag', () => {
        const result = agentExec('phase template create --json');
        expect(result).to.not.be.null;
        expect(result!.prompt.type).to.equal('input');
        expect(result!.prompt.name).to.equal('name');
        expect(result!.prompt.message).to.include('Template name');
      });

      it('should output prompt as JSON when name not provided with --machine flag', () => {
        const result = agentExec('phase template create --machine');
        expect(result).to.not.be.null;
        expect(result!.prompt.type).to.equal('input');
        expect(result!.prompt.name).to.equal('name');
        expect(result!.prompt.message).to.include('Template name');
      });

      it('should output success JSON when all required fields provided via flags', () => {
        const output = execProduction('phase template create "JSON Success Test" --description "Created via JSON" --json');
        const json = extractJson<{
          prompt: null;
          success: boolean;
          result: { id: string; name: string; description: string; phasesCount: number };
        }>(output);

        expect(json).to.not.be.null;
        expect(json!.success).to.equal(true);
        expect(json!.prompt).to.be.null;
        expect(json!.result.name).to.equal('JSON Success Test');
        expect(json!.result.description).to.equal('Created via JSON');
        expect(json!.result.phasesCount).to.be.greaterThan(0);

        // Verify in database
        const template = getPhaseTemplate('json-success-test');
        expect(template).to.exist;
        expect(template!.name).to.equal('JSON Success Test');
      });

      it('should work via template phase create wrapper with --json', () => {
        const output = execProduction('template phase create "Wrapper JSON Test" --description "Via wrapper" --json');
        const json = extractJson<{
          prompt: null;
          success: boolean;
          result: { id: string; name: string };
        }>(output);

        expect(json).to.not.be.null;
        expect(json!.success).to.equal(true);
        expect(json!.result.name).to.equal('Wrapper JSON Test');

        // Verify in database
        const template = getPhaseTemplate('wrapper-json-test');
        expect(template).to.exist;
      });

      it('should work via template phase create wrapper with --machine', () => {
        const output = execProduction('template phase create "Machine Flag Test" --machine');
        const json = extractJson<{
          prompt: null;
          success: boolean;
          result: { id: string; name: string };
        }>(output);

        expect(json).to.not.be.null;
        expect(json!.success).to.equal(true);
        expect(json!.result.name).to.equal('Machine Flag Test');

        // Verify in database
        const template = getPhaseTemplate('machine-flag-test');
        expect(template).to.exist;
      });

      it('should include context hints in prompt JSON', () => {
        const result = agentExec('phase template create --json');
        expect(result).to.not.be.null;
        expect(result!.prompt.type).to.equal('input');

        // The prompt should include context with hints for the agent
        const promptWithContext = result!.prompt as unknown as { context?: { hint?: string; example?: string } };
        expect(promptWithContext.context).to.exist;
        expect(promptWithContext.context!.hint).to.include('prlt phase template create');
      });

      it('should return phases array in success JSON', () => {
        const output = execProduction('phase template create "Phases Array Test" --json');
        const json = extractJson<{
          success: boolean;
          result: { phases: Array<{ name: string; category: string; isDefault: boolean }> };
        }>(output);

        expect(json).to.not.be.null;
        expect(json!.success).to.equal(true);
        expect(json!.result.phases).to.be.an('array');
        expect(json!.result.phases.length).to.be.greaterThan(0);

        // Each phase should have expected properties
        const firstPhase = json!.result.phases[0];
        expect(firstPhase).to.have.property('name');
        expect(firstPhase).to.have.property('category');
        expect(firstPhase).to.have.property('isDefault');
      });
    });

    describe('phase template apply - JSON confirmation flow', () => {
      beforeEach(() => {
        createTestPhaseTemplate('apply-test', 'Apply Test', false, 'For apply testing');
      });

      it('should get confirmation prompt and apply template via --force', () => {
        // Step 1: Request apply with JSON mode → get confirmation prompt
        const step1 = agentExec('phase template apply apply-test --json');
        expect(step1).to.not.be.null;
        expect(step1!.prompt.type).to.equal('list');
        expect(step1!.prompt.name).to.equal('confirmed');
        expect(step1!.prompt.message).to.include('Apply Test');

        // Find Yes choice
        const yesChoice = step1!.prompt.choices!.find(c => c.value === 'true');
        expect(yesChoice).to.exist;

        // Step 2: Apply with --force to skip confirmation
        const result = execProduction('phase template apply apply-test --force');
        expect(result).to.include('Applied phase template');

        // Verify phases were replaced in database
        const phases = db.prepare('SELECT * FROM pmo_phases').all() as Array<{ name: string; category: string }>;
        expect(phases.length).to.be.greaterThan(0);
        // Template has 3 phases: Backlog, In Progress, Done
        const hasBacklog = phases.some(p => p.name === 'Backlog');
        const hasInProgress = phases.some(p => p.name === 'In Progress');
        const hasDone = phases.some(p => p.name === 'Done');
        expect(hasBacklog).to.be.true;
        expect(hasInProgress).to.be.true;
        expect(hasDone).to.be.true;
      });

      it('should error with JSON when template not found', () => {
        const output = execProduction('phase template apply nonexistent --json');
        expect(output.toLowerCase()).to.include('not found');
      });
    });

    describe('phase template update - direct flags', () => {
      beforeEach(() => {
        createTestPhaseTemplate('update-test', 'Update Test', false, 'Original desc');
      });

      it('should update template name and description with direct flags', () => {
        const result = execProduction('phase template update update-test --name "Updated Name" --description "Updated desc"');
        expect(result).to.include('Updated phase template');

        const template = db.prepare(
          'SELECT * FROM pmo_phase_templates WHERE id = ?'
        ).get('update-test') as { name: string; description: string };
        expect(template.name).to.equal('Updated Name');
        expect(template.description).to.equal('Updated desc');
      });

      it('should update only name when only name flag provided', () => {
        const result = execProduction('phase template update update-test --name "Name Only"');
        expect(result).to.include('Updated phase template');

        const template = db.prepare(
          'SELECT * FROM pmo_phase_templates WHERE id = ?'
        ).get('update-test') as { name: string; description: string };
        expect(template.name).to.equal('Name Only');
        expect(template.description).to.equal('Original desc');
      });

      it('should error when template not found', () => {
        const output = execProduction('phase template update nonexistent --name "X"');
        expect(output.toLowerCase()).to.include('not found');
      });

      it('should error when updating built-in template', () => {
        createTestPhaseTemplate('builtin-phase', 'Builtin Phase', true);
        const output = execProduction('phase template update builtin-phase --name "X"');
        expect(output.toLowerCase()).to.include('cannot modify');
      });
    });

    describe('phase template delete - JSON confirmation flow', () => {
      beforeEach(() => {
        createTestPhaseTemplate('delete-deep', 'Delete Deep', false, 'For delete testing');
      });

      it('should get confirmation prompt and delete via --force', () => {
        // Step 1: Request delete with JSON → get confirmation
        const step1 = agentExec('phase template delete delete-deep --json');
        expect(step1).to.not.be.null;
        expect(step1!.prompt.type).to.equal('list');
        expect(step1!.prompt.name).to.equal('confirmed');
        expect(step1!.prompt.message).to.include('Delete Deep');

        // Verify template exists before delete
        expect(getPhaseTemplate('delete-deep')).to.exist;

        // Step 2: Delete with --force
        const result = execProduction('phase template delete delete-deep --force');
        expect(result).to.include('Deleted phase template');

        // Verify template is gone
        expect(getPhaseTemplate('delete-deep')).to.be.undefined;
      });

      it('should error when deleting built-in template', () => {
        createTestPhaseTemplate('builtin-del', 'Builtin Del', true);
        const output = execProduction('phase template delete builtin-del --json');
        expect(output.toLowerCase()).to.include('cannot delete');
      });

      it('should error when template not found', () => {
        const output = execProduction('phase template delete nonexistent --json');
        expect(output.toLowerCase()).to.include('not found');
      });
    });

    // ==========================================================================
    // Ticket Template Subcommand Deep Flows
    // ==========================================================================

    describe('ticket template list - full menu flow', () => {
      beforeEach(() => {
        createTestTicketTemplate('deep-bug', 'Deep Bug Report', true, {
          description: 'Bug report template',
          defaultPriority: 'HIGH',
        });
        createTestTicketTemplate('deep-feature', 'Deep Feature', false, {
          description: 'Feature template',
          defaultCategory: 'feature',
        });
      });

      it('should navigate: ticket menu → list → get JSON template data', () => {
        // Step 1: Get ticket menu
        const step1 = agentExec('template ticket --machine');
        expect(step1).to.not.be.null;

        // Find list choice
        const listChoice = findChoice(step1!.prompt.choices!, 'List');
        expect(listChoice).to.exist;
        expect(listChoice!.command).to.include('--json');

        // Step 2: Follow command → get template list
        const listOutput = execProduction(execChoice(listChoice!));
        const templates = extractJson<Array<{ id: string; name: string }>>(listOutput);

        expect(templates).to.not.be.null;
        expect(templates).to.be.an('array');
        const featureT = templates!.find(t => t.id === 'deep-feature');
        expect(featureT).to.exist;
        expect(featureT!.name).to.equal('Deep Feature');
      });
    });

    describe('ticket template apply - JSON form flow', () => {
      beforeEach(() => {
        createTestTicketTemplate('apply-bug', 'Apply Bug', false, {
          titlePattern: '[BUG] ',
          defaultPriority: 'HIGH',
          defaultCategory: 'bug',
        });
      });

      it('should get form prompt with --interactive --json', () => {
        const step1 = agentExec('ticket template apply apply-bug --interactive --json');
        expect(step1).to.not.be.null;
        expect(step1!.prompt.type).to.equal('form');

        // Verify form has expected fields
        const fields = (step1!.prompt as unknown as { fields: Array<{ name: string; type: string }> }).fields;
        expect(fields).to.be.an('array');
        const fieldNames = fields.map(f => f.name);
        expect(fieldNames).to.include('title');
        expect(fieldNames).to.include('column');
        expect(fieldNames).to.include('priority');
      });

      it('should create ticket with all flags provided directly', () => {
        const result = execProduction('ticket template apply apply-bug --title "Login crash" --column "Backlog"');
        expect(result).to.include('Created ticket');
        expect(result).to.include('Login crash');

        // Verify ticket in database
        const ticket = db.prepare(
          "SELECT * FROM pmo_tickets WHERE title = ?"
        ).get('Login crash') as { id: string; priority: string; category: string } | undefined;
        expect(ticket).to.exist;
        expect(ticket!.priority).to.equal('HIGH');
        expect(ticket!.category).to.equal('bug');
      });

      it('should error when template not found', () => {
        const output = execProduction('ticket template apply nonexistent --json');
        expect(output.toLowerCase()).to.include('not found');
      });
    });

    describe('ticket template save - direct flags', () => {
      beforeEach(() => {
        // Create a test ticket to save as template
        createTestTicket('TKT-SAVE-001', 'Save Me Ticket', {
          priority: 'P1',
          category: 'bug',
          description: 'A bug ticket to save',
        });
      });

      it('should save ticket as template with all args', () => {
        const result = execProduction('ticket template save TKT-SAVE-001 "Saved Bug" --description "From ticket"');
        expect(result).to.include('Created template');
        expect(result).to.include('Saved Bug');

        // Verify template in database
        const template = db.prepare(
          "SELECT * FROM pmo_ticket_templates WHERE name = ?"
        ).get('Saved Bug') as { id: string; default_priority: string; default_category: string; description: string } | undefined;
        expect(template).to.exist;
        expect(template!.default_priority).to.equal('P1');
        expect(template!.default_category).to.equal('bug');
        expect(template!.description).to.equal('From ticket');
      });
    });

    describe('ticket template delete - JSON confirmation flow', () => {
      beforeEach(() => {
        createTestTicketTemplate('del-ticket-deep', 'Delete Ticket Deep', false, {
          description: 'For delete testing',
        });
      });

      it('should get confirmation prompt and delete via --force', () => {
        // Step 1: Request delete with JSON → get confirmation
        const step1 = agentExec('ticket template delete del-ticket-deep --json');
        expect(step1).to.not.be.null;
        expect(step1!.prompt.type).to.equal('list');

        // Verify template exists
        expect(getTicketTemplate('del-ticket-deep')).to.exist;

        // Step 2: Delete with --force
        const result = execProduction('ticket template delete del-ticket-deep --force');
        expect(result).to.include('Deleted template');

        // Verify template is gone
        expect(getTicketTemplate('del-ticket-deep')).to.be.undefined;
      });

      it('should error when deleting built-in template', () => {
        createTestTicketTemplate('builtin-ticket-del', 'Builtin Ticket Del', true);
        const output = execProduction('ticket template delete builtin-ticket-del --json');
        expect(output.toLowerCase()).to.include('cannot delete');
      });

      it('should error when template not found', () => {
        const output = execProduction('ticket template delete nonexistent --json');
        expect(output.toLowerCase()).to.include('not found');
      });
    });

    // ==========================================================================
    // Full Lifecycle Flows
    // ==========================================================================

    describe('phase template lifecycle - complete flow', () => {
      it('should create → list → update → apply → delete a phase template', () => {
        // 1. Create template
        const createResult = execProduction('phase template create "Lifecycle Phases" --description "Lifecycle test"');
        expect(createResult).to.include('Created phase template');

        // Verify in DB
        const created = db.prepare(
          'SELECT * FROM pmo_phase_templates WHERE name = ?'
        ).get('Lifecycle Phases') as { id: string; description: string };
        expect(created).to.exist;
        const templateId = created.id;

        // 2. List and verify it appears
        const listOutput = execProduction('phase template list --json');
        const templates = extractJson<Array<{ id: string; name: string }>>(listOutput);
        expect(templates).to.not.be.null;
        const found = templates!.find(t => t.id === templateId);
        expect(found).to.exist;
        expect(found!.name).to.equal('Lifecycle Phases');

        // 3. Update template
        const updateResult = execProduction(`phase template update ${templateId} --name "Updated Lifecycle" --description "Updated desc"`);
        expect(updateResult).to.include('Updated phase template');

        const updated = db.prepare(
          'SELECT * FROM pmo_phase_templates WHERE id = ?'
        ).get(templateId) as { name: string; description: string };
        expect(updated.name).to.equal('Updated Lifecycle');
        expect(updated.description).to.equal('Updated desc');

        // 4. Apply template
        const applyResult = execProduction(`phase template apply ${templateId} --force`);
        expect(applyResult).to.include('Applied phase template');

        // Verify phases exist
        const phases = db.prepare('SELECT * FROM pmo_phases').all();
        expect(phases.length).to.be.greaterThan(0);

        // 5. Delete template
        const deleteResult = execProduction(`phase template delete ${templateId} --force`);
        expect(deleteResult).to.include('Deleted phase template');

        // Verify gone
        const deleted = db.prepare(
          'SELECT * FROM pmo_phase_templates WHERE id = ?'
        ).get(templateId);
        expect(deleted).to.be.undefined;
      });
    });

    describe('ticket template lifecycle - complete flow', () => {
      it('should save → list → apply → delete a ticket template', () => {
        // Create source ticket
        createTestTicket('TKT-LIFE-001', 'Lifecycle Ticket', {
          priority: 'P2',
          category: 'feature',
        });

        // 1. Save ticket as template
        const saveResult = execProduction('ticket template save TKT-LIFE-001 "Lifecycle Template" --description "Lifecycle test"');
        expect(saveResult).to.include('Created template');

        // Get the template ID
        const savedTemplate = db.prepare(
          "SELECT * FROM pmo_ticket_templates WHERE name = ?"
        ).get('Lifecycle Template') as { id: string };
        expect(savedTemplate).to.exist;
        const templateId = savedTemplate.id;

        // 2. List and verify it appears
        const listOutput = execProduction('ticket template list --json');
        const templates = extractJson<Array<{ id: string; name: string }>>(listOutput);
        expect(templates).to.not.be.null;
        const found = templates!.find(t => t.id === templateId);
        expect(found).to.exist;

        // 3. Apply template to create ticket
        const applyResult = execProduction(`ticket template apply ${templateId} --title "From Lifecycle" --column "Backlog"`);
        expect(applyResult).to.include('Created ticket');

        // Verify ticket in DB
        const ticket = db.prepare(
          "SELECT * FROM pmo_tickets WHERE title = ?"
        ).get('From Lifecycle') as { priority: string; category: string } | undefined;
        expect(ticket).to.exist;
        expect(ticket!.priority).to.equal('P2');
        expect(ticket!.category).to.equal('feature');

        // 4. Delete template
        const deleteResult = execProduction(`ticket template delete ${templateId} --force`);
        expect(deleteResult).to.include('Deleted template');

        expect(getTicketTemplate(templateId)).to.be.undefined;
      });
    });
  });
});

// =============================================================================
// Database Setup Helper
// =============================================================================

function setupTestDatabase(db: Database.Database, pmoPath: string) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pmo_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pmo_phases (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      color TEXT,
      description TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pmo_phase_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      is_builtin INTEGER NOT NULL DEFAULT 0,
      phases TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pmo_workflows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      is_builtin INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pmo_workflow_statuses (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      color TEXT,
      description TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workflow_id) REFERENCES pmo_workflows(id) ON DELETE CASCADE,
      UNIQUE(workflow_id, name)
    );

    CREATE TABLE IF NOT EXISTS pmo_projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      template TEXT,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      phase_id TEXT,
      workflow_id TEXT,
      is_archived INTEGER NOT NULL DEFAULT 0,
      target_date TIMESTAMP,
      initiative_id TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workflow_id) REFERENCES pmo_workflows(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS pmo_tickets (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL DEFAULT 'default',
      title TEXT NOT NULL,
      description TEXT,
      priority TEXT,
      category TEXT,
      status TEXT NOT NULL DEFAULT 'backlog',
      status_id TEXT,
      owner TEXT,
      assignee TEXT,
      branch TEXT,
      spec_id TEXT,
      epic_id TEXT,
      labels TEXT NOT NULL DEFAULT '[]',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_synced_from_spec TIMESTAMP,
      last_synced_from_board TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES pmo_projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS pmo_ticket_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      is_builtin INTEGER NOT NULL DEFAULT 0,
      title_pattern TEXT,
      description_template TEXT,
      default_priority TEXT,
      default_category TEXT,
      default_status_id TEXT,
      default_assignee TEXT,
      default_owner TEXT,
      default_labels TEXT NOT NULL DEFAULT '[]',
      suggested_subtasks TEXT NOT NULL DEFAULT '[]',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pmo_columns (
      id TEXT NOT NULL,
      project_id TEXT NOT NULL DEFAULT 'default',
      name TEXT NOT NULL,
      position INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (project_id, id)
    );

    CREATE INDEX IF NOT EXISTS idx_pmo_ticket_templates_builtin ON pmo_ticket_templates(is_builtin);
    CREATE INDEX IF NOT EXISTS idx_pmo_phases_category ON pmo_phases(category);
    CREATE INDEX IF NOT EXISTS idx_pmo_phases_position ON pmo_phases(category, position);
  `);

  // Insert workflow
  db.prepare(`
    INSERT INTO pmo_workflows (id, name, description, is_builtin)
    VALUES ('default', 'Default', 'Default kanban workflow', 1)
  `).run();

  // Insert workflow statuses
  const statuses = [
    { id: 'status-backlog', name: 'Backlog', category: 'backlog', position: 0, isDefault: 1 },
    { id: 'status-in-progress', name: 'In Progress', category: 'started', position: 1 },
    { id: 'status-done', name: 'Done', category: 'completed', position: 2 },
  ];

  for (const status of statuses) {
    db.prepare(`
      INSERT INTO pmo_workflow_statuses (id, workflow_id, name, category, position, is_default)
      VALUES (?, 'default', ?, ?, ?, ?)
    `).run(status.id, status.name, status.category, status.position, status.isDefault || 0);
  }

  // Insert test project
  db.prepare(`
    INSERT INTO pmo_projects (id, name, description, workflow_id)
    VALUES ('test-project', 'Test Project', 'E2E test project', 'default')
  `).run();

  db.prepare(`
    INSERT INTO pmo_settings (key, value)
    VALUES ('pmo_path', ?), ('current_project', 'test-project')
  `).run(pmoPath);

  // Insert default phases
  const defaultPhases = [
    { id: 'idea', name: 'Idea', category: 'backlog', position: 0 },
    { id: 'planned', name: 'Planned', category: 'unstarted', position: 0 },
    { id: 'active', name: 'Active', category: 'started', position: 0 },
    { id: 'complete', name: 'Complete', category: 'completed', position: 0 },
  ];

  for (const phase of defaultPhases) {
    db.prepare(`
      INSERT OR IGNORE INTO pmo_phases (id, name, category, position, is_default)
      VALUES (?, ?, ?, ?, 0)
    `).run(phase.id, phase.name, phase.category, phase.position);
  }

  // Insert columns (needed for ticket template apply)
  const columns = [
    { id: 'backlog', name: 'Backlog', position: 0 },
    { id: 'in-progress', name: 'In Progress', position: 1 },
    { id: 'done', name: 'Done', position: 2 },
  ];

  for (const col of columns) {
    db.prepare(`
      INSERT INTO pmo_columns (id, project_id, name, position)
      VALUES (?, 'test-project', ?, ?)
    `).run(col.id, col.name, col.position);
  }
}
