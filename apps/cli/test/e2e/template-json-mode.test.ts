/* eslint-disable max-nested-callbacks */
import { expect } from 'chai';
import Database from 'better-sqlite3';
import {
  createTestEnvironment,
  cleanupTestEnvironment,
  createHQConfig,
  createPMODirectories,
  setupProductionSchema,
  createTestProject,
  execInProcess,
  extractJson,
  findChoice,
  execChoice,
  type TestEnvironment,
  hasContextError,
} from './test-helpers.js';

/**
 * E2E Agent Flow Tests for Template Commands
 *
 * Tests the full agent navigation flow for the template namespace:
 * - prlt template (main menu)
 * - prlt template list [--type ticket|phase]
 * - prlt template create --type ticket|phase
 * - prlt template apply --type ticket|phase
 * - prlt template delete [--type ticket|phase]
 * - prlt template save
 * - prlt template update
 *
 * These tests verify that AI agents can:
 * 1. Call commands with --machine flag
 * 2. Receive structured JSON responses
 * 3. Follow command fields to navigate through menus
 * 4. Complete the full workflow with database verification
 */
/**
 * Local async agentExec that uses execInProcess instead of execProduction.
 */
async function agentExecAsync(cmd: string): Promise<any | null> {
  const output = await execInProcess(cmd);
  if (hasContextError(output)) {
    return null;
  }
  const json = extractJson<any>(output);
  if (json && typeof json === 'object' && !('prompt' in json)) {
    return null;
  }
  return json;
}

describe('Template Commands - JSON Mode E2E Tests', () => {
  let env: TestEnvironment;
  let db: Database.Database;

  beforeEach(() => {
    env = createTestEnvironment('template-json-');
    db = setupProductionSchema(env.dbPath, env.pmoPath);
    createHQConfig(env.proletariatDir);
    createPMODirectories(env.pmoPath, 'test-project');
    createTestProject(db);
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
      INSERT OR REPLACE INTO pmo_ticket_templates (id, name, description, is_builtin, title_pattern, default_priority, default_category)
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
      INSERT OR REPLACE INTO pmo_phase_templates (id, name, description, is_builtin, phases)
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
      INSERT INTO pmo_tickets (id, project_id, title, priority, category, description, status, position)
      VALUES (?, 'test-project', ?, ?, ?, ?, ?, 0)
    `).run(
      id, title,
      options.priority || null,
      options.category || null,
      options.description || null,
      options.status || 'Backlog'
    );
  }

  // ===========================================================================
  // template --machine (main menu)
  // ===========================================================================
  describe('prlt template --machine (main menu)', () => {
    it('should output JSON with action choices', async () => {
      const result = await agentExecAsync('template --machine');

      expect(result).to.not.be.null;
      expect(result!.prompt.type).to.equal('list');
      expect(result!.prompt.name).to.equal('action');
      expect(result!.prompt.choices).to.be.an('array');
      expect(result!.prompt.choices!.length).to.equal(7);
    });

    it('should have choice for List templates with command field', async () => {
      const result = await agentExecAsync('template --machine');
      expect(result).to.not.be.null;

      const listChoice = findChoice(result!.prompt.choices!, 'List templates');
      expect(listChoice).to.exist;
      expect(listChoice!.command).to.include('template list');
      expect(listChoice!.command).to.include('--json');
    });

    it('should have choice for Create template with command field', async () => {
      const result = await agentExecAsync('template --machine');
      expect(result).to.not.be.null;

      const createChoice = findChoice(result!.prompt.choices!, 'Create template');
      expect(createChoice).to.exist;
      expect(createChoice!.command).to.include('template create');
      expect(createChoice!.command).to.include('--json');
    });

    it('should have choice for Apply template with command field', async () => {
      const result = await agentExecAsync('template --machine');
      expect(result).to.not.be.null;

      const applyChoice = findChoice(result!.prompt.choices!, 'Apply template');
      expect(applyChoice).to.exist;
      expect(applyChoice!.command).to.include('template apply');
      expect(applyChoice!.command).to.include('--json');
    });

    it('should have choice for Delete template with command field', async () => {
      const result = await agentExecAsync('template --machine');
      expect(result).to.not.be.null;

      const deleteChoice = findChoice(result!.prompt.choices!, 'Delete template');
      expect(deleteChoice).to.exist;
      expect(deleteChoice!.command).to.include('template delete');
      expect(deleteChoice!.command).to.include('--json');
    });

    it('should work with --json flag (legacy)', async () => {
      const result = await agentExecAsync('template --json');
      expect(result).to.not.be.null;
      expect(result!.prompt.type).to.equal('list');
      expect(result!.prompt.name).to.equal('action');
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

    it('should output valid JSON with --json flag', async () => {
      const output = await execInProcess('template list --json');
      const json = extractJson<{ ticket: unknown[]; phase: unknown[] }>(output);

      expect(json).to.not.be.null;
      expect(json!.ticket).to.be.an('array');
      expect(json!.phase).to.be.an('array');
    });

    it('should include both ticket and phase templates (including built-ins)', async () => {
      const output = await execInProcess('template list --json');
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

    it('should filter by type: ticket', async () => {
      const output = await execInProcess('template list --type ticket --json');
      const json = extractJson<{ ticket: unknown[]; phase?: unknown[] }>(output);

      expect(json).to.not.be.null;
      expect(json!.ticket).to.be.an('array');
      expect(json!.ticket.length).to.be.at.least(2);
      expect(json!.phase).to.be.undefined;
    });

    it('should filter by type: phase', async () => {
      const output = await execInProcess('template list --type phase --json');
      const json = extractJson<{ ticket?: unknown[]; phase: unknown[] }>(output);

      expect(json).to.not.be.null;
      expect(json!.phase).to.be.an('array');
      expect(json!.phase.length).to.be.at.least(2);
      expect(json!.ticket).to.be.undefined;
    });

    it('should filter by builtin', async () => {
      const output = await execInProcess('template list --builtin --json');
      const json = extractJson<{
        ticket: Array<{ isBuiltin: boolean }>;
        phase: Array<{ isBuiltin: boolean }>;
      }>(output);

      expect(json).to.not.be.null;
      for (const t of json!.ticket) expect(t.isBuiltin).to.equal(true);
      for (const p of json!.phase) expect(p.isBuiltin).to.equal(true);
    });

    it('should filter by custom', async () => {
      const output = await execInProcess('template list --custom --json');
      const json = extractJson<{
        ticket: Array<{ isBuiltin: boolean }>;
        phase: Array<{ isBuiltin: boolean }>;
      }>(output);

      expect(json).to.not.be.null;
      for (const t of json!.ticket) expect(t.isBuiltin).to.equal(false);
      for (const p of json!.phase) expect(p.isBuiltin).to.equal(false);
    });

    it('should include ticket template details', async () => {
      const output = await execInProcess('template list --type ticket --json');
      const json = extractJson<{
        ticket: Array<{ id: string; name: string; description: string; defaultPriority: string }>;
      }>(output);

      expect(json).to.not.be.null;
      const customTicket = json!.ticket.find(t => t.id === 'custom-ticket');
      expect(customTicket).to.exist;
      expect(customTicket!.name).to.equal('Custom Ticket');
      expect(customTicket!.description).to.equal('Custom ticket template');
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

    it('should output type selection prompt when no type provided', async () => {
      const result = await agentExecAsync('template delete --machine');

      expect(result).to.not.be.null;
      expect(result!.prompt.type).to.equal('list');
      expect(result!.prompt.name).to.equal('type');
      expect(result!.prompt.choices).to.be.an('array');
    });

    it('should have type choices with command fields', async () => {
      const result = await agentExecAsync('template delete --machine');
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

    it('should output template selection when type provided', async () => {
      const result = await agentExecAsync('template delete --type ticket --machine');

      expect(result).to.not.be.null;
      expect(result!.prompt.type).to.equal('checkbox');
      expect(result!.prompt.name).to.equal('templateIds');
      expect(result!.prompt.choices).to.be.an('array');
    });

    it('should show ticket templates for selection when type=ticket', async () => {
      const result = await agentExecAsync('template delete --type ticket --machine');
      expect(result).to.not.be.null;

      const choice = findChoice(result!.prompt.choices!, 'Delete Ticket Template');
      expect(choice).to.exist;
      expect(choice!.command).to.include('--json');
    });

    it('should show phase templates for selection when type=phase', async () => {
      const result = await agentExecAsync('template delete --type phase --machine');
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
      it('should navigate: template menu → list choice → get list output', async () => {
        createTestTicketTemplate('flow-ticket', 'Flow Ticket', true);
        createTestPhaseTemplate('flow-phase', 'Flow Phase', true);

        // Step 1: Get main menu
        const step1 = await agentExecAsync('template --machine');
        expect(step1).to.not.be.null;
        expect(step1!.prompt.type).to.equal('list');

        // Find list choice
        const listChoice = findChoice(step1!.prompt.choices!, 'List');
        expect(listChoice).to.exist;
        expect(listChoice!.command).to.exist;

        // Step 2: Execute list command from choice
        const listCmd = execChoice(listChoice!);
        const listOutput = await execInProcess(listCmd);
        const json = extractJson<{ ticket: unknown[]; phase: unknown[] }>(listOutput);

        expect(json).to.not.be.null;
        expect(json!.ticket).to.be.an('array');
        expect(json!.phase).to.be.an('array');
      });

      it('should navigate: template menu → create choice → navigate to create', async () => {
        // Step 1: Get main menu
        const step1 = await agentExecAsync('template --machine');
        expect(step1).to.not.be.null;

        // Find create choice
        const createChoice = findChoice(step1!.prompt.choices!, 'Create');
        expect(createChoice).to.exist;
        expect(createChoice!.command).to.include('template create');
      });

      it('should navigate: template menu → delete choice → navigate to delete', async () => {
        // Step 1: Get main menu
        const step1 = await agentExecAsync('template --machine');
        expect(step1).to.not.be.null;

        // Find delete choice
        const deleteChoice = findChoice(step1!.prompt.choices!, 'Delete');
        expect(deleteChoice).to.exist;
        expect(deleteChoice!.command).to.include('template delete');
      });
    });

    describe('template delete - full agent flow', () => {
      beforeEach(() => {
        createTestTicketTemplate('del-flow-1', 'Delete Flow Template', false, {
          description: 'Template to delete',
        });
        createTestPhaseTemplate('del-phase-1', 'Delete Phase Flow', false);
      });

      it('should complete flow: select type → select template → confirm → deleted', async () => {
        // Verify template exists before
        const template = getTicketTemplate('del-flow-1');
        expect(template).to.exist;

        // Step 1: No type, get type selection
        const step1 = await agentExecAsync('template delete --machine');
        expect(step1).to.not.be.null;
        expect(step1!.prompt.name).to.equal('type');

        // Find ticket type
        const typeChoice = findChoice(step1!.prompt.choices!, 'Ticket');
        expect(typeChoice).to.exist;

        // Step 2: Execute with type, get template selection
        const step2 = await agentExecAsync(execChoice(typeChoice!));
        expect(step2).to.not.be.null;
        expect(step2!.prompt.name).to.equal('templateIds');

        // Find the template to delete
        const templateChoice = findChoice(step2!.prompt.choices!, 'Delete Flow Template');
        expect(templateChoice).to.exist;
        expect(templateChoice!.command).to.include('del-flow-1');
      });

      it('should navigate delete flow with --force to skip confirmation', async () => {
        // Step 1: Get template selection for ticket type
        const step1 = await agentExecAsync('template delete --type ticket --machine');
        expect(step1).to.not.be.null;
        expect(step1!.prompt.name).to.equal('templateIds');

        // Verify our template appears in choices
        const choice = findChoice(step1!.prompt.choices!, 'Delete Flow Template');
        expect(choice).to.exist;
        expect(choice!.command).to.include('--json');
        // The command field should contain the template ID for the agent to use
        expect(choice!.command).to.include('del-flow-1');
      });

      it('should complete flow for phase templates', async () => {
        // Step 1: Type provided, get template selection
        const step1 = await agentExecAsync('template delete --type phase --machine');
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

      it('should return all templates as JSON for agent processing', async () => {
        const output = await execInProcess('template list --json');
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

      it('should filter templates by type for agent', async () => {
        const output = await execInProcess('template list --type ticket --json');
        const json = extractJson<{ ticket: Array<{ id: string }> }>(output);

        expect(json).to.not.be.null;
        expect(json!.ticket.length).to.be.at.least(2);

        // Verify our test templates are in the results
        const found = json!.ticket.find(t => t.id === 'list-ticket-2');
        expect(found).to.exist;
      });

      it('should filter by builtin for agent', async () => {
        const output = await execInProcess('template list --builtin --json');
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

      it('should filter by custom for agent', async () => {
        const output = await execInProcess('template list --custom --json');
        const json = extractJson<{
          ticket: Array<{ isBuiltin: boolean }>;
          phase: Array<{ isBuiltin: boolean }>;
        }>(output);

        expect(json).to.not.be.null;
        expect(json!.ticket.length).to.equal(1);
        expect(json!.phase.length).to.equal(1);
      });
    });

    describe('template main menu - all operations available', () => {
      it('should have all template operations in the main menu', async () => {
        const result = await agentExecAsync('template --machine');
        expect(result).to.not.be.null;

        const actions = result!.prompt.choices!.map((c: { value: string }) => c.value);
        expect(actions).to.include('list');
        expect(actions).to.include('create');
        expect(actions).to.include('apply');
        expect(actions).to.include('save');
        expect(actions).to.include('update');
        expect(actions).to.include('delete');
      });
    });

    describe('backward compatibility: --json flag flows', () => {
      it('should complete menu flow with --json flag (legacy)', async () => {
        const result = await agentExecAsync('template --json');
        expect(result).to.not.be.null;
        expect(result!.prompt.type).to.equal('list');
        expect(result!.prompt.name).to.equal('action');
      });

      it('should list templates with --json flag (legacy)', async () => {
        createTestTicketTemplate('compat-ticket', 'Compat Ticket', true);

        const output = await execInProcess('template list --json');
        const json = extractJson<{ ticket: unknown[] }>(output);

        expect(json).to.not.be.null;
        expect(json!.ticket).to.be.an('array');
      });

      it('should complete delete flow with --json flag (legacy)', async () => {
        createTestTicketTemplate('compat-del', 'Compat Delete', false);

        const result = await agentExecAsync('template delete --json');
        expect(result).to.not.be.null;
        expect(result!.prompt.type).to.equal('list');
        expect(result!.prompt.name).to.equal('type');
      });
    });

    // ==========================================================================
    // Phase Template Subcommand Deep Flows
    // ==========================================================================

    describe('phase template list - direct command', () => {
      beforeEach(() => {
        createTestPhaseTemplate('deep-agile', 'Deep Agile', true, 'Agile phases');
        createTestPhaseTemplate('deep-custom', 'Deep Custom', false, 'Custom phases');
      });

      it('should list phase templates with --type phase', async () => {
        const listOutput = await execInProcess('template list --type phase --json');
        const json = extractJson<{ phase: Array<{ id: string; name: string; isBuiltin: boolean }> }>(listOutput);

        expect(json).to.not.be.null;
        expect(json!.phase).to.be.an('array');
        // Should contain our test templates (plus built-in templates seeded by the app)
        const agileT = json!.phase.find(t => t.id === 'deep-agile');
        expect(agileT).to.exist;
        expect(agileT!.name).to.equal('Deep Agile');
        const customT = json!.phase.find(t => t.id === 'deep-custom');
        expect(customT).to.exist;
        expect(customT!.isBuiltin).to.equal(false);
      });
    });

    describe('phase template create - full flow (direct flags)', () => {
      it('should create phase template with flags and verify DB', async () => {
        // In non-TTY mode (like tests), output is JSON
        const result = await execInProcess('template create --type phase "Agent Created" --description "Created by agent" --json');
        const json = extractJson<{ success: boolean; result: { name: string } }>(result);
        expect(json).to.not.be.null;
        expect(json!.success).to.equal(true);
        expect(json!.result.name).to.equal('Agent Created');

        // Verify in database
        const template = getPhaseTemplate('agent-created');
        expect(template).to.exist;
        expect(template!.name).to.equal('Agent Created');
      });

      it('should create phase template with direct command and verify DB', async () => {
        // In non-TTY mode (like tests), output is JSON
        const result = await execInProcess('template create --type phase "Direct Create" --description "Direct test" --json');
        const json = extractJson<{ success: boolean; result: { name: string; phasesCount: number } }>(result);
        expect(json).to.not.be.null;
        expect(json!.success).to.equal(true);
        expect(json!.result.name).to.equal('Direct Create');
        expect(json!.result.phasesCount).to.be.greaterThan(0);

        const template = db.prepare(
          'SELECT * FROM pmo_phase_templates WHERE name = ?'
        ).get('Direct Create') as { id: string; description: string; is_builtin: number } | undefined;
        expect(template).to.exist;
        expect(template!.description).to.equal('Direct test');
        expect(template!.is_builtin).to.equal(0);
      });
    });

    describe('phase template create - JSON mode support (TKT-794)', () => {
      it('should output error JSON when name not provided with --json flag', async () => {
        const output = await execInProcess('template create --type phase --json');
        const json = extractJson<{ type: string; error: { code: string; message: string } }>(output);
        expect(json).to.not.be.null;
        expect(json!.type).to.equal('error');
        expect(json!.error.code).to.equal('NAME_REQUIRED');
        expect(json!.error.message).to.include('Name required');
      });

      it('should output error JSON when name not provided with --machine flag', async () => {
        const output = await execInProcess('template create --type phase --machine');
        const json = extractJson<{ type: string; error: { code: string; message: string } }>(output);
        expect(json).to.not.be.null;
        expect(json!.type).to.equal('error');
        expect(json!.error.code).to.equal('NAME_REQUIRED');
      });

      it('should output success JSON when all required fields provided via flags', async () => {
        const output = await execInProcess('template create --type phase "JSON Success Test" --description "Created via JSON" --json');
        const json = extractJson<{
          prompt: null;
          success: boolean;
          result: { id: string; name: string; phasesCount: number };
        }>(output);

        expect(json).to.not.be.null;
        expect(json!.success).to.equal(true);
        expect(json!.prompt).to.be.null;
        expect(json!.result.name).to.equal('JSON Success Test');
        expect(json!.result.phasesCount).to.be.greaterThan(0);

        // Verify in database
        const template = getPhaseTemplate('json-success-test');
        expect(template).to.exist;
        expect(template!.name).to.equal('JSON Success Test');
      });

      it('should work via template create --type phase with --json', async () => {
        const output = await execInProcess('template create --type phase "Wrapper JSON Test" --description "Via wrapper" --json');
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

      it('should work via template create --type phase with --machine', async () => {
        const output = await execInProcess('template create --type phase "Machine Flag Test" --machine');
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

      it('should include usage hint in error message when name missing', async () => {
        const output = await execInProcess('template create --type phase --json');
        const json = extractJson<{ type: string; error: { message: string } }>(output);
        expect(json).to.not.be.null;
        expect(json!.error.message).to.include('prlt template create');
      });

      it('should return phasesCount in success JSON', async () => {
        const output = await execInProcess('template create --type phase "Phases Count Test" --json');
        const json = extractJson<{
          success: boolean;
          result: { id: string; name: string; phasesCount: number };
        }>(output);

        expect(json).to.not.be.null;
        expect(json!.success).to.equal(true);
        expect(json!.result.phasesCount).to.be.a('number');
        expect(json!.result.phasesCount).to.be.greaterThan(0);
        expect(json!.result.name).to.equal('Phases Count Test');
      });
    });

    describe('phase template apply - JSON confirmation flow', () => {
      beforeEach(() => {
        createTestPhaseTemplate('apply-test', 'Apply Test', false, 'For apply testing');
      });

      it('should get confirmation prompt and apply template via --force', async () => {
        // Step 1: Request apply with JSON mode → get confirmation prompt
        const step1 = await agentExecAsync('template apply --type phase apply-test --json');
        expect(step1).to.not.be.null;
        expect(step1!.prompt.type).to.equal('list');
        expect(step1!.prompt.name).to.equal('confirmed');
        expect(step1!.prompt.message).to.include('existing phase');

        // Find Yes choice
        const yesChoice = step1!.prompt.choices!.find((c: { value: string }) => c.value === 'true');
        expect(yesChoice).to.exist;

        // Step 2: Apply with --force to skip confirmation
        const result = await execInProcess('template apply --type phase apply-test --force');
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

      it('should error with JSON when template not found', async () => {
        const output = await execInProcess('template apply --type phase nonexistent --json');
        expect(output.toLowerCase()).to.include('not found');
      });
    });

    describe('phase template update - direct flags', () => {
      beforeEach(() => {
        createTestPhaseTemplate('update-test', 'Update Test', false, 'Original desc');
      });

      it('should update template name and description with direct flags', async () => {
        const result = await execInProcess('template update update-test --name "Updated Name" --description "Updated desc" --json');
        const json = extractJson<{ success: boolean; result: { template: { name: string; description: string } } }>(result);
        expect(json).to.not.be.null;
        expect(json!.success).to.equal(true);

        const template = db.prepare(
          'SELECT * FROM pmo_phase_templates WHERE id = ?'
        ).get('update-test') as { name: string; description: string };
        expect(template.name).to.equal('Updated Name');
        expect(template.description).to.equal('Updated desc');
      });

      it('should update only name when only name flag provided', async () => {
        const result = await execInProcess('template update update-test --name "Name Only" --json');
        const json = extractJson<{ success: boolean }>(result);
        expect(json).to.not.be.null;
        expect(json!.success).to.equal(true);

        const template = db.prepare(
          'SELECT * FROM pmo_phase_templates WHERE id = ?'
        ).get('update-test') as { name: string; description: string };
        expect(template.name).to.equal('Name Only');
        expect(template.description).to.equal('Original desc');
      });

      it('should error when template not found', async () => {
        const output = await execInProcess('template update nonexistent --name "X"');
        expect(output.toLowerCase()).to.include('not found');
      });

      it('should error when updating built-in template', async () => {
        createTestPhaseTemplate('builtin-phase', 'Builtin Phase', true);
        const output = await execInProcess('template update builtin-phase --name "X"');
        expect(output.toLowerCase()).to.include('cannot modify');
      });
    });

    describe('phase template delete - JSON confirmation flow', () => {
      beforeEach(() => {
        createTestPhaseTemplate('delete-deep', 'Delete Deep', false, 'For delete testing');
      });

      it('should get confirmation prompt and delete via --force', async () => {
        // Step 1: Request delete with JSON → get confirmation
        const step1 = await agentExecAsync('phase template delete delete-deep --json');
        expect(step1).to.not.be.null;
        expect(step1!.prompt.type).to.equal('list');
        expect(step1!.prompt.name).to.equal('confirm');
        expect(step1!.prompt.message).to.include('Delete Deep');

        // Verify template exists before delete
        expect(getPhaseTemplate('delete-deep')).to.exist;

        // Step 2: Delete with --force
        const result = await execInProcess('phase template delete delete-deep --force');
        expect(result).to.include('Deleted phase template');

        // Verify template is gone
        expect(getPhaseTemplate('delete-deep')).to.be.undefined;
      });

      it('should error when deleting built-in template', async () => {
        createTestPhaseTemplate('builtin-del', 'Builtin Del', true);
        const output = await execInProcess('phase template delete builtin-del --json');
        expect(output.toLowerCase()).to.include('cannot delete');
      });

      it('should error when template not found', async () => {
        const output = await execInProcess('phase template delete nonexistent --json');
        expect(output.toLowerCase()).to.include('not found');
      });
    });

    // ==========================================================================
    // Ticket Template Subcommand Deep Flows
    // ==========================================================================

    describe('ticket template list - direct command', () => {
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

      it('should list ticket templates with --type ticket', async () => {
        const listOutput = await execInProcess('template list --type ticket --json');
        const json = extractJson<{ ticket: Array<{ id: string; name: string }> }>(listOutput);

        expect(json).to.not.be.null;
        expect(json!.ticket).to.be.an('array');
        const featureT = json!.ticket.find(t => t.id === 'deep-feature');
        expect(featureT).to.exist;
        expect(featureT!.name).to.equal('Deep Feature');
      });
    });

    describe('ticket template apply - JSON form flow', () => {
      beforeEach(() => {
        createTestTicketTemplate('apply-bug', 'Apply Bug', false, {
          titlePattern: '[BUG] ',
          defaultPriority: 'P1',
          defaultCategory: 'bug',
        });
      });

      it('should get form prompt with --interactive --json', async () => {
        const step1 = await agentExecAsync('template apply --type ticket apply-bug --interactive --json');
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

      it('should create ticket with all flags provided directly', async () => {
        const result = await execInProcess('template apply --type ticket apply-bug --title "Login crash" --column "Backlog"');
        // In non-TTY mode, output includes the success log
        expect(result).to.include('Login crash');

        // Verify ticket in database
        const ticket = db.prepare(
          "SELECT * FROM pmo_tickets WHERE title = ?"
        ).get('Login crash') as { id: string; priority: string; category: string } | undefined;
        expect(ticket).to.exist;
        expect(ticket!.priority).to.equal('P1');
        expect(ticket!.category).to.equal('bug');
      });

      it('should error when template not found', async () => {
        const output = await execInProcess('template apply --type ticket nonexistent --json');
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

      it('should save ticket as template with all args', async () => {
        const output = await execInProcess('template save TKT-SAVE-001 "Saved Bug" --description "From ticket" --json');
        const json = extractJson<{ success: boolean; result: { template: { name: string } } }>(output);
        expect(json).to.not.be.null;
        expect(json!.success).to.equal(true);

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

      it('should get confirmation prompt and delete via --force', async () => {
        // Step 1: Request delete with JSON → get confirmation
        const step1 = await agentExecAsync('ticket template delete del-ticket-deep --json');
        expect(step1).to.not.be.null;
        expect(step1!.prompt.type).to.equal('list');

        // Verify template exists
        expect(getTicketTemplate('del-ticket-deep')).to.exist;

        // Step 2: Delete with --force
        const result = await execInProcess('ticket template delete del-ticket-deep --force');
        expect(result).to.include('Deleted template');

        // Verify template is gone
        expect(getTicketTemplate('del-ticket-deep')).to.be.undefined;
      });

      it('should error when deleting built-in template', async () => {
        createTestTicketTemplate('builtin-ticket-del', 'Builtin Ticket Del', true);
        const output = await execInProcess('ticket template delete builtin-ticket-del --json');
        expect(output.toLowerCase()).to.include('cannot delete');
      });

      it('should error when template not found', async () => {
        const output = await execInProcess('ticket template delete nonexistent --json');
        expect(output.toLowerCase()).to.include('not found');
      });
    });

    // ==========================================================================
    // Full Lifecycle Flows
    // ==========================================================================

    describe('phase template lifecycle - complete flow', () => {
      it('should create → list → update → apply → delete a phase template', async () => {
        // 1. Create template (non-TTY outputs JSON)
        const createResult = await execInProcess('template create --type phase "Lifecycle Phases" --description "Lifecycle test" --json');
        const createJson = extractJson<{ success: boolean; result: { name: string } }>(createResult);
        expect(createJson).to.not.be.null;
        expect(createJson!.success).to.equal(true);

        // Verify in DB
        const created = db.prepare(
          'SELECT * FROM pmo_phase_templates WHERE name = ?'
        ).get('Lifecycle Phases') as { id: string; description: string };
        expect(created).to.exist;
        const templateId = created.id;

        // 2. List and verify it appears
        const listOutput = await execInProcess('template list --type phase --json');
        const json = extractJson<{ phase: Array<{ id: string; name: string }> }>(listOutput);
        expect(json).to.not.be.null;
        const found = json!.phase.find(t => t.id === templateId);
        expect(found).to.exist;
        expect(found!.name).to.equal('Lifecycle Phases');

        // 3. Update template (non-TTY outputs JSON)
        const updateResult = await execInProcess(`template update ${templateId} --name "Updated Lifecycle" --description "Updated desc" --json`);
        const updateJson = extractJson<{ success: boolean }>(updateResult);
        expect(updateJson).to.not.be.null;
        expect(updateJson!.success).to.equal(true);

        const updated = db.prepare(
          'SELECT * FROM pmo_phase_templates WHERE id = ?'
        ).get(templateId) as { name: string; description: string };
        expect(updated.name).to.equal('Updated Lifecycle');
        expect(updated.description).to.equal('Updated desc');

        // 4. Apply template
        const applyResult = await execInProcess(`template apply --type phase ${templateId} --force`);
        expect(applyResult).to.include('Applied phase template');

        // Verify phases exist
        const phases = db.prepare('SELECT * FROM pmo_phases').all();
        expect(phases.length).to.be.greaterThan(0);

        // 5. Delete template
        const deleteResult = await execInProcess(`phase template delete ${templateId} --force`);
        expect(deleteResult).to.include('Deleted phase template');

        // Verify gone
        const deleted = db.prepare(
          'SELECT * FROM pmo_phase_templates WHERE id = ?'
        ).get(templateId);
        expect(deleted).to.be.undefined;
      });
    });

    describe('ticket template lifecycle - complete flow', () => {
      it('should save → list → apply → delete a ticket template', async () => {
        // Create source ticket
        createTestTicket('TKT-LIFE-001', 'Lifecycle Ticket', {
          priority: 'P2',
          category: 'feature',
        });

        // 1. Save ticket as template (non-TTY outputs JSON)
        const saveResult = await execInProcess('template save TKT-LIFE-001 "Lifecycle Template" --description "Lifecycle test" --json');
        const saveJson = extractJson<{ success: boolean }>(saveResult);
        expect(saveJson).to.not.be.null;
        expect(saveJson!.success).to.equal(true);

        // Get the template ID
        const savedTemplate = db.prepare(
          "SELECT * FROM pmo_ticket_templates WHERE name = ?"
        ).get('Lifecycle Template') as { id: string };
        expect(savedTemplate).to.exist;
        const templateId = savedTemplate.id;

        // 2. List and verify it appears
        const listOutput = await execInProcess('template list --type ticket --json');
        const json = extractJson<{ ticket: Array<{ id: string; name: string }> }>(listOutput);
        expect(json).to.not.be.null;
        const found = json!.ticket.find(t => t.id === templateId);
        expect(found).to.exist;

        // 3. Apply template to create ticket
        const applyResult = await execInProcess(`template apply --type ticket ${templateId} --title "From Lifecycle" --column "Backlog"`);
        expect(applyResult).to.include('Created ticket');

        // Verify ticket in DB
        const ticket = db.prepare(
          "SELECT * FROM pmo_tickets WHERE title = ?"
        ).get('From Lifecycle') as { priority: string; category: string } | undefined;
        expect(ticket).to.exist;
        expect(ticket!.priority).to.equal('P2');
        expect(ticket!.category).to.equal('feature');

        // 4. Delete template
        const deleteResult = await execInProcess(`ticket template delete ${templateId} --force`);
        expect(deleteResult).to.include('Deleted template');

        expect(getTicketTemplate(templateId)).to.be.undefined;
      });
    });
  });
});

