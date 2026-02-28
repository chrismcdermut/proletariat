import { expect } from 'chai'
import { detectTerminalApp } from '../../src/commands/orchestrator/attach.js'

describe('detectTerminalApp', () => {
  const originalEnv = { ...process.env }
  const originalPlatform = process.platform

  beforeEach(() => {
    // Clear all relevant env vars before each test
    delete process.env.SSH_TTY
    delete process.env.SSH_CONNECTION
    delete process.env.DISPLAY
    delete process.env.WAYLAND_DISPLAY
    delete process.env.TERM_PROGRAM
  })

  afterEach(() => {
    // Restore original environment
    process.env = { ...originalEnv }
    Object.defineProperty(process, 'platform', { value: originalPlatform })
  })

  describe('remote session detection', () => {
    it('returns null when SSH_TTY is set', () => {
      process.env.SSH_TTY = '/dev/pts/0'
      process.env.TERM_PROGRAM = 'iTerm.app'
      expect(detectTerminalApp()).to.equal(null)
    })

    it('returns null when SSH_CONNECTION is set', () => {
      process.env.SSH_CONNECTION = '192.168.1.1 52000 192.168.1.2 22'
      process.env.TERM_PROGRAM = 'iTerm.app'
      expect(detectTerminalApp()).to.equal(null)
    })
  })

  describe('headless detection on non-darwin', () => {
    it('returns null when no DISPLAY or WAYLAND_DISPLAY on linux', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' })
      process.env.TERM_PROGRAM = 'iTerm.app'
      expect(detectTerminalApp()).to.equal(null)
    })

    it('detects terminal when DISPLAY is set on linux', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' })
      process.env.DISPLAY = ':0'
      process.env.TERM_PROGRAM = 'iTerm.app'
      expect(detectTerminalApp()).to.equal('iTerm')
    })

    it('detects terminal when WAYLAND_DISPLAY is set on linux', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' })
      process.env.WAYLAND_DISPLAY = 'wayland-0'
      process.env.TERM_PROGRAM = 'ghostty'
      expect(detectTerminalApp()).to.equal('Ghostty')
    })
  })

  describe('TERM_PROGRAM mapping', () => {
    beforeEach(() => {
      // Ensure we're on darwin so the headless check doesn't interfere
      Object.defineProperty(process, 'platform', { value: 'darwin' })
    })

    it('returns null when TERM_PROGRAM is not set', () => {
      expect(detectTerminalApp()).to.equal(null)
    })

    it('maps iTerm.app to iTerm', () => {
      process.env.TERM_PROGRAM = 'iTerm.app'
      expect(detectTerminalApp()).to.equal('iTerm')
    })

    it('maps ghostty to Ghostty', () => {
      process.env.TERM_PROGRAM = 'ghostty'
      expect(detectTerminalApp()).to.equal('Ghostty')
    })

    it('maps Apple_Terminal to Terminal', () => {
      process.env.TERM_PROGRAM = 'Apple_Terminal'
      expect(detectTerminalApp()).to.equal('Terminal')
    })

    it('maps WezTerm to WezTerm', () => {
      process.env.TERM_PROGRAM = 'WezTerm'
      expect(detectTerminalApp()).to.equal('WezTerm')
    })

    it('returns null for unknown terminal programs', () => {
      process.env.TERM_PROGRAM = 'alacritty'
      expect(detectTerminalApp()).to.equal(null)
    })
  })
})
