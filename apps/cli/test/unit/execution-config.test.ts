import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';

import {
  loadExecutionConfig,
  saveTerminalApp,
  saveTerminalOpenInBackground,
  saveTmuxControlMode,
  saveShell,
} from '../../src/lib/execution/config.js';
import { DEFAULT_EXECUTION_CONFIG } from '../../src/lib/execution/types.js';

/**
 * Unit tests for execution configuration
 * TKT-496: Terminal openInBackground setting
 */
describe('Execution Config', () => {
  let testDir: string;
  let dbPath: string;
  let db: Database.Database;

  beforeEach(() => {
    // Create temp directory and database for testing
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-config-test-'));
    dbPath = path.join(testDir, 'test.db');
    db = new Database(dbPath);

    // Create workspace_settings table
    db.exec(`
      CREATE TABLE IF NOT EXISTS workspace_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
  });

  afterEach(() => {
    if (db) db.close();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('DEFAULT_EXECUTION_CONFIG', () => {
    it('has openInBackground defaulting to true', () => {
      expect(DEFAULT_EXECUTION_CONFIG.terminal.openInBackground).to.equal(true);
    });

    it('has terminal.app defaulting to Terminal', () => {
      expect(DEFAULT_EXECUTION_CONFIG.terminal.app).to.equal('Terminal');
    });
  });

  describe('loadExecutionConfig', () => {
    it('returns default config when no settings exist', () => {
      const config = loadExecutionConfig(db);
      expect(config.terminal.openInBackground).to.equal(true);
    });

    it('loads openInBackground as true when stored as "true"', () => {
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run(
        'execution.terminal.open_in_background',
        'true'
      );

      const config = loadExecutionConfig(db);
      expect(config.terminal.openInBackground).to.equal(true);
    });

    it('loads openInBackground as false when stored as "false"', () => {
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run(
        'execution.terminal.open_in_background',
        'false'
      );

      const config = loadExecutionConfig(db);
      expect(config.terminal.openInBackground).to.equal(false);
    });

    it('loads terminal app from database', () => {
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run(
        'execution.terminal.app',
        'iTerm'
      );

      const config = loadExecutionConfig(db);
      expect(config.terminal.app).to.equal('iTerm');
    });
  });

  describe('saveTerminalOpenInBackground', () => {
    it('saves true value correctly', () => {
      saveTerminalOpenInBackground(db, true);

      const row = db.prepare('SELECT value FROM workspace_settings WHERE key = ?').get(
        'execution.terminal.open_in_background'
      ) as { value: string };

      expect(row.value).to.equal('true');
    });

    it('saves false value correctly', () => {
      saveTerminalOpenInBackground(db, false);

      const row = db.prepare('SELECT value FROM workspace_settings WHERE key = ?').get(
        'execution.terminal.open_in_background'
      ) as { value: string };

      expect(row.value).to.equal('false');
    });

    it('round-trips correctly through load', () => {
      saveTerminalOpenInBackground(db, false);
      const config = loadExecutionConfig(db);
      expect(config.terminal.openInBackground).to.equal(false);

      saveTerminalOpenInBackground(db, true);
      const config2 = loadExecutionConfig(db);
      expect(config2.terminal.openInBackground).to.equal(true);
    });
  });

  describe('saveTerminalApp', () => {
    it('saves terminal app correctly', () => {
      saveTerminalApp(db, 'iTerm');

      const row = db.prepare('SELECT value FROM workspace_settings WHERE key = ?').get(
        'execution.terminal.app'
      ) as { value: string };

      expect(row.value).to.equal('iTerm');
    });

    it('round-trips correctly through load', () => {
      saveTerminalApp(db, 'Ghostty');
      const config = loadExecutionConfig(db);
      expect(config.terminal.app).to.equal('Ghostty');
    });
  });

  describe('saveTmuxControlMode', () => {
    it('saves tmux control mode correctly', () => {
      saveTmuxControlMode(db, true);

      const row = db.prepare('SELECT value FROM workspace_settings WHERE key = ?').get(
        'execution.tmux.control_mode'
      ) as { value: string };

      expect(row.value).to.equal('true');
    });
  });

  describe('saveShell', () => {
    it('saves shell correctly', () => {
      saveShell(db, 'fish');

      const row = db.prepare('SELECT value FROM workspace_settings WHERE key = ?').get(
        'execution.shell'
      ) as { value: string };

      expect(row.value).to.equal('fish');
    });

    it('round-trips correctly through load', () => {
      saveShell(db, 'bash');
      const config = loadExecutionConfig(db);
      expect(config.shell).to.equal('bash');
    });
  });
});
