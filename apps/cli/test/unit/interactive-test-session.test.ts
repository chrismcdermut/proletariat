/**
 * Unit tests for the InteractiveTestSession helpers (PRLT-1233).
 *
 * The InteractiveTestSession class itself spins up a real tmux session, so
 * direct unit-testing it is impractical. Instead we cover the pure helpers
 * that drive its behavior: pattern matching for waitForOutput, special-key
 * detection for tmux send-keys, and POSIX shell escaping.
 */

import { expect } from 'chai';
import {
  isTmuxSpecialKey,
  matchesPattern,
  shellEscape,
} from '../e2e/interactive-test-session.js';

describe('InteractiveTestSession helpers', () => {
  describe('matchesPattern', () => {
    it('matches a substring with a string pattern', () => {
      expect(matchesPattern('Ticket Operations menu', 'Operations')).to.equal(true);
    });

    it('returns false when the substring is missing', () => {
      expect(matchesPattern('Ticket Operations menu', 'Project')).to.equal(false);
    });

    it('matches against a RegExp pattern', () => {
      expect(matchesPattern('TKT-1234 some title', /TKT-\d+/)).to.equal(true);
    });

    it('returns false when RegExp does not match', () => {
      expect(matchesPattern('no ticket here', /TKT-\d+/)).to.equal(false);
    });

    it('treats string patterns as literal — no regex meta-character interpretation', () => {
      // Without regex semantics, '.+' is matched literally
      expect(matchesPattern('hello world', '.+')).to.equal(false);
      expect(matchesPattern('hello.+world', '.+')).to.equal(true);
    });
  });

  describe('isTmuxSpecialKey', () => {
    const specialKeys = [
      'Up',
      'Down',
      'Left',
      'Right',
      'Enter',
      'Escape',
      'Tab',
      'Space',
      'BSpace',
      'C-c',
      'C-d',
      'M-x',
    ];

    for (const key of specialKeys) {
      it(`recognises "${key}" as a special key`, () => {
        expect(isTmuxSpecialKey(key)).to.equal(true);
      });
    }

    it('treats arbitrary text as non-special', () => {
      expect(isTmuxSpecialKey('prlt ticket')).to.equal(false);
      expect(isTmuxSpecialKey('hello world')).to.equal(false);
      expect(isTmuxSpecialKey('')).to.equal(false);
    });

    it('does not match uppercase ctrl combos (tmux requires lowercase)', () => {
      expect(isTmuxSpecialKey('C-C')).to.equal(false);
    });

    it('does not match multi-key sequences', () => {
      expect(isTmuxSpecialKey('Up Down')).to.equal(false);
      expect(isTmuxSpecialKey('Enter Enter')).to.equal(false);
    });
  });

  describe('shellEscape', () => {
    it('wraps a plain value in single quotes', () => {
      expect(shellEscape('hello')).to.equal("'hello'");
    });

    it('preserves spaces inside the quoted value', () => {
      expect(shellEscape('hello world')).to.equal("'hello world'");
    });

    it('escapes embedded single quotes using the POSIX dance', () => {
      // ' becomes '\''  → close, escaped quote, reopen
      expect(shellEscape("it's")).to.equal("'it'\\''s'");
    });

    it('handles empty strings', () => {
      expect(shellEscape('')).to.equal("''");
    });

    it('passes shell metacharacters through literally inside the quotes', () => {
      expect(shellEscape('$(rm -rf /)')).to.equal("'$(rm -rf /)'");
      expect(shellEscape('a;b|c&d')).to.equal("'a;b|c&d'");
    });
  });
});
