import { expect } from 'chai'
import { buildTmuxMessageCommands } from '../../src/lib/execution/session-utils.js'

/**
 * Regression tests for PRLT-1134: session poke breaks on parentheses and newlines.
 *
 * These tests verify that buildTmuxMessageCommands produces correct argument
 * arrays for execFileSync, ensuring shell metacharacters in messages are passed
 * verbatim to tmux send-keys -l (literal mode) without shell interpretation.
 *
 * Previously these tests required a real tmux server (failing in CI — PRLT-1244).
 * Now they test the command-building logic directly as pure unit tests.
 */
describe('sendTmuxMessage — shell escaping (PRLT-1134)', function () {
  const SESSION = 'test-session'

  /**
   * Helper: verify the text command passes the message verbatim via send-keys -l.
   */
  function expectLiteralMessage(message: string, containerId?: string): void {
    const cmds = buildTmuxMessageCommands(SESSION, message, containerId)

    // Must use -l flag (literal mode) to prevent tmux key interpretation
    expect(cmds.text.args).to.include('-l')

    // Message must be the last argument, passed as-is (no escaping/transformation)
    expect(cmds.text.args[cmds.text.args.length - 1]).to.equal(message)

    // Without container: command is tmux directly
    if (!containerId) {
      expect(cmds.text.cmd).to.equal('tmux')
      expect(cmds.text.args).to.deep.equal(['send-keys', '-l', '-t', SESSION, message])
    }
  }

  it('should handle parentheses in message', () => {
    expectLiteralMessage('Install foo (option 1) or bar')
  })

  it('should handle single quotes in message', () => {
    expectLiteralMessage("it's a test with 'quotes'")
  })

  it('should handle double quotes in message', () => {
    expectLiteralMessage('say "hello world"')
  })

  it('should handle dollar signs and backticks without expansion', () => {
    expectLiteralMessage('cost is $100 and `command` here')
  })

  it('should handle semicolons and pipes', () => {
    expectLiteralMessage('run this; then that | grep foo')
  })

  it('should handle ampersands and redirects', () => {
    expectLiteralMessage('cmd1 && cmd2 || cmd3 > /dev/null 2>&1')
  })

  it('should handle exclamation marks and hash', () => {
    expectLiteralMessage('hello! # this is not a comment')
  })

  it('should handle curly braces and square brackets', () => {
    expectLiteralMessage('data: {key: [1, 2, 3]}')
  })

  it('should handle backslashes', () => {
    expectLiteralMessage('path\\to\\file and \\n literal')
  })

  it('should handle multi-line messages (newlines)', () => {
    expectLiteralMessage('line one\nline two\nline three')
  })

  it('should handle mixed special characters', () => {
    expectLiteralMessage("Fix bug (issue #42): use `printf '%s'` instead of $var")
  })

  // Verify the full command structure (escape, text, enter sequence)
  describe('command structure', function () {
    it('should produce escape, text, and enter commands for host tmux', () => {
      const msg = 'hello world'
      const cmds = buildTmuxMessageCommands(SESSION, msg)

      expect(cmds.escape).to.deep.equal({
        cmd: 'tmux',
        args: ['send-keys', '-t', SESSION, 'Escape'],
      })
      expect(cmds.text).to.deep.equal({
        cmd: 'tmux',
        args: ['send-keys', '-l', '-t', SESSION, msg],
      })
      expect(cmds.enter).to.deep.equal({
        cmd: 'tmux',
        args: ['send-keys', '-t', SESSION, 'Enter'],
      })
    })

    it('should wrap commands with docker exec for container sessions', () => {
      const msg = 'hello (world) $var'
      const containerId = 'abc123'
      const cmds = buildTmuxMessageCommands(SESSION, msg, containerId)

      // All commands should go through docker exec
      expect(cmds.escape.cmd).to.equal('docker')
      expect(cmds.text.cmd).to.equal('docker')
      expect(cmds.enter.cmd).to.equal('docker')

      // Docker args should wrap tmux args
      expect(cmds.text.args).to.deep.equal([
        'exec', containerId, 'tmux', 'send-keys', '-l', '-t', SESSION, msg,
      ])

      // Message is still passed verbatim as the last arg
      expect(cmds.text.args[cmds.text.args.length - 1]).to.equal(msg)
    })
  })
})
