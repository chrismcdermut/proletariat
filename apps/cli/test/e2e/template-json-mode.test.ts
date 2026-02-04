import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import {
  createTestEnvironment,
  cleanupTestEnvironment,
  createHQConfig,
  createPMODirectories,
  exec,
  type TestEnvironment,
} from './test-helpers.js';

/**
 * Extract JSON from CLI output that may contain warnings.
 * Looks for the first line starting with { or [ and parses from there.
 */
function extractJson<T>(output: string): T {
  const lines = output.split('\n');
  let jsonStart = -1;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      jsonStart = i;
      break;
    }
  }

  if (jsonStart === -1) {
    throw new Error(`No JSON found in output: ${output.substring(0, 500)}...`);
  }

  const jsonLines = lines.slice(jsonStart).join('\n');
  return JSON.parse(jsonLines) as T;
}

interface AgentPrompt {
  prompt?: {
    type: string;
    name: string;
    message: string;
    choices?: Array<{ name: string; value: string; command?: string }>;
    context?: Record<string, unknown>;
    default?: string;
  };
  success?: boolean;
  result?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
  };
  metadata: {
    command: string;
    flags: Record<string, unknown>;
  };
}

/**
 * E2E tests for template commands JSON mode.
 *
 * Tests verify that:
 * 1. Template menu commands support --json/--machine flags
 * 2. All sub-commands produce valid JSON prompt schemas
 * 3. Full multi-step agent flows complete successfully
 * 4. New FlagResolver-based commands (create, update, save) output proper prompts
 */
describe('Template Commands JSON Mode', () => {
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

  // Helpers
  function agentExec(cmd: string): AgentPrompt {
    const output = exec(cmd);
    return extractJson<AgentPrompt>(output);
  }

  function findChoice(
    choices: Array<{ name: string; value: string; command?: string }>,
    pattern: string
  ): { name: string; value: string; command?: string } | undefined {
    return choices.find(c => c.name.toLowerCase().includes(pattern.toLowerCase()));
  }

  function findChoiceByValue(
    choices: Array<{ name: string; value: string; command?: string }>,
    value: string
  ): { name: string; value: string; command?: string } | undefined {
    return choices.find(c => c.value === value);
  }

  function execChoice(choice: { command?: string }): string {
    if (!choice.command) {
      throw new Error('Choice has no command field');
    }
    return choice.command.replace('prlt ', '');
  }

  function execFinal(cmd: string): string {
    return exec(cmd.replace(/ --json/g, '').replace(/ --machine/g, ''));
  }

  function createTestTicket(id: string, title: string, options: {
    priority?: string;
    category?: string;
    description?: string;
  } = {}): void {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO pmo_tickets (id, project_id, title, description, priority, category, status, status_id, labels, created_at, updated_at)
      VALUES (?, 'test-project', ?, ?, ?, ?, 'backlog', 'status-backlog', '[]', ?, ?)
    `).run(id, title, options.description || null, options.priority || null, options.category || null, now, now);

    db.prepare(`
      INSERT INTO pmo_board_tickets (project_id, ticket_id, column_id, position)
      VALUES ('test-project', ?, 'backlog', 0)
    `).run(id);
  }

  // ===========================================================================
  // Template menu navigation tests
  // ===========================================================================

  describe('template index --json (main menu)', () => {
    it('should output valid JSON with action selection prompt', () => {
      const result = agentExec('template --json');

      expect(result.prompt).to.exist;
      expect(result.prompt!.type).to.equal('list');
      expect(result.prompt!.name).to.equal('action');
      expect(result.metadata.command).to.equal('template');

      const values = result.prompt!.choices!.map(c => c.value);
      expect(values).to.include('list');
      expect(values).to.include('ticket');
      expect(values).to.include('phase');
    });
  });

  describe('template phase --json (phase sub-menu)', () => {
    it('should output valid JSON with action selection prompt', () => {
      const result = agentExec('template phase --json');

      expect(result.prompt).to.exist;
      expect(result.prompt!.type).to.equal('list');
      expect(result.prompt!.name).to.equal('action');
      expect(result.metadata.command).to.equal('template phase');

      const values = result.prompt!.choices!.map(c => c.value);
      expect(values).to.include('list');
      expect(values).to.include('apply');
      expect(values).to.include('create');
      expect(values).to.include('update');
      expect(values).to.include('delete');
    });
  });

  describe('template ticket --json (ticket sub-menu)', () => {
    it('should output valid JSON with action selection prompt', () => {
      const result = agentExec('template ticket --json');

      expect(result.prompt).to.exist;
      expect(result.prompt!.type).to.equal('list');
      expect(result.prompt!.name).to.equal('action');
      expect(result.metadata.command).to.equal('template ticket');

      const values = result.prompt!.choices!.map(c => c.value);
      expect(values).to.include('list');
      expect(values).to.include('apply');
      expect(values).to.include('save');
      expect(values).to.include('delete');
    });
  });

  // ===========================================================================
  // Phase template sub-commands
  // ===========================================================================

  describe('phase template list --json', () => {
    it('should output JSON list of phase templates', () => {
      const output = exec('phase template list --json');
      const templates = JSON.parse(output);

      expect(templates).to.be.an('array');
      expect(templates.length).to.be.at.least(2);
      expect(templates.some((t: { id: string }) => t.id === 'default')).to.be.true;
      expect(templates.some((t: { id: string }) => t.id === 'agile')).to.be.true;
    });
  });

  describe('phase template create --json (NEW)', () => {
    it('should output name input prompt when no name provided', () => {
      const result = agentExec('phase template create --json');

      expect(result.prompt).to.exist;
      expect(result.prompt!.type).to.equal('input');
      expect(result.prompt!.name).to.equal('name');
      expect(result.prompt!.message).to.include('name');
      expect(result.metadata.command).to.equal('phase template create');
    });

    it('should output description prompt when name provided but not description', () => {
      const result = agentExec('phase template create "Test Template" --json');

      expect(result.prompt).to.exist;
      expect(result.prompt!.type).to.equal('input');
      expect(result.prompt!.name).to.equal('description');
      expect(result.prompt!.message).to.include('escription');
    });

    it('should output success JSON when all args provided', () => {
      const result = agentExec('phase template create "Full Args Template" --description "A test template" --json');

      expect(result.success).to.be.true;
      expect(result.result).to.exist;
      expect(result.result!.name).to.equal('Full Args Template');
      expect(result.result!.description).to.equal('A test template');
      expect(result.result!.phaseCount).to.be.a('number');
      expect((result.result!.phaseCount as number)).to.be.greaterThan(0);

      // Verify in database
      const template = db.prepare('SELECT * FROM pmo_phase_templates WHERE name = ?').get('Full Args Template') as { id: string } | undefined;
      expect(template).to.not.be.undefined;
    });

    it('should include hint context for input prompts', () => {
      const result = agentExec('phase template create --json');

      expect(result.prompt).to.exist;
      expect(result.prompt!.context).to.exist;
      expect(result.prompt!.context!.hint).to.be.a('string');
    });
  });

  describe('phase template update --json (NEW)', () => {
    beforeEach(() => {
      // Create a custom template to update (provide all args to avoid interactive prompts)
      exec('phase template create "Updatable Template" --description "For update tests"');
    });

    it('should output template selection prompt when no ID provided', () => {
      const result = agentExec('phase template update --json');

      expect(result.prompt).to.exist;
      expect(result.prompt!.type).to.equal('list');
      expect(result.prompt!.name).to.equal('id');
      expect(result.prompt!.choices).to.be.an('array');
      expect(result.prompt!.choices!.length).to.be.greaterThan(0);
      expect(result.metadata.command).to.equal('phase template update');

      // Should only show editable (non-builtin) templates
      const choice = findChoice(result.prompt!.choices!, 'Updatable Template');
      expect(choice).to.exist;
    });

    it('should include --json in template selection commands', () => {
      const result = agentExec('phase template update --json');

      expect(result.prompt).to.exist;
      for (const choice of result.prompt!.choices!) {
        if (choice.command) {
          expect(choice.command).to.include('--json');
        }
      }
    });

    it('should output name/description prompt when ID provided but no flags', () => {
      const result = agentExec('phase template update updatable-template --json');

      expect(result.prompt).to.exist;
      expect(result.prompt!.type).to.equal('input');
      expect(result.prompt!.name).to.equal('name');
    });

    it('should output success JSON when all flags provided', () => {
      const result = agentExec('phase template update updatable-template --name "Renamed Template" --json');

      expect(result.success).to.be.true;
      expect(result.result).to.exist;
      expect(result.result!.name).to.equal('Renamed Template');

      // Verify in database
      const template = db.prepare('SELECT name FROM pmo_phase_templates WHERE id = ?').get('updatable-template') as { name: string } | undefined;
      expect(template).to.not.be.undefined;
      expect(template!.name).to.equal('Renamed Template');
    });

    it('should error when no editable templates exist', () => {
      // Delete the custom template
      exec('phase template delete updatable-template --force');

      const result = agentExec('phase template update --json');

      expect(result.error).to.exist;
      expect(result.error!.code).to.equal('NO_EDITABLE_TEMPLATES');
    });
  });

  describe('phase template delete --json', () => {
    beforeEach(() => {
      exec('phase template create "Deletable Template" --description "For delete tests"');
    });

    it('should output confirmation prompt when ID provided', () => {
      const result = agentExec('phase template delete deletable-template --json');

      expect(result.prompt).to.exist;
      expect(result.prompt!.type).to.equal('list');
      expect(result.prompt!.name).to.equal('confirmed');
    });

    it('should error when template not found', () => {
      const result = agentExec('phase template delete non-existent --json');

      expect(result.error).to.exist;
      expect(result.error!.code).to.equal('TEMPLATE_NOT_FOUND');
    });
  });

  describe('phase template apply --json', () => {
    it('should output confirmation prompt when template ID provided', () => {
      const result = agentExec('phase template apply agile --json');

      expect(result.prompt).to.exist;
      expect(result.prompt!.type).to.equal('list');
      expect(result.prompt!.name).to.equal('confirmed');
    });

    it('should error when template not found', () => {
      const result = agentExec('phase template apply non-existent --json');

      expect(result.error).to.exist;
      expect(result.error!.code).to.equal('TEMPLATE_NOT_FOUND');
    });
  });

  // ===========================================================================
  // Ticket template sub-commands
  // ===========================================================================

  describe('ticket template list --json', () => {
    it('should output JSON list of ticket templates', () => {
      const output = exec('ticket template list --json');
      const templates = JSON.parse(output);

      expect(templates).to.be.an('array');
      expect(templates.length).to.be.at.least(3);
      expect(templates.some((t: { id: string }) => t.id === 'bug-report')).to.be.true;
      expect(templates.some((t: { id: string }) => t.id === 'feature-request')).to.be.true;
    });
  });

  describe('ticket template save --json (NEW)', () => {
    beforeEach(() => {
      createTestTicket('TKT-SAVE-1', 'Save test ticket', {
        priority: 'HIGH',
        category: 'feature',
        description: 'A ticket to save as template',
      });
      createTestTicket('TKT-SAVE-2', 'Another ticket', {
        priority: 'LOW',
        category: 'bug',
      });
    });

    it('should output ticket selection prompt when no ticket provided', () => {
      const result = agentExec('ticket template save -P test-project --json');

      expect(result.prompt).to.exist;
      expect(result.prompt!.type).to.equal('list');
      expect(result.prompt!.name).to.equal('ticket');
      expect(result.prompt!.choices).to.be.an('array');
      expect(result.prompt!.choices!.length).to.be.greaterThan(0);
      expect(result.metadata.command).to.equal('ticket template save');
    });

    it('should include ticket IDs in choices', () => {
      const result = agentExec('ticket template save -P test-project --json');

      expect(result.prompt).to.exist;
      const choice = findChoice(result.prompt!.choices!, 'TKT-SAVE-1');
      expect(choice).to.exist;
    });

    it('should include --json in ticket selection commands', () => {
      const result = agentExec('ticket template save -P test-project --json');

      expect(result.prompt).to.exist;
      for (const choice of result.prompt!.choices!) {
        if (choice.command) {
          expect(choice.command).to.include('--json');
        }
      }
    });

    it('should output name prompt when ticket provided but no name', () => {
      const result = agentExec('ticket template save TKT-SAVE-1 -P test-project --json');

      expect(result.prompt).to.exist;
      expect(result.prompt!.type).to.equal('input');
      expect(result.prompt!.name).to.equal('name');
      expect(result.prompt!.message).to.include('name');
    });

    it('should output description prompt when ticket and name provided', () => {
      const result = agentExec('ticket template save TKT-SAVE-1 "My Save Template" -P test-project --json');

      expect(result.prompt).to.exist;
      expect(result.prompt!.type).to.equal('input');
      expect(result.prompt!.name).to.equal('description');
    });

    it('should output success JSON when all args provided', () => {
      const result = agentExec('ticket template save TKT-SAVE-1 "Full Save Template" --description "From ticket" -P test-project --json');

      expect(result.success).to.be.true;
      expect(result.result).to.exist;
      expect(result.result!.name).to.equal('Full Save Template');
      expect(result.result!.ticketId).to.equal('TKT-SAVE-1');

      // Verify in database
      const template = db.prepare('SELECT * FROM pmo_ticket_templates WHERE name = ?').get('Full Save Template') as { id: string } | undefined;
      expect(template).to.not.be.undefined;
    });

    it('should error when no tickets available', () => {
      // Clear all tickets
      db.exec('DELETE FROM pmo_board_tickets');
      db.exec('DELETE FROM pmo_tickets');

      const result = agentExec('ticket template save -P test-project --json');

      expect(result.error).to.exist;
      expect(result.error!.code).to.equal('NO_TICKETS');
    });

    it('should error when ticket not found', () => {
      const result = agentExec('ticket template save TKT-NONEXISTENT -P test-project --json');

      expect(result.error).to.exist;
      expect(result.error!.code).to.equal('TICKET_NOT_FOUND');
    });
  });

  describe('ticket template delete --json', () => {
    beforeEach(() => {
      createTestTicket('TKT-DEL-1', 'Delete source ticket');
      exec('ticket template save TKT-DEL-1 "Deletable Ticket Template" --description "For delete" -P test-project');
    });

    it('should output confirmation prompt when ID provided', () => {
      const result = agentExec('ticket template delete deletable-ticket-template --json');

      // selectFromList outputs with name 'selection'
      expect(result.prompt).to.exist;
      expect(result.prompt!.type).to.equal('list');
    });

    it('should error when template not found', () => {
      const result = agentExec('ticket template delete non-existent --json');

      expect(result.error).to.exist;
      expect(result.error!.code).to.equal('TEMPLATE_NOT_FOUND');
    });
  });

  describe('ticket template apply --json', () => {
    it('should output form prompt when template provided with --interactive', () => {
      const result = agentExec('ticket template apply bug-report -P test-project --interactive --json');

      expect(result.prompt).to.exist;
    });

    it('should create ticket from template with all flags (no prompt)', () => {
      const output = exec('ticket template apply bug-report --title "Test Bug" -P test-project');

      expect(output).to.include('Created ticket');
      expect(output).to.include('Bug Report');
    });
  });

  // ===========================================================================
  // Full multi-step agent flows
  // ===========================================================================

  describe('Full agent flows', () => {
    describe('template → phase → create flow', () => {
      it('should complete full flow: template menu → phase → create → name → description → verify created', () => {
        // Step 1: Template main menu
        const step1 = agentExec('template --json');
        expect(step1.prompt).to.exist;
        const phaseChoice = findChoiceByValue(step1.prompt!.choices!, 'phase');
        expect(phaseChoice).to.exist;

        // Step 2: Phase sub-menu
        const step2 = agentExec('template phase --json');
        expect(step2.prompt).to.exist;
        const createChoice = findChoiceByValue(step2.prompt!.choices!, 'create');
        expect(createChoice).to.exist;

        // Step 3: Phase template create - gets name prompt
        const step3 = agentExec('phase template create --json');
        expect(step3.prompt).to.exist;
        expect(step3.prompt!.type).to.equal('input');
        expect(step3.prompt!.name).to.equal('name');

        // Step 4: Provide name (as positional arg), get description prompt
        const step4 = agentExec('phase template create "Flow Test Phases" --json');
        expect(step4.prompt).to.exist;
        expect(step4.prompt!.type).to.equal('input');
        expect(step4.prompt!.name).to.equal('description');

        // Step 5: Provide both name and description, get success
        const step5 = agentExec('phase template create "Flow Test Phases 2" --description "Created via flow" --json');
        expect(step5.success).to.be.true;
        expect(step5.result).to.exist;
        expect(step5.result!.name).to.equal('Flow Test Phases 2');

        // Verify in database
        const template = db.prepare('SELECT * FROM pmo_phase_templates WHERE name = ?').get('Flow Test Phases 2') as { id: string; description: string } | undefined;
        expect(template).to.not.be.undefined;
        expect(template!.description).to.equal('Created via flow');
      });
    });

    describe('template → phase → update flow', () => {
      beforeEach(() => {
        exec('phase template create "Update Flow Template" --description "For update flow"');
      });

      it('should complete flow: phase menu → update → select template → get name prompt', () => {
        // Step 1: Phase sub-menu
        const step1 = agentExec('template phase --json');
        expect(step1.prompt).to.exist;
        const updateChoice = findChoiceByValue(step1.prompt!.choices!, 'update');
        expect(updateChoice).to.exist;

        // Step 2: Get template selection
        const step2 = agentExec('phase template update --json');
        expect(step2.prompt).to.exist;
        expect(step2.prompt!.type).to.equal('list');
        expect(step2.prompt!.name).to.equal('id');

        const templateChoice = findChoice(step2.prompt!.choices!, 'Update Flow Template');
        expect(templateChoice).to.exist;
        expect(templateChoice!.command).to.include('--json');

        // Step 3: Follow command from choice to get name/description prompt
        const step3Cmd = execChoice(templateChoice!);
        const step3 = agentExec(step3Cmd);
        expect(step3.prompt).to.exist;
        expect(step3.prompt!.type).to.equal('input');
        expect(step3.prompt!.name).to.equal('name');
      });

      it('should complete full update with flags', () => {
        const result = agentExec('phase template update update-flow-template --name "Renamed Flow" --json');

        expect(result.success).to.be.true;
        expect(result.result).to.exist;
        expect(result.result!.name).to.equal('Renamed Flow');

        // Verify in database
        const template = db.prepare('SELECT name FROM pmo_phase_templates WHERE id = ?').get('update-flow-template') as { name: string } | undefined;
        expect(template!.name).to.equal('Renamed Flow');
      });
    });

    describe('template → ticket → save flow', () => {
      beforeEach(() => {
        createTestTicket('TKT-FLOW-1', 'Flow save ticket', {
          priority: 'MEDIUM',
          category: 'feature',
        });
      });

      it('should complete flow: template menu → ticket → save → select ticket → name prompt', () => {
        // Step 1: Template main menu
        const step1 = agentExec('template --json');
        expect(step1.prompt).to.exist;
        const ticketChoice = findChoiceByValue(step1.prompt!.choices!, 'ticket');
        expect(ticketChoice).to.exist;

        // Step 2: Ticket sub-menu
        const step2 = agentExec('template ticket --json');
        expect(step2.prompt).to.exist;
        const saveChoice = findChoiceByValue(step2.prompt!.choices!, 'save');
        expect(saveChoice).to.exist;

        // Step 3: Ticket template save - gets ticket selection
        const step3 = agentExec('ticket template save -P test-project --json');
        expect(step3.prompt).to.exist;
        expect(step3.prompt!.type).to.equal('list');
        expect(step3.prompt!.name).to.equal('ticket');

        const tktChoice = findChoice(step3.prompt!.choices!, 'TKT-FLOW-1');
        expect(tktChoice).to.exist;
        expect(tktChoice!.command).to.include('--json');

        // Step 4: Select ticket, get name prompt
        const step4 = agentExec('ticket template save TKT-FLOW-1 -P test-project --json');
        expect(step4.prompt).to.exist;
        expect(step4.prompt!.type).to.equal('input');
        expect(step4.prompt!.name).to.equal('name');
      });

      it('should complete full save with all args', () => {
        const result = agentExec('ticket template save TKT-FLOW-1 "Flow Template" --description "Saved via flow" -P test-project --json');

        expect(result.success).to.be.true;
        expect(result.result).to.exist;
        expect(result.result!.name).to.equal('Flow Template');
        expect(result.result!.ticketId).to.equal('TKT-FLOW-1');

        // Verify in database
        const template = db.prepare('SELECT * FROM pmo_ticket_templates WHERE name = ?').get('Flow Template') as { id: string; default_priority: string } | undefined;
        expect(template).to.not.be.undefined;
        expect(template!.default_priority).to.equal('MEDIUM');
      });
    });

    describe('template → phase → delete flow', () => {
      beforeEach(() => {
        exec('phase template create "Delete Flow Template" --description "For delete flow"');
      });

      it('should complete flow: phase menu → delete → confirmation → execute', () => {
        // Step 1: Phase sub-menu
        const step1 = agentExec('template phase --json');
        expect(step1.prompt).to.exist;
        const deleteChoice = findChoiceByValue(step1.prompt!.choices!, 'delete');
        expect(deleteChoice).to.exist;

        // Step 2: Provide template ID, get confirmation prompt
        const step2 = agentExec('phase template delete delete-flow-template --json');
        expect(step2.prompt).to.exist;
        expect(step2.prompt!.name).to.equal('confirmed');

        // Step 3: Execute with --force to actually delete
        const finalOutput = exec('phase template delete delete-flow-template --force');
        expect(finalOutput).to.include('Deleted');

        // Verify in database
        const template = db.prepare('SELECT * FROM pmo_phase_templates WHERE id = ?').get('delete-flow-template');
        expect(template).to.be.undefined;
      });
    });

    describe('template → phase → apply flow', () => {
      it('should complete flow: phase menu → apply → select template → confirmation', () => {
        // Step 1: Phase sub-menu
        const step1 = agentExec('template phase --json');
        expect(step1.prompt).to.exist;
        const applyChoice = findChoiceByValue(step1.prompt!.choices!, 'apply');
        expect(applyChoice).to.exist;

        // Step 2: Apply - should get confirmation (workspace already has phases)
        const step2 = agentExec('phase template apply agile --json');
        expect(step2.prompt).to.exist;
        expect(step2.prompt!.name).to.equal('confirmed');

        // Step 3: Execute with --force to actually apply
        const finalOutput = exec('phase template apply agile --force');
        expect(finalOutput).to.include('Applied phase template');

        // Verify in database
        const phases = db.prepare('SELECT name FROM pmo_phases').all() as { name: string }[];
        const names = phases.map(p => p.name);
        expect(names).to.include('In Sprint');
      });
    });

    describe('template → phase → list flow', () => {
      it('should complete flow: phase menu → list → get JSON template list', () => {
        // Step 1: Phase sub-menu
        const step1 = agentExec('template phase --json');
        expect(step1.prompt).to.exist;
        const listChoice = findChoiceByValue(step1.prompt!.choices!, 'list');
        expect(listChoice).to.exist;

        // Step 2: List - outputs JSON array directly
        const output = exec('phase template list --json');
        const templates = JSON.parse(output);
        expect(templates).to.be.an('array');
        expect(templates.length).to.be.at.least(2);
      });
    });

    describe('template → ticket → list flow', () => {
      it('should complete flow: ticket menu → list → get JSON template list', () => {
        // Step 1: Ticket sub-menu
        const step1 = agentExec('template ticket --json');
        expect(step1.prompt).to.exist;
        const listChoice = findChoiceByValue(step1.prompt!.choices!, 'list');
        expect(listChoice).to.exist;

        // Step 2: List - outputs JSON array directly
        const output = exec('ticket template list --json');
        const templates = JSON.parse(output);
        expect(templates).to.be.an('array');
        expect(templates.length).to.be.at.least(3);
      });
    });
  });
});

// ===========================================================================
// Database Setup
// ===========================================================================

function setupTestDatabase(db: Database.Database, pmoPath: string) {
  // Minimal table setup - only create tables we need to pre-populate with data.
  // The CLI's SQLiteStorage.ensurePMOTables() will auto-create all other tables
  // with the correct schema via CREATE TABLE IF NOT EXISTS.
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

    CREATE TABLE IF NOT EXISTS pmo_columns (
      id TEXT NOT NULL,
      project_id TEXT NOT NULL DEFAULT 'default',
      name TEXT NOT NULL,
      position INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (project_id, id)
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

    CREATE TABLE IF NOT EXISTS pmo_board_tickets (
      project_id TEXT NOT NULL,
      ticket_id TEXT NOT NULL,
      column_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (project_id, ticket_id),
      FOREIGN KEY (project_id) REFERENCES pmo_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (ticket_id) REFERENCES pmo_tickets(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id, column_id) REFERENCES pmo_columns(project_id, id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS pmo_ticket_metadata (
      ticket_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT,
      PRIMARY KEY (ticket_id, key),
      FOREIGN KEY (ticket_id) REFERENCES pmo_tickets(id) ON DELETE CASCADE
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

    CREATE INDEX IF NOT EXISTS idx_pmo_tickets_project ON pmo_tickets(project_id);
    CREATE INDEX IF NOT EXISTS idx_pmo_tickets_status ON pmo_tickets(status);
    CREATE INDEX IF NOT EXISTS idx_pmo_tickets_status_id ON pmo_tickets(status_id);
  `);

  // Insert workflow
  db.prepare(`
    INSERT INTO pmo_workflows (id, name, description, is_builtin)
    VALUES ('default', 'Default', 'Default kanban workflow', 1)
  `).run();

  // Insert workflow statuses
  const workflowStatuses = [
    { id: 'status-backlog', name: 'Backlog', category: 'backlog', position: 0, isDefault: 1 },
    { id: 'status-in-progress', name: 'In Progress', category: 'started', position: 1 },
    { id: 'status-done', name: 'Done', category: 'completed', position: 2 },
  ];

  for (const status of workflowStatuses) {
    db.prepare(`
      INSERT INTO pmo_workflow_statuses (id, workflow_id, name, category, position, is_default)
      VALUES (?, 'default', ?, ?, ?, ?)
    `).run(status.id, status.name, status.category, status.position, status.isDefault || 0);
  }

  // Seed default phases
  const defaultPhases = [
    { id: 'idea', name: 'Idea', category: 'backlog', position: 0, description: 'Project concept', isDefault: 1 },
    { id: 'planned', name: 'Planned', category: 'unstarted', position: 0, description: 'Scheduled for work' },
    { id: 'active', name: 'Active', category: 'started', position: 0, description: 'Work in progress' },
    { id: 'completed', name: 'Completed', category: 'completed', position: 0, description: 'Finished' },
    { id: 'canceled', name: 'Canceled', category: 'canceled', position: 0, description: 'Won\'t be done' },
  ];

  for (const phase of defaultPhases) {
    db.prepare(`
      INSERT INTO pmo_phases (id, name, category, position, description, is_default)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(phase.id, phase.name, phase.category, phase.position, phase.description, phase.isDefault || 0);
  }

  // Seed built-in phase templates
  const builtinPhaseTemplates = [
    {
      id: 'default',
      name: 'Default',
      description: 'Standard project lifecycle phases',
      phases: JSON.stringify([
        { name: 'Idea', category: 'backlog', position: 0, description: 'Project concept', isDefault: true },
        { name: 'Planned', category: 'unstarted', position: 0, description: 'Scheduled for work' },
        { name: 'Active', category: 'started', position: 0, description: 'Work in progress' },
        { name: 'Completed', category: 'completed', position: 0, description: 'Finished' },
        { name: 'Canceled', category: 'canceled', position: 0, description: 'Won\'t be done' },
      ]),
    },
    {
      id: 'agile',
      name: 'Agile',
      description: 'Agile/Scrum project phases',
      phases: JSON.stringify([
        { name: 'Backlog', category: 'backlog', position: 0, description: 'Not yet prioritized' },
        { name: 'Groomed', category: 'unstarted', position: 0, description: 'Ready to be picked up' },
        { name: 'In Sprint', category: 'started', position: 0, description: 'Actively being worked on', isDefault: true },
        { name: 'Done', category: 'completed', position: 0, description: 'Sprint work completed' },
        { name: 'Dropped', category: 'canceled', position: 0, description: 'Removed from backlog' },
      ]),
    },
    {
      id: 'product',
      name: 'Product',
      description: 'Product development lifecycle',
      phases: JSON.stringify([
        { name: 'Discovery', category: 'backlog', position: 0, description: 'Research and exploration' },
        { name: 'Definition', category: 'unstarted', position: 0, description: 'Requirements and specs', isDefault: true },
        { name: 'Development', category: 'started', position: 0, description: 'Building the product' },
        { name: 'Launch', category: 'completed', position: 0, description: 'Shipped to users' },
        { name: 'Growth', category: 'completed', position: 1, description: 'Post-launch iteration' },
        { name: 'Sunset', category: 'canceled', position: 0, description: 'End of life' },
      ]),
    },
  ];

  for (const template of builtinPhaseTemplates) {
    db.prepare(`
      INSERT INTO pmo_phase_templates (id, name, description, is_builtin, phases)
      VALUES (?, ?, ?, 1, ?)
    `).run(template.id, template.name, template.description, template.phases);
  }

  // Seed built-in ticket templates
  const builtinTicketTemplates = [
    {
      id: 'bug-report',
      name: 'Bug Report',
      description: 'Template for reporting bugs with reproduction steps',
      titlePattern: '[BUG] ',
      defaultPriority: 'HIGH',
      defaultCategory: 'bug',
      suggestedSubtasks: [
        { title: 'Reproduce the bug' },
        { title: 'Identify root cause' },
        { title: 'Implement fix' },
        { title: 'Add regression test' },
      ],
    },
    {
      id: 'feature-request',
      name: 'Feature Request',
      description: 'Template for new feature requests',
      titlePattern: '[FEATURE] ',
      defaultPriority: 'MEDIUM',
      defaultCategory: 'feature',
      suggestedSubtasks: [
        { title: 'Design implementation approach' },
        { title: 'Implement feature' },
        { title: 'Add tests' },
        { title: 'Update documentation' },
      ],
    },
    {
      id: 'task',
      name: 'Task',
      description: 'General task template',
      defaultPriority: 'MEDIUM',
      defaultCategory: 'chore',
      suggestedSubtasks: [],
    },
  ];

  const now = new Date().toISOString();
  for (const template of builtinTicketTemplates) {
    db.prepare(`
      INSERT OR IGNORE INTO pmo_ticket_templates (
        id, name, description, is_builtin, title_pattern, description_template,
        default_priority, default_category, default_status_id, default_assignee,
        default_owner, default_labels, suggested_subtasks, created_at
      )
      VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      template.id,
      template.name,
      template.description || null,
      template.titlePattern || null,
      null,
      template.defaultPriority || null,
      template.defaultCategory || null,
      null,
      null,
      null,
      '[]',
      JSON.stringify(template.suggestedSubtasks || []),
      now
    );
  }

  // Create test project with workflow
  db.prepare(`
    INSERT INTO pmo_projects (id, name, template, phase_id, workflow_id, is_archived)
    VALUES ('test-project', 'Test Project', 'kanban', 'idea', 'default', 0)
  `).run();

  db.prepare(`INSERT INTO pmo_settings (key, value) VALUES ('pmo_path', ?)`).run(pmoPath);
  db.prepare(`INSERT INTO pmo_settings (key, value) VALUES ('current_project', 'test-project')`).run();

  // Create columns for test project (legacy, but still needed for some code paths)
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

  // Create PMO project directory
  const projectPath = path.join(pmoPath, 'projects', 'test-project');
  fs.mkdirSync(projectPath, { recursive: true });

  // Create specs directory
  const specsPath = path.join(pmoPath, 'specs');
  fs.mkdirSync(specsPath, { recursive: true });
}
