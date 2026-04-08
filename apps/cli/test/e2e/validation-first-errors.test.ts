/**
 * E2E tests for the validation-first JSON error layer (PRLT-1269).
 *
 * These tests verify that commands automatically emit a structured
 * `validation_error` envelope (instead of crashing or printing
 * human-readable text) when oclif parsing fails in machine mode.
 *
 * The whole point of this layer is that it requires NO per-command code,
 * so we exercise it against representative commands across the codebase
 * without modifying them.
 */
import { expect } from 'chai';
import {
  createTestEnvironment,
  cleanupTestEnvironment,
  createHQConfig,
  createPMODirectories,
  setupProductionSchema,
  createTestProject,
  execInProcess,
  extractJson as extractJsonOrNull,
  type TestEnvironment,
} from './test-helpers.js';
import type Database from 'better-sqlite3';

interface ValidationErrorEnvelope {
  type: 'validation_error';
  command: string;
  reason: string;
  message: string;
  missing: string[];
  schema: Record<string, {
    type: 'list' | 'input' | 'confirm' | 'checkbox';
    choices?: string[];
    default?: string | number | boolean | null;
    required?: boolean;
    description?: string;
    char?: string;
  }>;
  metadata: {
    command: string;
    flags: Record<string, unknown>;
    timestamp?: string;
  };
}

function extractJson<T>(output: string): T {
  const result = extractJsonOrNull<T>(output);
  if (result === null) {
    throw new Error(`No JSON found in output: ${output.substring(0, 500)}...`);
  }
  return result;
}

describe('Validation-first JSON error layer (PRLT-1269)', () => {
  let env: TestEnvironment;
  let db: Database.Database;

  beforeEach(() => {
    env = createTestEnvironment('validation-first-');
    db = setupProductionSchema(env.dbPath, env.pmoPath);
    createTestProject(db, { id: 'test-project', name: 'Test Project', description: 'E2E test project' });
    createHQConfig(env.proletariatDir);
    createPMODirectories(env.pmoPath, 'test-project');
  });

  afterEach(() => {
    if (db) db.close();
    cleanupTestEnvironment(env);
  });

  describe('missing required flags', () => {
    it('emits validation_error for `work run` without --prompt', async () => {
      const output = await execInProcess('work run --json');
      const envelope = extractJson<ValidationErrorEnvelope>(output);

      expect(envelope.type).to.equal('validation_error');
      expect(envelope.command).to.equal('work run');
      expect(envelope.reason).to.equal('missing_required_flags');
      expect(envelope.missing).to.include('prompt');
      expect(envelope.schema).to.have.property('prompt');
      expect(envelope.schema.prompt.required).to.equal(true);
      expect(envelope.schema.prompt.type).to.equal('input');
    });
  });

  describe('invalid choice values', () => {
    it('emits validation_error with full choices when --environment is invalid', async () => {
      const output = await execInProcess('work run --prompt test --environment bogus --json');
      const envelope = extractJson<ValidationErrorEnvelope>(output);

      expect(envelope.type).to.equal('validation_error');
      expect(envelope.reason).to.equal('invalid_flag_value');
      expect(envelope.missing).to.deep.equal(['environment']);
      expect(envelope.schema).to.have.property('environment');
      expect(envelope.schema.environment.type).to.equal('list');
      expect(envelope.schema.environment.choices).to.be.an('array').that.is.not.empty;
      // The default choices include host/docker/devcontainer
      expect(envelope.schema.environment.choices).to.include.members(['host', 'docker']);
    });
  });

  describe('integration commands that previously crashed in JSON mode', () => {
    it('asana connect: nonexistent flag returns validation_error, not a crash', async () => {
      const output = await execInProcess('asana connect --bogus --json');
      const envelope = extractJson<ValidationErrorEnvelope>(output);

      expect(envelope.type).to.equal('validation_error');
      expect(envelope.reason).to.equal('nonexistent_flags');
      expect(envelope.command).to.equal('asana connect');
    });

    it('monday connect: nonexistent flag returns validation_error', async () => {
      const output = await execInProcess('monday connect --bogus --json');
      const envelope = extractJson<ValidationErrorEnvelope>(output);

      expect(envelope.type).to.equal('validation_error');
      expect(envelope.reason).to.equal('nonexistent_flags');
      expect(envelope.command).to.equal('monday connect');
    });
  });

  describe('schema introspection', () => {
    it('exposes the description and char alias for required flags', async () => {
      const output = await execInProcess('work run --json');
      const envelope = extractJson<ValidationErrorEnvelope>(output);

      const promptFlag = envelope.schema.prompt;
      expect(promptFlag.description).to.be.a('string').and.not.empty;
      expect(promptFlag.char).to.equal('p');
    });

    it('serializes the static default for an option flag', async () => {
      const output = await execInProcess('work run --prompt test --environment bogus --json');
      const envelope = extractJson<ValidationErrorEnvelope>(output);

      // `environment` has a static string default (host) — verify it round-trips.
      expect(envelope.schema.environment).to.have.property('default');
      expect(typeof envelope.schema.environment.default).to.equal('string');
    });
  });

  describe('envelope shape', () => {
    it('always includes all required fields per the contract', async () => {
      const output = await execInProcess('work run --json');
      const envelope = extractJson<ValidationErrorEnvelope>(output);

      expect(envelope).to.have.all.keys([
        'type', 'command', 'reason', 'message', 'missing', 'schema', 'metadata',
      ]);
      expect(envelope.metadata).to.have.property('command');
      expect(envelope.metadata).to.have.property('flags');
    });
  });
});
