import { expect } from 'chai'
import { SqliteDatabase } from '../../src/lib/database/sqlite.js'
import { ProviderTriggerStore, TriggerHandler } from '../../src/lib/providers/trigger-config.js'
import { resetEventBus, getEventBus } from '../../src/lib/events/index.js'

function createTestDb(): SqliteDatabase {
  const db = new SqliteDatabase(':memory:')
  db.exec(`
    CREATE TABLE pmo_provider_triggers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL DEFAULT '*',
      trigger_event TEXT NOT NULL,
      target_status TEXT NOT NULL,
      project_id TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(provider, trigger_event, project_id)
    )
  `)
  return db
}

describe('ProviderTriggerStore', () => {
  let db: SqliteDatabase
  let store: ProviderTriggerStore

  beforeEach(() => {
    db = createTestDb()
    store = new ProviderTriggerStore(db)
  })

  afterEach(() => {
    db.close()
  })

  describe('upsertTrigger / getTriggersForEvent', () => {
    it('creates and retrieves a trigger', () => {
      store.upsertTrigger({
        provider: '*',
        triggerEvent: 'pr_created',
        targetStatus: 'Review',
        projectId: null,
        enabled: true,
      })

      const triggers = store.getTriggersForEvent('pr_created')
      expect(triggers).to.have.lengthOf(1)
      expect(triggers[0].targetStatus).to.equal('Review')
      expect(triggers[0].enabled).to.be.true
    })

    it('filters by provider', () => {
      store.upsertTrigger({
        provider: 'linear',
        triggerEvent: 'pr_created',
        targetStatus: 'Review',
        projectId: null,
        enabled: true,
      })

      // Should match when provider is specified
      const linearTriggers = store.getTriggersForEvent('pr_created', 'linear')
      expect(linearTriggers).to.have.lengthOf(1)

      // Should not match for a different provider (no wildcard)
      const jiraTriggers = store.getTriggersForEvent('pr_created', 'jira')
      expect(jiraTriggers).to.have.lengthOf(0)
    })

    it('wildcard provider matches all providers', () => {
      store.upsertTrigger({
        provider: '*',
        triggerEvent: 'pr_merged',
        targetStatus: 'Done',
        projectId: null,
        enabled: true,
      })

      const triggers = store.getTriggersForEvent('pr_merged', 'linear')
      expect(triggers).to.have.lengthOf(1)
    })

    it('prefers provider-specific over wildcard', () => {
      store.upsertTrigger({
        provider: '*',
        triggerEvent: 'pr_created',
        targetStatus: 'Review',
        projectId: null,
        enabled: true,
      })
      store.upsertTrigger({
        provider: 'linear',
        triggerEvent: 'pr_created',
        targetStatus: 'Linear Review',
        projectId: null,
        enabled: true,
      })

      const triggers = store.getTriggersForEvent('pr_created', 'linear')
      expect(triggers).to.have.lengthOf(2)
      expect(triggers[0].targetStatus).to.equal('Linear Review') // Specific first
    })

    it('excludes disabled triggers', () => {
      store.upsertTrigger({
        provider: '*',
        triggerEvent: 'pr_created',
        targetStatus: 'Review',
        projectId: null,
        enabled: false,
      })

      const triggers = store.getTriggersForEvent('pr_created')
      expect(triggers).to.have.lengthOf(0)
    })
  })

  describe('listTriggers', () => {
    it('lists all triggers', () => {
      store.upsertTrigger({
        provider: '*',
        triggerEvent: 'pr_created',
        targetStatus: 'Review',
        projectId: null,
        enabled: true,
      })
      store.upsertTrigger({
        provider: '*',
        triggerEvent: 'pr_merged',
        targetStatus: 'Done',
        projectId: null,
        enabled: true,
      })

      const triggers = store.listTriggers()
      expect(triggers).to.have.lengthOf(2)
    })
  })

  describe('removeTrigger', () => {
    it('removes a trigger by ID', () => {
      store.upsertTrigger({
        provider: '*',
        triggerEvent: 'pr_created',
        targetStatus: 'Review',
        projectId: null,
        enabled: true,
      })

      const triggers = store.listTriggers()
      expect(triggers).to.have.lengthOf(1)

      store.removeTrigger(triggers[0].id!)
      expect(store.listTriggers()).to.have.lengthOf(0)
    })
  })

  describe('setEnabled', () => {
    it('enables/disables a trigger', () => {
      store.upsertTrigger({
        provider: '*',
        triggerEvent: 'pr_created',
        targetStatus: 'Review',
        projectId: null,
        enabled: true,
      })

      const triggers = store.listTriggers()
      const id = triggers[0].id!

      store.setEnabled(id, false)
      expect(store.listTriggers()[0].enabled).to.be.false

      store.setEnabled(id, true)
      expect(store.listTriggers()[0].enabled).to.be.true
    })
  })
})

describe('TriggerHandler', () => {
  let db: SqliteDatabase
  let handler: TriggerHandler
  let movedTickets: Array<{ ticketId: string; projectId: string; targetStatus: string }>

  beforeEach(() => {
    resetEventBus()
    db = createTestDb()
    movedTickets = []

    handler = new TriggerHandler(db, async (ticketId, projectId, targetStatus) => {
      movedTickets.push({ ticketId, projectId, targetStatus })
    })
    handler.start()
  })

  afterEach(() => {
    handler.stop()
    db.close()
    resetEventBus()
  })

  it('moves ticket on pr_created trigger', () => {
    const store = new ProviderTriggerStore(db)
    store.upsertTrigger({
      provider: '*',
      triggerEvent: 'pr_created',
      targetStatus: 'Review',
      projectId: null,
      enabled: true,
    })

    getEventBus().emit('work:pr_created', {
      workItemId: 'TKT-1',
      source: 'pmo',
      projectId: 'project-1',
      prUrl: 'https://github.com/test/pr/1',
      prTitle: 'Fix bug',
      timestamp: new Date(),
    })

    // TriggerHandler uses void async, give it a tick
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(movedTickets).to.have.lengthOf(1)
        expect(movedTickets[0].ticketId).to.equal('TKT-1')
        expect(movedTickets[0].targetStatus).to.equal('Review')
        resolve()
      }, 10)
    })
  })

  it('moves ticket on pr_merged trigger', () => {
    const store = new ProviderTriggerStore(db)
    store.upsertTrigger({
      provider: '*',
      triggerEvent: 'pr_merged',
      targetStatus: 'Done',
      projectId: null,
      enabled: true,
    })

    getEventBus().emit('work:pr_merged', {
      workItemId: 'TKT-2',
      source: 'pmo',
      projectId: 'project-1',
      prNumber: 42,
      prTitle: 'Feature',
      prUrl: 'https://github.com/test/pr/42',
      mergeMethod: 'squash',
      timestamp: new Date(),
    })

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(movedTickets).to.have.lengthOf(1)
        expect(movedTickets[0].targetStatus).to.equal('Done')
        resolve()
      }, 10)
    })
  })

  it('does not move ticket when no matching trigger', () => {
    // No triggers configured
    getEventBus().emit('work:pr_created', {
      workItemId: 'TKT-1',
      source: 'pmo',
      projectId: 'project-1',
      prUrl: 'https://github.com/test/pr/1',
      prTitle: 'Fix',
      timestamp: new Date(),
    })

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(movedTickets).to.have.lengthOf(0)
        resolve()
      }, 10)
    })
  })

  it('moves ticket on work:started (agent_started trigger)', () => {
    const store = new ProviderTriggerStore(db)
    store.upsertTrigger({
      provider: '*',
      triggerEvent: 'agent_started',
      targetStatus: 'In Progress',
      projectId: null,
      enabled: true,
    })

    getEventBus().emit('work:started', {
      workItemId: 'TKT-3',
      source: 'pmo',
      projectId: 'project-1',
      status: 'In Progress',
      timestamp: new Date(),
    })

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(movedTickets).to.have.lengthOf(1)
        expect(movedTickets[0].targetStatus).to.equal('In Progress')
        resolve()
      }, 10)
    })
  })
})
