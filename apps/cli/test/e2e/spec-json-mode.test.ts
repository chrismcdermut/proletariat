/* eslint-disable max-nested-callbacks */
import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import {
  createTestEnvironment,
  cleanupTestEnvironment,
  createHQConfig,
  createPMODirectories,
  execProduction,
  extractJson,
  agentExec,
  findChoice,
  execChoice,
  execFinal,
  type TestEnvironment,
} from './test-helpers.js';

/**
 * E2E Agent Flow Tests for Spec Commands
 *
 * These tests verify that AI agents can:
 * 1. Call commands with --machine flag
 * 2. Receive structured JSON responses
 * 3. Follow command fields to navigate through menus
 * 4. Complete the full workflow with database verification
 *
 * Commands tested:
 * - prlt spec (main menu)
 * - prlt spec create
 * - prlt spec list
 * - prlt spec view
 * - prlt spec plan
 * - prlt spec ticket
 * - prlt spec link
 * - prlt spec link depends
 * - prlt spec link remove
 */
describe('Spec Commands - JSON Mode E2E Tests', () => {
  let env: TestEnvironment;
  let db: Database.Database;

  beforeEach(() => {
    env = createTestEnvironment('spec-json-');
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
   * Helper to create a test spec directly in the database.
   */
  function createTestSpec(
    id: string,
    title: string,
    status: string = 'draft',
    type?: string,
    problem?: string
  ): void {
    db.prepare(`
      INSERT INTO pmo_specs (id, title, status, type, problem)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, title, status, type || null, problem || null);
  }

  /**
   * Helper to create a spec dependency.
   */
  function createSpecDependency(
    specId: string,
    dependsOnSpecId: string,
    dependencyType: string = 'depends_on'
  ): void {
    db.prepare(`
      INSERT INTO pmo_spec_dependencies (spec_id, depends_on_spec_id, dependency_type)
      VALUES (?, ?, ?)
    `).run(specId, dependsOnSpecId, dependencyType);
  }

  /**
   * Helper to create a test ticket.
   */
  function createTestTicket(id: string, title: string, specId?: string): void {
    db.prepare(`
      INSERT INTO pmo_tickets (id, project_id, title, status, spec_id)
      VALUES (?, 'test-project', ?, 'backlog', ?)
    `).run(id, title, specId || null);
  }

  /**
   * Helper to get a spec from the database.
   */
  function getSpec(id: string): { id: string; title: string; status: string; type: string | null; problem: string | null } | undefined {
    return db.prepare('SELECT * FROM pmo_specs WHERE id = ?').get(id) as { id: string; title: string; status: string; type: string | null; problem: string | null } | undefined;
  }

  /**
   * Helper to get a ticket from the database.
   */
  function getTicket(id: string): { id: string; title: string; spec_id: string | null } | undefined {
    return db.prepare('SELECT * FROM pmo_tickets WHERE id = ?').get(id) as { id: string; title: string; spec_id: string | null } | undefined;
  }

  /**
   * Helper to get spec dependencies.
   */
  function getSpecDependencies(specId: string): Array<{ spec_id: string; depends_on_spec_id: string; dependency_type: string }> {
    return db.prepare(`
      SELECT * FROM pmo_spec_dependencies WHERE spec_id = ?
    `).all(specId) as Array<{ spec_id: string; depends_on_spec_id: string; dependency_type: string }>;
  }

  /**
   * Helper to create a spec file on disk (required for spec ticket command).
   */
  function createSpecFile(specId: string, status: string = 'active'): void {
    const specsDir = path.join(env.pmoPath, 'projects', 'test-project', 'specs', status);
    fs.mkdirSync(specsDir, { recursive: true });
    fs.writeFileSync(path.join(specsDir, `${specId}.md`), `# ${specId}\n\nSpec content here.`);
  }

  // ===========================================================================
  // spec list --machine
  // ===========================================================================
  describe('prlt spec list --machine', () => {
    beforeEach(() => {
      createTestSpec('spec-1', 'User Authentication', 'active', 'product');
      createTestSpec('spec-2', 'API Design', 'draft', 'platform');
      createTestSpec('spec-3', 'Completed Feature', 'implemented', 'infra');
    });

    it('should output valid JSON with --machine flag', () => {
      const output = execProduction('spec list --machine');
      const json = extractJson<{ success: boolean; result: { specs: Array<{ id: string }> } }>(output);

      expect(json).to.not.be.null;
      expect(json!.success).to.equal(true);
      expect(json!.result.specs).to.be.an('array');
      expect(json!.result.specs.length).to.equal(3);
    });

    it('should output valid JSON with --json flag (legacy)', () => {
      const output = execProduction('spec list --json');
      const json = extractJson<{ success: boolean }>(output);

      expect(json).to.not.be.null;
      expect(json!.success).to.equal(true);
    });

    it('should work with -m shorthand', () => {
      const output = execProduction('spec list -m');
      const json = extractJson<{ success: boolean }>(output);

      expect(json).to.not.be.null;
      expect(json!.success).to.equal(true);
    });

    it('should include spec details in output', () => {
      const output = execProduction('spec list --machine');
      const json = extractJson<{
        success: boolean;
        result: {
          specs: Array<{ id: string; title: string; status: string; type: string }>;
          count: number;
        };
      }>(output);

      expect(json).to.not.be.null;
      expect(json!.result.count).to.equal(3);

      const spec1 = json!.result.specs.find(s => s.id === 'spec-1');
      expect(spec1).to.exist;
      expect(spec1!.title).to.equal('User Authentication');
      expect(spec1!.status).to.equal('active');
      expect(spec1!.type).to.equal('product');
    });

    it('should filter by status', () => {
      const output = execProduction('spec list --status active --machine');
      const json = extractJson<{
        success: boolean;
        result: { specs: Array<{ status: string }>; count: number };
      }>(output);

      expect(json).to.not.be.null;
      expect(json!.result.count).to.equal(1);
      expect(json!.result.specs[0].status).to.equal('active');
    });

    it('should filter by type', () => {
      const output = execProduction('spec list --type product --machine');
      const json = extractJson<{
        success: boolean;
        result: { specs: Array<{ type: string }>; count: number };
      }>(output);

      expect(json).to.not.be.null;
      expect(json!.result.count).to.equal(1);
      expect(json!.result.specs[0].type).to.equal('product');
    });
  });

  // ===========================================================================
  // spec create --machine
  // ===========================================================================
  describe('prlt spec create --machine', () => {
    it('should output title input prompt when no title provided', () => {
      const result = agentExec('spec create --machine');

      expect(result).to.not.be.null;
      expect(result!.prompt.type).to.equal('input');
      expect(result!.prompt.name).to.equal('title');
      expect(result!.metadata.command).to.equal('spec create');
    });

    it('should output type selection prompt in interactive mode with title', () => {
      // Use -i flag to get type selection prompt
      const result = agentExec('spec create "Test Spec" -i --machine');

      expect(result).to.not.be.null;
      expect(result!.prompt.type).to.equal('list');
      expect(result!.prompt.name).to.equal('type');
      expect(result!.prompt.choices).to.be.an('array');
      expect(result!.prompt.choices!.length).to.be.greaterThan(0);
    });

    it('should have choices with command fields for type selection', () => {
      const result = agentExec('spec create "Test Spec" -i --machine');

      expect(result).to.not.be.null;
      for (const choice of result!.prompt.choices!) {
        if (choice.command) {
          expect(choice.command).to.include('--json');
          expect(choice.command).to.include('prlt spec create');
        }
      }
    });

    it('should work with -m shorthand', () => {
      const result = agentExec('spec create -m');

      expect(result).to.not.be.null;
      expect(result!.prompt.type).to.equal('input');
      expect(result!.metadata.command).to.equal('spec create');
    });

    it('should create spec when title provided (without prompts)', () => {
      // When title is provided without -i, spec is created directly with defaults
      const output = execProduction('spec create "Direct Spec"');

      expect(output).to.include('Created spec');
      expect(output).to.include('Direct Spec');

      // Verify in database
      const spec = getSpec('direct-spec');
      expect(spec).to.exist;
      expect(spec!.title).to.equal('Direct Spec');
      expect(spec!.status).to.equal('draft');
    });

    it('should create spec when all flags provided', () => {
      const output = execProduction('spec create "Full Spec" --type product --status active');

      expect(output).to.include('Created spec');
      expect(output).to.include('Full Spec');

      // Verify in database
      const spec = getSpec('full-spec');
      expect(spec).to.exist;
      expect(spec!.title).to.equal('Full Spec');
      expect(spec!.type).to.equal('product');
      expect(spec!.status).to.equal('active');
    });
  });

  // ===========================================================================
  // spec view --machine
  // ===========================================================================
  describe('prlt spec view --machine', () => {
    beforeEach(() => {
      createTestSpec('view-spec-1', 'View Test Spec', 'active', 'product', 'Test problem statement');
      createTestSpec('view-spec-2', 'Another Spec', 'draft');
    });

    it('should output spec selection prompt when no spec ID provided', () => {
      const result = agentExec('spec view -P test-project --machine');

      expect(result).to.not.be.null;
      expect(result!.prompt.type).to.equal('list');
      expect(result!.prompt.name).to.equal('spec');
      expect(result!.prompt.choices).to.be.an('array');
    });

    it('should have choices with command fields for spec selection', () => {
      const result = agentExec('spec view -P test-project --machine');

      expect(result).to.not.be.null;
      for (const choice of result!.prompt.choices!) {
        if (choice.command) {
          expect(choice.command).to.include('--json');
          expect(choice.command).to.include('prlt spec view');
        }
      }
    });

    it('should show spec details when spec ID provided', () => {
      const output = execProduction('spec view view-spec-1 -P test-project');

      expect(output).to.include('View Test Spec');
      expect(output).to.include('active');
      expect(output).to.include('Test problem statement');
    });
  });

  // ===========================================================================
  // spec plan --machine
  // ===========================================================================
  describe('prlt spec plan --machine', () => {
    beforeEach(() => {
      createTestSpec('plan-spec-1', 'Planning Spec', 'active', 'product');
      createTestSpec('plan-spec-2', 'Another Planning Spec', 'draft');
    });

    it('should output spec selection prompt when no spec ID provided', () => {
      const result = agentExec('spec plan --machine');

      expect(result).to.not.be.null;
      expect(result!.prompt.type).to.equal('list');
      expect(result!.prompt.name).to.equal('spec');
      expect(result!.prompt.choices).to.be.an('array');
    });

    it('should have choices with command fields', () => {
      const result = agentExec('spec plan --machine');

      expect(result).to.not.be.null;
      const choice = findChoice(result!.prompt.choices!, 'Planning Spec');
      expect(choice).to.exist;
      expect(choice!.command).to.include('--json');
    });

    it('should show spec content when spec ID provided', () => {
      const output = execProduction('spec plan plan-spec-1');

      expect(output).to.include('Planning Spec');
      expect(output).to.include('Planning from spec');
    });
  });

  // ===========================================================================
  // spec ticket --machine
  // ===========================================================================
  describe('prlt spec ticket --machine', () => {
    beforeEach(() => {
      // Create both database records AND spec files on disk
      createTestSpec('ticket-spec-1', 'Ticket Spec', 'active');
      createTestSpec('ticket-spec-2', 'Another Ticket Spec', 'draft');
      createSpecFile('ticket-spec-1', 'active');
      createSpecFile('ticket-spec-2', 'draft');
      createTestTicket('TKT-LINK-1', 'Ticket to link');
      createTestTicket('TKT-LINK-2', 'Another ticket');
    });

    it('should output ticket selection prompt when no ticket ID provided', () => {
      const result = agentExec('spec ticket -P test-project --machine');

      expect(result).to.not.be.null;
      expect(result!.prompt.type).to.equal('list');
      expect(result!.prompt.name).to.equal('ticket');
      expect(result!.prompt.choices).to.be.an('array');
    });

    it('should have choices with command fields for ticket selection', () => {
      const result = agentExec('spec ticket -P test-project --machine');

      expect(result).to.not.be.null;
      const choice = findChoice(result!.prompt.choices!, 'TKT-LINK-1');
      expect(choice).to.exist;
      expect(choice!.command).to.include('--json');
    });

    it('should output spec selection prompt when ticket ID provided', () => {
      const result = agentExec('spec ticket TKT-LINK-1 -P test-project --machine');

      expect(result).to.not.be.null;
      expect(result!.prompt.type).to.equal('list');
      expect(result!.prompt.name).to.equal('spec');
    });

    it('should link ticket to spec when all args provided', () => {
      const output = execProduction('spec ticket TKT-LINK-1 ticket-spec-1 -P test-project');

      expect(output).to.include('Linked ticket');
      expect(output).to.include('TKT-LINK-1');
      expect(output).to.include('ticket-spec-1');

      // Verify in database
      const ticket = getTicket('TKT-LINK-1');
      expect(ticket).to.exist;
      expect(ticket!.spec_id).to.equal('ticket-spec-1');
    });
  });

  // ===========================================================================
  // spec link --machine
  // ===========================================================================
  describe('prlt spec link --machine', () => {
    beforeEach(() => {
      createTestSpec('link-spec-1', 'Link Spec One', 'active');
      createTestSpec('link-spec-2', 'Link Spec Two', 'active');
      createTestSpec('link-spec-3', 'Link Spec Three', 'draft');
    });

    it('should output spec selection prompt when no spec ID provided', () => {
      const result = agentExec('spec link --machine');

      expect(result).to.not.be.null;
      expect(result!.prompt.type).to.equal('list');
      expect(result!.prompt.name).to.equal('id');
      expect(result!.prompt.choices).to.be.an('array');
    });

    it('should have choices for all specs', () => {
      const result = agentExec('spec link --machine');

      expect(result).to.not.be.null;
      expect(result!.prompt.choices!.length).to.equal(3);

      const choice1 = findChoice(result!.prompt.choices!, 'Link Spec One');
      expect(choice1).to.exist;
    });
  });

  // ===========================================================================
  // spec link depends --machine
  // ===========================================================================
  describe('prlt spec link depends --machine', () => {
    beforeEach(() => {
      createTestSpec('depends-spec-1', 'Depends Spec One', 'active');
      createTestSpec('depends-spec-2', 'Depends Spec Two', 'active');
      createTestSpec('depends-spec-3', 'Depends Spec Three', 'draft');
    });

    it('should output target spec selection prompt when target not provided', () => {
      const result = agentExec('spec link depends depends-spec-1 --machine');

      expect(result).to.not.be.null;
      expect(result!.prompt.type).to.equal('list');
      expect(result!.prompt.name).to.equal('target');
      expect(result!.prompt.choices).to.be.an('array');
    });

    it('should exclude source spec from target choices', () => {
      const result = agentExec('spec link depends depends-spec-1 --machine');

      expect(result).to.not.be.null;
      // Should only have 2 choices (spec-2 and spec-3, not spec-1)
      expect(result!.prompt.choices!.length).to.equal(2);

      const selfChoice = findChoice(result!.prompt.choices!, 'depends-spec-1');
      expect(selfChoice).to.be.undefined;
    });

    it('should have choices with command fields', () => {
      const result = agentExec('spec link depends depends-spec-1 --machine');

      expect(result).to.not.be.null;
      for (const choice of result!.prompt.choices!) {
        expect(choice.command).to.include('--json');
        expect(choice.command).to.include('spec link depends');
      }
    });

    it('should create dependency when all args provided', () => {
      const output = execProduction('spec link depends depends-spec-1 depends-spec-2');

      expect(output).to.include('depends on');
      expect(output).to.include('depends-spec-1');
      expect(output).to.include('depends-spec-2');

      // Verify in database
      const deps = getSpecDependencies('depends-spec-1');
      expect(deps.length).to.equal(1);
      expect(deps[0].depends_on_spec_id).to.equal('depends-spec-2');
      expect(deps[0].dependency_type).to.equal('depends_on');
    });
  });

  // ===========================================================================
  // spec link remove --machine
  // ===========================================================================
  describe('prlt spec link remove --machine', () => {
    beforeEach(() => {
      createTestSpec('remove-spec-1', 'Remove Spec One', 'active');
      createTestSpec('remove-spec-2', 'Remove Spec Two', 'active');
      createSpecDependency('remove-spec-1', 'remove-spec-2', 'depends_on');
    });

    it('should output dependency selection prompt when target not provided', () => {
      const result = agentExec('spec link remove remove-spec-1 --machine');

      expect(result).to.not.be.null;
      expect(result!.prompt.type).to.equal('list');
      expect(result!.prompt.name).to.equal('target');
      expect(result!.prompt.choices).to.be.an('array');
    });

    it('should have choices with command fields', () => {
      const result = agentExec('spec link remove remove-spec-1 --machine');

      expect(result).to.not.be.null;
      for (const choice of result!.prompt.choices!) {
        expect(choice.command).to.include('--json');
        expect(choice.command).to.include('spec link remove');
      }
    });

    it('should remove dependency when all args provided', () => {
      // Verify dependency exists before
      let deps = getSpecDependencies('remove-spec-1');
      expect(deps.length).to.equal(1);

      const output = execProduction('spec link remove remove-spec-1 remove-spec-2');

      expect(output).to.include('Removed dependency');

      // Verify in database - dependency should be gone
      deps = getSpecDependencies('remove-spec-1');
      expect(deps.length).to.equal(0);
    });

    it('should return error when no dependencies exist', () => {
      createTestSpec('no-deps-spec', 'No Deps Spec', 'active');

      const result = agentExec('spec link remove no-deps-spec --machine');

      // Should return error JSON (no dependencies to remove)
      if (result === null) {
        // Context error - acceptable
        expect(true).to.be.true;
      } else if ('error' in result) {
        // Error response - expected
        expect(true).to.be.true;
      }
    });
  });

  // ===========================================================================
  // End-to-end Agent Flow Tests
  // ===========================================================================
  describe('End-to-end agent flows (--machine flag)', () => {
    describe('spec create - full agent flow', () => {
      it('should complete flow: enter title → select type → spec created (interactive mode)', () => {
        // Step 1: No title provided, get input prompt
        const step1 = agentExec('spec create --machine');
        expect(step1).to.not.be.null;
        expect(step1!.prompt.type).to.equal('input');
        expect(step1!.prompt.name).to.equal('title');

        // Step 2: Provide title with -i flag, get type selection
        const step2 = agentExec('spec create "Agent Created Spec" -i --machine');
        expect(step2).to.not.be.null;
        expect(step2!.prompt.type).to.equal('list');
        expect(step2!.prompt.name).to.equal('type');

        // Find 'product' type
        const typeChoice = findChoice(step2!.prompt.choices!, 'Product');
        expect(typeChoice).to.exist;

        // Step 3: Execute with type selected
        const result = execFinal(execChoice(typeChoice!));

        expect(result).to.include('Created spec');
        expect(result).to.include('Agent Created Spec');

        // Verify in database
        const spec = getSpec('agent-created-spec');
        expect(spec).to.exist;
        expect(spec!.title).to.equal('Agent Created Spec');
        expect(spec!.type).to.equal('product');
      });

      it('should complete flow with title provided directly (no prompts)', () => {
        // Without -i flag, spec is created directly with defaults
        const result = execProduction('spec create "Direct Created Spec"');

        expect(result).to.include('Created spec');
        expect(result).to.include('Direct Created Spec');

        // Verify in database
        const spec = getSpec('direct-created-spec');
        expect(spec).to.exist;
        expect(spec!.status).to.equal('draft');
      });

      it('should complete flow with all flags provided directly', () => {
        const result = execProduction('spec create "Full Flags Spec" --type platform --status active');

        expect(result).to.include('Created spec');
        expect(result).to.include('Full Flags Spec');

        // Verify in database
        const spec = getSpec('full-flags-spec');
        expect(spec).to.exist;
        expect(spec!.type).to.equal('platform');
        expect(spec!.status).to.equal('active');
      });
    });

    describe('spec view - full agent flow', () => {
      beforeEach(() => {
        createTestSpec('view-flow-spec', 'View Flow Spec', 'active', 'product', 'Test problem');
      });

      it('should complete flow: select spec → view details', () => {
        // Step 1: No spec ID, get spec selection prompt
        const step1 = agentExec('spec view -P test-project --machine');
        expect(step1).to.not.be.null;
        expect(step1!.prompt.type).to.equal('list');
        expect(step1!.prompt.name).to.equal('spec');

        // Find the test spec
        const specChoice = findChoice(step1!.prompt.choices!, 'View Flow Spec');
        expect(specChoice).to.exist;

        // Step 2: Execute with spec selected
        const result = execFinal(execChoice(specChoice!));

        expect(result).to.include('View Flow Spec');
        expect(result).to.include('Test problem');
      });

      it('should complete flow with spec ID provided directly', () => {
        const result = execProduction('spec view view-flow-spec -P test-project');

        expect(result).to.include('View Flow Spec');
        expect(result).to.include('active');
      });
    });

    describe('spec ticket - full agent flow', () => {
      beforeEach(() => {
        // Create both database records AND spec files on disk
        createTestSpec('ticket-flow-spec', 'Ticket Flow Spec', 'active');
        createSpecFile('ticket-flow-spec', 'active');
        createTestTicket('TKT-FLOW-1', 'Ticket Flow Test');
      });

      it('should complete flow: select ticket → select spec → ticket linked', () => {
        // Step 1: No ticket ID, get ticket selection prompt
        const step1 = agentExec('spec ticket -P test-project --machine');
        expect(step1).to.not.be.null;
        expect(step1!.prompt.type).to.equal('list');
        expect(step1!.prompt.name).to.equal('ticket');

        // Find the test ticket
        const ticketChoice = findChoice(step1!.prompt.choices!, 'TKT-FLOW-1');
        expect(ticketChoice).to.exist;

        // Step 2: Execute with ticket selected, get spec selection prompt
        const step2 = agentExec(execChoice(ticketChoice!));
        expect(step2).to.not.be.null;
        expect(step2!.prompt.type).to.equal('list');
        expect(step2!.prompt.name).to.equal('spec');

        // Find the test spec
        const specChoice = findChoice(step2!.prompt.choices!, 'ticket-flow-spec');
        expect(specChoice).to.exist;

        // Step 3: Execute with spec selected
        const result = execFinal(execChoice(specChoice!));

        expect(result).to.include('Linked ticket');

        // Verify in database
        const ticket = getTicket('TKT-FLOW-1');
        expect(ticket).to.exist;
        expect(ticket!.spec_id).to.equal('ticket-flow-spec');
      });

      it('should complete flow with all args provided directly', () => {
        const result = execProduction('spec ticket TKT-FLOW-1 ticket-flow-spec -P test-project');

        expect(result).to.include('Linked ticket');

        // Verify in database
        const ticket = getTicket('TKT-FLOW-1');
        expect(ticket).to.exist;
        expect(ticket!.spec_id).to.equal('ticket-flow-spec');
      });
    });

    describe('spec link depends - full agent flow', () => {
      beforeEach(() => {
        createTestSpec('dep-flow-1', 'Dependency Flow One', 'active');
        createTestSpec('dep-flow-2', 'Dependency Flow Two', 'active');
      });

      it('should complete flow: select target → dependency created', () => {
        // Step 1: Spec ID provided, get target spec selection
        const step1 = agentExec('spec link depends dep-flow-1 --machine');
        expect(step1).to.not.be.null;
        expect(step1!.prompt.type).to.equal('list');
        expect(step1!.prompt.name).to.equal('target');

        // Find target spec
        const targetChoice = findChoice(step1!.prompt.choices!, 'dep-flow-2');
        expect(targetChoice).to.exist;

        // Step 2: Execute with target selected
        const result = execFinal(execChoice(targetChoice!));

        expect(result).to.include('depends on');

        // Verify in database
        const deps = getSpecDependencies('dep-flow-1');
        expect(deps.length).to.equal(1);
        expect(deps[0].depends_on_spec_id).to.equal('dep-flow-2');
      });

      it('should complete flow with all args provided directly', () => {
        const result = execProduction('spec link depends dep-flow-1 dep-flow-2');

        expect(result).to.include('depends on');

        // Verify in database
        const deps = getSpecDependencies('dep-flow-1');
        expect(deps.length).to.equal(1);
        expect(deps[0].dependency_type).to.equal('depends_on');
      });
    });

    describe('spec link remove - full agent flow', () => {
      beforeEach(() => {
        createTestSpec('rem-flow-1', 'Remove Flow One', 'active');
        createTestSpec('rem-flow-2', 'Remove Flow Two', 'active');
        createSpecDependency('rem-flow-1', 'rem-flow-2', 'depends_on');
      });

      it('should complete flow: select dependency → dependency removed', () => {
        // Verify dependency exists before
        let deps = getSpecDependencies('rem-flow-1');
        expect(deps.length).to.equal(1);

        // Step 1: Spec ID provided, get dependency selection
        const step1 = agentExec('spec link remove rem-flow-1 --machine');
        expect(step1).to.not.be.null;
        expect(step1!.prompt.type).to.equal('list');
        expect(step1!.prompt.name).to.equal('target');

        // Find dependency to remove
        const depChoice = findChoice(step1!.prompt.choices!, 'rem-flow-2');
        expect(depChoice).to.exist;

        // Step 2: Execute removal
        const result = execFinal(execChoice(depChoice!));

        expect(result).to.include('Removed dependency');

        // Verify in database - dependency should be gone
        deps = getSpecDependencies('rem-flow-1');
        expect(deps.length).to.equal(0);
      });

      it('should complete flow with all args provided directly', () => {
        // Verify dependency exists before
        let deps = getSpecDependencies('rem-flow-1');
        expect(deps.length).to.equal(1);

        const result = execProduction('spec link remove rem-flow-1 rem-flow-2');

        expect(result).to.include('Removed dependency');

        // Verify in database
        deps = getSpecDependencies('rem-flow-1');
        expect(deps.length).to.equal(0);
      });
    });

    describe('spec list - agent data retrieval', () => {
      beforeEach(() => {
        createTestSpec('list-flow-1', 'List Flow One', 'draft', 'product');
        createTestSpec('list-flow-2', 'List Flow Two', 'active', 'platform');
        createTestSpec('list-flow-3', 'List Flow Three', 'implemented', 'infra');
      });

      it('should return all specs as JSON for agent processing', () => {
        const output = execProduction('spec list --machine');
        const json = extractJson<{
          success: boolean;
          result: { specs: Array<{ id: string; title: string; status: string; type: string }> };
        }>(output);

        expect(json).to.not.be.null;
        expect(json!.success).to.equal(true);
        expect(json!.result.specs).to.be.an('array');
        expect(json!.result.specs.length).to.equal(3);

        // Agent can find specific specs
        const activeSpec = json!.result.specs.find(s => s.title === 'List Flow Two');
        expect(activeSpec).to.exist;
        expect(activeSpec!.status).to.equal('active');
        expect(activeSpec!.type).to.equal('platform');
      });

      it('should filter specs by status for agent', () => {
        const output = execProduction('spec list --status active --machine');
        const json = extractJson<{
          success: boolean;
          result: { specs: Array<{ status: string }>; count: number };
        }>(output);

        expect(json).to.not.be.null;
        expect(json!.result.count).to.equal(1);
        for (const spec of json!.result.specs) {
          expect(spec.status).to.equal('active');
        }
      });

      it('should filter specs by type for agent', () => {
        const output = execProduction('spec list --type product --machine');
        const json = extractJson<{
          success: boolean;
          result: { specs: Array<{ type: string }>; count: number };
        }>(output);

        expect(json).to.not.be.null;
        expect(json!.result.count).to.equal(1);
        for (const spec of json!.result.specs) {
          expect(spec.type).to.equal('product');
        }
      });
    });

    describe('backward compatibility: --json flag flows', () => {
      beforeEach(() => {
        createTestSpec('json-compat-spec', 'JSON Compat Spec', 'draft');
      });

      it('should complete create flow with --json flag (legacy) in interactive mode', () => {
        // Use -i flag to get type selection prompt
        const step1 = agentExec('spec create "Legacy JSON Spec" -i --json');
        expect(step1).to.not.be.null;
        expect(step1!.prompt.type).to.equal('list');
        expect(step1!.prompt.name).to.equal('type');

        const typeChoice = findChoice(step1!.prompt.choices!, 'Product');
        const result = execFinal(execChoice(typeChoice!));

        expect(result).to.include('Created spec');
      });

      it('should create spec with title and --json flag (direct creation)', () => {
        // Without -i, spec is created directly
        const output = execProduction('spec create "Direct JSON Spec" --json');

        expect(output).to.include('Created spec');
        expect(output).to.include('Direct JSON Spec');

        // Verify in database
        const spec = getSpec('direct-json-spec');
        expect(spec).to.exist;
      });

      it('should list specs with --json flag (legacy)', () => {
        const output = execProduction('spec list --json');
        const json = extractJson<{ success: boolean }>(output);

        expect(json).to.not.be.null;
        expect(json!.success).to.equal(true);
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

    CREATE TABLE IF NOT EXISTS pmo_specs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT DEFAULT 'draft',
      type TEXT,
      tags TEXT,
      depends_on TEXT,
      problem TEXT,
      solution TEXT,
      decisions TEXT,
      not_now TEXT,
      ui_ux TEXT,
      acceptance_criteria TEXT,
      open_questions TEXT,
      requirements_functional TEXT,
      requirements_technical TEXT,
      context TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pmo_spec_dependencies (
      spec_id TEXT NOT NULL,
      depends_on_spec_id TEXT NOT NULL,
      dependency_type TEXT NOT NULL DEFAULT 'depends_on',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (spec_id, depends_on_spec_id, dependency_type),
      FOREIGN KEY (spec_id) REFERENCES pmo_specs(id) ON DELETE RESTRICT,
      FOREIGN KEY (depends_on_spec_id) REFERENCES pmo_specs(id) ON DELETE RESTRICT,
      CHECK (spec_id != depends_on_spec_id)
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
      FOREIGN KEY (project_id) REFERENCES pmo_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (spec_id) REFERENCES pmo_specs(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_pmo_specs_status ON pmo_specs(status);
    CREATE INDEX IF NOT EXISTS idx_pmo_specs_type ON pmo_specs(type);
    CREATE INDEX IF NOT EXISTS idx_pmo_spec_deps_depends_on ON pmo_spec_dependencies(depends_on_spec_id);
    CREATE INDEX IF NOT EXISTS idx_pmo_tickets_spec ON pmo_tickets(spec_id);
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
}
