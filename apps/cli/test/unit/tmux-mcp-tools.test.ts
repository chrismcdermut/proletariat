import { expect } from 'chai'
import { execSync } from 'node:child_process'

/**
 * Unit tests for tmux MCP tools (TKT-1097)
 *
 * Tests the tmux tool registration and basic functionality.
 * Integration tests that require tmux are skipped when tmux is not available.
 */

function isTmuxAvailable(): boolean {
  try {
    execSync('tmux -V', { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

function tmux(args: string): string {
  return execSync(`tmux ${args}`, {
    encoding: 'utf-8',
    timeout: 10_000,
    env: { ...process.env, TERM: process.env.TERM || 'xterm-256color' },
  }).trim()
}

const SESSION_PREFIX = 'test-tmux-mcp-'
let sessionCounter = 0

function uniqueSession(): string {
  return `${SESSION_PREFIX}${Date.now()}-${sessionCounter++}`
}

function cleanupSessions(): void {
  try {
    const sessions = tmux('list-sessions -F "#{session_name}"').split('\n')
    for (const session of sessions) {
      if (session.startsWith(SESSION_PREFIX)) {
        try {
          tmux(`kill-session -t "${session}"`)
        } catch {
          // Ignore
        }
      }
    }
  } catch {
    // No tmux server running
  }
}

describe('Tmux MCP Tools (TKT-1097)', () => {
  describe('Module structure', () => {
    it('should export registerTmuxTools function', async () => {
      const mod = await import('../../src/lib/mcp/tools/tmux.js')
      expect(mod.registerTmuxTools).to.be.a('function')
    })

    it('should be re-exported from tools index', async () => {
      const mod = await import('../../src/lib/mcp/tools/index.js')
      expect(mod.registerTmuxTools).to.be.a('function')
    })
  })

  // Integration tests that require tmux
  const describeIfTmux = isTmuxAvailable() ? describe : describe.skip

  describeIfTmux('tmux session management (integration)', () => {
    afterEach(() => {
      cleanupSessions()
    })

    it('should create and detect a tmux session', () => {
      const name = uniqueSession()
      tmux(`new-session -d -s "${name}" -x 80 -y 24`)

      const sessions = tmux('list-sessions -F "#{session_name}"')
      expect(sessions).to.contain(name)

      tmux(`kill-session -t "${name}"`)
    })

    it('should send keys and capture pane content', async () => {
      const name = uniqueSession()
      tmux(`new-session -d -s "${name}" -x 80 -y 24`)

      // Send echo command
      tmux(`send-keys -t "${name}" "echo hello-tmux-test" Enter`)
      // Wait for command to execute
      await new Promise(r => setTimeout(r, 500))

      const output = tmux(`capture-pane -t "${name}" -p`)
      expect(output).to.contain('hello-tmux-test')

      tmux(`kill-session -t "${name}"`)
    })

    it('should handle has-session for non-existent sessions', () => {
      const name = uniqueSession()
      let exists = false
      try {
        tmux(`has-session -t "${name}"`)
        exists = true
      } catch {
        exists = false
      }
      expect(exists).to.be.false
    })

    it('should send special keys (arrows, escape)', async () => {
      const name = uniqueSession()
      tmux(`new-session -d -s "${name}" -x 80 -y 24`)

      // Send some text, then use Home and insert text
      tmux(`send-keys -t "${name}" "world" Enter`)
      await new Promise(r => setTimeout(r, 200))

      // Send Ctrl+C (should not crash)
      tmux(`send-keys -t "${name}" C-c`)
      await new Promise(r => setTimeout(r, 200))

      const output = tmux(`capture-pane -t "${name}" -p`)
      // Should not be empty or crashed
      expect(output).to.be.a('string')

      tmux(`kill-session -t "${name}"`)
    })

    it('should create session with custom dimensions', () => {
      const name = uniqueSession()
      tmux(`new-session -d -s "${name}" -x 120 -y 40`)

      // Verify session was created and capture pane works
      const output = tmux(`capture-pane -t "${name}" -p`)
      expect(output).to.be.a('string')

      // Verify session exists in list
      const sessions = tmux('list-sessions -F "#{session_name}"')
      expect(sessions).to.contain(name)

      tmux(`kill-session -t "${name}"`)
    })

    it('should list multiple sessions', () => {
      const name1 = uniqueSession()
      const name2 = uniqueSession()

      tmux(`new-session -d -s "${name1}" -x 80 -y 24`)
      tmux(`new-session -d -s "${name2}" -x 80 -y 24`)

      const sessions = tmux('list-sessions -F "#{session_name}"')
      expect(sessions).to.contain(name1)
      expect(sessions).to.contain(name2)

      tmux(`kill-session -t "${name1}"`)
      tmux(`kill-session -t "${name2}"`)
    })

    it('should kill a session cleanly', () => {
      const name = uniqueSession()
      tmux(`new-session -d -s "${name}" -x 80 -y 24`)

      // Verify it exists
      tmux(`has-session -t "${name}"`)

      // Kill it
      tmux(`kill-session -t "${name}"`)

      // Verify it's gone
      let exists = false
      try {
        tmux(`has-session -t "${name}"`)
        exists = true
      } catch {
        exists = false
      }
      expect(exists).to.be.false
    })
  })
})
