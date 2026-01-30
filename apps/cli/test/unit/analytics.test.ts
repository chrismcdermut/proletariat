import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';

import {
  isAnalyticsEnabled,
  getAnalyticsConfig,
  enableAnalytics,
  disableAnalytics,
  hasAnalyticsPreference,
  getOrCreateWorkspaceId,
  ensureQueueTable,
  getQueueSize,
  cleanupOldEvents,
  getCollectedDataDescription,
  trackCommand,
  trackExecution,
  trackFeature,
} from '../../src/lib/analytics/index.js';

/**
 * Unit tests for analytics module
 * TKT-131: Usage analytics (Statsig/PostHog)
 */
describe('Analytics Module', () => {
  let testDir: string;
  let dbPath: string;
  let db: Database.Database;

  beforeEach(() => {
    // Create temp directory and database for testing
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'analytics-test-'));
    dbPath = path.join(testDir, 'test.db');
    db = new Database(dbPath);

    // Create workspace_settings table
    db.exec(`
      CREATE TABLE IF NOT EXISTS workspace_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
  });

  afterEach(() => {
    if (db) db.close();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('Analytics Settings', () => {
    describe('isAnalyticsEnabled', () => {
      it('returns false when no preference is set', () => {
        expect(isAnalyticsEnabled(db)).to.equal(false);
      });

      it('returns false when explicitly disabled', () => {
        db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run(
          'analytics.enabled',
          'false'
        );
        expect(isAnalyticsEnabled(db)).to.equal(false);
      });

      it('returns true when enabled', () => {
        db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run(
          'analytics.enabled',
          'true'
        );
        expect(isAnalyticsEnabled(db)).to.equal(true);
      });
    });

    describe('hasAnalyticsPreference', () => {
      it('returns false when no preference is set', () => {
        expect(hasAnalyticsPreference(db)).to.equal(false);
      });

      it('returns true when preference is set (even if disabled)', () => {
        db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run(
          'analytics.enabled',
          'false'
        );
        expect(hasAnalyticsPreference(db)).to.equal(true);
      });
    });

    describe('getAnalyticsConfig', () => {
      it('returns default config when nothing is set', () => {
        const config = getAnalyticsConfig(db);
        expect(config.enabled).to.equal(false);
        expect(config.workspaceId).to.be.null;
        expect(config.consentDate).to.be.null;
      });

      it('returns full config when all values are set', () => {
        db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run(
          'analytics.enabled',
          'true'
        );
        db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run(
          'analytics.workspace_id',
          'test-uuid-123'
        );
        db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run(
          'analytics.consent_date',
          '2024-01-15T10:00:00Z'
        );

        const config = getAnalyticsConfig(db);
        expect(config.enabled).to.equal(true);
        expect(config.workspaceId).to.equal('test-uuid-123');
        expect(config.consentDate).to.equal('2024-01-15T10:00:00Z');
      });
    });

    describe('enableAnalytics', () => {
      it('sets enabled to true', () => {
        enableAnalytics(db);
        expect(isAnalyticsEnabled(db)).to.equal(true);
      });

      it('generates a workspace ID if not exists', () => {
        const config = enableAnalytics(db);
        expect(config.workspaceId).to.be.a('string');
        expect(config.workspaceId).to.have.lengthOf(36); // UUID format
      });

      it('preserves existing workspace ID', () => {
        db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run(
          'analytics.workspace_id',
          'existing-uuid'
        );
        const config = enableAnalytics(db);
        expect(config.workspaceId).to.equal('existing-uuid');
      });

      it('sets consent date', () => {
        const before = new Date();
        const config = enableAnalytics(db);
        const after = new Date();

        expect(config.consentDate).to.be.a('string');
        const consentDate = new Date(config.consentDate!);
        expect(consentDate.getTime()).to.be.at.least(before.getTime());
        expect(consentDate.getTime()).to.be.at.most(after.getTime());
      });

      it('creates analytics queue table', () => {
        enableAnalytics(db);
        const tableExists = db.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='analytics_queue'"
        ).get();
        expect(tableExists).to.exist;
      });
    });

    describe('disableAnalytics', () => {
      it('sets enabled to false', () => {
        enableAnalytics(db);
        expect(isAnalyticsEnabled(db)).to.equal(true);

        disableAnalytics(db);
        expect(isAnalyticsEnabled(db)).to.equal(false);
      });

      it('preserves workspace ID for audit trail', () => {
        const config = enableAnalytics(db);
        const workspaceId = config.workspaceId;

        disableAnalytics(db);

        const afterConfig = getAnalyticsConfig(db);
        expect(afterConfig.workspaceId).to.equal(workspaceId);
      });
    });

    describe('getOrCreateWorkspaceId', () => {
      it('creates a new UUID if none exists', () => {
        const id = getOrCreateWorkspaceId(db);
        expect(id).to.be.a('string');
        expect(id).to.have.lengthOf(36);
      });

      it('returns existing UUID if set', () => {
        db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run(
          'analytics.workspace_id',
          'existing-uuid'
        );
        const id = getOrCreateWorkspaceId(db);
        expect(id).to.equal('existing-uuid');
      });

      it('persists the generated UUID', () => {
        const id1 = getOrCreateWorkspaceId(db);
        const id2 = getOrCreateWorkspaceId(db);
        expect(id1).to.equal(id2);
      });
    });
  });

  describe('Queue Management', () => {
    describe('ensureQueueTable', () => {
      it('creates the analytics_queue table', () => {
        ensureQueueTable(db);
        const tableExists = db.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='analytics_queue'"
        ).get();
        expect(tableExists).to.exist;
      });

      it('is idempotent (can be called multiple times)', () => {
        ensureQueueTable(db);
        ensureQueueTable(db);
        const tableExists = db.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='analytics_queue'"
        ).get();
        expect(tableExists).to.exist;
      });
    });

    describe('getQueueSize', () => {
      it('returns 0 when queue is empty', () => {
        const size = getQueueSize(db);
        expect(size).to.equal(0);
      });

      it('returns correct count after adding events', () => {
        ensureQueueTable(db);
        const now = new Date().toISOString();

        db.prepare(`
          INSERT INTO analytics_queue (event_type, distinct_id, properties, timestamp, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).run('command.executed', 'test-id', '{}', now, now);

        db.prepare(`
          INSERT INTO analytics_queue (event_type, distinct_id, properties, timestamp, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).run('command.executed', 'test-id', '{}', now, now);

        const size = getQueueSize(db);
        expect(size).to.equal(2);
      });
    });

    describe('cleanupOldEvents', () => {
      it('removes events older than 7 days', () => {
        ensureQueueTable(db);
        const now = new Date();
        const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
        const sixDaysAgo = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);

        // Add old event
        db.prepare(`
          INSERT INTO analytics_queue (event_type, distinct_id, properties, timestamp, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).run('old.event', 'test-id', '{}', eightDaysAgo.toISOString(), eightDaysAgo.toISOString());

        // Add recent event
        db.prepare(`
          INSERT INTO analytics_queue (event_type, distinct_id, properties, timestamp, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).run('new.event', 'test-id', '{}', sixDaysAgo.toISOString(), sixDaysAgo.toISOString());

        expect(getQueueSize(db)).to.equal(2);

        const deleted = cleanupOldEvents(db);
        expect(deleted).to.equal(1);
        expect(getQueueSize(db)).to.equal(1);

        // Verify the remaining event is the recent one
        const remaining = db.prepare('SELECT event_type FROM analytics_queue').get() as { event_type: string };
        expect(remaining.event_type).to.equal('new.event');
      });

      it('returns 0 when nothing to clean', () => {
        ensureQueueTable(db);
        const deleted = cleanupOldEvents(db);
        expect(deleted).to.equal(0);
      });
    });
  });

  describe('Event Tracking (when disabled)', () => {
    describe('trackCommand', () => {
      it('does not queue events when analytics is disabled', () => {
        ensureQueueTable(db);
        trackCommand(db, {
          command: 'test command',
          success: true,
          cli_version: '1.0.0',
        });
        expect(getQueueSize(db)).to.equal(0);
      });
    });

    describe('trackExecution', () => {
      it('does not queue events when analytics is disabled', () => {
        ensureQueueTable(db);
        trackExecution(db, 'execution.started', {
          mode: 'terminal',
          executor: 'claude-code',
          cli_version: '1.0.0',
        });
        expect(getQueueSize(db)).to.equal(0);
      });
    });

    describe('trackFeature', () => {
      it('does not queue events when analytics is disabled', () => {
        ensureQueueTable(db);
        trackFeature(db, {
          feature: 'test-feature',
          cli_version: '1.0.0',
        });
        expect(getQueueSize(db)).to.equal(0);
      });
    });
  });

  describe('Event Tracking (when enabled)', () => {
    beforeEach(() => {
      enableAnalytics(db);
    });

    describe('trackCommand', () => {
      it('queues command events when analytics is enabled', () => {
        trackCommand(db, {
          command: 'ticket create',
          duration_ms: 150,
          success: true,
          cli_version: '1.0.0',
        });
        expect(getQueueSize(db)).to.equal(1);

        const event = db.prepare('SELECT * FROM analytics_queue').get() as {
          event_type: string;
          properties: string;
        };
        expect(event.event_type).to.equal('command.executed');

        const props = JSON.parse(event.properties);
        expect(props.command).to.equal('ticket create');
        expect(props.duration_ms).to.equal(150);
        expect(props.success).to.equal(true);
      });

      it('uses command.failed for failed commands', () => {
        trackCommand(db, {
          command: 'work start',
          success: false,
          error_code: 'NO_TICKET',
          cli_version: '1.0.0',
        });

        const event = db.prepare('SELECT * FROM analytics_queue').get() as {
          event_type: string;
          properties: string;
        };
        expect(event.event_type).to.equal('command.failed');

        const props = JSON.parse(event.properties);
        expect(props.error_code).to.equal('NO_TICKET');
      });
    });

    describe('trackExecution', () => {
      it('queues execution events when analytics is enabled', () => {
        trackExecution(db, 'execution.completed', {
          mode: 'terminal',
          executor: 'claude-code',
          exit_status: 'completed',
          duration_seconds: 300,
          cli_version: '1.0.0',
        });
        expect(getQueueSize(db)).to.equal(1);

        const event = db.prepare('SELECT * FROM analytics_queue').get() as {
          event_type: string;
          properties: string;
        };
        expect(event.event_type).to.equal('execution.completed');

        const props = JSON.parse(event.properties);
        expect(props.mode).to.equal('terminal');
        expect(props.executor).to.equal('claude-code');
        expect(props.duration_seconds).to.equal(300);
      });
    });

    describe('trackFeature', () => {
      it('queues feature events when analytics is enabled', () => {
        trackFeature(db, {
          feature: 'docker-executor',
          variant: 'devcontainer',
          cli_version: '1.0.0',
        });
        expect(getQueueSize(db)).to.equal(1);

        const event = db.prepare('SELECT * FROM analytics_queue').get() as {
          event_type: string;
          properties: string;
        };
        expect(event.event_type).to.equal('feature.used');

        const props = JSON.parse(event.properties);
        expect(props.feature).to.equal('docker-executor');
        expect(props.variant).to.equal('devcontainer');
      });
    });
  });

  describe('Documentation', () => {
    describe('getCollectedDataDescription', () => {
      it('returns a non-empty string', () => {
        const description = getCollectedDataDescription();
        expect(description).to.be.a('string');
        expect(description.length).to.be.greaterThan(100);
      });

      it('mentions what is collected', () => {
        const description = getCollectedDataDescription();
        expect(description).to.include('Command names');
        expect(description).to.include('success/failure');
        expect(description).to.include('CLI version');
      });

      it('mentions what is not collected', () => {
        const description = getCollectedDataDescription();
        expect(description).to.include('NEVER COLLECT');
        expect(description).to.include('code');
        expect(description).to.include('File paths');
      });

      it('mentions how to manage settings', () => {
        const description = getCollectedDataDescription();
        expect(description).to.include('prlt config analytics');
        expect(description).to.include('--enable');
        expect(description).to.include('--disable');
      });
    });
  });
});
