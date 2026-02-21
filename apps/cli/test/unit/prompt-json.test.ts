import { expect } from 'chai';
import {
  isNonTTY,
  shouldOutputJson,
  isMachineOutput,
  createMetadata,
  normalizeChoices,
  buildPromptConfig,
  type JsonFlags,
} from '../../src/lib/prompt-json.js';

describe('prompt-json', () => {
  describe('isNonTTY', () => {
    it('returns true when stdout is not a TTY', () => {
      const originalIsTTY = process.stdout.isTTY;
      Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
      expect(isNonTTY()).to.be.true;
      Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
    });

    it('returns false when stdout is a TTY', () => {
      const originalStdoutIsTTY = process.stdout.isTTY;
      const originalStdinIsTTY = process.stdin.isTTY;
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
      expect(isNonTTY()).to.be.false;
      Object.defineProperty(process.stdout, 'isTTY', { value: originalStdoutIsTTY, configurable: true });
      Object.defineProperty(process.stdin, 'isTTY', { value: originalStdinIsTTY, configurable: true });
    });

    it('does not check PRLT_JSON env var (pure TTY detection)', () => {
      const originalStdoutIsTTY = process.stdout.isTTY;
      const originalStdinIsTTY = process.stdin.isTTY;
      const originalPrltJson = process.env.PRLT_JSON;
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
      process.env.PRLT_JSON = '1';
      expect(isNonTTY()).to.be.false;
      Object.defineProperty(process.stdout, 'isTTY', { value: originalStdoutIsTTY, configurable: true });
      Object.defineProperty(process.stdin, 'isTTY', { value: originalStdinIsTTY, configurable: true });
      if (originalPrltJson === undefined) {
        delete process.env.PRLT_JSON;
      } else {
        process.env.PRLT_JSON = originalPrltJson;
      }
    });
  });

  describe('shouldOutputJson', () => {
    let originalStdoutIsTTY: boolean | undefined;
    let originalStdinIsTTY: boolean | undefined;
    let originalPrltJson: string | undefined;
    let originalPrltOutputFormat: string | undefined;

    beforeEach(() => {
      originalStdoutIsTTY = process.stdout.isTTY;
      originalStdinIsTTY = process.stdin.isTTY;
      originalPrltJson = process.env.PRLT_JSON;
      originalPrltOutputFormat = process.env.PRLT_OUTPUT_FORMAT;
      // Default to TTY mode for tests
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
      delete process.env.PRLT_JSON;
      delete process.env.PRLT_OUTPUT_FORMAT;
    });

    afterEach(() => {
      Object.defineProperty(process.stdout, 'isTTY', { value: originalStdoutIsTTY, configurable: true });
      Object.defineProperty(process.stdin, 'isTTY', { value: originalStdinIsTTY, configurable: true });
      if (originalPrltJson === undefined) {
        delete process.env.PRLT_JSON;
      } else {
        process.env.PRLT_JSON = originalPrltJson;
      }
      if (originalPrltOutputFormat === undefined) {
        delete process.env.PRLT_OUTPUT_FORMAT;
      } else {
        process.env.PRLT_OUTPUT_FORMAT = originalPrltOutputFormat;
      }
    });

    it('returns true when json flag is true', () => {
      const flags: JsonFlags = { json: true };
      expect(shouldOutputJson(flags)).to.be.true;
    });

    it('returns true when machine flag is true', () => {
      const flags: JsonFlags = { machine: true };
      expect(shouldOutputJson(flags)).to.be.true;
    });

    it('returns false in non-TTY environment without explicit flag', () => {
      Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
      const flags: JsonFlags = {};
      expect(shouldOutputJson(flags)).to.be.false;
    });

    it('returns false when no flags and in TTY environment', () => {
      const flags: JsonFlags = {};
      expect(shouldOutputJson(flags)).to.be.false;
    });

    it('returns false when json flag is explicitly false', () => {
      const flags: JsonFlags = { json: false };
      expect(shouldOutputJson(flags)).to.be.false;
    });

    it('returns true when PRLT_JSON=1 is set', () => {
      process.env.PRLT_JSON = '1';
      const flags: JsonFlags = {};
      expect(shouldOutputJson(flags)).to.be.true;
    });

    it('returns true when PRLT_JSON=true is set', () => {
      process.env.PRLT_JSON = 'true';
      const flags: JsonFlags = {};
      expect(shouldOutputJson(flags)).to.be.true;
    });

    it('returns true when PRLT_OUTPUT_FORMAT=json is set', () => {
      process.env.PRLT_OUTPUT_FORMAT = 'json';
      const flags: JsonFlags = {};
      expect(shouldOutputJson(flags)).to.be.true;
    });

    it('returns false when PRLT_OUTPUT_FORMAT=text is set', () => {
      process.env.PRLT_OUTPUT_FORMAT = 'text';
      const flags: JsonFlags = {};
      expect(shouldOutputJson(flags)).to.be.false;
    });
  });

  describe('isMachineOutput', () => {
    let originalPrltJson: string | undefined;
    let originalPrltOutputFormat: string | undefined;

    beforeEach(() => {
      originalPrltJson = process.env.PRLT_JSON;
      originalPrltOutputFormat = process.env.PRLT_OUTPUT_FORMAT;
      delete process.env.PRLT_JSON;
      delete process.env.PRLT_OUTPUT_FORMAT;
    });

    afterEach(() => {
      if (originalPrltJson === undefined) {
        delete process.env.PRLT_JSON;
      } else {
        process.env.PRLT_JSON = originalPrltJson;
      }
      if (originalPrltOutputFormat === undefined) {
        delete process.env.PRLT_OUTPUT_FORMAT;
      } else {
        process.env.PRLT_OUTPUT_FORMAT = originalPrltOutputFormat;
      }
    });

    it('returns true when json flag is true', () => {
      expect(isMachineOutput({ json: true })).to.be.true;
    });

    it('returns true when machine flag is true', () => {
      expect(isMachineOutput({ machine: true })).to.be.true;
    });

    it('returns true when PRLT_OUTPUT_FORMAT=json is set', () => {
      process.env.PRLT_OUTPUT_FORMAT = 'json';
      expect(isMachineOutput({})).to.be.true;
    });

    it('returns false without explicit flags or env vars', () => {
      expect(isMachineOutput({})).to.be.false;
    });
  });

  describe('createMetadata', () => {
    it('creates metadata with command and flags', () => {
      const metadata = createMetadata('work spawn', { many: true, column: 'Backlog' });
      expect(metadata.command).to.equal('work spawn');
      expect(metadata.flags).to.deep.equal({ many: true, column: 'Backlog' });
      expect(metadata.timestamp).to.be.a('string');
    });

    it('filters out undefined values from flags', () => {
      const metadata = createMetadata('ticket create', { title: 'Test', priority: undefined });
      expect(metadata.flags).to.deep.equal({ title: 'Test' });
    });

    it('filters out internal flags starting with underscore', () => {
      const metadata = createMetadata('work spawn', { _internal: true, visible: 'value' });
      expect(metadata.flags).to.deep.equal({ visible: 'value' });
    });

    it('includes ISO timestamp', () => {
      const metadata = createMetadata('test', {});
      expect(metadata.timestamp).to.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  describe('normalizeChoices', () => {
    it('handles string choices', () => {
      const choices = ['Option A', 'Option B'];
      const normalized = normalizeChoices(choices);
      expect(normalized).to.deep.equal([
        { name: 'Option A', value: 'Option A' },
        { name: 'Option B', value: 'Option B' },
      ]);
    });

    it('handles object choices', () => {
      const choices = [
        { name: 'Display A', value: 'value-a' },
        { name: 'Display B', value: 'value-b' },
      ];
      const normalized = normalizeChoices(choices);
      expect(normalized).to.deep.equal([
        { name: 'Display A', value: 'value-a' },
        { name: 'Display B', value: 'value-b' },
      ]);
    });

    it('includes disabled property when present', () => {
      const choices = [
        { name: 'Enabled', value: 'enabled', disabled: false },
        { name: 'Disabled', value: 'disabled', disabled: true },
      ];
      const normalized = normalizeChoices(choices);
      expect(normalized).to.deep.equal([
        { name: 'Enabled', value: 'enabled', disabled: false },
        { name: 'Disabled', value: 'disabled', disabled: true },
      ]);
    });

    it('filters out separator instances', () => {
      const choices = [
        { name: 'Option A', value: 'a' },
        { type: 'separator', line: '---' },
        { name: 'Option B', value: 'b' },
      ];
      const normalized = normalizeChoices(choices);
      expect(normalized).to.have.length(2);
      expect(normalized[0]).to.deep.equal({ name: 'Option A', value: 'a' });
      expect(normalized[1]).to.deep.equal({ name: 'Option B', value: 'b' });
    });

    it('converts non-string values to strings', () => {
      const choices = [
        { name: 'Number', value: 123 as unknown as string },
      ];
      const normalized = normalizeChoices(choices);
      expect(normalized[0].value).to.equal('123');
    });
  });

  describe('buildPromptConfig', () => {
    it('builds list prompt config', () => {
      const config = buildPromptConfig(
        'list',
        'selectedOption',
        'Select an option:',
        [
          { name: 'Option A', value: 'a' },
          { name: 'Option B', value: 'b' },
        ]
      );

      expect(config.type).to.equal('list');
      expect(config.name).to.equal('selectedOption');
      expect(config.message).to.equal('Select an option:');
      expect(config.choices).to.have.length(2);
    });

    it('builds checkbox prompt config', () => {
      const config = buildPromptConfig(
        'checkbox',
        'selectedTickets',
        'Select tickets:',
        [
          { name: 'TKT-001', value: 'TKT-001' },
          { name: 'TKT-002', value: 'TKT-002' },
        ]
      );

      expect(config.type).to.equal('checkbox');
      expect(config.name).to.equal('selectedTickets');
    });

    it('builds confirm prompt config', () => {
      const config = buildPromptConfig(
        'confirm',
        'proceed',
        'Do you want to continue?'
      );

      expect(config.type).to.equal('confirm');
      expect(config.name).to.equal('proceed');
      expect(config.choices).to.be.undefined;
    });

    it('includes default value when provided', () => {
      const config = buildPromptConfig(
        'list',
        'column',
        'Select column:',
        [{ name: 'Backlog', value: 'Backlog' }],
        'Backlog'
      );

      expect(config.default).to.equal('Backlog');
    });

    it('omits default when not provided', () => {
      const config = buildPromptConfig(
        'list',
        'column',
        'Select column:',
        [{ name: 'Backlog', value: 'Backlog' }]
      );

      expect(config.default).to.be.undefined;
    });
  });
});
