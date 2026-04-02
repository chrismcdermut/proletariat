import { expect } from 'chai'
import Database from 'better-sqlite3'
import { notificationSystem } from '../../src/lib/database/migrations/0021_notification_system.js'

/**
 * Tests for the notification system database migration.
 */
describe('Migration 0021: notification_system (PRLT-1157)', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('journal_mode = WAL')
  })

  afterEach(() => {
    if (db) db.close()
  })

  it('should have correct migration metadata', () => {
    expect(notificationSystem.id).to.equal('0021')
    expect(notificationSystem.name).to.equal('notification_system')
  })

  it('should create notification_providers table', () => {
    notificationSystem.up(db)

    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='notification_providers'"
    ).all()
    expect(tables).to.have.lengthOf(1)
  })

  it('should create notification_rules table', () => {
    notificationSystem.up(db)

    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='notification_rules'"
    ).all()
    expect(tables).to.have.lengthOf(1)
  })

  it('should create indexes', () => {
    notificationSystem.up(db)

    const indexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_notification%'"
    ).all() as Array<{ name: string }>

    const indexNames = indexes.map(i => i.name)
    expect(indexNames).to.include('idx_notification_providers_type')
    expect(indexNames).to.include('idx_notification_providers_enabled')
    expect(indexNames).to.include('idx_notification_rules_event')
    expect(indexNames).to.include('idx_notification_rules_provider')
    expect(indexNames).to.include('idx_notification_rules_escalation')
  })

  it('should enforce provider type CHECK constraint', () => {
    notificationSystem.up(db)

    expect(() => {
      db.prepare(
        "INSERT INTO notification_providers (id, type, name, config) VALUES ('t1', 'invalid_type', 'test', '{}')"
      ).run()
    }).to.throw()
  })

  it('should be idempotent (safe to run twice)', () => {
    notificationSystem.up(db)
    expect(() => notificationSystem.up(db)).to.not.throw()
  })

  it('should allow inserting valid data', () => {
    notificationSystem.up(db)

    db.prepare(
      "INSERT INTO notification_providers (id, type, name, config) VALUES ('p1', 'slack', 'test-slack', '{\"webhook_url\": \"https://test\"}')"
    ).run()

    db.prepare(
      "INSERT INTO notification_rules (id, event, provider_id) VALUES ('r1', 'on_agent_died', 'p1')"
    ).run()

    const providers = db.prepare('SELECT * FROM notification_providers').all()
    expect(providers).to.have.lengthOf(1)

    const rules = db.prepare('SELECT * FROM notification_rules').all()
    expect(rules).to.have.lengthOf(1)
  })
})
