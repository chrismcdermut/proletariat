import { expect } from 'chai';
import {
  isValidAgentName,
  normalizeAgentName,
  canonicalAgentName,
  getSuggestedAgentNames,
  isBuiltinTheme,
  getBuiltinTheme,
  getThemePersistentDir,
  getThemeEphemeralDir,
  getThemeDirectories,
  pickAdjective,
  pickThemeName,
  pickRandomThemeName,
  BUILTIN_THEMES,
  AGENT_ADJECTIVES,
  DEFAULT_AGENTS_DIR,
  TEMP_AGENTS_DIR,
  DEFAULT_EPHEMERAL_THEME,
} from '../../src/lib/themes.js';

/**
 * Unit tests for theme validation and utility functions.
 * Converts business logic previously only tested via e2e CLI commands
 * into fast, focused unit tests.
 *
 * TKT-002: Speed up CI by converting e2e → unit tests
 */
describe('Theme Validation & Utilities', () => {
  describe('isValidAgentName', () => {
    it('accepts simple alphanumeric names', () => {
      expect(isValidAgentName('agent1')).to.be.true;
      expect(isValidAgentName('bezos')).to.be.true;
      expect(isValidAgentName('Alpha')).to.be.true;
    });

    it('accepts names with hyphens and underscores', () => {
      expect(isValidAgentName('my-agent')).to.be.true;
      expect(isValidAgentName('agent_1')).to.be.true;
      expect(isValidAgentName('test-agent-2')).to.be.true;
    });

    it('rejects names starting with hyphen or underscore', () => {
      expect(isValidAgentName('-agent')).to.be.false;
      expect(isValidAgentName('_agent')).to.be.false;
    });

    it('rejects names with spaces', () => {
      expect(isValidAgentName('my agent')).to.be.false;
    });

    it('rejects names with special characters', () => {
      expect(isValidAgentName('agent@1')).to.be.false;
      expect(isValidAgentName('agent.name')).to.be.false;
      expect(isValidAgentName('agent!name')).to.be.false;
    });

    it('rejects empty string', () => {
      expect(isValidAgentName('')).to.be.false;
    });
  });

  describe('normalizeAgentName', () => {
    it('trims whitespace', () => {
      expect(normalizeAgentName('  agent  ')).to.equal('agent');
    });

    it('replaces spaces with dashes', () => {
      expect(normalizeAgentName('my agent')).to.equal('my-agent');
      expect(normalizeAgentName('my  agent  name')).to.equal('my-agent-name');
    });

    it('removes invalid characters', () => {
      expect(normalizeAgentName('agent@1!')).to.equal('agent1');
      expect(normalizeAgentName('test.name')).to.equal('testname');
    });

    it('preserves case', () => {
      expect(normalizeAgentName('MyAgent')).to.equal('MyAgent');
    });

    it('handles combined transformations', () => {
      expect(normalizeAgentName('  Mary Jane!  ')).to.equal('Mary-Jane');
    });
  });

  describe('canonicalAgentName', () => {
    it('lowercases names', () => {
      expect(canonicalAgentName('MyAgent')).to.equal('myagent');
      expect(canonicalAgentName('AGENT')).to.equal('agent');
    });

    it('preserves already lowercase names', () => {
      expect(canonicalAgentName('agent')).to.equal('agent');
    });
  });

  describe('getSuggestedAgentNames', () => {
    it('returns array of default agent name suggestions', () => {
      const names = getSuggestedAgentNames();
      expect(names).to.be.an('array');
      expect(names.length).to.be.greaterThan(0);
      expect(names[0]).to.match(/^agent-\d+$/);
    });
  });

  describe('BUILTIN_THEMES', () => {
    it('includes billionaires theme', () => {
      const theme = BUILTIN_THEMES.find(t => t.id === 'billionaires');
      expect(theme).to.exist;
      expect(theme!.names).to.include('bezos');
      expect(theme!.names).to.include('musk');
    });

    it('includes toyotas theme', () => {
      const theme = BUILTIN_THEMES.find(t => t.id === 'toyotas');
      expect(theme).to.exist;
      expect(theme!.names).to.include('camry');
      expect(theme!.names).to.include('supra');
    });

    it('includes companies theme', () => {
      const theme = BUILTIN_THEMES.find(t => t.id === 'companies');
      expect(theme).to.exist;
      expect(theme!.names).to.include('google');
    });

    it('all themes have required fields', () => {
      for (const theme of BUILTIN_THEMES) {
        expect(theme.id).to.be.a('string').that.is.not.empty;
        expect(theme.name).to.be.a('string').that.is.not.empty;
        expect(theme.displayName).to.be.a('string').that.is.not.empty;
        expect(theme.names).to.be.an('array').with.length.greaterThan(0);
        expect(theme.persistentDir).to.be.a('string');
        expect(theme.ephemeralDir).to.be.a('string');
      }
    });
  });

  describe('isBuiltinTheme', () => {
    it('returns true for built-in theme IDs', () => {
      expect(isBuiltinTheme('billionaires')).to.be.true;
      expect(isBuiltinTheme('toyotas')).to.be.true;
      expect(isBuiltinTheme('companies')).to.be.true;
    });

    it('returns false for custom theme IDs', () => {
      expect(isBuiltinTheme('my-custom-theme')).to.be.false;
      expect(isBuiltinTheme('')).to.be.false;
    });
  });

  describe('getBuiltinTheme', () => {
    it('returns theme definition for built-in themes', () => {
      const theme = getBuiltinTheme('billionaires');
      expect(theme).to.exist;
      expect(theme!.id).to.equal('billionaires');
      expect(theme!.displayName).to.equal('Billionaires');
    });

    it('returns undefined for non-existent themes', () => {
      expect(getBuiltinTheme('nonexistent')).to.be.undefined;
    });
  });

  describe('getThemePersistentDir / getThemeEphemeralDir', () => {
    it('returns default dirs when no theme specified', () => {
      expect(getThemePersistentDir()).to.equal(DEFAULT_AGENTS_DIR);
      expect(getThemeEphemeralDir()).to.equal(TEMP_AGENTS_DIR);
    });

    it('returns theme-specific dirs for known themes', () => {
      expect(getThemePersistentDir('billionaires')).to.equal('staff');
      expect(getThemeEphemeralDir('billionaires')).to.equal('temp');
    });

    it('returns default dirs for unknown themes', () => {
      expect(getThemePersistentDir('nonexistent')).to.equal(DEFAULT_AGENTS_DIR);
      expect(getThemeEphemeralDir('nonexistent')).to.equal(TEMP_AGENTS_DIR);
    });
  });

  describe('getThemeDirectories', () => {
    it('returns both dirs in a single call', () => {
      const dirs = getThemeDirectories('billionaires');
      expect(dirs.persistentDir).to.equal('staff');
      expect(dirs.ephemeralDir).to.equal('temp');
    });
  });

  describe('pickAdjective', () => {
    it('returns a string from AGENT_ADJECTIVES', () => {
      const adjective = pickAdjective();
      expect(AGENT_ADJECTIVES).to.include(adjective);
    });
  });

  describe('pickThemeName', () => {
    it('returns a name from the specified theme', () => {
      const name = pickThemeName('billionaires');
      const theme = BUILTIN_THEMES.find(t => t.id === 'billionaires')!;
      expect(theme.names).to.include(name);
    });

    it('falls back to billionaires for unknown theme', () => {
      const name = pickThemeName('nonexistent');
      const fallback = BUILTIN_THEMES[0];
      expect(fallback.names).to.include(name);
    });
  });

  describe('pickRandomThemeName', () => {
    it('returns a name and theme ID from available themes', () => {
      const { themeName, themeId } = pickRandomThemeName();
      const theme = BUILTIN_THEMES.find(t => t.id === themeId);
      expect(theme).to.exist;
      expect(theme!.names).to.include(themeName);
    });
  });

  describe('DEFAULT_EPHEMERAL_THEME', () => {
    it('should be billionaires', () => {
      expect(DEFAULT_EPHEMERAL_THEME).to.equal('billionaires');
    });
  });
});
