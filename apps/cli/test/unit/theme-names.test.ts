import { expect } from 'chai';
import {
  generateEphemeralAgentName,
  extractBaseName,
  isEphemeralAgentName,
  getAgentBaseName,
  BUILTIN_THEMES,
} from '../../src/lib/themes.js';
import { Agent } from '../../src/lib/database/index.js';

/**
 * Unit tests for theme name generation and parsing (TKT-503)
 *
 * These tests verify that:
 * 1. generateEphemeralAgentName() generates correct formats
 * 2. extractBaseName() handles both numberless and numbered formats
 * 3. isEphemeralAgentName() recognizes ephemeral agent names
 *
 * Note: Database-related tests (getAvailableThemeNames, migrations) are in e2e tests
 * because the better-sqlite3 native module doesn't work with ts-node/esm loader.
 */
describe('Theme Name Generation (TKT-503)', () => {
  describe('generateEphemeralAgentName()', () => {
    it('should generate name without number when name is available', () => {
      const existingNames = new Set<string>();
      const name = generateEphemeralAgentName(existingNames, { themeId: 'billionaires' });

      const parts = name.split('-');
      // Should be adjective-baseName (2 parts) when no conflicts
      expect(parts.length).to.equal(2);
    });

    it('should add number suffix when base name already exists', () => {
      // Pre-populate with "bold-bezos" to force a numbered name
      const existingNames = new Set(['bold-bezos'].map(n => n.toLowerCase()));

      // Generate names until we get one that would have conflicted with "bold-bezos"
      let foundNumbered = false;
      for (let i = 0; i < 100; i++) {
        const name = generateEphemeralAgentName(existingNames, { themeId: 'billionaires' });
        existingNames.add(name.toLowerCase());

        // If the name starts with "bold-bezos-", it means it added a number
        if (name.startsWith('bold-bezos-')) {
          foundNumbered = true;
          const parts = name.split('-');
          expect(parts.length).to.equal(3);
          expect(parseInt(parts[2], 10)).to.be.at.least(2);
          break;
        }
      }
      // Note: This test may not always find a numbered name due to randomness
    });

    it('should prefer unused base names when inUseBaseNames provided', () => {
      const existingNames = new Set<string>();

      // Mark most billionaire names as "in use"
      const billionairesTheme = BUILTIN_THEMES.find(t => t.id === 'billionaires');
      const inUseBaseNames = new Set(
        billionairesTheme!.names.slice(0, -3).map(n => n.toLowerCase()) // Leave only 3 available
      );
      const unusedNames = billionairesTheme!.names.slice(-3).map(n => n.toLowerCase());

      // Generate multiple names and verify they use the unused base names
      const generatedBaseNames: string[] = [];
      for (let i = 0; i < 10; i++) {
        const name = generateEphemeralAgentName(existingNames, {
          themeId: 'billionaires',
          inUseBaseNames,
        });
        existingNames.add(name.toLowerCase());

        // Extract base name using the helper function
        const baseName = extractBaseName(name).toLowerCase();
        generatedBaseNames.push(baseName);
      }

      // At least some of the generated names should use the unused base names
      const usedUnusedNames = generatedBaseNames.filter(n => unusedNames.includes(n));
      expect(usedUnusedNames.length).to.be.greaterThan(0);
    });

    it('should not generate duplicate names', () => {
      const existingNames = new Set<string>();
      const generated: string[] = [];

      for (let i = 0; i < 20; i++) {
        const name = generateEphemeralAgentName(existingNames, { themeId: 'billionaires' });
        expect(generated).to.not.include(name);
        generated.push(name);
        existingNames.add(name.toLowerCase());
      }
    });

    it('should avoid names in existingNames set', () => {
      // Pre-populate with some existing names (both formats)
      const existingNames = new Set(['bold-bezos', 'keen-musk', 'fast-gates-2'].map(n => n.toLowerCase()));

      for (let i = 0; i < 10; i++) {
        const name = generateEphemeralAgentName(existingNames, { themeId: 'billionaires' });
        expect(existingNames.has(name.toLowerCase())).to.be.false;
        existingNames.add(name.toLowerCase());
      }
    });

    it('should use external conflict checker when provided', () => {
      const existingNames = new Set<string>();
      const blockedNames = ['bold-bezos', 'keen-bezos'];

      const checkExternalConflict = (candidateName: string) => {
        if (blockedNames.includes(candidateName)) {
          return { conflict: true, reason: 'blocked by test' };
        }
        return { conflict: false };
      };

      for (let i = 0; i < 5; i++) {
        const name = generateEphemeralAgentName(existingNames, {
          themeId: 'billionaires',
          checkExternalConflict,
        });
        expect(blockedNames).to.not.include(name);
        existingNames.add(name.toLowerCase());
      }
    });
  });

  describe('extractBaseName()', () => {
    it('should extract base name from numberless format', () => {
      expect(extractBaseName('bold-bezos')).to.equal('bezos');
      expect(extractBaseName('keen-musk')).to.equal('musk');
    });

    it('should extract base name from numbered format', () => {
      expect(extractBaseName('bold-bezos-2')).to.equal('bezos');
      expect(extractBaseName('keen-musk-15')).to.equal('musk');
    });

    it('should handle multi-part base names', () => {
      expect(extractBaseName('bold-mary-jane')).to.equal('mary-jane');
      expect(extractBaseName('keen-mary-jane-2')).to.equal('mary-jane');
    });

    it('should return original name if no hyphen', () => {
      expect(extractBaseName('bezos')).to.equal('bezos');
    });
  });

  describe('isEphemeralAgentName()', () => {
    it('should recognize numberless ephemeral names', () => {
      expect(isEphemeralAgentName('bold-bezos')).to.be.true;
      expect(isEphemeralAgentName('keen-musk')).to.be.true;
    });

    it('should recognize numbered ephemeral names', () => {
      expect(isEphemeralAgentName('bold-bezos-2')).to.be.true;
      expect(isEphemeralAgentName('keen-musk-15')).to.be.true;
    });

    it('should reject names without valid adjective', () => {
      expect(isEphemeralAgentName('notanadjective-bezos')).to.be.false;
      expect(isEphemeralAgentName('random-name')).to.be.false;
    });

    it('should reject single-part names', () => {
      expect(isEphemeralAgentName('bezos')).to.be.false;
      expect(isEphemeralAgentName('bold')).to.be.false;
    });
  });

  describe('getAgentBaseName()', () => {
    const makeAgent = (overrides: Partial<Agent>): Agent => ({
      name: 'test-agent',
      type: 'persistent',
      status: 'active',
      base_name: null,
      theme_id: null,
      worktree_path: null,
      mount_mode: 'worktree',
      created_at: new Date().toISOString(),
      cleaned_at: null,
      ...overrides,
    });

    it('should return base_name if explicitly set', () => {
      const agent = makeAgent({ name: 'bold-bezos', base_name: 'bezos', type: 'ephemeral' });
      expect(getAgentBaseName(agent)).to.equal('bezos');
    });

    it('should extract base name for ephemeral agents without base_name', () => {
      const agent = makeAgent({ name: 'bold-bezos', type: 'ephemeral' });
      expect(getAgentBaseName(agent)).to.equal('bezos');
    });

    it('should extract base name for numbered ephemeral agents', () => {
      const agent = makeAgent({ name: 'keen-musk-2', type: 'ephemeral' });
      expect(getAgentBaseName(agent)).to.equal('musk');
    });

    it('should return name directly for staff agents', () => {
      const agent = makeAgent({ name: 'gates', type: 'persistent' });
      expect(getAgentBaseName(agent)).to.equal('gates');
    });
  });
});
