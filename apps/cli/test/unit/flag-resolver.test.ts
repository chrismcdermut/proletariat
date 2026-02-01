import { expect } from 'chai';
import { FlagResolver } from '../../src/lib/flags/resolver.js';

describe('FlagResolver', () => {
  describe('constructor', () => {
    it('should create resolver with provided options', () => {
      const resolver = new FlagResolver({
        commandName: 'test command',
        baseCommand: 'prlt test',
        jsonMode: false,
        flags: { option: 'value' },
      });

      expect(resolver.hasFlag('option')).to.be.true;
      expect(resolver.getFlag('option')).to.equal('value');
    });

    it('should handle empty flags', () => {
      const resolver = new FlagResolver({
        commandName: 'test',
        baseCommand: 'prlt test',
        jsonMode: false,
        flags: {},
      });

      expect(resolver.hasFlag('missing')).to.be.false;
    });
  });

  describe('addPrompt', () => {
    it('should add prompt to resolver', () => {
      const resolver = new FlagResolver({
        commandName: 'test',
        baseCommand: 'prlt test',
        jsonMode: false,
        flags: {},
      });

      resolver.addPrompt({
        flagName: 'selection',
        type: 'list',
        message: 'Select option:',
        choices: () => [
          { name: 'Option A', value: 'a' },
          { name: 'Option B', value: 'b' },
        ],
      });

      // Prompt was added successfully (internal state)
      expect(resolver.hasFlag('selection')).to.be.false; // Not resolved yet
    });

    it('should chain multiple prompts', () => {
      const resolver = new FlagResolver({
        commandName: 'test',
        baseCommand: 'prlt test',
        jsonMode: false,
        flags: {},
      });

      resolver
        .addPrompt({
          flagName: 'first',
          type: 'list',
          message: 'First:',
          choices: () => [{ name: 'A', value: 'a' }],
        })
        .addPrompt({
          flagName: 'second',
          type: 'input',
          message: 'Second:',
        });

      // Chainable API works
      expect(resolver).to.be.instanceOf(FlagResolver);
    });
  });

  describe('setFlag', () => {
    it('should set flag value directly', () => {
      const resolver = new FlagResolver<{ myFlag?: string }>({
        commandName: 'test',
        baseCommand: 'prlt test',
        jsonMode: false,
        flags: {},
      });

      resolver.setFlag('myFlag', 'my-value');

      expect(resolver.hasFlag('myFlag')).to.be.true;
      expect(resolver.getFlag('myFlag')).to.equal('my-value');
    });
  });

  describe('setContext', () => {
    it('should set custom context', () => {
      const resolver = new FlagResolver({
        commandName: 'test',
        baseCommand: 'prlt test',
        jsonMode: false,
        flags: {},
      });

      resolver.setContext('projectId', 'test-project');

      expect(resolver.getContext('projectId')).to.equal('test-project');
    });
  });

  describe('resolve (interactive mode)', () => {
    it('should skip prompts for flags that already have values', async () => {
      const resolver = new FlagResolver<{ existingFlag?: string }>({
        commandName: 'test',
        baseCommand: 'prlt test',
        jsonMode: false,
        flags: { existingFlag: 'preset-value' },
      });

      let promptCalled = false;
      resolver.addPrompt({
        flagName: 'existingFlag',
        type: 'list',
        message: 'Should not prompt:',
        choices: () => {
          promptCalled = true;
          return [{ name: 'A', value: 'a' }];
        },
      });

      const resolved = await resolver.resolve();

      expect(promptCalled).to.be.false;
      expect(resolved.existingFlag).to.equal('preset-value');
    });

    it('should skip prompts when "when" condition returns false', async () => {
      const resolver = new FlagResolver<{ conditional?: string }>({
        commandName: 'test',
        baseCommand: 'prlt test',
        jsonMode: false,
        flags: {},
      });

      let choicesGenerated = false;
      resolver.addPrompt({
        flagName: 'conditional',
        type: 'list',
        message: 'Conditional prompt:',
        when: () => false, // Never show this prompt
        choices: () => {
          choicesGenerated = true;
          return [{ name: 'A', value: 'a' }];
        },
      });

      const resolved = await resolver.resolve();

      expect(choicesGenerated).to.be.false;
      expect(resolved.conditional).to.be.undefined;
    });

    it('should respect prompt order and dependencies when all flags provided', async () => {
      // Test that when both flags are already provided, no prompts are shown
      const resolver = new FlagResolver<{ first?: string; second?: string }>({
        commandName: 'test',
        baseCommand: 'prlt test',
        jsonMode: false,
        flags: { first: 'first-value', second: 'second-value' },
      });

      resolver.addPrompt({
        flagName: 'first',
        type: 'list',
        message: 'First:',
        choices: () => [{ name: 'First', value: 'first-value' }],
      });

      resolver.addPrompt({
        flagName: 'second',
        type: 'list',
        message: 'Second:',
        when: (ctx) => ctx.flags.first === 'first-value',
        choices: () => [{ name: 'Second', value: 'second-value' }],
      });

      // Both flags already set, so no prompts should be shown
      const resolved = await resolver.resolve();
      expect(resolved.first).to.equal('first-value');
      expect(resolved.second).to.equal('second-value');
    });
  });

  describe('hasFlag / getFlag', () => {
    it('should return true for existing flags', () => {
      const resolver = new FlagResolver({
        commandName: 'test',
        baseCommand: 'prlt test',
        jsonMode: false,
        flags: { existing: 'value' },
      });

      expect(resolver.hasFlag('existing')).to.be.true;
    });

    it('should return false for non-existing flags', () => {
      const resolver = new FlagResolver({
        commandName: 'test',
        baseCommand: 'prlt test',
        jsonMode: false,
        flags: {},
      });

      expect(resolver.hasFlag('nonexistent')).to.be.false;
    });

    it('should return undefined for non-existing flags', () => {
      const resolver = new FlagResolver({
        commandName: 'test',
        baseCommand: 'prlt test',
        jsonMode: false,
        flags: {},
      });

      expect(resolver.getFlag('nonexistent')).to.be.undefined;
    });

    it('should return flag value', () => {
      const resolver = new FlagResolver({
        commandName: 'test',
        baseCommand: 'prlt test',
        jsonMode: false,
        flags: { myFlag: 'my-value' },
      });

      expect(resolver.getFlag('myFlag')).to.equal('my-value');
    });
  });
});
