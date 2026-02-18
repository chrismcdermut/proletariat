/* eslint-disable max-nested-callbacks */
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
  execProduction,
  extractJson as extractJsonOrNull,
  type TestEnvironment,
} from './test-helpers.js';
import {
  validateJsonEnvelope,
  JSON_ENVELOPE_TYPES,
  JSON_ENVELOPE_REQUIRED_FIELDS,
  type JsonEnvelopeType,
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
 * well-formed JSON envelopes with correct exit codes when run in
 * non-TTY/JSON mode. This ensures autonomous agent orchestration
 * works deterministically.
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

    it('ticket list -P --json should output valid JSON', () => {
      const output = exec('ticket list -P test-project --format json');
      // ticket list with --format json outputs raw array, not envelope
      const parsed = JSON.parse(output.trim().split('\n').filter(l => l.trim().startsWith('[') || l.trim().startsWith('{')).join('\n'));
      expect(parsed).to.be.an('array');
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

    it('ticket view --json should output ticket data or prompt', () => {
      const output = exec('ticket view TKT-100 -P test-project --json');
      const json = extractJson<Record<string, unknown>>(output);
      const errors = validateJsonEnvelope(json);
      expect(errors, `Envelope errors: ${errors.join(', ')}`).to.be.empty;
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

    it('agent list --json should output agent list or prompt', () => {
      const output = exec('agent list -P test-project --json');
      const json = extractJson<Record<string, unknown>>(output);
      const errors = validateJsonEnvelope(json);
      expect(errors, `Envelope errors: ${errors.join(', ')}`).to.be.empty;
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

    it('execution list --json should output execution list', () => {
      const output = exec('execution list -P test-project --json');
      const json = extractJson<Record<string, unknown>>(output);
      const errors = validateJsonEnvelope(json);
      expect(errors, `Envelope errors: ${errors.join(', ')}`).to.be.empty;
    });
  });
});
