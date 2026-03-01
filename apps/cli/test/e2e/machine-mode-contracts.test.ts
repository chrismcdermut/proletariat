 
import { expect } from 'chai';
import Database from 'better-sqlite3';
import {
  createTestEnvironment,
  cleanupTestEnvironment,
  createHQConfig,
  createPMODirectories,
  setupProductionSchema,
  addWorkspaceTables,
  createTestProject,
  createTestTicket,
  exec,
  extractJson as extractJsonOrNull,
  type TestEnvironment,
} from './test-helpers.js';
import {
  validateJsonEnvelope,
} from '../../src/lib/prompt-json.js';

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
 * Non-TTY integration tests for machine-mode JSON contracts (TKT-1006).
 *
 * These tests validate that commands in all 5 core families output
 * well-formed JSON when run in non-TTY/JSON mode. Commands fall into
 * two categories:
 *
 * 1. **Envelope commands** - Use the canonical JSON envelope (prompt, success,
 *    error, dry-run, confirmation_needed, execution_result). These are validated
 *    against the full envelope schema.
 *
 * 2. **Data commands** - Output raw JSON arrays/objects (e.g., ticket list,
 *    agent list). These are validated for parseable JSON structure.
 *
 * This ensures autonomous agent orchestration works deterministically.
 */
describe('Machine-Mode JSON Contracts (TKT-1006)', () => {
  let env: TestEnvironment;
  let db: Database.Database;

  beforeEach(() => {
    env = createTestEnvironment('machine-mode-');
    db = setupProductionSchema(env.dbPath, env.pmoPath);
    addWorkspaceTables(db, { type: 'hq', hasPmo: true });
    createHQConfig(env.proletariatDir);
    createPMODirectories(env.pmoPath, 'test-project');
    createTestProject(db, {
      id: 'test-project',
      name: 'Test Project',
      description: 'Machine mode contract test project',
    });
  });

  afterEach(() => {
    if (db) db.close();
    cleanupTestEnvironment(env);
  });

  // =========================================================================
  // Ticket Family
  // =========================================================================
  describe('ticket family', () => {
    beforeEach(() => {
      createTestTicket(db, 'test-project', {
        id: 'TKT-100',
        title: 'Test Ticket Alpha',
        status: 'Backlog',
        statusId: 'default-backlog',
      });
      createTestTicket(db, 'test-project', {
        id: 'TKT-101',
        title: 'Test Ticket Beta',
        status: 'Backlog',
        statusId: 'default-backlog',
      });
    });

    it('ticket index --json should output a valid prompt envelope', () => {
      const output = exec('ticket -P test-project --json');
      const json = extractJson<Record<string, unknown>>(output);
      const errors = validateJsonEnvelope(json);
      expect(errors, `Envelope errors: ${errors.join(', ')}`).to.be.empty;
      expect(json.type).to.equal('prompt');
    });

    it('ticket list --format json should output parseable JSON array', () => {
      const output = exec('ticket list -P test-project --format json');
      // ticket list with --format json outputs raw array, not envelope
      const json = extractJson<unknown[]>(output);
      expect(json).to.be.an('array');
      expect(json.length).to.be.greaterThan(0);
      // Each ticket should have core fields
      const ticket = json[0] as Record<string, unknown>;
      expect(ticket).to.have.property('id');
      expect(ticket).to.have.property('title');
    });

    it('ticket create --json should output a prompt envelope for missing fields', () => {
      const output = exec('ticket create -P test-project --json');
      const json = extractJson<Record<string, unknown>>(output);
      const errors = validateJsonEnvelope(json);
      expect(errors, `Envelope errors: ${errors.join(', ')}`).to.be.empty;
      expect(json.type).to.equal('prompt');
    });

    it('ticket move --json should output a prompt for ticket selection', () => {
      const output = exec('ticket move -P test-project --json');
      const json = extractJson<Record<string, unknown>>(output);
      const errors = validateJsonEnvelope(json);
      expect(errors, `Envelope errors: ${errors.join(', ')}`).to.be.empty;
      expect(json.type).to.equal('prompt');
      const prompt = (json as { prompt: { choices: Array<{ command?: string }> } }).prompt;
      expect(prompt.choices).to.be.an('array');
      // Verify choices have command fields
      for (const choice of prompt.choices) {
        if (choice.command) {
          expect(choice.command).to.include('--json');
        }
      }
    });

    it('ticket move with ticket ID --json should output column selection prompt', () => {
      const output = exec('ticket move TKT-100 -P test-project --json');
      const json = extractJson<Record<string, unknown>>(output);
      const errors = validateJsonEnvelope(json);
      expect(errors, `Envelope errors: ${errors.join(', ')}`).to.be.empty;
      expect(json.type).to.equal('prompt');
    });

    it('ticket bulk --json should output a prompt menu', () => {
      const output = exec('ticket bulk -P test-project --json');
      const json = extractJson<Record<string, unknown>>(output);
      const errors = validateJsonEnvelope(json);
      expect(errors, `Envelope errors: ${errors.join(', ')}`).to.be.empty;
      expect(json.type).to.equal('prompt');
    });

    it('ticket resolve --json with no clarification tickets should output error', () => {
      const output = exec('ticket resolve -P test-project --json');
      const json = extractJson<Record<string, unknown>>(output);
      const errors = validateJsonEnvelope(json);
      expect(errors, `Envelope errors: ${errors.join(', ')}`).to.be.empty;
      expect(json.type).to.equal('error');
    });
  });

  // =========================================================================
  // Work Family
  // =========================================================================
  describe('work family', () => {
    beforeEach(() => {
      createTestTicket(db, 'test-project', {
        id: 'TKT-200',
        title: 'Work Test Ticket',
        status: 'Backlog',
        statusId: 'default-backlog',
      });
    });

    it('work index --json should output a valid prompt envelope', () => {
      const output = exec('work -P test-project --json');
      const json = extractJson<Record<string, unknown>>(output);
      const errors = validateJsonEnvelope(json);
      expect(errors, `Envelope errors: ${errors.join(', ')}`).to.be.empty;
      expect(json.type).to.equal('prompt');
    });

    it('work start --json should output a prompt for action selection', () => {
      const output = exec('work start -P test-project --json');
      const json = extractJson<Record<string, unknown>>(output);
      const errors = validateJsonEnvelope(json);
      expect(errors, `Envelope errors: ${errors.join(', ')}`).to.be.empty;
    });

    it('work spawn --json should output a prompt envelope', () => {
      const output = exec('work spawn -P test-project --json');
      const json = extractJson<Record<string, unknown>>(output);
      const errors = validateJsonEnvelope(json);
      expect(errors, `Envelope errors: ${errors.join(', ')}`).to.be.empty;
    });
  });

  // =========================================================================
  // Project Family
  // =========================================================================
  describe('project family', () => {
    it('project index --json should output a valid prompt envelope', () => {
      const output = exec('project -P test-project --json');
      const json = extractJson<Record<string, unknown>>(output);
      const errors = validateJsonEnvelope(json);
      expect(errors, `Envelope errors: ${errors.join(', ')}`).to.be.empty;
      expect(json.type).to.equal('prompt');
    });

    it('project list --json should output project data', () => {
      const output = exec('project list --json');
      const json = extractJson<Record<string, unknown>>(output);
      const errors = validateJsonEnvelope(json);
      expect(errors, `Envelope errors: ${errors.join(', ')}`).to.be.empty;
      expect(json.type).to.equal('success');
    });

    it('project view --json should output project details', () => {
      const output = exec('project view test-project --json');
      const json = extractJson<Record<string, unknown>>(output);
      const errors = validateJsonEnvelope(json);
      expect(errors, `Envelope errors: ${errors.join(', ')}`).to.be.empty;
      expect(json.type).to.equal('success');
    });

    it('project create --json should output a form prompt', () => {
      const output = exec('project create --json');
      const json = extractJson<Record<string, unknown>>(output);
      const errors = validateJsonEnvelope(json);
      expect(errors, `Envelope errors: ${errors.join(', ')}`).to.be.empty;
      expect(json.type).to.equal('prompt');
    });
  });

  // =========================================================================
  // Agent Family
  // =========================================================================
  describe('agent family', () => {
    it('agent index --json should output a valid prompt envelope', () => {
      const output = exec('agent -P test-project --json');
      const json = extractJson<Record<string, unknown>>(output);
      const errors = validateJsonEnvelope(json);
      expect(errors, `Envelope errors: ${errors.join(', ')}`).to.be.empty;
      expect(json.type).to.equal('prompt');
    });

    it('agent list --json should output parseable JSON data', () => {
      const output = exec('agent list -P test-project --json');
      // agent list outputs raw object with staff/temp/all arrays, not envelope
      const json = extractJson<Record<string, unknown>>(output);
      expect(json).to.be.an('object');
      // Verify expected structure: has staff, temp, or all arrays
      const hasExpectedKeys = 'staff' in json || 'temp' in json || 'all' in json || 'type' in json;
      expect(hasExpectedKeys, 'agent list output should have staff/temp/all keys or type discriminator').to.be.true;
    });
  });

  // =========================================================================
  // Execution Family
  // =========================================================================
  describe('execution family', () => {
    it('execution index --json should output a valid prompt envelope', () => {
      const output = exec('execution -P test-project --json');
      const json = extractJson<Record<string, unknown>>(output);
      const errors = validateJsonEnvelope(json);
      expect(errors, `Envelope errors: ${errors.join(', ')}`).to.be.empty;
      expect(json.type).to.equal('prompt');
    });

    it('execution list --json should output parseable JSON data', () => {
      const output = exec('execution list -P test-project --json');
      // execution list outputs raw array, not envelope
      const json = extractJson<unknown>(output);
      // Should be a valid JSON structure (array or object)
      expect(json).to.satisfy((v: unknown) =>
        Array.isArray(v) || (typeof v === 'object' && v !== null)
      );
    });
  });

  // =========================================================================
  // Cross-Family: Envelope Structure Consistency
  // =========================================================================
  describe('cross-family envelope consistency', () => {
    beforeEach(() => {
      createTestTicket(db, 'test-project', {
        id: 'TKT-300',
        title: 'Consistency Test Ticket',
        status: 'Backlog',
        statusId: 'default-backlog',
      });
    });

    it('all prompt envelopes should have metadata with command and flags', () => {
      // Test multiple commands that output prompt envelopes
      const promptCommands = [
        'ticket -P test-project --json',
        'work -P test-project --json',
        'project -P test-project --json',
        'ticket create -P test-project --json',
        'ticket move -P test-project --json',
      ];

      for (const cmd of promptCommands) {
        const output = exec(cmd);
        const json = extractJson<{ metadata?: { command?: string; flags?: unknown } }>(output);
        expect(json.metadata, `${cmd}: should have metadata`).to.exist;
        expect(json.metadata!.command, `${cmd}: metadata.command should be a string`).to.be.a('string');
        expect(json.metadata!.flags, `${cmd}: metadata.flags should be an object`).to.be.an('object');
      }
    });

    it('prompt envelopes should have non-null prompt field', () => {
      const promptCommands = [
        'ticket -P test-project --json',
        'ticket create -P test-project --json',
        'ticket move -P test-project --json',
      ];

      for (const cmd of promptCommands) {
        const output = exec(cmd);
        const json = extractJson<{ type: string; prompt: unknown }>(output);
        expect(json.type, `${cmd}: type should be 'prompt'`).to.equal('prompt');
        expect(json.prompt, `${cmd}: prompt should not be null`).to.not.be.null;
      }
    });

    it('error envelopes should have code and message', () => {
      const output = exec('ticket resolve -P test-project --json');
      const json = extractJson<{ type: string; error: { code: string; message: string } }>(output);
      expect(json.type).to.equal('error');
      expect(json.error.code).to.be.a('string').and.not.empty;
      expect(json.error.message).to.be.a('string').and.not.empty;
    });
  });
});
