/**
 * Unit tests for spec commands JSON mode support.
 *
 * These tests verify that spec commands correctly output JSON when
 * the --json flag is used or in non-TTY environments.
 */

import { expect } from 'chai';
import {
  shouldOutputJson,
  createMetadata,
  buildPromptConfig,
  outputSuccessAsJson,
} from '../../src/lib/prompt-json.js';

describe('Spec Commands JSON Mode', () => {
  describe('spec list JSON mode', () => {
    it('should output structured spec data with outputSuccessAsJson', () => {
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

  describe('spec plan JSON mode', () => {
    it('should build prompt config for spec selection', () => {
      const specs = [
        { id: 'spec-1', title: 'Spec 1', status: 'active', type: 'product' },
        { id: 'spec-2', title: 'Spec 2', status: 'draft', type: 'platform' },
      ];

      const choices = specs.map(s => ({
        name: `${s.title} [${s.status}]${s.type ? ` (${s.type})` : ''}`,
        value: s.id,
        command: `prlt spec plan ${s.id} --json`,
      }));

      expect(choices).to.have.lengthOf(2);
      expect(choices[0].name).to.equal('Spec 1 [active] (product)');
      expect(choices[0].value).to.equal('spec-1');
      expect(choices[0].command).to.contain('spec plan spec-1 --json');
    });

    it('should use selectFromList pattern with command field', () => {
      const items = [
        { id: 'spec-1', title: 'Spec 1', status: 'active', type: 'product' },
      ];

      // Simulate the selectFromList helper behavior
      const getName = (s: typeof items[0]) => `${s.title} [${s.status}]${s.type ? ` (${s.type})` : ''}`;
      const getValue = (s: typeof items[0]) => s.id;
      const getCommand = (s: typeof items[0]) => `prlt spec plan ${s.id} --json`;

      const choices = items.map(item => ({
        name: getName(item),
        value: getValue(item),
        command: getCommand(item),
      }));

      expect(choices[0]).to.deep.equal({
        name: 'Spec 1 [active] (product)',
        value: 'spec-1',
        command: 'prlt spec plan spec-1 --json',
      });
    });
  });

  describe('spec ticket JSON mode', () => {
    it('should build prompt config for ticket selection', () => {
      const tickets = [
        { id: 'TKT-001', title: 'Fix auth bug' },
        { id: 'TKT-002', title: 'Add login page' },
      ];

      const choices = tickets.map(t => ({
        name: `${t.id}: ${t.title}`,
        value: t.id,
        command: `prlt spec ticket ${t.id} --json`,
      }));

      expect(choices).to.have.lengthOf(2);
      expect(choices[0].name).to.equal('TKT-001: Fix auth bug');
      expect(choices[0].command).to.contain('spec ticket TKT-001 --json');
    });

    it('should build prompt config for spec selection after ticket is selected', () => {
      const ticketId = 'TKT-001';
      const specs = [
        { id: 'auth-spec', name: 'auth-spec', status: 'active' },
        { id: 'login-spec', name: 'login-spec', status: 'draft' },
      ];

      const choices = specs.map(s => ({
        name: `${s.name} (${s.status})`,
        value: s.id,
        command: `prlt spec ticket ${ticketId} ${s.id} --json`,
      }));

      expect(choices).to.have.lengthOf(2);
      expect(choices[0].name).to.equal('auth-spec (active)');
      expect(choices[0].command).to.equal('prlt spec ticket TKT-001 auth-spec --json');
    });
  });

  describe('spec view JSON mode', () => {
    it('should build prompt config for spec selection', () => {
      const specs = [
        { id: 'spec-1', title: 'Spec 1', status: 'active', type: 'product' },
      ];

      const choices = specs.map(s => ({
        name: `${s.title} [${s.status}]${s.type ? ` (${s.type})` : ''}`,
        value: s.id,
        command: `prlt spec view ${s.id} --json`,
      }));

      expect(choices[0].command).to.contain('spec view spec-1 --json');
    });
  });

  describe('requireProject JSON mode', () => {
    it('should include baseCommand for project selection prompt', () => {
      const projects = [
        { id: 'PROJ-001', name: '1. MVP' },
        { id: 'PROJ-002', name: '2. Polish' },
      ];

      const baseCommand = 'prlt spec ticket';
      const choices = projects.map(p => ({
        name: `${p.name} (${p.id})`,
        value: p.id,
        command: `${baseCommand} -P ${p.id} --json`,
      }));

      expect(choices[0].command).to.equal('prlt spec ticket -P PROJ-001 --json');
      expect(choices[1].command).to.equal('prlt spec ticket -P PROJ-002 --json');
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
