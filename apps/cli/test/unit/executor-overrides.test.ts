import { expect } from 'chai'
import {
  parseExecutorEnv,
  buildShellExports,
  buildDockerEnvFlags,
  readExecutorOverridesFromFlags,
} from '../../src/lib/execution/executor-overrides.js'
import { getExecutorCommand } from '../../src/lib/execution/runners/executor.js'

/**
 * Tests for the executor override helpers (PRLT-1369).
 * Covers --executor-env parsing, shell/docker fragment building, and the
 * binOverride parameter on getExecutorCommand.
 */

describe('Executor Overrides (PRLT-1369)', () => {
  describe('parseExecutorEnv', () => {
    it('returns undefined for empty/missing input', () => {
      expect(parseExecutorEnv(undefined)).to.be.undefined
      expect(parseExecutorEnv([])).to.be.undefined
    })

    it('parses a single KEY=VALUE pair', () => {
      const result = parseExecutorEnv(['CLAUDE_CONFIG_DIR=/Users/me/.claude-work'])
      expect(result).to.deep.equal({ CLAUDE_CONFIG_DIR: '/Users/me/.claude-work' })
    })

    it('parses multiple pairs', () => {
      const result = parseExecutorEnv(['A=1', 'B=2', 'C=hello world'])
      expect(result).to.deep.equal({ A: '1', B: '2', C: 'hello world' })
    })

    it('keeps everything after the first = in the value', () => {
      const result = parseExecutorEnv(['DSN=postgres://u:p=secret@host/db'])
      expect(result).to.deep.equal({ DSN: 'postgres://u:p=secret@host/db' })
    })

    it('throws on missing =', () => {
      expect(() => parseExecutorEnv(['NOEQUALS'])).to.throw(/KEY=VALUE/)
    })

    it('throws on invalid identifier key', () => {
      expect(() => parseExecutorEnv(['1BAD=value'])).to.throw(/Invalid --executor-env key/)
      expect(() => parseExecutorEnv(['has-dash=value'])).to.throw(/Invalid --executor-env key/)
    })
  })

  describe('buildShellExports', () => {
    it('returns empty string for undefined env', () => {
      expect(buildShellExports(undefined)).to.equal('')
    })

    it('emits one export line per key', () => {
      const out = buildShellExports({ CLAUDE_CONFIG_DIR: '/home/me/.claude-work', FOO: 'bar' })
      expect(out).to.include(`export CLAUDE_CONFIG_DIR='/home/me/.claude-work'`)
      expect(out).to.include(`export FOO='bar'`)
    })

    it('escapes single quotes in values', () => {
      const out = buildShellExports({ MSG: "it's fine" })
      // Single-quote escaping: ' → '\''
      expect(out).to.equal(`export MSG='it'\\''s fine'`)
    })
  })

  describe('buildDockerEnvFlags', () => {
    it('returns empty string for undefined env', () => {
      expect(buildDockerEnvFlags(undefined)).to.equal('')
    })

    it('emits -e KEY=VALUE flags with leading space', () => {
      const out = buildDockerEnvFlags({ CLAUDE_CONFIG_DIR: '/home/node/.claude-work' })
      expect(out).to.equal(` -e CLAUDE_CONFIG_DIR='/home/node/.claude-work'`)
    })

    it('joins multiple env vars', () => {
      const out = buildDockerEnvFlags({ A: '1', B: '2' })
      expect(out).to.include(`-e A='1'`)
      expect(out).to.include(`-e B='2'`)
    })
  })

  describe('readExecutorOverridesFromFlags', () => {
    it('returns undefined when no overrides set', () => {
      expect(readExecutorOverridesFromFlags({})).to.be.undefined
    })

    it('parses env-only', () => {
      const result = readExecutorOverridesFromFlags({ 'executor-env': ['FOO=bar'] })
      expect(result).to.deep.equal({ env: { FOO: 'bar' }, bin: undefined })
    })

    it('parses bin-only', () => {
      const result = readExecutorOverridesFromFlags({ 'executor-bin': '/usr/local/bin/claude-wrapper' })
      expect(result).to.deep.equal({ env: undefined, bin: '/usr/local/bin/claude-wrapper' })
    })

    it('parses both', () => {
      const result = readExecutorOverridesFromFlags({
        'executor-env': ['CLAUDE_CONFIG_DIR=/x'],
        'executor-bin': 'claude-wrapper',
      })
      expect(result).to.deep.equal({
        env: { CLAUDE_CONFIG_DIR: '/x' },
        bin: 'claude-wrapper',
      })
    })
  })

  describe('getExecutorCommand binOverride (PRLT-1369)', () => {
    it('uses default "claude" binary when no override', () => {
      const { cmd } = getExecutorCommand('claude-code', 'do work', true)
      expect(cmd).to.equal('claude')
    })

    it('uses binOverride for claude-code', () => {
      const { cmd } = getExecutorCommand('claude-code', 'do work', true, '/usr/local/bin/claude-wrapper')
      expect(cmd).to.equal('/usr/local/bin/claude-wrapper')
    })

    it('preserves args when binOverride is supplied (claude-code, danger)', () => {
      const { args } = getExecutorCommand('claude-code', 'do work', true, '/wrap/claude')
      expect(args).to.include('--dangerously-skip-permissions')
      expect(args).to.include('do work')
    })

    it('uses binOverride for codex', () => {
      const { cmd } = getExecutorCommand('codex', 'do work', true, '/usr/local/bin/codex-wrapper')
      expect(cmd).to.equal('/usr/local/bin/codex-wrapper')
    })

    it('promotes "custom" executor with bin override into a real command', () => {
      const { cmd, args } = getExecutorCommand('custom', 'do work', true, '/path/to/agent')
      expect(cmd).to.equal('/path/to/agent')
      expect(args).to.deep.equal(['do work'])
    })

    it('falls back to echo for "custom" with no bin override', () => {
      const { cmd } = getExecutorCommand('custom', 'do work')
      expect(cmd).to.equal('echo')
    })
  })
})
