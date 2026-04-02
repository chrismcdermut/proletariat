import type Database from 'better-sqlite3'
import type { Migration } from '../migrator.js'

export const notificationSystem: Migration = {
  id: '0021',
  name: 'notification_system',
  up: (db: Database.Database) => {
    // Notification providers — configured channels for sending notifications
    // (Slack webhooks, SendGrid email, Twilio SMS, terminal stdout, browser push)
    db.exec(`
      CREATE TABLE IF NOT EXISTS notification_providers (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('slack', 'email', 'sms', 'terminal', 'browser_push')),
        name TEXT NOT NULL UNIQUE,
        config TEXT NOT NULL DEFAULT '{}',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_notification_providers_type ON notification_providers(type)`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_notification_providers_enabled ON notification_providers(enabled)`)

    // Notification rules — map events to providers with optional escalation
    db.exec(`
      CREATE TABLE IF NOT EXISTS notification_rules (
        id TEXT PRIMARY KEY,
        event TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 0,
        escalation_delay_seconds INTEGER,
        escalation_group TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (provider_id) REFERENCES notification_providers(id) ON DELETE CASCADE
      )
    `)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_notification_rules_event ON notification_rules(event)`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_notification_rules_provider ON notification_rules(provider_id)`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_notification_rules_escalation ON notification_rules(escalation_group)`)
  },
}
