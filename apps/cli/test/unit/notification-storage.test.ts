import { expect } from 'chai'
import Database from 'better-sqlite3'
import { NotificationStorage } from '../../src/lib/notifications/storage.js'
import { notificationSystem } from '../../src/lib/database/migrations/0021_notification_system.js'

/**
 * Tests for NotificationStorage — CRUD for notification providers and rules.
 */
describe('NotificationStorage (PRLT-1157)', () => {
  let db: Database.Database
  let storage: NotificationStorage

  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('journal_mode = WAL')
    // Enable foreign keys for cascade delete tests
    db.pragma('foreign_keys = ON')
    notificationSystem.up(db)
    storage = new NotificationStorage(db)
  })

  afterEach(() => {
    if (db) db.close()
  })

  // =========================================================================
  // Provider CRUD
  // =========================================================================
  describe('providers', () => {
    it('should create a provider', () => {
      const provider = storage.createProvider({
        type: 'slack',
        name: 'my-slack',
        config: { webhook_url: 'https://hooks.slack.com/test' },
      })

      expect(provider).to.have.property('id')
      expect(provider.type).to.equal('slack')
      expect(provider.name).to.equal('my-slack')
      expect(provider.config).to.deep.include({ webhook_url: 'https://hooks.slack.com/test' })
      expect(provider.enabled).to.equal(true)
    })

    it('should list providers', () => {
      storage.createProvider({ type: 'slack', name: 'slack-1', config: { webhook_url: 'https://a' } })
      storage.createProvider({ type: 'email', name: 'email-1', config: { provider: 'sendgrid', api_key: 'k', from: 'a@b.com', to: ['c@d.com'] } })
      storage.createProvider({ type: 'terminal', name: 'term', config: {} })

      const all = storage.listProviders()
      expect(all).to.have.lengthOf(3)

      const slackOnly = storage.listProviders({ type: 'slack' })
      expect(slackOnly).to.have.lengthOf(1)
      expect(slackOnly[0].name).to.equal('slack-1')
    })

    it('should get provider by name', () => {
      storage.createProvider({ type: 'slack', name: 'test-slack', config: { webhook_url: 'https://test' } })

      const found = storage.getProviderByName('test-slack')
      expect(found).to.not.be.null
      expect(found!.name).to.equal('test-slack')

      const notFound = storage.getProviderByName('nonexistent')
      expect(notFound).to.be.null
    })

    it('should get provider by ID', () => {
      const created = storage.createProvider({ type: 'terminal', name: 'term', config: {} })

      const found = storage.getProviderById(created.id)
      expect(found).to.not.be.null
      expect(found!.id).to.equal(created.id)
    })

    it('should update a provider', () => {
      const provider = storage.createProvider({ type: 'slack', name: 'slack-upd', config: { webhook_url: 'https://old' } })

      const updated = storage.updateProvider(provider.id, {
        config: { webhook_url: 'https://new' },
        enabled: false,
      })
      expect(updated).to.equal(true)

      const found = storage.getProviderById(provider.id)!
      expect(found.config).to.deep.include({ webhook_url: 'https://new' })
      expect(found.enabled).to.equal(false)
    })

    it('should delete a provider', () => {
      const provider = storage.createProvider({ type: 'terminal', name: 'del-me', config: {} })

      const deleted = storage.deleteProvider(provider.id)
      expect(deleted).to.equal(true)

      expect(storage.getProviderById(provider.id)).to.be.null
    })

    it('should reject duplicate provider names', () => {
      storage.createProvider({ type: 'slack', name: 'unique', config: { webhook_url: 'https://a' } })
      expect(() => {
        storage.createProvider({ type: 'slack', name: 'unique', config: { webhook_url: 'https://b' } })
      }).to.throw()
    })

    it('should filter by enabled status', () => {
      const p1 = storage.createProvider({ type: 'slack', name: 's1', config: { webhook_url: 'https://a' } })
      storage.createProvider({ type: 'slack', name: 's2', config: { webhook_url: 'https://b' } })
      storage.updateProvider(p1.id, { enabled: false })

      const enabled = storage.listProviders({ enabled: true })
      expect(enabled).to.have.lengthOf(1)
      expect(enabled[0].name).to.equal('s2')

      const disabled = storage.listProviders({ enabled: false })
      expect(disabled).to.have.lengthOf(1)
      expect(disabled[0].name).to.equal('s1')
    })
  })

  // =========================================================================
  // Rule CRUD
  // =========================================================================
  describe('rules', () => {
    let providerId: string

    beforeEach(() => {
      const provider = storage.createProvider({ type: 'slack', name: 'test-slack', config: { webhook_url: 'https://test' } })
      providerId = provider.id
    })

    it('should create a rule', () => {
      const rule = storage.createRule({
        event: 'on_agent_died',
        providerId,
      })

      expect(rule).to.have.property('id')
      expect(rule.event).to.equal('on_agent_died')
      expect(rule.providerId).to.equal(providerId)
      expect(rule.priority).to.equal(0)
      expect(rule.escalationDelaySeconds).to.be.null
      expect(rule.escalationGroup).to.be.null
      expect(rule.enabled).to.equal(true)
    })

    it('should create a rule with escalation config', () => {
      const rule = storage.createRule({
        event: 'on_ci_failed',
        providerId,
        priority: 1,
        escalationDelaySeconds: 600,
        escalationGroup: 'ci-alerts',
      })

      expect(rule.priority).to.equal(1)
      expect(rule.escalationDelaySeconds).to.equal(600)
      expect(rule.escalationGroup).to.equal('ci-alerts')
    })

    it('should list rules filtered by event', () => {
      storage.createRule({ event: 'on_agent_died', providerId })
      storage.createRule({ event: 'on_ci_failed', providerId })
      storage.createRule({ event: 'on_agent_died', providerId, priority: 1 })

      const agentRules = storage.listRules({ event: 'on_agent_died' })
      expect(agentRules).to.have.lengthOf(2)

      const ciRules = storage.listRules({ event: 'on_ci_failed' })
      expect(ciRules).to.have.lengthOf(1)
    })

    it('should list rules filtered by provider', () => {
      const p2 = storage.createProvider({ type: 'email', name: 'test-email', config: { provider: 'sendgrid', api_key: 'k', from: 'a@b.com', to: ['c@d.com'] } })
      storage.createRule({ event: 'on_ci_failed', providerId })
      storage.createRule({ event: 'on_ci_failed', providerId: p2.id })

      const slackRules = storage.listRules({ providerId })
      expect(slackRules).to.have.lengthOf(1)
    })

    it('should delete a rule', () => {
      const rule = storage.createRule({ event: 'on_agent_died', providerId })

      const deleted = storage.deleteRule(rule.id)
      expect(deleted).to.equal(true)
      expect(storage.getRuleById(rule.id)).to.be.null
    })

    it('should enable/disable a rule', () => {
      const rule = storage.createRule({ event: 'on_agent_died', providerId })

      storage.setRuleEnabled(rule.id, false)
      expect(storage.getRuleById(rule.id)!.enabled).to.equal(false)

      storage.setRuleEnabled(rule.id, true)
      expect(storage.getRuleById(rule.id)!.enabled).to.equal(true)
    })

    it('should cascade delete rules when provider is deleted', () => {
      storage.createRule({ event: 'on_agent_died', providerId })
      storage.createRule({ event: 'on_ci_failed', providerId })

      expect(storage.listRules()).to.have.lengthOf(2)

      storage.deleteProvider(providerId)
      expect(storage.listRules()).to.have.lengthOf(0)
    })

    it('should get rules with providers resolved', () => {
      storage.createRule({ event: 'on_agent_died', providerId })

      const results = storage.getRulesWithProviders('on_agent_died')
      expect(results).to.have.lengthOf(1)
      expect(results[0].rule.event).to.equal('on_agent_died')
      expect(results[0].provider.name).to.equal('test-slack')
      expect(results[0].provider.type).to.equal('slack')
    })

    it('should not return disabled rules or providers in getRulesWithProviders', () => {
      storage.createRule({ event: 'on_agent_died', providerId })
      storage.updateProvider(providerId, { enabled: false })

      const results = storage.getRulesWithProviders('on_agent_died')
      expect(results).to.have.lengthOf(0)
    })

    it('should order rules by priority', () => {
      storage.createRule({ event: 'on_agent_died', providerId, priority: 2 })
      storage.createRule({ event: 'on_agent_died', providerId, priority: 0 })
      storage.createRule({ event: 'on_agent_died', providerId, priority: 1 })

      const rules = storage.listRules({ event: 'on_agent_died' })
      expect(rules.map(r => r.priority)).to.deep.equal([0, 1, 2])
    })
  })
})
