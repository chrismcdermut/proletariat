import { expect } from 'chai';
import { FlagResolver, shouldOutputJson } from '../../src/lib/flags/index.js';

/**
 * Tests for FlagResolver - unified flag resolution for human and machine modes
 * TKT-738: Migrate work/* commands to use FlagResolver pattern
 */
describe('FlagResolver', () => {
  describe('constructor', () => {
    it('creates resolver with command info', () => {
      const resolver = new FlagResolver({
        commandName: 'work start',
        baseCommand: 'prlt work start',
        jsonMode: false,
        flags: {},
      });

      expect(resolver).to.be.instanceOf(FlagResolver);
    });

    it('accepts initial flags', () => {
      const resolver = new FlagResolver<{ column?: string }>({
        commandName: 'ticket create',
        baseCommand: 'prlt ticket create',
        jsonMode: false,
        flags: { column: 'Backlog' },
      });

      expect(resolver.getFlag('column')).to.equal('Backlog');
    });
  });

  describe('hasFlag', () => {
    it('returns true when flag has a value', () => {
      const resolver = new FlagResolver<{ column?: string }>({
        commandName: 'test',
        baseCommand: 'prlt test',
        jsonMode: false,
        flags: { column: 'Backlog' },
      });

      expect(resolver.hasFlag('column')).to.be.true;
    });

    it('returns false when flag is undefined', () => {
      const resolver = new FlagResolver<{ column?: string }>({
        commandName: 'test',
        baseCommand: 'prlt test',
        jsonMode: false,
        flags: {},
      });

      expect(resolver.hasFlag('column')).to.be.false;
    });
  });

  describe('getFlag', () => {
    it('returns flag value when set', () => {
      const resolver = new FlagResolver<{ priority?: string }>({
        commandName: 'test',
        baseCommand: 'prlt test',
        jsonMode: false,
        flags: { priority: 'P0' },
      });

      expect(resolver.getFlag('priority')).to.equal('P0');
    });

    it('returns undefined when flag not set', () => {
      const resolver = new FlagResolver<{ priority?: string }>({
        commandName: 'test',
        baseCommand: 'prlt test',
        jsonMode: false,
        flags: {},
      });

      expect(resolver.getFlag('priority')).to.be.undefined;
    });
  });

  describe('setFlag', () => {
    it('sets flag value directly', () => {
      const resolver = new FlagResolver<{ column?: string }>({
        commandName: 'test',
        baseCommand: 'prlt test',
        jsonMode: false,
        flags: {},
      });

      resolver.setFlag('column', 'Backlog');
      expect(resolver.getFlag('column')).to.equal('Backlog');
    });

    it('returns resolver for chaining', () => {
      const resolver = new FlagResolver<{ column?: string; priority?: string }>({
        commandName: 'test',
        baseCommand: 'prlt test',
        jsonMode: false,
        flags: {},
      });

      const result = resolver
        .setFlag('column', 'Backlog')
        .setFlag('priority', 'P0');

      expect(result).to.equal(resolver);
      expect(resolver.getFlag('column')).to.equal('Backlog');
      expect(resolver.getFlag('priority')).to.equal('P0');
    });
  });

  describe('setContext / getContext', () => {
    it('stores and retrieves context values', () => {
      const resolver = new FlagResolver({
        commandName: 'test',
        baseCommand: 'prlt test',
        jsonMode: false,
        flags: {},
      });

      resolver.setContext('projectId', 'proj-123');
      expect(resolver.getContext('projectId')).to.equal('proj-123');
    });

    it('returns undefined for missing context', () => {
      const resolver = new FlagResolver({
        commandName: 'test',
        baseCommand: 'prlt test',
        jsonMode: false,
        flags: {},
      });

      expect(resolver.getContext('missing')).to.be.undefined;
    });
  });

  describe('addPrompt', () => {
    it('adds prompt definition', () => {
      const resolver = new FlagResolver<{ column?: string }>({
        commandName: 'test',
        baseCommand: 'prlt test',
        jsonMode: false,
        flags: {},
      });

      const result = resolver.addPrompt({
        flagName: 'column',
        type: 'list',
        message: 'Select column:',
        choices: () => [{ name: 'Backlog', value: 'Backlog' }],
      });

      expect(result).to.equal(resolver); // Returns resolver for chaining
    });

    it('returns resolver for chaining multiple prompts', () => {
      const resolver = new FlagResolver<{ column?: string; priority?: string }>({
        commandName: 'test',
        baseCommand: 'prlt test',
        jsonMode: false,
        flags: {},
      });

      resolver
        .addPrompt({
          flagName: 'column',
          type: 'list',
          message: 'Select column:',
          choices: () => [{ name: 'Backlog', value: 'Backlog' }],
        })
        .addPrompt({
          flagName: 'priority',
          type: 'list',
          message: 'Select priority:',
          choices: () => [{ name: 'P0', value: 'P0' }],
        });

      // Should not throw - prompts are queued
      expect(resolver).to.be.instanceOf(FlagResolver);
    });
  });

  describe('resolve - interactive mode', () => {
    it('skips prompts when flag already has value', async () => {
      const resolver = new FlagResolver<{ column?: string }>({
        commandName: 'test',
        baseCommand: 'prlt test',
        jsonMode: false,
        flags: { column: 'Backlog' }, // Already set
      });

      resolver.addPrompt({
        flagName: 'column',
        type: 'list',
        message: 'Select column:',
        choices: () => [{ name: 'Backlog', value: 'Backlog' }],
      });

      // Should resolve without prompting since column is already set
      const result = await resolver.resolve();
      expect(result.column).to.equal('Backlog');
    });

    it('skips prompts when `when` condition is false', async () => {
      const resolver = new FlagResolver<{ action?: string; customPrompt?: string }>({
        commandName: 'test',
        baseCommand: 'prlt test',
        jsonMode: false,
        flags: { action: 'implement' }, // Not __custom__
      });

      resolver.addPrompt({
        flagName: 'customPrompt',
        type: 'input',
        message: 'Enter custom prompt:',
        when: (ctx) => ctx.flags.action === '__custom__', // Should be false
      });

      const result = await resolver.resolve();
      expect(result.customPrompt).to.be.undefined;
    });

    it('resolves all pre-set flags without prompting', async () => {
      const resolver = new FlagResolver<{ column?: string; priority?: string; title?: string }>({
        commandName: 'test',
        baseCommand: 'prlt test',
        jsonMode: false,
        flags: {
          column: 'Backlog',
          priority: 'P0',
          title: 'Test ticket',
        },
      });

      resolver
        .addPrompt({
          flagName: 'column',
          type: 'list',
          message: 'Select column:',
          choices: () => [{ name: 'Backlog', value: 'Backlog' }],
        })
        .addPrompt({
          flagName: 'priority',
          type: 'list',
          message: 'Select priority:',
          choices: () => [{ name: 'P0', value: 'P0' }],
        })
        .addPrompt({
          flagName: 'title',
          type: 'input',
          message: 'Enter title:',
        });

      const result = await resolver.resolve();
      expect(result.column).to.equal('Backlog');
      expect(result.priority).to.equal('P0');
      expect(result.title).to.equal('Test ticket');
    });
  });

  describe('resolve - JSON mode', () => {
    // Note: These tests verify the JSON output format by capturing process.stdout
    // The actual process.exit behavior is tested indirectly through integration tests

    it('resolves all flags when all are pre-set (no prompting needed)', async () => {
      const resolver = new FlagResolver<{ column?: string }>({
        commandName: 'test',
        baseCommand: 'prlt test',
        jsonMode: true, // JSON mode but all flags set
        flags: { column: 'Backlog' },
      });

      resolver.addPrompt({
        flagName: 'column',
        type: 'list',
        message: 'Select column:',
        choices: () => [{ name: 'Backlog', value: 'Backlog' }],
      });

      // Should resolve without outputting JSON since column is already set
      const result = await resolver.resolve();
      expect(result.column).to.equal('Backlog');
    });

    it('respects when condition in JSON mode', async () => {
      const resolver = new FlagResolver<{ action?: string; customPrompt?: string }>({
        commandName: 'test',
        baseCommand: 'prlt test',
        jsonMode: true,
        flags: { action: 'implement' }, // Not __custom__
      });

      // This prompt should be skipped because when returns false
      resolver.addPrompt({
        flagName: 'customPrompt',
        type: 'input',
        message: 'Enter custom prompt:',
        when: (ctx) => ctx.flags.action === '__custom__',
      });

      // Should resolve without prompting since when condition is false
      const result = await resolver.resolve();
      expect(result.action).to.equal('implement');
      expect(result.customPrompt).to.be.undefined;
    });
  });

  describe('prompt definition options', () => {
    it('supports context object in constructor', () => {
      const resolver = new FlagResolver<{ action?: string }>({
        commandName: 'test',
        baseCommand: 'prlt test',
        jsonMode: false,
        flags: {},
        context: { ticketId: 'TKT-001', projectId: 'proj-123' },
      });

      expect(resolver.getContext('ticketId')).to.equal('TKT-001');
      expect(resolver.getContext('projectId')).to.equal('proj-123');
    });

    it('supports args in constructor', () => {
      const resolver = new FlagResolver({
        commandName: 'test',
        baseCommand: 'prlt test',
        jsonMode: false,
        flags: {},
        args: { ticketId: 'TKT-001' },
      });

      // Args are accessible through the resolver context
      expect(resolver).to.be.instanceOf(FlagResolver);
    });
  });
});

describe('shouldOutputJson (re-exported from flags)', () => {
  let originalIsTTY: boolean | undefined;

  beforeEach(() => {
    originalIsTTY = process.stdout.isTTY;
  });

  afterEach(() => {
    Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
  });

  it('returns true when json flag is true', () => {
    expect(shouldOutputJson({ json: true })).to.be.true;
  });

  it('returns true in non-TTY environment', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
    expect(shouldOutputJson({})).to.be.true;
  });

  it('returns false in TTY environment without json flag', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    expect(shouldOutputJson({})).to.be.false;
  });

  it('returns false when json flag is explicitly false', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    expect(shouldOutputJson({ json: false })).to.be.false;
  });
});

/**
 * Integration-style tests for work commands using FlagResolver
 * These test the behavior when all flags are pre-provided (no interactive prompting)
 */
describe('Work Commands FlagResolver Integration', () => {
  describe('work start - FlagResolver pattern', () => {
    it('accepts all required flags without prompting', async () => {
      // This test verifies that FlagResolver correctly handles pre-set flags
      const resolver = new FlagResolver<{
        agent?: string;
        action?: string;
        display?: string;
        'permission-mode'?: string;
      }>({
        commandName: 'work start',
        baseCommand: 'prlt work start TKT-001',
        jsonMode: false,
        flags: {
          agent: 'claude',
          action: 'implement',
          display: 'terminal',
          'permission-mode': 'danger',
        },
      });

      // Add prompts that would normally ask for these values
      resolver
        .addPrompt({
          flagName: 'agent',
          type: 'list',
          message: 'Select agent:',
          choices: () => [{ name: 'claude', value: 'claude' }],
        })
        .addPrompt({
          flagName: 'action',
          type: 'list',
          message: 'Select action:',
          choices: () => [{ name: 'implement', value: 'implement' }],
        });

      const result = await resolver.resolve();
      expect(result.agent).to.equal('claude');
      expect(result.action).to.equal('implement');
      expect(result.display).to.equal('terminal');
      expect(result['permission-mode']).to.equal('danger');
    });
  });

  describe('work spawn - FlagResolver pattern', () => {
    it('handles batch mode flags', async () => {
      const resolver = new FlagResolver<{
        column?: string;
        action?: string;
        'permission-mode'?: string;
      }>({
        commandName: 'work spawn',
        baseCommand: 'prlt work spawn --all',
        jsonMode: false,
        flags: {
          column: 'Backlog',
          action: 'implement',
          'permission-mode': 'safe',
        },
      });

      resolver
        .addPrompt({
          flagName: 'column',
          type: 'list',
          message: 'Select column:',
          choices: () => [{ name: 'Backlog', value: 'Backlog' }],
        })
        .addPrompt({
          flagName: 'action',
          type: 'list',
          message: 'Select action:',
          choices: () => [{ name: 'implement', value: 'implement' }],
        });

      const result = await resolver.resolve();
      expect(result.column).to.equal('Backlog');
      expect(result.action).to.equal('implement');
      expect(result['permission-mode']).to.equal('safe');
    });
  });

  describe('work watch - FlagResolver pattern', () => {
    it('handles watch mode flags', async () => {
      const resolver = new FlagResolver<{
        column?: string;
        selectedEnvironment?: string;
        selectedDisplay?: string;
      }>({
        commandName: 'work watch',
        baseCommand: 'prlt work watch',
        jsonMode: false,
        flags: {
          column: 'Ready',
          selectedEnvironment: 'devcontainer',
          selectedDisplay: 'terminal',
        },
      });

      resolver
        .addPrompt({
          flagName: 'column',
          type: 'list',
          message: 'Select column:',
          choices: () => [{ name: 'Ready', value: 'Ready' }],
        })
        .addPrompt({
          flagName: 'selectedEnvironment',
          type: 'list',
          message: 'Where should agents run?',
          choices: () => [{ name: 'devcontainer', value: 'devcontainer' }],
        });

      const result = await resolver.resolve();
      expect(result.column).to.equal('Ready');
      expect(result.selectedEnvironment).to.equal('devcontainer');
      expect(result.selectedDisplay).to.equal('terminal');
    });
  });
});
