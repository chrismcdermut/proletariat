/**
 * Unit tests for the validation-first JSON error layer schema introspection
 * helpers (PRLT-1269).
 *
 * These tests cover the pure functions that convert oclif flag/arg
 * definitions into the schema dictionary embedded in `validation_error`
 * envelopes. The catch-handler integration is exercised by the e2e tests in
 * `validation-first-errors.test.ts`.
 */
import { expect } from 'chai';
import {
  buildArgSchemaEntry,
  buildFlagSchemaEntry,
  buildFlagSchemaFromOclif,
  isMachineModeFromArgv,
  type OclifFlagLike,
} from '../../src/lib/prompt-json.js';

describe('validation-first schema introspection (PRLT-1269)', () => {
  describe('buildFlagSchemaEntry', () => {
    it('maps a string flag with options to a list type with choices', () => {
      const entry = buildFlagSchemaEntry({
        type: 'option',
        name: 'environment',
        description: 'Execution environment',
        options: ['host', 'docker', 'devcontainer'],
        default: 'docker',
        required: true,
      });

      expect(entry.type).to.equal('list');
      expect(entry.choices).to.deep.equal(['host', 'docker', 'devcontainer']);
      expect(entry.default).to.equal('docker');
      expect(entry.required).to.equal(true);
      expect(entry.description).to.equal('Execution environment');
    });

    it('maps a string flag without options to an input type', () => {
      const entry = buildFlagSchemaEntry({
        type: 'option',
        name: 'prompt',
        description: 'Work prompt',
        required: true,
      });

      expect(entry.type).to.equal('input');
      expect(entry.choices).to.equal(undefined);
      expect(entry.required).to.equal(true);
      expect(entry.description).to.equal('Work prompt');
    });

    it('maps a boolean flag to a confirm type', () => {
      const entry = buildFlagSchemaEntry({
        type: 'boolean',
        name: 'force',
        description: 'Force re-authentication',
        default: false,
      });

      expect(entry.type).to.equal('confirm');
      expect(entry.default).to.equal(false);
    });

    it('maps a multiple-value flag with options to a checkbox', () => {
      const entry = buildFlagSchemaEntry({
        type: 'option',
        name: 'labels',
        options: ['bug', 'feature', 'chore'],
        multiple: true,
      });

      expect(entry.type).to.equal('checkbox');
      expect(entry.choices).to.deep.equal(['bug', 'feature', 'chore']);
    });

    it('maps a multiple-value flag without options to a checkbox', () => {
      const entry = buildFlagSchemaEntry({
        type: 'option',
        name: 'tags',
        multiple: true,
      });

      expect(entry.type).to.equal('checkbox');
    });

    it('falls back to summary when description is missing', () => {
      const entry = buildFlagSchemaEntry({
        type: 'option',
        name: 'foo',
        summary: 'A foo flag',
      });

      expect(entry.description).to.equal('A foo flag');
    });

    it('skips function defaults (only static primitives are exposed)', () => {
      const entry = buildFlagSchemaEntry({
        type: 'option',
        name: 'foo',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        default: ((() => 'computed') as unknown) as any,
      });

      expect(entry.default).to.equal(undefined);
    });

    it('preserves the short character flag when present', () => {
      const entry = buildFlagSchemaEntry({
        type: 'option',
        name: 'project',
        char: 'P',
      });

      expect(entry.char).to.equal('P');
    });

    it('omits required field when flag is optional', () => {
      const entry = buildFlagSchemaEntry({
        type: 'option',
        name: 'nice-to-have',
      });

      expect(entry.required).to.equal(undefined);
    });
  });

  describe('buildArgSchemaEntry', () => {
    it('maps an arg with options to a list type', () => {
      const entry = buildArgSchemaEntry({
        name: 'status',
        options: ['open', 'closed'],
        required: true,
      });

      expect(entry.type).to.equal('list');
      expect(entry.choices).to.deep.equal(['open', 'closed']);
      expect(entry.required).to.equal(true);
    });

    it('maps an arg without options to an input type', () => {
      const entry = buildArgSchemaEntry({
        name: 'ticketId',
        description: 'Ticket ID',
      });

      expect(entry.type).to.equal('input');
      expect(entry.description).to.equal('Ticket ID');
    });
  });

  describe('buildFlagSchemaFromOclif', () => {
    const flags: Record<string, OclifFlagLike> = {
      environment: {
        type: 'option',
        name: 'environment',
        options: ['host', 'docker'],
        default: 'docker',
        required: true,
      },
      force: {
        type: 'boolean',
        name: 'force',
        default: false,
      },
      project: {
        type: 'option',
        name: 'project',
        char: 'P',
      },
    };

    it('returns the full schema when no restriction is given', () => {
      const schema = buildFlagSchemaFromOclif(flags);
      expect(Object.keys(schema)).to.have.members(['environment', 'force', 'project']);
      expect(schema.environment.type).to.equal('list');
      expect(schema.force.type).to.equal('confirm');
      expect(schema.project.type).to.equal('input');
    });

    it('restricts the schema to the requested flag names', () => {
      const schema = buildFlagSchemaFromOclif(flags, ['environment']);
      expect(Object.keys(schema)).to.deep.equal(['environment']);
    });

    it('returns an empty object when given undefined flags', () => {
      const schema = buildFlagSchemaFromOclif(undefined);
      expect(schema).to.deep.equal({});
    });

    it('skips invalid flag entries', () => {
      const schema = buildFlagSchemaFromOclif({
        good: { type: 'option', name: 'good' },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        bad: null as any,
      });
      expect(Object.keys(schema)).to.deep.equal(['good']);
    });
  });

  describe('isMachineModeFromArgv', () => {
    let originalStdoutIsTTY: boolean | undefined;
    let originalStdinIsTTY: boolean | undefined;

    beforeEach(() => {
      originalStdoutIsTTY = process.stdout.isTTY;
      originalStdinIsTTY = process.stdin.isTTY;
      // Default to TTY mode so argv detection is the only signal
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    });

    afterEach(() => {
      Object.defineProperty(process.stdout, 'isTTY', { value: originalStdoutIsTTY, configurable: true });
      Object.defineProperty(process.stdin, 'isTTY', { value: originalStdinIsTTY, configurable: true });
    });

    it('returns true when --json is in argv', () => {
      expect(isMachineModeFromArgv(['--prompt', 'test', '--json'])).to.equal(true);
    });

    it('returns true when --machine is in argv', () => {
      expect(isMachineModeFromArgv(['--machine'])).to.equal(true);
    });

    it('returns true when -m is in argv', () => {
      expect(isMachineModeFromArgv(['-m'])).to.equal(true);
    });

    it('returns false when no machine flags and stdin/stdout are TTY', () => {
      expect(isMachineModeFromArgv(['--prompt', 'test'])).to.equal(false);
    });

    it('returns false when argv is undefined and stdin/stdout are TTY', () => {
      expect(isMachineModeFromArgv(undefined)).to.equal(false);
    });

    it('returns true when stdout is non-TTY (auto-detect)', () => {
      Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
      expect(isMachineModeFromArgv([])).to.equal(true);
    });
  });
});
