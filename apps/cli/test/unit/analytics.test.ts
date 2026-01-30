import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';

import {
  isAnalyticsEnabled,
  enableAnalytics,
  disableAnalytics,
  getAnalyticsConfig,
  getWorkspaceUUID,
  hasAnalyticsPreference,
  getConsentDate,
} from '../../src/lib/analytics/config.js';

import {
  queueEvent,
  getQueuedEvents,
  getQueueCount,
  removeEvents,
  clearQueue,
  purgeOldEvents,
  getQueueStats,
  ensureAnalyticsQueueTable,
} from '../../src/lib/analytics/queue.js';

import { PMO_TABLES } from '../../src/lib/pmo/schema.js';

/**
 * Unit tests for analytics module
 * TKT-131: Usage analytics (PostHog)
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

    // Create analytics queue table
    db.exec(`
      CREATE TABLE IF NOT EXISTS ${PMO_TABLES.analytics_queue} (
        id TEXT PRIMARY KEY,
        event TEXT NOT NULL,
        properties TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_pmo_analytics_queue_created ON ${PMO_TABLES.analytics_queue}(created_at);
    `);
  });

  afterEach(() => {
    if (db) db.close();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('Analytics Config', () => {
    describe('isAnalyticsEnabled', () => {
      it('returns false when analytics is not configured', () => {
        expect(isAnalyticsEnabled(db)).to.equal(false);
      });

      it('returns true when analytics is enabled', () => {
        enableAnalytics(db);
        expect(isAnalyticsEnabled(db)).to.equal(true);
      });

      it('returns false when analytics is disabled', () => {
        enableAnalytics(db);
        disableAnalytics(db);
        expect(isAnalyticsEnabled(db)).to.equal(false);
      });
    });

    describe('getWorkspaceUUID', () => {
      it('generates a UUID if none exists', () => {
        const uuid = getWorkspaceUUID(db);
        expect(uuid).to.be.a('string');
        expect(uuid.length).to.be.greaterThan(0);
      });

      it('returns the same UUID on subsequent calls', () => {
        const uuid1 = getWorkspaceUUID(db);
        const uuid2 = getWorkspaceUUID(db);
        expect(uuid1).to.equal(uuid2);
      });

      it('preserves UUID across enable/disable cycles', () => {
        enableAnalytics(db);
        const uuid1 = getWorkspaceUUID(db);
        disableAnalytics(db);
        enableAnalytics(db);
        const uuid2 = getWorkspaceUUID(db);
        expect(uuid1).to.equal(uuid2);
      });
    });

    describe('enableAnalytics', () => {
      it('sets analytics.enabled to true', () => {
        enableAnalytics(db);
        expect(isAnalyticsEnabled(db)).to.equal(true);
      });

      it('sets consent date', () => {
        enableAnalytics(db);
        const consentDate = getConsentDate(db);
        expect(consentDate).to.be.a('string');
        expect(consentDate).to.include('T'); // ISO date format
      });

      it('creates workspace UUID', () => {
        enableAnalytics(db);
        const uuid = getWorkspaceUUID(db);
        expect(uuid).to.be.a('string');
        expect(uuid.length).to.be.greaterThan(0);
      });
    });

    describe('disableAnalytics', () => {
      it('sets analytics.enabled to false', () => {
        enableAnalytics(db);
        disableAnalytics(db);
        expect(isAnalyticsEnabled(db)).to.equal(false);
      });

      it('clears consent date', () => {
        enableAnalytics(db);
        disableAnalytics(db);
        const consentDate = getConsentDate(db);
        expect(consentDate).to.be.null;
      });
    });

    describe('hasAnalyticsPreference', () => {
      it('returns false when no preference is set', () => {
        expect(hasAnalyticsPreference(db)).to.equal(false);
      });

      it('returns true after enabling analytics', () => {
        enableAnalytics(db);
        expect(hasAnalyticsPreference(db)).to.equal(true);
      });

      it('returns true after disabling analytics', () => {
        enableAnalytics(db);
        disableAnalytics(db);
        expect(hasAnalyticsPreference(db)).to.equal(true);
      });
    });

    describe('getAnalyticsConfig', () => {
      it('returns full config object', () => {
        enableAnalytics(db);
        const config = getAnalyticsConfig(db);

        expect(config).to.have.property('enabled', true);
        expect(config).to.have.property('workspaceId');
        expect(config).to.have.property('consentDate');
        expect(config.workspaceId).to.be.a('string');
        expect(config.consentDate).to.be.a('string');
      });

      it('returns disabled config when analytics is off', () => {
        const config = getAnalyticsConfig(db);
        expect(config.enabled).to.equal(false);
        expect(config.consentDate).to.be.null;
      });
    });
  });

  describe('Analytics Queue', () => {
    describe('queueEvent', () => {
      it('adds an event to the queue', () => {
        queueEvent(db, 'test.event', { foo: 'bar' });
        expect(getQueueCount(db)).to.equal(1);
      });

      it('stores event properties as JSON', () => {
        queueEvent(db, 'test.event', { key: 'value', num: 42 });
        const events = getQueuedEvents(db);

        expect(events).to.have.length(1);
        expect(events[0].event).to.equal('test.event');
        expect(JSON.parse(events[0].properties)).to.deep.equal({ key: 'value', num: 42 });
      });

      it('sets created_at timestamp', () => {
        const before = Date.now();
        queueEvent(db, 'test.event', {});
        const after = Date.now();

        const events = getQueuedEvents(db);
        expect(events[0].created_at).to.be.at.least(before);
        expect(events[0].created_at).to.be.at.most(after);
      });
    });

    describe('getQueuedEvents', () => {
      it('returns events in oldest-first order', () => {
        queueEvent(db, 'event.first', {});
        queueEvent(db, 'event.second', {});
        queueEvent(db, 'event.third', {});

        const events = getQueuedEvents(db);
        expect(events).to.have.length(3);
        expect(events[0].event).to.equal('event.first');
        expect(events[2].event).to.equal('event.third');
      });

      it('respects limit parameter', () => {
        queueEvent(db, 'event.1', {});
        queueEvent(db, 'event.2', {});
        queueEvent(db, 'event.3', {});

        const events = getQueuedEvents(db, 2);
        expect(events).to.have.length(2);
        expect(events[0].event).to.equal('event.1');
        expect(events[1].event).to.equal('event.2');
      });
    });

    describe('removeEvents', () => {
      it('removes specified events by ID', () => {
        queueEvent(db, 'event.keep', {});
        queueEvent(db, 'event.remove', {});

        const events = getQueuedEvents(db);
        const removeId = events.find(e => e.event === 'event.remove')!.id;

        removeEvents(db, [removeId]);

        const remaining = getQueuedEvents(db);
        expect(remaining).to.have.length(1);
        expect(remaining[0].event).to.equal('event.keep');
      });

      it('handles empty array', () => {
        queueEvent(db, 'event.1', {});
        removeEvents(db, []);
        expect(getQueueCount(db)).to.equal(1);
      });
    });

    describe('clearQueue', () => {
      it('removes all events', () => {
        queueEvent(db, 'event.1', {});
        queueEvent(db, 'event.2', {});
        queueEvent(db, 'event.3', {});

        clearQueue(db);
        expect(getQueueCount(db)).to.equal(0);
      });
    });

    describe('purgeOldEvents', () => {
      it('removes events older than 7 days', () => {
        // Insert an old event directly
        const oldTime = Date.now() - (8 * 24 * 60 * 60 * 1000); // 8 days ago
        db.prepare(`
          INSERT INTO ${PMO_TABLES.analytics_queue} (id, event, properties, created_at)
          VALUES (?, ?, ?, ?)
        `).run('old-event', 'old.event', '{}', oldTime);

        // Add a new event
        queueEvent(db, 'new.event', {});

        const purged = purgeOldEvents(db);

        expect(purged).to.equal(1);
        expect(getQueueCount(db)).to.equal(1);

        const remaining = getQueuedEvents(db);
        expect(remaining[0].event).to.equal('new.event');
      });

      it('keeps events newer than 7 days', () => {
        queueEvent(db, 'recent.event', {});
        const purged = purgeOldEvents(db);
        expect(purged).to.equal(0);
        expect(getQueueCount(db)).to.equal(1);
      });
    });

    describe('getQueueStats', () => {
      it('returns correct stats for empty queue', () => {
        const stats = getQueueStats(db);
        expect(stats.totalEvents).to.equal(0);
        expect(stats.oldestEventAge).to.be.null;
        expect(stats.newestEventAge).to.be.null;
      });

      it('returns correct stats for populated queue', () => {
        queueEvent(db, 'event.1', {});
        queueEvent(db, 'event.2', {});

        const stats = getQueueStats(db);
        expect(stats.totalEvents).to.equal(2);
        expect(stats.oldestEventAge).to.be.a('number');
        expect(stats.newestEventAge).to.be.a('number');
        expect(stats.oldestEventAge).to.be.at.least(stats.newestEventAge!);
      });
    });

    describe('ensureAnalyticsQueueTable', () => {
      it('creates table if it does not exist', () => {
        // Drop the table first
        db.exec(`DROP TABLE IF EXISTS ${PMO_TABLES.analytics_queue}`);

        // Ensure it's recreated
        ensureAnalyticsQueueTable(db);

        // Should be able to queue an event now
        queueEvent(db, 'test.event', {});
        expect(getQueueCount(db)).to.equal(1);
      });
    });
  });
});
