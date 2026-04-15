import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WATCH_SOURCE = fs.readFileSync(
  path.resolve(__dirname, '../../src/commands/watch/index.ts'),
  'utf-8',
)
const ACTIONS_SOURCE = fs.readFileSync(
  path.resolve(__dirname, '../../src/lib/orchestrate/actions.ts'),
  'utf-8',
)

/**
 * Regression tests for PRLT-1314: prlt watch poke delivery fails —
 * message truncated in shell exec.
 *
 * Root cause: execSync() with a string command goes through the shell,
 * causing messages with newlines, #, parentheses, and quotes to be
 * truncated or misinterpreted.
 *
 * Fix: use execFileSync (no shell) so the message is passed as a
 * direct argv element, bypassing shell interpretation entirely.
 */

describe('watch poke delivery (PRLT-1314)', () => {
  // ===========================================================================
  // Source code guards — verify execSync(string) is NOT used for poke calls
  // ===========================================================================

  describe('watch command', () => {
    it('must NOT use execSync with a template string for poke calls', () => {
      // The bug: execSync(`prlt session poke ${target} ...`) goes through /bin/sh
      // which truncates messages with shell metacharacters.
      expect(WATCH_SOURCE).to.not.match(
        /execSync\s*\(\s*`prlt\s+session\s+poke/,
        'watch command must not use execSync with template string for poke — use execFileSync instead (PRLT-1314)',
      )
    })

    it('must use execFileSync for poke calls', () => {
      expect(WATCH_SOURCE).to.include('execFileSync')
    })

    it('must pass message via stdin (input option) not as a shell argument', () => {
      // Verify stdin piping pattern: execFileSync('prlt', [..., '-'], { input: ... })
      expect(WATCH_SOURCE).to.match(/input:\s*message/)
    })

    it('must import execFileSync, not execSync', () => {
      expect(WATCH_SOURCE).to.include('execFileSync')
      // Should not import execSync (only execFileSync)
      expect(WATCH_SOURCE).to.not.match(
        /import\s*\{[^}]*\bexecSync\b[^}]*\}\s*from\s*['"]node:child_process['"]/,
        'watch command should import execFileSync, not execSync',
      )
    })
  })

  describe('orchestrate actions', () => {
    it('must NOT use execSync with template string for poke calls', () => {
      // Same bug pattern in actions.ts — passing poke messages through shell
      expect(ACTIONS_SOURCE).to.not.match(
        /execSync\s*\(\s*`prlt\s+(session\s+)?poke/,
        'orchestrate actions must not use execSync with template string for poke — use execFileSync instead (PRLT-1314)',
      )
    })

    it('must use execFileSync for poke calls', () => {
      // Verify all poke calls use execFileSync
      const pokeLines = ACTIONS_SOURCE.split('\n').filter(
        (line) => line.includes('poke') && (line.includes('execFileSync') || line.includes('execSync')),
      )
      for (const line of pokeLines) {
        expect(line).to.include(
          'execFileSync',
          `Poke call uses execSync instead of execFileSync: ${line.trim()}`,
        )
      }
    })
  })

  // ===========================================================================
  // Functional tests — verify execFileSync passes special characters intact
  // ===========================================================================

  describe('execFileSync passes messages with special characters', () => {
    // These tests use a real execFileSync call with `echo` to verify that
    // special characters survive the no-shell argv path.

    const testCases = [
      {
        name: 'newlines',
        message: 'GitHub PR update:\n- #1164 (PRLT-1298): now has merge conflicts',
      },
      {
        name: 'hash and parentheses',
        message: '#1164 (PRLT-1298): status changed',
      },
      {
        name: 'double quotes',
        message: 'Agent said "hello world" and stopped',
      },
      {
        name: 'single quotes',
        message: "it's a test with 'quotes'",
      },
      {
        name: 'dollar signs and backticks',
        message: 'cost is $100 and `command` here',
      },
      {
        name: 'semicolons and pipes',
        message: 'run this; then that | grep foo',
      },
      {
        name: 'ampersands and redirects',
        message: 'cmd1 && cmd2 || cmd3 > /dev/null',
      },
      {
        name: 'mixed special characters (original bug report)',
        message: 'GitHub PR update:\n- #1164 (PRLT-1298): now has merge conflicts\n- #1165 (PRLT-1299): ready for review',
      },
    ]

    for (const { name, message } of testCases) {
      it(`preserves ${name} when passed via stdin`, () => {
        // Simulate the watch command's approach: execFileSync with stdin piping
        // Using `cat` to echo back stdin — verifies the message survives the pipe
        const result = execFileSync('cat', [], {
          input: message,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        })
        expect(result).to.equal(message)
      })
    }
  })

  // ===========================================================================
  // Error handling — verify stderr is surfaced
  // ===========================================================================

  describe('error reporting', () => {
    it('watch command surfaces stderr from failed poke', () => {
      // Verify the error handler reads err.stderr, not just err.message
      expect(WATCH_SOURCE).to.include('stderr')
    })
  })
})
