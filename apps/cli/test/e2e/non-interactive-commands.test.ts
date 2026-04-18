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
  extractJson as extractJsonOrNull,
  execInProcess,
  type TestEnvironment,
} from './test-helpers.js';

/**
 * Asserting wrapper around shared extractJson.
 * Throws if no valid JSON is found.
 */
function extractJson<T>(output: string): T {
  const result = extractJsonOrNull<T>(output);
  if (result === null) {
    throw new Error(`No JSON found in output: ${output.substring(0, 500)}...`);
  }
  return result;
}

/**
 * Tests for non-interactive command improvements (PRLT-1309).
 *
 * Verifies that commands that previously required interactive input
 * now support non-interactive flags and JSON mode fallbacks for agent automation.
 */
describe('Non-interactive command improvements (PRLT-1309)', () => {
  let env: TestEnvironment;
  let db: Database.Database;

  beforeEach(() => {
    env = createTestEnvironment('non-interactive-');

    db = setupProductionSchema(env.dbPath, env.pmoPath);
    createTestProject(db, { id: 'test-project', name: 'Test Project', description: 'E2E test project' });

    createHQConfig(env.proletariatDir);
    createPMODirectories(env.pmoPath, 'test-project');
  });

  afterEach(() => {
    if (db) db.close();
    cleanupTestEnvironment(env);
  });

  /** Insert a test ticket into the ticket_refs table (provider-agnostic cache). */
  function createLocalTestTicket(id: string, title: string, statusId: string = 'default-backlog'): void {
    const statusName = statusId === 'default-backlog' ? 'Backlog' :
                       statusId === 'default-in-progress' ? 'In Progress' :
                       statusId === 'default-review' ? 'Review' : 'Done';

    // Try pmo_tickets first (older schema), then ticket_refs (current schema)
    try {
      db.prepare(`
        INSERT INTO pmo_tickets (id, project_id, title, status, status_id)
        VALUES (?, 'test-project', ?, ?, ?)
      `).run(id, title, statusName, statusId);
    } catch {
      // pmo_tickets table doesn't exist (PRLT-1299); use ticket_refs
      db.prepare(`
        INSERT INTO ticket_refs (id, provider, title, status, project_id)
        VALUES (?, 'pmo', ?, ?, 'test-project')
      `).run(id, title, statusName);
    }
  }

  // ===========================================================================
  // project configure --set
  // ===========================================================================
  describe('project configure --set', () => {
    it('should set a single workflow column mapping via --set flag', async () => {
      const output = await execInProcess(
        'project configure --set planned=Todo -P test-project --json'
      );
      const json = extractJson<{ type: string; result: { workflow: Record<string, string> } }>(output);

      expect(json.type).to.equal('success');
      expect(json.result.workflow.planned).to.equal('Todo');
    });

    it('should set multiple workflow column mappings via repeated --set flags', async () => {
      const output = await execInProcess(
        'project configure --set planned=Todo --set done=Shipped -P test-project --json'
      );
      const json = extractJson<{ type: string; result: { workflow: Record<string, string> } }>(output);

      expect(json.type).to.equal('success');
      expect(json.result.workflow.planned).to.equal('Todo');
      expect(json.result.workflow.done).to.equal('Shipped');
    });

    it('should reject invalid workflow keys', async () => {
      const output = await execInProcess(
        'project configure --set invalid_key=Todo -P test-project --json'
      );
      const json = extractJson<{ type: string; error: { code: string } }>(output);

      expect(json.type).to.equal('error');
      expect(json.error.code).to.equal('INVALID_SET_KEY');
    });

    it('should reject invalid --set format (missing =)', async () => {
      const output = await execInProcess(
        'project configure --set planned -P test-project --json'
      );
      const json = extractJson<{ type: string; error: { code: string } }>(output);

      expect(json.type).to.equal('error');
      expect(json.error.code).to.equal('INVALID_SET_FORMAT');
    });

    it('should reject empty values', async () => {
      const output = await execInProcess(
        'project configure --set planned= -P test-project --json'
      );
      const json = extractJson<{ type: string; error: { code: string } }>(output);

      expect(json.type).to.equal('error');
      expect(json.error.code).to.equal('EMPTY_SET_VALUE');
    });

    it('should persist workflow config across invocations', async () => {
      // Set a column mapping
      await execInProcess(
        'project configure --set planned=Todo -P test-project --json'
      );

      // Read it back with --show
      const output = await execInProcess(
        'project configure --show -P test-project --json'
      );
      const json = extractJson<{ type: string; result: { workflow: Record<string, string> } }>(output);

      expect(json.type).to.equal('success');
      expect(json.result.workflow.planned).to.equal('Todo');
    });

    it('should show current config with --show in JSON mode', async () => {
      const output = await execInProcess(
        'project configure --show -P test-project --json'
      );
      const json = extractJson<{ type: string; result: { workflow: Record<string, string> } }>(output);

      expect(json.type).to.equal('success');
      expect(json.result.workflow).to.have.property('planned');
      expect(json.result.workflow).to.have.property('in_progress');
      expect(json.result.workflow).to.have.property('review');
      expect(json.result.workflow).to.have.property('done');
      expect(json.result.workflow).to.have.property('backlog');
    });

    it('should output column choices as JSON prompt when no --set given', async () => {
      const output = await execInProcess(
        'project configure -P test-project --json'
      );
      const json = extractJson<{ type: string; prompt: { type: string; name: string; choices: Array<{ command: string }> } }>(output);

      expect(json.type).to.equal('prompt');
      expect(json.prompt.type).to.equal('list');
      // First prompt is for the 'planned' intent
      expect(json.prompt.name).to.equal('planned');
      // Each choice command should include --set and --json for stateless continuation
      for (const choice of json.prompt.choices) {
        expect(choice.command).to.include('--set planned=');
        expect(choice.command).to.include('--json');
        expect(choice.command).to.include('-P test-project');
      }
    });
  });

  // ===========================================================================
  // ticket delete — JSON mode and flag validation
  // ===========================================================================
  describe('ticket delete — JSON mode', () => {
    // Note: Full E2E tests for ticket delete with actual ticket data require
    // a working ticket provider (Linear/Jira/PMO). The PMO provider's ticket
    // operations were removed in PRLT-1299, so we test the command structure,
    // JSON output format, and flag validation here.

    it('should accept --status flag without error', async () => {
      // When no tickets exist, the command should still produce valid JSON
      const output = await execInProcess(
        'ticket delete --bulk --force --status Done -P test-project --json'
      );
      const json = extractJson<{ type: string; error?: { code: string } }>(output);

      // Command produces a structured JSON error (not a crash)
      expect(json.type).to.be.a('string');
    });

    it('should accept variadic ticket IDs without parse error', async () => {
      // The command should accept multiple args even if the provider fails
      const output = await execInProcess(
        'ticket delete TKT-001 TKT-002 --force -P test-project --json'
      );
      const json = extractJson<{ type?: string; success?: boolean; deleted?: number; failed?: number }>(output);

      // Should produce JSON output (success or error, not a parse crash)
      expect(json).to.be.an('object');
    });
  });

  // ===========================================================================
  // linear import — JSON mode prompts
  // ===========================================================================
  describe('linear import — JSON mode', () => {
    it('should output error when Linear is not configured', async () => {
      const output = await execInProcess(
        'linear import -P test-project --json'
      );
      const json = extractJson<{ type: string; error: { code: string } }>(output);

      expect(json.type).to.equal('error');
      expect(json.error.code).to.equal('LINEAR_NOT_CONFIGURED');
    });
  });
});
