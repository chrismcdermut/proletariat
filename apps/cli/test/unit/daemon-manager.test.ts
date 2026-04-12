import { expect } from 'chai'
import { reconcilerDaemonSpec } from '../../src/lib/session/daemon-manager.js'

/**
 * Tests for the daemon manager (PRLT-1287).
 *
 * The daemon manager handles spawning and supervising long-running
 * infrastructure daemons. These tests cover the pure logic — the
 * DaemonSpec builders and configuration — without touching tmux or
 * machine.db.
 */
describe('Daemon Manager (PRLT-1287)', () => {
  // ===========================================================================
  // reconcilerDaemonSpec
  // ===========================================================================
  describe('reconcilerDaemonSpec', () => {
    it('returns a DaemonSpec with type "reconciler"', () => {
      const spec = reconcilerDaemonSpec()
      expect(spec.type).to.equal('reconciler')
    })

    it('builds a command that runs prlt reconcile --watch --foreground', () => {
      const spec = reconcilerDaemonSpec()
      expect(spec.command).to.include('prlt reconcile --watch --foreground')
    })

    it('uses default interval of 300 seconds', () => {
      const spec = reconcilerDaemonSpec()
      expect(spec.command).to.include('--interval 300')
    })

    it('accepts a custom interval', () => {
      const spec = reconcilerDaemonSpec(60)
      expect(spec.command).to.include('--interval 60')
    })

    it('command always includes --foreground (runs inside tmux, not nested spawn)', () => {
      const spec = reconcilerDaemonSpec()
      expect(spec.command).to.include('--foreground')
    })
  })

  // ===========================================================================
  // DaemonSpec shape validation
  // ===========================================================================
  describe('DaemonSpec interface', () => {
    it('has type and command fields', () => {
      const spec = reconcilerDaemonSpec()
      expect(spec).to.have.property('type')
      expect(spec).to.have.property('command')
      expect(typeof spec.type).to.equal('string')
      expect(typeof spec.command).to.equal('string')
    })

    it('type is a short identifier suitable for session naming', () => {
      const spec = reconcilerDaemonSpec()
      // Type should not contain spaces or special characters
      expect(spec.type).to.match(/^[a-z0-9-]+$/)
    })
  })
})
