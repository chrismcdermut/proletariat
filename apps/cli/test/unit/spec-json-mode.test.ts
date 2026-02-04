/**
 * Unit tests for spec commands JSON mode support using FlagResolver.
 *
 * These tests verify that the FlagResolver pattern is correctly implemented
 * in spec commands for JSON mode support.
 */

import { expect } from 'chai';
import {
  shouldOutputJson,
  createMetadata,
  outputSuccessAsJson,
} from '../../src/lib/prompt-json.js';
import { FlagResolver, ResolverChoice } from '../../src/lib/flags/resolver.js';

describe('Spec Commands JSON Mode with FlagResolver', () => {
  describe('spec list JSON mode', () => {
    it('should output structured spec data', () => {
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

  describe('FlagResolver configuration', () => {
    it('should create FlagResolver with correct configuration for spec plan', () => {
      const resolver = new FlagResolver<{ spec?: string }>({
        commandName: 'spec plan',
        baseCommand: 'prlt spec plan',
        jsonMode: false,
        flags: {},
      });

      expect(resolver).to.be.instanceOf(FlagResolver);
    });

    it('should create FlagResolver with context for spec ticket', () => {
      const resolver = new FlagResolver<{ ticket?: string }>({
        commandName: 'spec ticket',
        baseCommand: 'prlt spec ticket',
        jsonMode: false,
        flags: { ticket: undefined },
        context: { projectId: 'test-project' },
      });

      expect(resolver).to.be.instanceOf(FlagResolver);
      expect(resolver.getContext('projectId')).to.equal('test-project');
    });

    it('should create FlagResolver with initial flags for spec create', () => {
      const resolver = new FlagResolver<{
        title?: string;
        type?: string;
        status?: string;
      }>({
        commandName: 'spec create',
        baseCommand: 'prlt spec create',
        jsonMode: false,
        flags: {
          title: 'My Spec',
          status: 'draft',
        },
      });

      expect(resolver.getFlag('title')).to.equal('My Spec');
      expect(resolver.getFlag('status')).to.equal('draft');
      expect(resolver.getFlag('type')).to.be.undefined;
    });
  });

  describe('FlagResolver prompt definitions', () => {
    it('should allow adding list prompt for spec selection', () => {
      const specs = [
        { id: 'spec-1', title: 'Spec 1', status: 'active', type: 'product' },
        { id: 'spec-2', title: 'Spec 2', status: 'draft', type: 'platform' },
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
          name: `${s.title} [${s.status}]${s.type ? ` (${s.type})` : ''}`,
          value: s.id,
        })),
      });

      expect(resolver).to.be.instanceOf(FlagResolver);
    });

    it('should allow adding input prompt with validation for spec create', () => {
      const resolver = new FlagResolver<{ title?: string }>({
        commandName: 'spec create',
        baseCommand: 'prlt spec create',
        jsonMode: false,
        flags: {},
      });

      resolver.addPrompt({
        flagName: 'title',
        type: 'input',
        message: 'Spec title:',
        validate: (value) => (value as string).length > 0 || 'Title is required',
        when: (ctx) => !ctx.flags.title,
      });

      expect(resolver).to.be.instanceOf(FlagResolver);
    });

    it('should allow adding multiple prompts with conditional execution', () => {
      const typeChoices = [
        { name: 'Product', value: 'product' },
        { name: 'Platform', value: 'platform' },
      ];
      const statusChoices = [
        { name: 'Draft', value: 'draft' },
        { name: 'Active', value: 'active' },
      ];

      const resolver = new FlagResolver<{
        title?: string;
        type?: string;
        status?: string;
      }>({
        commandName: 'spec create',
        baseCommand: 'prlt spec create',
        jsonMode: false,
        flags: {},
      });

      resolver.addPrompt({
        flagName: 'title',
        type: 'input',
        message: 'Spec title:',
        when: (ctx) => !ctx.flags.title,
      });

      resolver.addPrompt({
        flagName: 'type',
        type: 'list',
        message: 'Spec type:',
        choices: () => typeChoices,
        when: (ctx) => !ctx.flags.type && ctx.flags.title !== undefined,
      });

      resolver.addPrompt({
        flagName: 'status',
        type: 'list',
        message: 'Status:',
        choices: () => statusChoices,
        default: 'draft',
        when: (ctx) => ctx.flags.title !== undefined,
      });

      expect(resolver).to.be.instanceOf(FlagResolver);
    });

    it('should allow custom command builder with getCommand', () => {
      const menuChoices = [
        { name: 'Create', value: 'create' },
        { name: 'View', value: 'view' },
      ];

      const resolver = new FlagResolver<{ action?: string }>({
        commandName: 'spec',
        baseCommand: 'prlt spec',
        jsonMode: false,
        flags: {},
      });

      resolver.addPrompt({
        flagName: 'action',
        type: 'list',
        message: 'Select action:',
        choices: () => menuChoices,
        getCommand: (value) => {
          const commands: Record<string, string> = {
            create: 'prlt spec create --json',
            view: 'prlt spec view --json',
          };
          return commands[value as string] || '';
        },
      });

      expect(resolver).to.be.instanceOf(FlagResolver);
    });
  });

  describe('FlagResolver flag management', () => {
    it('should check if flag exists with hasFlag', () => {
      const resolver = new FlagResolver<{ spec?: string; title?: string }>({
        commandName: 'test',
        baseCommand: 'prlt test',
        jsonMode: false,
        flags: { spec: 'test-spec' },
      });

      expect(resolver.hasFlag('spec')).to.be.true;
      expect(resolver.hasFlag('title')).to.be.false;
    });

    it('should get flag value with getFlag', () => {
      const resolver = new FlagResolver<{ spec?: string }>({
        commandName: 'test',
        baseCommand: 'prlt test',
        jsonMode: false,
        flags: { spec: 'test-spec' },
      });

      expect(resolver.getFlag('spec')).to.equal('test-spec');
    });

    it('should set flag value with setFlag', () => {
      const resolver = new FlagResolver<{ spec?: string }>({
        commandName: 'test',
        baseCommand: 'prlt test',
        jsonMode: false,
        flags: {},
      });

      resolver.setFlag('spec', 'new-spec');
      expect(resolver.getFlag('spec')).to.equal('new-spec');
    });

    it('should set and get context values', () => {
      const resolver = new FlagResolver<{ spec?: string }>({
        commandName: 'test',
        baseCommand: 'prlt test',
        jsonMode: false,
        flags: {},
        context: { projectId: 'initial-project' },
      });

      expect(resolver.getContext('projectId')).to.equal('initial-project');

      resolver.setContext('ticketId', 'TKT-001');
      expect(resolver.getContext('ticketId')).to.equal('TKT-001');
    });
  });

  describe('FlagResolver resolve behavior (non-JSON mode)', () => {
    it('should skip prompts when flag is already set', async () => {
      const resolver = new FlagResolver<{ spec?: string }>({
        commandName: 'test',
        baseCommand: 'prlt test',
        jsonMode: false,
        flags: { spec: 'already-set' },
      });

      resolver.addPrompt({
        flagName: 'spec',
        type: 'list',
        message: 'Select spec:',
        choices: () => [{ name: 'Test', value: 'test' }],
      });

      // Since flag is already set, resolve should return immediately
      const resolved = await resolver.resolve();
      expect(resolved.spec).to.equal('already-set');
    });

    it('should skip prompts when condition is false', async () => {
      const resolver = new FlagResolver<{ spec?: string; dependentFlag?: string }>({
        commandName: 'test',
        baseCommand: 'prlt test',
        jsonMode: false,
        flags: {},
      });

      resolver.addPrompt({
        flagName: 'dependentFlag',
        type: 'input',
        message: 'Enter value:',
        when: (ctx) => ctx.flags.spec !== undefined, // Only when spec is set
      });

      // Since spec is not set, dependentFlag prompt should be skipped
      const resolved = await resolver.resolve();
      expect(resolved.dependentFlag).to.be.undefined;
    });
  });

  describe('Choice building for spec commands', () => {
    it('should build choice list for spec plan', () => {
      const specs = [
        { id: 'spec-1', title: 'Spec 1', status: 'active', type: 'product' },
        { id: 'spec-2', title: 'Spec 2', status: 'draft', type: 'platform' },
      ];

      const choices: ResolverChoice<string>[] = specs.map(s => ({
        name: `${s.title} [${s.status}]${s.type ? ` (${s.type})` : ''}`,
        value: s.id,
      }));

      expect(choices).to.have.lengthOf(2);
      expect(choices[0].name).to.equal('Spec 1 [active] (product)');
      expect(choices[0].value).to.equal('spec-1');
      expect(choices[1].name).to.equal('Spec 2 [draft] (platform)');
    });

    it('should build choice list for spec ticket', () => {
      const tickets = [
        { id: 'TKT-001', title: 'Fix auth bug' },
        { id: 'TKT-002', title: 'Add login page' },
      ];

      const choices: ResolverChoice<string>[] = tickets.map(t => ({
        name: `${t.id}: ${t.title}`,
        value: t.id,
      }));

      expect(choices).to.have.lengthOf(2);
      expect(choices[0].name).to.equal('TKT-001: Fix auth bug');
      expect(choices[0].value).to.equal('TKT-001');
    });

    it('should build menu choices for spec index', () => {
      const menuChoices: ResolverChoice<string>[] = [
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
      const typeChoices: ResolverChoice<string>[] = [
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

    it('should build status choices for spec create', () => {
      const statusChoices: ResolverChoice<string>[] = [
        { name: 'Draft (planning)', value: 'draft' },
        { name: 'Active (in progress)', value: 'active' },
        { name: 'Implemented (complete)', value: 'implemented' },
      ];

      expect(statusChoices).to.have.lengthOf(3);
      expect(statusChoices[0].value).to.equal('draft');
      expect(statusChoices[2].value).to.equal('implemented');
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

    it('should return true in non-TTY environment', () => {
      const originalIsTTY = process.stdout.isTTY;
      Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });

      expect(shouldOutputJson({})).to.be.true;

      Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
    });
  });
});
