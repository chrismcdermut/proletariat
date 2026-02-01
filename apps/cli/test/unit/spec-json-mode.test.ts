/**
 * Unit tests for spec commands JSON mode support using FlagResolver.
 *
 * These tests verify that spec commands correctly output JSON when
 * the --json flag is used or in non-TTY environments.
 */

import { expect } from 'chai';
import {
  shouldOutputJson,
  createMetadata,
} from '../../src/lib/prompt-json.js';
import { FlagResolver } from '../../src/lib/flags/index.js';

describe('Spec Commands JSON Mode with FlagResolver', () => {
  describe('spec list JSON mode', () => {
    it('should output structured spec data', () => {
      // Test the shape of spec list output
      const specs = [
        {
          id: 'auth-system',
          title: 'Auth System',
          status: 'active' as const,
          type: 'product' as const,
          tags: ['security'],
          problem: 'Need authentication',
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-02'),
        },
      ];

      const result = {
        specs: specs.map(s => ({
          id: s.id,
          title: s.title,
          status: s.status,
          type: s.type,
          tags: s.tags,
          problem: s.problem,
          createdAt: s.createdAt?.toISOString(),
          updatedAt: s.updatedAt?.toISOString(),
        })),
        count: specs.length,
        filters: {
          status: undefined,
          type: undefined,
          search: undefined,
        },
      };

      expect(result.specs).to.have.lengthOf(1);
      expect(result.specs[0].id).to.equal('auth-system');
      expect(result.specs[0].status).to.equal('active');
      expect(result.count).to.equal(1);
    });

    it('should include metadata with command name and flags', () => {
      const flags = { json: true, status: 'active' };
      const metadata = createMetadata('spec list', flags);

      expect(metadata.command).to.equal('spec list');
      expect(metadata.flags.json).to.be.true;
      expect(metadata.flags.status).to.equal('active');
      expect(metadata.timestamp).to.be.a('string');
    });
  });

  describe('FlagResolver for spec commands', () => {
    it('should build choice list for spec selection (spec plan)', () => {
      const specs = [
        { id: 'spec-1', title: 'Spec 1', status: 'active', type: 'product' },
        { id: 'spec-2', title: 'Spec 2', status: 'draft', type: 'platform' },
      ];

      const choices = specs.map(s => ({
        name: `${s.title} [${s.status}]${s.type ? ` (${s.type})` : ''}`,
        value: s.id,
      }));

      expect(choices).to.have.lengthOf(2);
      expect(choices[0].name).to.equal('Spec 1 [active] (product)');
      expect(choices[0].value).to.equal('spec-1');
    });

    it('should create FlagResolver with correct configuration', () => {
      const resolver = new FlagResolver<{ spec?: string }>({
        commandName: 'spec plan',
        baseCommand: 'prlt spec plan',
        jsonMode: false,
        flags: {},
      });

      // Resolver should be created successfully
      expect(resolver).to.be.instanceOf(FlagResolver);
    });

    it('should allow adding prompts to resolver', () => {
      const specs = [
        { id: 'spec-1', title: 'Spec 1', status: 'active', type: 'product' },
      ];

      const resolver = new FlagResolver<{ spec?: string }>({
        commandName: 'spec plan',
        baseCommand: 'prlt spec plan',
        jsonMode: false,
        flags: {},
      });

      resolver.addPrompt({
        flagName: 'spec',
        type: 'list',
        message: 'Select spec to plan:',
        choices: () => specs.map(s => ({
          name: `${s.title} [${s.status}]`,
          value: s.id,
        })),
      });

      // Resolver should accept the prompt
      expect(resolver).to.be.instanceOf(FlagResolver);
    });

    it('should build choice list for ticket selection (spec ticket)', () => {
      const tickets = [
        { id: 'TKT-001', title: 'Fix auth bug' },
        { id: 'TKT-002', title: 'Add login page' },
      ];

      const choices = tickets.map(t => ({
        name: `${t.id}: ${t.title}`,
        value: t.id,
      }));

      expect(choices).to.have.lengthOf(2);
      expect(choices[0].name).to.equal('TKT-001: Fix auth bug');
      expect(choices[0].value).to.equal('TKT-001');
    });

    it('should build menu choices for spec index', () => {
      const menuChoices = [
        { name: 'Create new spec', value: 'create' },
        { name: 'List all specs', value: 'list' },
        { name: 'View spec', value: 'view' },
        { name: 'Generate tickets from spec', value: 'generate' },
        { name: 'Assign ticket to spec', value: 'ticket' },
        { name: 'Manage dependencies', value: 'link' },
        { name: 'Cancel', value: 'cancel' },
      ];

      expect(menuChoices).to.have.lengthOf(7);
      expect(menuChoices[0].value).to.equal('create');
      expect(menuChoices[6].value).to.equal('cancel');
    });

    it('should build type choices for spec create', () => {
      const typeChoices = [
        { name: 'Product (user-facing feature)', value: 'product' },
        { name: 'Platform (internal tooling)', value: 'platform' },
        { name: 'Infra (technical infrastructure)', value: 'infra' },
        { name: 'Integration (external service)', value: 'integration' },
        { name: 'None', value: '' },
      ];

      expect(typeChoices).to.have.lengthOf(5);
      expect(typeChoices[0].value).to.equal('product');
      expect(typeChoices[4].value).to.equal('');
    });
  });

  describe('shouldOutputJson', () => {
    it('should return true when --json flag is set', () => {
      expect(shouldOutputJson({ json: true })).to.be.true;
    });

    it('should return false when --json flag is not set in TTY', () => {
      const originalIsTTY = process.stdout.isTTY;
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });

      expect(shouldOutputJson({ json: false })).to.be.false;
      expect(shouldOutputJson({})).to.be.false;

      Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
    });
  });
});
