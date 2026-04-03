import { expect } from 'chai'
import Database from 'better-sqlite3'
import { NotificationManager, stopNotificationManager } from '../../src/lib/notifications/manager.js'
import { NotificationStorage } from '../../src/lib/notifications/storage.js'
import { notificationSystem } from '../../src/lib/database/migrations/0021_notification_system.js'

/**
 * Tests for NotificationManager — event handling, escalation chains,
 * and integration with storage.
 */
describe('NotificationManager (PRLT-1157)', () => {
  let db: Database.Database
  let storage: NotificationStorage
  let manager: NotificationManager

  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    notificationSystem.up(db)
    storage = new NotificationStorage(db)
    stopNotificationManager()
  })

  afterEach(() => {
    if (manager) manager.stop()
    stopNotificationManager()
    if (db) db.close()
  })

  // =========================================================================
  // Lifecycle
  // =========================================================================
  describe('lifecycle', () => {
    it('should construct without error', () => {
      expect(() => {
        manager = new NotificationManager({ db })
      }).to.not.throw()
    })

    it('should stop without error even if not started', () => {
      manager = new NotificationManager({ db })
      expect(() => manager.stop()).to.not.throw()
    })

    it('should stop and clear escalation timers', () => {
      manager = new NotificationManager({ db })
      // Start then stop should not throw
      manager.stop()
      expect(manager.getActiveEscalations()).to.have.lengthOf(0)
    })
  })

  // =========================================================================
  // fireEvent
  // =========================================================================
  describe('fireEvent', () => {
    it('should return empty results when no rules match', async () => {
      manager = new NotificationManager({ db })

      const results = await manager.fireEvent('on_agent_died', { event: 'on_agent_died' })
      expect(results).to.have.lengthOf(0)
    })

    it('should dispatch to terminal provider when rule matches', async () => {
      const provider = storage.createProvider({ type: 'terminal', name: 'term', config: {} })
      storage.createRule({ event: 'on_agent_died', providerId: provider.id })

      manager = new NotificationManager({ db })

      const results = await manager.fireEvent('on_agent_died', {
        event: 'on_agent_died',
        ticket: 'PRLT-123',
        agent: 'agent-1',
      })

      expect(results).to.have.lengthOf(1)
      expect(results[0].success).to.equal(true)
      expect(results[0].providerName).to.equal('term')
    })

    it('should dispatch to multiple providers', async () => {
      const p1 = storage.createProvider({ type: 'terminal', name: 'term-1', config: {} })
      const p2 = storage.createProvider({ type: 'terminal', name: 'term-2', config: {} })
      storage.createRule({ event: 'on_ci_failed', providerId: p1.id })
      storage.createRule({ event: 'on_ci_failed', providerId: p2.id })

      manager = new NotificationManager({ db })

      const results = await manager.fireEvent('on_ci_failed', { event: 'on_ci_failed' })
      expect(results).to.have.lengthOf(2)
      expect(results.every(r => r.success)).to.equal(true)
    })

    it('should not dispatch to disabled providers', async () => {
      const provider = storage.createProvider({ type: 'terminal', name: 'disabled-term', config: {} })
      storage.updateProvider(provider.id, { enabled: false })
      storage.createRule({ event: 'on_agent_died', providerId: provider.id })

      manager = new NotificationManager({ db })

      const results = await manager.fireEvent('on_agent_died', { event: 'on_agent_died' })
      expect(results).to.have.lengthOf(0)
    })

    it('should not dispatch for disabled rules', async () => {
      const provider = storage.createProvider({ type: 'terminal', name: 'term', config: {} })
      const rule = storage.createRule({ event: 'on_agent_died', providerId: provider.id })
      storage.setRuleEnabled(rule.id, false)

      manager = new NotificationManager({ db })

      const results = await manager.fireEvent('on_agent_died', { event: 'on_agent_died' })
      expect(results).to.have.lengthOf(0)
    })

    it('should log dispatch activity', async () => {
      const logs: string[] = []
      const provider = storage.createProvider({ type: 'terminal', name: 'logged-term', config: {} })
      storage.createRule({ event: 'on_ci_green', providerId: provider.id })

      manager = new NotificationManager({ db, log: (msg) => logs.push(msg) })

      await manager.fireEvent('on_ci_green', { event: 'on_ci_green' })
      expect(logs.some(l => l.includes('logged-term'))).to.equal(true)
    })
  })

  // =========================================================================
  // Escalation Chains
  // =========================================================================
  describe('escalation chains', () => {
    it('should start an escalation chain with grouped rules', async () => {
      const p1 = storage.createProvider({ type: 'terminal', name: 'esc-1', config: {} })
      const p2 = storage.createProvider({ type: 'terminal', name: 'esc-2', config: {} })

      // Step 1: immediate
      storage.createRule({
        event: 'on_agent_died',
        providerId: p1.id,
        escalationDelaySeconds: 0,
        escalationGroup: 'agent-alert',
      })
      // Step 2: after 600s
      storage.createRule({
        event: 'on_agent_died',
        providerId: p2.id,
        escalationDelaySeconds: 600,
        escalationGroup: 'agent-alert',
      })

      manager = new NotificationManager({ db })

      // Fire the event — immediate rules should dispatch, escalation chain should start
      const results = await manager.fireEvent('on_agent_died', { event: 'on_agent_died' })

      // Immediate results are empty because all rules are in escalation group
      expect(results).to.have.lengthOf(0)

      // Allow microtask for first step to settle
      await new Promise(resolve => setTimeout(resolve, 50))

      // Escalation chain should be active (step 1 done, step 2 pending at 600s)
      const escalations = manager.getActiveEscalations()
      expect(escalations).to.have.lengthOf(1)
      expect(escalations[0].group).to.equal('agent-alert')
      expect(escalations[0].steps).to.have.lengthOf(2)
    })

    it('should acknowledge an escalation chain', async () => {
      const p1 = storage.createProvider({ type: 'terminal', name: 'ack-1', config: {} })
      const p2 = storage.createProvider({ type: 'terminal', name: 'ack-2', config: {} })
      // Step 1: immediate, step 2: far in the future (still pending)
      storage.createRule({
        event: 'on_agent_died',
        providerId: p1.id,
        escalationDelaySeconds: 0,
        escalationGroup: 'ack-test',
      })
      storage.createRule({
        event: 'on_agent_died',
        providerId: p2.id,
        escalationDelaySeconds: 9999,
        escalationGroup: 'ack-test',
      })

      manager = new NotificationManager({ db })
      await manager.fireEvent('on_agent_died', { event: 'on_agent_died' })

      // Allow microtask to settle (step 1 fires, step 2 is scheduled)
      await new Promise(resolve => setTimeout(resolve, 50))

      expect(manager.getActiveEscalations()).to.have.lengthOf(1)

      const acked = manager.acknowledgeEscalation('ack-test')
      expect(acked).to.equal(true)
      expect(manager.getActiveEscalations()).to.have.lengthOf(0)
    })

    it('should return false when acknowledging non-existent escalation', () => {
      manager = new NotificationManager({ db })
      const result = manager.acknowledgeEscalation('nonexistent')
      expect(result).to.equal(false)
    })

    it('should not start duplicate escalation chains', async () => {
      const p1 = storage.createProvider({ type: 'terminal', name: 'dup-1', config: {} })
      const p2 = storage.createProvider({ type: 'terminal', name: 'dup-2', config: {} })
      // Step 1: immediate, step 2: far future (chain stays active)
      storage.createRule({
        event: 'on_agent_died',
        providerId: p1.id,
        escalationDelaySeconds: 0,
        escalationGroup: 'dup-group',
      })
      storage.createRule({
        event: 'on_agent_died',
        providerId: p2.id,
        escalationDelaySeconds: 9999,
        escalationGroup: 'dup-group',
      })

      manager = new NotificationManager({ db })

      await manager.fireEvent('on_agent_died', { event: 'on_agent_died' })
      // Allow microtask to settle
      await new Promise(resolve => setTimeout(resolve, 50))
      await manager.fireEvent('on_agent_died', { event: 'on_agent_died' })

      // Should still only have one active escalation
      expect(manager.getActiveEscalations()).to.have.lengthOf(1)
    })
  })

  // =========================================================================
  // Context Normalization
  // =========================================================================
  describe('context normalization', () => {
    it('should normalize ticketId to ticket', async () => {
      const provider = storage.createProvider({ type: 'terminal', name: 'ctx-term', config: {} })
      storage.createRule({ event: 'work:started', providerId: provider.id })

      manager = new NotificationManager({ db })

      const results = await manager.fireEvent('work:started', {
        event: 'work:started',
        ticketId: 'PRLT-456',
        prNumber: 99,
        sessionId: 'session-1',
      })

      expect(results).to.have.lengthOf(1)
      expect(results[0].success).to.equal(true)
    })
  })
})
