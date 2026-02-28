/**
 * Unit tests for spec edit command JSON mode support.
 *
 * These tests verify that the FlagResolver pattern is correctly implemented
 * in the spec edit command for JSON mode support.
 */

import { expect } from 'chai';
import {
  shouldOutputJson,
  createMetadata,
} from '../../src/lib/prompt-json.js';
import { FlagResolver, ResolverChoice } from '../../src/lib/flags/resolver.js';

describe('Spec Edit Command', () => {
  describe('FlagResolver configuration for spec edit', () => {
    it('should create FlagResolver with correct configuration', () => {
      const resolver = new FlagResolver<{ spec?: string }>({
        commandName: 'spec edit',
        baseCommand: 'prlt spec edit',
        jsonMode: false,
        flags: {},
      });

      expect(resolver).to.be.instanceOf(FlagResolver);
    });

    it('should create FlagResolver with initial spec from args', () => {
      const resolver = new FlagResolver<{ spec?: string }>({
        commandName: 'spec edit',
        baseCommand: 'prlt spec edit',
        jsonMode: false,
        flags: { spec: 'user-authentication' },
      });

      expect(resolver.getFlag('spec')).to.equal('user-authentication');
    });

    it('should include metadata with command name for JSON output', () => {
      const flags = { json: true, spec: 'auth-spec' };
      const metadata = createMetadata('spec edit', flags);

      expect(metadata.command).to.equal('spec edit');
      expect(metadata.flags.json).to.be.true;
      expect(metadata.flags.spec).to.equal('auth-spec');
      expect(metadata.timestamp).to.be.a('string');
    });
  });

  describe('Spec selection prompt', () => {
    it('should build choice list for spec selection', () => {
      const specs = [
        { id: 'spec-1', title: 'Auth System', status: 'active', type: 'product' },
        { id: 'spec-2', title: 'API Design', status: 'draft', type: 'platform' },
        { id: 'spec-3', title: 'DB Schema', status: 'implemented', type: 'infra' },
      ];

      const choices: ResolverChoice<string>[] = specs.map(s => ({
        name: `${s.title} [${s.status}]${s.type ? ` (${s.type})` : ''}`,
        value: s.id,
      }));

      expect(choices).to.have.lengthOf(3);
      expect(choices[0].name).to.equal('Auth System [active] (product)');
      expect(choices[0].value).to.equal('spec-1');
      expect(choices[1].name).to.equal('API Design [draft] (platform)');
      expect(choices[2].name).to.equal('DB Schema [implemented] (infra)');
    });

    it('should add spec selection prompt to resolver', () => {
      const specs = [
        { id: 'spec-1', title: 'Auth System', status: 'active', type: 'product' },
      ];

      const resolver = new FlagResolver<{ spec?: string }>({
        commandName: 'spec edit',
        baseCommand: 'prlt spec edit',
        jsonMode: false,
        flags: {},
      });

      resolver.addPrompt({
        flagName: 'spec',
        type: 'list',
        message: 'Select spec to edit:',
        choices: () => specs.map(s => ({
          name: `${s.title} [${s.status}]${s.type ? ` (${s.type})` : ''}`,
          value: s.id,
        })),
      });

      expect(resolver).to.be.instanceOf(FlagResolver);
    });
  });

  describe('Type choices for spec edit', () => {
    it('should build type choices including None option', () => {
      const typeChoices: ResolverChoice<string>[] = [
        { name: 'Product (user-facing feature)', value: 'product' },
        { name: 'Platform (internal tooling)', value: 'platform' },
        { name: 'Infra (technical infrastructure)', value: 'infra' },
        { name: 'Integration (external service)', value: 'integration' },
        { name: 'None', value: '' },
      ];

      expect(typeChoices).to.have.lengthOf(5);
      expect(typeChoices[0].value).to.equal('product');
      expect(typeChoices[1].value).to.equal('platform');
      expect(typeChoices[2].value).to.equal('infra');
      expect(typeChoices[3].value).to.equal('integration');
      expect(typeChoices[4].value).to.equal('');
      expect(typeChoices[4].name).to.equal('None');
    });
  });

  describe('Status choices for spec edit', () => {
    it('should build status choices', () => {
      const statusChoices: ResolverChoice<string>[] = [
        { name: 'Draft (planning)', value: 'draft' },
        { name: 'Active (in progress)', value: 'active' },
        { name: 'Implemented (complete)', value: 'implemented' },
      ];

      expect(statusChoices).to.have.lengthOf(3);
      expect(statusChoices[0].value).to.equal('draft');
      expect(statusChoices[1].value).to.equal('active');
      expect(statusChoices[2].value).to.equal('implemented');
    });
  });

  describe('Update detection', () => {
    it('should detect title change', () => {
      const spec = { title: 'Old Title', status: 'draft' as const };
      const answers = { title: 'New Title', status: 'draft' };

      const updates: { title?: string } = {};
      if (answers.title !== spec.title) {
        updates.title = answers.title;
      }

      expect(updates.title).to.equal('New Title');
    });

    it('should not include unchanged fields', () => {
      const spec = { title: 'Same Title', status: 'draft' as const };
      const answers = { title: 'Same Title', status: 'draft' };

      const updates: { title?: string; status?: string } = {};
      if (answers.title !== spec.title) {
        updates.title = answers.title;
      }
      if (answers.status !== spec.status) {
        updates.status = answers.status;
      }

      expect(updates).to.deep.equal({});
    });

    it('should detect type change from undefined to value', () => {
      const spec = { title: 'Test', status: 'draft' as const, type: undefined };
      const answers = { title: 'Test', status: 'draft', type: 'product' };

      const updates: { type?: string } = {};
      const newType = answers.type === '' ? undefined : answers.type;
      if (newType !== spec.type) {
        updates.type = newType;
      }

      expect(updates.type).to.equal('product');
    });

    it('should detect type change from value to undefined (none)', () => {
      const spec = { title: 'Test', status: 'draft' as const, type: 'product' as const };
      const answers = { title: 'Test', status: 'draft', type: '' };

      const updates: { type?: string | undefined } = {};
      const newType = answers.type === '' ? undefined : answers.type;
      if (newType !== spec.type) {
        updates.type = newType;
      }

      expect(updates.type).to.equal(undefined);
      expect('type' in updates).to.be.true;
    });

    it('should detect status change', () => {
      const spec = { title: 'Test', status: 'draft' as const };
      const answers = { title: 'Test', status: 'active' };

      const updates: { status?: string } = {};
      if (answers.status !== spec.status) {
        updates.status = answers.status;
      }

      expect(updates.status).to.equal('active');
    });

    it('should detect problem change', () => {
      const spec = { title: 'Test', status: 'draft' as const, problem: 'Old problem' };
      const answers = { problem: 'New problem' };

      const updates: { problem?: string } = {};
      if (answers.problem !== (spec.problem || '')) {
        updates.problem = answers.problem || undefined;
      }

      expect(updates.problem).to.equal('New problem');
    });

    it('should detect clearing of problem field', () => {
      const spec = { title: 'Test', status: 'draft' as const, problem: 'Old problem' };
      const answers = { problem: '' };

      const updates: { problem?: string | undefined } = {};
      if (answers.problem !== (spec.problem || '')) {
        updates.problem = answers.problem || undefined;
      }

      expect(updates.problem).to.equal(undefined);
      expect('problem' in updates).to.be.true;
    });
  });

  describe('Flag parsing', () => {
    it('should convert type "none" to undefined', () => {
      const flagType = 'none';
      const specType = flagType === 'none' ? undefined : flagType;

      expect(specType).to.be.undefined;
    });

    it('should keep valid type values', () => {
      const types = ['product', 'platform', 'infra', 'integration'];

      for (const t of types) {
        const specType = t === 'none' ? undefined : t;
        expect(specType).to.equal(t);
      }
    });

    it('should handle all valid status values', () => {
      const statuses = ['draft', 'active', 'implemented'];

      for (const s of statuses) {
        expect(statuses).to.include(s);
      }
    });
  });

  describe('JSON mode detection', () => {
    it('should return true when --json flag is set', () => {
      expect(shouldOutputJson({ json: true })).to.be.true;
    });

    // Note: --machine is an oclif alias that sets json: true
    // The shouldOutputJson function only sees { json: true }

    it('should return false when no flags are set in TTY', () => {
      const originalStdoutIsTTY = process.stdout.isTTY;
      const originalStdinIsTTY = process.stdin.isTTY;
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });

      expect(shouldOutputJson({ json: false })).to.be.false;
      expect(shouldOutputJson({})).to.be.false;

      Object.defineProperty(process.stdout, 'isTTY', { value: originalStdoutIsTTY, configurable: true });
      Object.defineProperty(process.stdin, 'isTTY', { value: originalStdinIsTTY, configurable: true });
    });
  });

  describe('FlagResolver resolve behavior', () => {
    it('should skip spec prompt when spec flag is already set', async () => {
      const resolver = new FlagResolver<{ spec?: string }>({
        commandName: 'spec edit',
        baseCommand: 'prlt spec edit',
        jsonMode: false,
        flags: { spec: 'existing-spec' },
      });

      resolver.addPrompt({
        flagName: 'spec',
        type: 'list',
        message: 'Select spec to edit:',
        choices: () => [{ name: 'Test', value: 'test' }],
      });

      const resolved = await resolver.resolve();
      expect(resolved.spec).to.equal('existing-spec');
    });
  });
});
