import { expect } from 'chai';
import { getSetTitleCommands } from '../../src/lib/terminal.js';

describe('Terminal Utilities', () => {
  describe('getSetTitleCommands', () => {
    it('generates shell commands with the title', () => {
      const commands = getSetTitleCommands('My Title');

      expect(commands).to.contain('My Title');
      expect(commands).to.contain('echo -ne');
      expect(commands).to.contain('\\033]0;');
      expect(commands).to.contain('\\033]1;');
    });

    it('escapes single quotes in title', () => {
      const commands = getSetTitleCommands("It's a test");

      // Single quote should be removed for shell safety
      expect(commands).to.contain('Its a test');
      expect(commands).to.not.contain("'");
    });

    it('escapes double quotes in title', () => {
      const commands = getSetTitleCommands('Say "hello"');

      // Double quotes should be removed for shell safety
      expect(commands).to.contain('Say hello');
      expect(commands).to.not.contain('"Say');
    });

    it('escapes backslashes in title', () => {
      const commands = getSetTitleCommands('path\\to\\file');

      // Backslashes should be removed for shell safety
      expect(commands).to.contain('pathtofile');
    });

    it('handles empty title', () => {
      const commands = getSetTitleCommands('');

      expect(commands).to.contain('\\033]0;\\007');
      expect(commands).to.contain('\\033]1;\\007');
    });

    it('handles title with spaces', () => {
      const commands = getSetTitleCommands('My Custom Title');

      expect(commands).to.contain('My Custom Title');
    });

    it('handles title with numbers', () => {
      const commands = getSetTitleCommands('TKT-123 Implementation');

      expect(commands).to.contain('TKT-123 Implementation');
    });

    it('handles title with special characters', () => {
      const commands = getSetTitleCommands('Task: Fix bug #42');

      expect(commands).to.contain('Task: Fix bug #42');
    });

    it('includes comment explaining the commands', () => {
      const commands = getSetTitleCommands('Test');

      expect(commands).to.contain('# Set terminal tab/window title');
    });
  });
});
