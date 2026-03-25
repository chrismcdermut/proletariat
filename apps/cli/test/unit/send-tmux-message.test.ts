import { expect } from 'chai'
import { execSync, execFileSync } from 'node:child_process'
import {
  sendTmuxMessage,
  captureTmuxPane,
} from '../../src/lib/execution/session-utils.js'

/**
 * Check if tmux is available in the current environment.
 * These tests require a real tmux server and are skipped in CI where tmux may not be available.
 */
function isTmuxAvailable(): boolean {
  try {
    execSync('tmux -V', { stdio: 'pipe' })
    // Also check if we can actually create a session (some CI runners have tmux binary but no server)
    execSync('tmux new-session -d -s prlt-tmux-check -x 80 -y 24', { stdio: 'pipe' })
    execSync('tmux kill-session -t prlt-tmux-check', { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

const tmuxAvailable = isTmuxAvailable()

/**
 * Regression tests for PRLT-1134: session poke breaks on parentheses and newlines.
 *
 * These tests create real tmux sessions and verify that messages containing
 * shell metacharacters are delivered verbatim, without shell interpretation.
 *
 * Skipped when tmux is not available (e.g., GitHub Actions CI).
 */
describe('sendTmuxMessage — shell escaping (PRLT-1134)', function () {
  if (!tmuxAvailable) {
    before(function () { this.skip() })
  }
  const TEST_SESSION = 'prlt-test-send-tmux-msg'

  beforeEach(() => {
    // Create a tmux session running cat, which echoes stdin to the pane
    try {
      execSync(`tmux kill-session -t ${TEST_SESSION} 2>/dev/null`, { stdio: 'pipe' })
    } catch {
      // Session may not exist
    }
    execFileSync('tmux', [
      'new-session', '-d', '-s', TEST_SESSION, '-x', '200', '-y', '50',
    ])
    // Brief pause for session to initialize
    execSync('sleep 0.3', { stdio: 'pipe' })
  })

  afterEach(() => {
    try {
      execSync(`tmux kill-session -t ${TEST_SESSION} 2>/dev/null`, { stdio: 'pipe' })
    } catch {
      // Best-effort cleanup
    }
  })

  /**
   * Capture the pane content and return just the text lines (trimmed, non-empty).
   */
  function getPaneContent(): string {
    const raw = captureTmuxPane(TEST_SESSION, 200)
    return raw ?? ''
  }

  it('should handle parentheses in message', () => {
    const msg = 'Install foo (option 1) or bar'
    sendTmuxMessage(TEST_SESSION, msg)
    // Allow tmux to render
    execSync('sleep 0.5', { stdio: 'pipe' })
    const pane = getPaneContent()
    expect(pane).to.include('Install foo (option 1) or bar')
  })

  it('should handle single quotes in message', () => {
    const msg = "it's a test with 'quotes'"
    sendTmuxMessage(TEST_SESSION, msg)
    execSync('sleep 0.5', { stdio: 'pipe' })
    const pane = getPaneContent()
    expect(pane).to.include("it's a test with 'quotes'")
  })

  it('should handle double quotes in message', () => {
    const msg = 'say "hello world"'
    sendTmuxMessage(TEST_SESSION, msg)
    execSync('sleep 0.5', { stdio: 'pipe' })
    const pane = getPaneContent()
    expect(pane).to.include('say "hello world"')
  })

  it('should handle dollar signs and backticks without expansion', () => {
    const msg = 'cost is $100 and `command` here'
    sendTmuxMessage(TEST_SESSION, msg)
    execSync('sleep 0.5', { stdio: 'pipe' })
    const pane = getPaneContent()
    expect(pane).to.include('cost is $100')
    expect(pane).to.include('`command`')
  })

  it('should handle semicolons and pipes', () => {
    const msg = 'run this; then that | grep foo'
    sendTmuxMessage(TEST_SESSION, msg)
    execSync('sleep 0.5', { stdio: 'pipe' })
    const pane = getPaneContent()
    expect(pane).to.include('run this; then that | grep foo')
  })

  it('should handle ampersands and redirects', () => {
    const msg = 'cmd1 && cmd2 || cmd3 > /dev/null 2>&1'
    sendTmuxMessage(TEST_SESSION, msg)
    execSync('sleep 0.5', { stdio: 'pipe' })
    const pane = getPaneContent()
    expect(pane).to.include('cmd1 && cmd2 || cmd3 > /dev/null 2>&1')
  })

  it('should handle exclamation marks and hash', () => {
    const msg = 'hello! # this is not a comment'
    sendTmuxMessage(TEST_SESSION, msg)
    execSync('sleep 0.5', { stdio: 'pipe' })
    const pane = getPaneContent()
    expect(pane).to.include('hello!')
    expect(pane).to.include('# this is not a comment')
  })

  it('should handle curly braces and square brackets', () => {
    const msg = 'data: {key: [1, 2, 3]}'
    sendTmuxMessage(TEST_SESSION, msg)
    execSync('sleep 0.5', { stdio: 'pipe' })
    const pane = getPaneContent()
    expect(pane).to.include('data: {key: [1, 2, 3]}')
  })

  it('should handle backslashes', () => {
    const msg = 'path\\to\\file and \\n literal'
    sendTmuxMessage(TEST_SESSION, msg)
    execSync('sleep 0.5', { stdio: 'pipe' })
    const pane = getPaneContent()
    expect(pane).to.include('path\\to\\file')
  })

  it('should handle multi-line messages (newlines)', () => {
    // Multi-line messages should be delivered to the pane.
    // With send-keys -l, newlines become Enter keystrokes,
    // which is the expected behavior for poke.
    const msg = 'line one\nline two\nline three'
    sendTmuxMessage(TEST_SESSION, msg)
    execSync('sleep 0.5', { stdio: 'pipe' })
    const pane = getPaneContent()
    // All lines should appear in the pane
    expect(pane).to.include('line one')
    expect(pane).to.include('line two')
    expect(pane).to.include('line three')
  })

  it('should handle mixed special characters', () => {
    const msg = "Fix bug (issue #42): use `printf '%s'` instead of $var"
    sendTmuxMessage(TEST_SESSION, msg)
    execSync('sleep 0.5', { stdio: 'pipe' })
    const pane = getPaneContent()
    expect(pane).to.include('Fix bug (issue #42)')
    expect(pane).to.include("printf '%s'")
    expect(pane).to.include('$var')
  })
})
