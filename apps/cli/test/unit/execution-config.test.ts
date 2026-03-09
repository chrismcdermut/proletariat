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
  saveFirewallAllowlistDomains,
  saveExecutionSetting,
  getMirrorToPmoDefault,
  saveMirrorToPmoDefault,
  getCreatePrDefault,
  saveCreatePrDefault,
  getAuthMethod,
  saveAuthMethod,
  clearAuthMethod,
  hasTerminalPreference,
  hasShellPreference,
  detectTerminalApp,
  detectShell,
  getCoderName,
  saveCoderName,
  hasCoderName,
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

  describe('mirror-to-pmo default config', () => {
    it('returns null when unset', () => {
      expect(getMirrorToPmoDefault(db)).to.equal(null);
    });

    it('saves and reads true', () => {
      saveMirrorToPmoDefault(db, true);
      expect(getMirrorToPmoDefault(db)).to.equal(true);
    });

    it('saves and reads false', () => {
      saveMirrorToPmoDefault(db, false);
      expect(getMirrorToPmoDefault(db)).to.equal(false);
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

  describe('saveFirewallAllowlistDomains', () => {
    it('saves domains as JSON array', () => {
      saveFirewallAllowlistDomains(db, ['example.com', 'test.org']);

      const row = db.prepare('SELECT value FROM workspace_settings WHERE key = ?').get(
        'execution.firewall.allowlist_domains'
      ) as { value: string };

      expect(JSON.parse(row.value)).to.deep.equal(['example.com', 'test.org']);
    });

    it('deduplicates domains', () => {
      saveFirewallAllowlistDomains(db, ['example.com', 'example.com', 'test.org']);

      const row = db.prepare('SELECT value FROM workspace_settings WHERE key = ?').get(
        'execution.firewall.allowlist_domains'
      ) as { value: string };

      expect(JSON.parse(row.value)).to.deep.equal(['example.com', 'test.org']);
    });

    it('trims whitespace from domains', () => {
      saveFirewallAllowlistDomains(db, ['  example.com  ', ' test.org ']);

      const row = db.prepare('SELECT value FROM workspace_settings WHERE key = ?').get(
        'execution.firewall.allowlist_domains'
      ) as { value: string };

      expect(JSON.parse(row.value)).to.deep.equal(['example.com', 'test.org']);
    });

    it('filters out empty strings', () => {
      saveFirewallAllowlistDomains(db, ['example.com', '', '  ', 'test.org']);

      const row = db.prepare('SELECT value FROM workspace_settings WHERE key = ?').get(
        'execution.firewall.allowlist_domains'
      ) as { value: string };

      expect(JSON.parse(row.value)).to.deep.equal(['example.com', 'test.org']);
    });

    it('round-trips through loadExecutionConfig as JSON', () => {
      saveFirewallAllowlistDomains(db, ['example.com', 'test.org']);
      const config = loadExecutionConfig(db);
      expect(config.firewall.allowlistDomains).to.deep.equal(['example.com', 'test.org']);
    });

    it('loadExecutionConfig parses legacy comma-separated format', () => {
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run(
        'execution.firewall.allowlist_domains',
        'example.com, test.org, another.net'
      );
      const config = loadExecutionConfig(db);
      expect(config.firewall.allowlistDomains).to.deep.equal(['example.com', 'test.org', 'another.net']);
    });
  });

  describe('saveExecutionSetting', () => {
    it('saves a generic setting by config key name', () => {
      saveExecutionSetting(db, 'dockerImage', 'node:20');

      const row = db.prepare('SELECT value FROM workspace_settings WHERE key = ?').get(
        'execution.docker.image'
      ) as { value: string };

      expect(row.value).to.equal('node:20');
    });

    it('round-trips docker settings through load', () => {
      saveExecutionSetting(db, 'dockerImage', 'node:20');
      saveExecutionSetting(db, 'dockerNetwork', 'host');
      saveExecutionSetting(db, 'dockerMemory', '4g');
      saveExecutionSetting(db, 'dockerCpus', '2');

      const config = loadExecutionConfig(db);
      expect(config.docker.image).to.equal('node:20');
      expect(config.docker.network).to.equal('host');
      expect(config.docker.memory).to.equal('4g');
      expect(config.docker.cpus).to.equal(2);
    });

    it('round-trips VM settings through load', () => {
      saveExecutionSetting(db, 'vmDefaultHost', '192.168.1.100');
      saveExecutionSetting(db, 'vmUser', 'deploy');
      saveExecutionSetting(db, 'vmKeyPath', '/home/user/.ssh/id_rsa');
      saveExecutionSetting(db, 'vmSyncMethod', 'rsync');

      const config = loadExecutionConfig(db);
      expect(config.vm.defaultHost).to.equal('192.168.1.100');
      expect(config.vm.user).to.equal('deploy');
      expect(config.vm.keyPath).to.equal('/home/user/.ssh/id_rsa');
      expect(config.vm.syncMethod).to.equal('rsync');
    });
  });

  describe('getCreatePrDefault / saveCreatePrDefault', () => {
    it('returns null when unset', () => {
      expect(getCreatePrDefault(db)).to.equal(null);
    });

    it('saves and reads true', () => {
      saveCreatePrDefault(db, true);
      expect(getCreatePrDefault(db)).to.equal(true);
    });

    it('saves and reads false', () => {
      saveCreatePrDefault(db, false);
      expect(getCreatePrDefault(db)).to.equal(false);
    });

    it('overwrites previous value', () => {
      saveCreatePrDefault(db, true);
      saveCreatePrDefault(db, false);
      expect(getCreatePrDefault(db)).to.equal(false);
    });
  });

  describe('getAuthMethod / saveAuthMethod / clearAuthMethod', () => {
    it('returns null when unset', () => {
      expect(getAuthMethod(db)).to.equal(null);
    });

    it('saves and reads oauth', () => {
      saveAuthMethod(db, 'oauth');
      expect(getAuthMethod(db)).to.equal('oauth');
    });

    it('saves and reads apikey', () => {
      saveAuthMethod(db, 'apikey');
      expect(getAuthMethod(db)).to.equal('apikey');
    });

    it('clearAuthMethod removes saved preference', () => {
      saveAuthMethod(db, 'oauth');
      expect(getAuthMethod(db)).to.equal('oauth');

      clearAuthMethod(db);
      expect(getAuthMethod(db)).to.equal(null);
    });

    it('returns null for invalid stored values', () => {
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run(
        'execution.auth_method',
        'invalid'
      );
      expect(getAuthMethod(db)).to.equal(null);
    });
  });

  describe('hasTerminalPreference / hasShellPreference', () => {
    it('returns false when no terminal preference set', () => {
      expect(hasTerminalPreference(db)).to.equal(false);
    });

    it('returns true after saving terminal preference', () => {
      saveTerminalApp(db, 'iTerm');
      expect(hasTerminalPreference(db)).to.equal(true);
    });

    it('returns false when no shell preference set', () => {
      expect(hasShellPreference(db)).to.equal(false);
    });

    it('returns true after saving shell preference', () => {
      saveShell(db, 'zsh');
      expect(hasShellPreference(db)).to.equal(true);
    });
  });

  describe('detectTerminalApp', () => {
    const originalTermProgram = process.env.TERM_PROGRAM;
    const originalTermEmulator = process.env.TERMINAL_EMULATOR;

    afterEach(() => {
      if (originalTermProgram !== undefined) {
        process.env.TERM_PROGRAM = originalTermProgram;
      } else {
        delete process.env.TERM_PROGRAM;
      }
      if (originalTermEmulator !== undefined) {
        process.env.TERMINAL_EMULATOR = originalTermEmulator;
      } else {
        delete process.env.TERMINAL_EMULATOR;
      }
    });

    it('detects iTerm', () => {
      process.env.TERM_PROGRAM = 'iTerm.app';
      expect(detectTerminalApp()).to.equal('iTerm');
    });

    it('detects Terminal.app', () => {
      process.env.TERM_PROGRAM = 'Apple_Terminal';
      expect(detectTerminalApp()).to.equal('Terminal');
    });

    it('detects Ghostty', () => {
      process.env.TERM_PROGRAM = 'ghostty';
      expect(detectTerminalApp()).to.equal('Ghostty');
    });

    it('detects Alacritty', () => {
      process.env.TERM_PROGRAM = 'alacritty';
      expect(detectTerminalApp()).to.equal('Alacritty');
    });

    it('detects WezTerm', () => {
      process.env.TERM_PROGRAM = 'WezTerm';
      expect(detectTerminalApp()).to.equal('WezTerm');
    });

    it('detects Kitty', () => {
      process.env.TERM_PROGRAM = 'kitty';
      expect(detectTerminalApp()).to.equal('Kitty');
    });

    it('detects Warp', () => {
      process.env.TERM_PROGRAM = 'warp';
      expect(detectTerminalApp()).to.equal('Warp');
    });

    it('detects JetBrains terminal via TERMINAL_EMULATOR', () => {
      process.env.TERM_PROGRAM = '';
      process.env.TERMINAL_EMULATOR = 'JetBrains-JediTerm';
      expect(detectTerminalApp()).to.equal('tmux');
    });

    it('returns null for unknown terminal', () => {
      process.env.TERM_PROGRAM = 'unknown-terminal';
      delete process.env.TERMINAL_EMULATOR;
      expect(detectTerminalApp()).to.equal(null);
    });
  });

  describe('detectShell', () => {
    const originalShell = process.env.SHELL;

    afterEach(() => {
      if (originalShell !== undefined) {
        process.env.SHELL = originalShell;
      } else {
        delete process.env.SHELL;
      }
    });

    it('detects zsh', () => {
      process.env.SHELL = '/bin/zsh';
      expect(detectShell()).to.equal('zsh');
    });

    it('detects bash', () => {
      process.env.SHELL = '/bin/bash';
      expect(detectShell()).to.equal('bash');
    });

    it('detects fish', () => {
      process.env.SHELL = '/usr/local/bin/fish';
      expect(detectShell()).to.equal('fish');
    });

    it('returns null for unknown shell', () => {
      process.env.SHELL = '/bin/csh';
      expect(detectShell()).to.equal(null);
    });

    it('returns null when SHELL is empty', () => {
      process.env.SHELL = '';
      expect(detectShell()).to.equal(null);
    });
  });

  describe('getCoderName / saveCoderName / hasCoderName', () => {
    it('returns null when unset', () => {
      expect(getCoderName(db)).to.equal(null);
    });

    it('hasCoderName returns false when unset', () => {
      expect(hasCoderName(db)).to.equal(false);
    });

    it('saves and reads coder name', () => {
      saveCoderName(db, 'john-doe');
      expect(getCoderName(db)).to.equal('john-doe');
    });

    it('hasCoderName returns true after save', () => {
      saveCoderName(db, 'john-doe');
      expect(hasCoderName(db)).to.equal(true);
    });

    it('overwrites previous value', () => {
      saveCoderName(db, 'john-doe');
      saveCoderName(db, 'jane-smith');
      expect(getCoderName(db)).to.equal('jane-smith');
    });
  });

  describe('loadExecutionConfig - full round-trip', () => {
    it('loads tmux control mode through config', () => {
      saveTmuxControlMode(db, true);
      const config = loadExecutionConfig(db);
      expect(config.tmux.controlMode).to.equal(true);

      saveTmuxControlMode(db, false);
      const config2 = loadExecutionConfig(db);
      expect(config2.tmux.controlMode).to.equal(false);
    });

    it('loads permission mode from database', () => {
      saveExecutionSetting(db, 'permissionMode', 'danger');
      const config = loadExecutionConfig(db);
      expect(config.permissionMode).to.equal('danger');
    });

    it('loads legacy sandboxed setting as permission mode', () => {
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run(
        'execution.sandboxed',
        'true'
      );
      const config = loadExecutionConfig(db);
      expect(config.permissionMode).to.equal('safe');
    });

    it('loads auth method from database', () => {
      saveAuthMethod(db, 'apikey');
      const config = loadExecutionConfig(db);
      expect(config.authMethod).to.equal('apikey');
    });

    it('loads create PR default from database', () => {
      saveCreatePrDefault(db, true);
      const config = loadExecutionConfig(db);
      expect(config.createPrDefault).to.equal(true);
    });

    it('loads output mode from database', () => {
      saveExecutionSetting(db, 'outputMode', 'print');
      const config = loadExecutionConfig(db);
      expect(config.outputMode).to.equal('print');
    });

    it('loads auto execute from database', () => {
      saveExecutionSetting(db, 'autoExecute', 'true');
      const config = loadExecutionConfig(db);
      expect(config.autoExecute).to.equal(true);
    });
  });
});
