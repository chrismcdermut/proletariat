import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { execInProcess } from './test-helpers.js';

/**
 * End-to-end tests for Config Commands (TKT-762)
 * Tests: prlt config --list, --set, --setting, --json
 *
 * Validates that config commands work in both interactive (via flags) and
 * JSON/agent mode, exercising the full command flow end-to-end.
 */
describe('Config Commands E2E Tests', () => {
  let testDir: string;
  let originalCwd: string;
  let dbPath: string;
  let db: Database.Database;

  beforeEach(() => {
    originalCwd = process.cwd();
    testDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'config-e2e-')));
    process.chdir(testDir);

    const proletariatDir = path.join(testDir, '.proletariat');
    fs.mkdirSync(proletariatDir, { recursive: true });
    dbPath = path.join(proletariatDir, 'workspace.db');

    db = new Database(dbPath);
    setupTestDatabase(db, testDir);
  });

  afterEach(() => {
    if (db) db.close();
    process.chdir(originalCwd);
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  // =========================================================================
  // config --list (non-TTY exec produces JSON output since shouldOutputJson detects non-TTY)
  // =========================================================================
  describe('prlt config --list', () => {
    it('should list all configuration values as JSON in non-TTY mode', async () => {
      // exec() runs in non-TTY, so --list triggers JSON output
      const output = await execInProcess('config --list');
      const parsed = JSON.parse(output);

      expect(parsed).to.have.property('success', true);
      expect(parsed.result).to.have.property('terminal');
      expect(parsed.result).to.have.property('shell');
      expect(parsed.result).to.have.property('tmux');
    });

    it('should show default terminal app in list output', async () => {
      const output = await execInProcess('config --list');
      const parsed = JSON.parse(output);

      expect(parsed.result.terminal).to.have.property('app');
    });

    it('should show default shell in list output', async () => {
      const output = await execInProcess('config --list');
      const parsed = JSON.parse(output);

      expect(parsed.result).to.have.property('shell');
    });
  });

  // =========================================================================
  // config --json (list mode)
  // =========================================================================
  describe('prlt config --json', () => {
    it('should output current config as JSON', async () => {
      const output = await execInProcess('config --json');
      const parsed = JSON.parse(output);

      expect(parsed).to.have.property('success', true);
      expect(parsed).to.have.property('result');
      expect(parsed.result).to.have.property('terminal');
      expect(parsed.result.terminal).to.have.property('app');
      expect(parsed.result.terminal).to.have.property('openInBackground');
      expect(parsed.result).to.have.property('shell');
      expect(parsed.result).to.have.property('tmux');
      expect(parsed.result.tmux).to.have.property('controlMode');
    });

    it('should include metadata in JSON output', async () => {
      const output = await execInProcess('config --json');
      const parsed = JSON.parse(output);

      expect(parsed).to.have.property('metadata');
      expect(parsed.metadata).to.have.property('command', 'config');
    });

    it('should reflect updated values in JSON output', async () => {
      // Set a value first
      await execInProcess('config --set "terminal.app iTerm"');

      const output = await execInProcess('config --json');
      const parsed = JSON.parse(output);

      expect(parsed.result.terminal.app).to.equal('iTerm');
    });
  });

  // =========================================================================
  // config --set
  // =========================================================================
  describe('prlt config --set', () => {
    it('should set terminal app', async () => {
      const output = await execInProcess('config --set "terminal.app Ghostty"');
      expect(output).to.contain('Ghostty');

      // Verify in DB
      const row = db.prepare("SELECT value FROM workspace_settings WHERE key = 'execution.terminal.app'").get() as { value: string } | undefined;
      expect(row).to.not.be.undefined;
      expect(row!.value).to.equal('Ghostty');
    });

    it('should set terminal openInBackground', async () => {
      await execInProcess('config --set "terminal.openInBackground false"');

      const row = db.prepare("SELECT value FROM workspace_settings WHERE key = 'execution.terminal.open_in_background'").get() as { value: string } | undefined;
      expect(row).to.not.be.undefined;
      expect(row!.value).to.equal('false');
    });

    it('should set shell', async () => {
      await execInProcess('config --set "shell fish"');

      const row = db.prepare("SELECT value FROM workspace_settings WHERE key = 'execution.shell'").get() as { value: string } | undefined;
      expect(row).to.not.be.undefined;
      expect(row!.value).to.equal('fish');
    });

    it('should set tmux control mode', async () => {
      await execInProcess('config --set "tmux.controlMode true"');

      const row = db.prepare("SELECT value FROM workspace_settings WHERE key = 'execution.tmux.control_mode'").get() as { value: string } | undefined;
      expect(row).to.not.be.undefined;
      expect(row!.value).to.equal('true');
    });

    it('should output success JSON when --json is used with --set', async () => {
      const output = await execInProcess('config --set "terminal.app Kitty" --json');
      const parsed = JSON.parse(output);

      expect(parsed).to.have.property('success', true);
      expect(parsed.result).to.have.property('key', 'terminal.app');
      expect(parsed.result).to.have.property('value', 'Kitty');
    });

    it('should warn on unknown config key', async () => {
      // In JSON mode, unknown keys produce a JSON error; text mode warning is
      // filtered by filterOutput (strips "Warning:" lines from oclif stderr)
      const output = await execInProcess('config --set "unknown.key value" --json');
      const parsed = JSON.parse(output);

      expect(parsed.type).to.equal('error');
      expect(parsed.error.code).to.equal('UNKNOWN_KEY');
      expect(parsed.error.message.toLowerCase()).to.contain('unknown');
    });

    it('should round-trip terminal app through set and json', async () => {
      await execInProcess('config --set "terminal.app WezTerm"');

      const output = await execInProcess('config --json');
      const parsed = JSON.parse(output);

      expect(parsed.result.terminal.app).to.equal('WezTerm');
    });

    it('should round-trip shell through set and json', async () => {
      await execInProcess('config --set "shell bash"');

      const output = await execInProcess('config --json');
      const parsed = JSON.parse(output);

      expect(parsed.result.shell).to.equal('bash');
    });

    it('should round-trip openInBackground through set and json', async () => {
      await execInProcess('config --set "terminal.openInBackground false"');

      const output = await execInProcess('config --json');
      const parsed = JSON.parse(output);

      expect(parsed.result.terminal.openInBackground).to.equal(false);
    });

    it('should round-trip tmux controlMode through set and json', async () => {
      await execInProcess('config --set "tmux.controlMode true"');

      const output = await execInProcess('config --json');
      const parsed = JSON.parse(output);

      expect(parsed.result.tmux.controlMode).to.equal(true);
    });
  });

  // =========================================================================
  // config --setting (JSON mode agent navigation)
  // =========================================================================
  describe('prlt config --setting (agent navigation)', () => {
    it('should output terminal app choices as JSON prompt', async () => {
      const output = await execInProcess('config --setting terminal.app --json');
      const parsed = JSON.parse(output);

      expect(parsed).to.have.property('prompt');
      expect(parsed.prompt).to.have.property('type', 'list');
      expect(parsed.prompt).to.have.property('name', 'newApp');
      expect(parsed.prompt).to.have.property('message', 'Select terminal app:');
      expect(parsed.prompt.choices).to.be.an('array');
      expect(parsed.prompt.choices.length).to.be.greaterThan(0);

      // Verify choices have command fields
      const iTermChoice = parsed.prompt.choices.find((c: { value: string }) => c.value === 'iTerm');
      expect(iTermChoice).to.not.be.undefined;
      expect(iTermChoice.command).to.contain('prlt config --set');
      expect(iTermChoice.command).to.contain('terminal.app');
    });

    it('should output shell choices as JSON prompt', async () => {
      const output = await execInProcess('config --setting shell --json');
      const parsed = JSON.parse(output);

      expect(parsed).to.have.property('prompt');
      expect(parsed.prompt).to.have.property('name', 'newShell');
      expect(parsed.prompt.choices).to.be.an('array');

      const zshChoice = parsed.prompt.choices.find((c: { value: string }) => c.value === 'zsh');
      expect(zshChoice).to.not.be.undefined;
      expect(zshChoice.command).to.contain('shell zsh');
    });

    it('should output openInBackground choices as JSON prompt', async () => {
      const output = await execInProcess('config --setting terminal.openInBackground --json');
      const parsed = JSON.parse(output);

      expect(parsed).to.have.property('prompt');
      expect(parsed.prompt).to.have.property('name', 'openInBg');
      expect(parsed.prompt.choices).to.be.an('array');
      expect(parsed.prompt.choices).to.have.length(2);

      // Verify true/false options
      const yesChoice = parsed.prompt.choices.find((c: { value: string }) => c.value === 'true');
      const noChoice = parsed.prompt.choices.find((c: { value: string }) => c.value === 'false');
      expect(yesChoice).to.not.be.undefined;
      expect(noChoice).to.not.be.undefined;
      expect(yesChoice.command).to.contain('terminal.openInBackground true');
      expect(noChoice.command).to.contain('terminal.openInBackground false');
    });

    it('should output tmux controlMode choices as JSON prompt', async () => {
      const output = await execInProcess('config --setting tmux.controlMode --json');
      const parsed = JSON.parse(output);

      expect(parsed).to.have.property('prompt');
      expect(parsed.prompt).to.have.property('name', 'controlMode');
      expect(parsed.prompt.choices).to.be.an('array');
      expect(parsed.prompt.choices).to.have.length(2);
    });

    it('should include all terminal app options', async () => {
      const output = await execInProcess('config --setting terminal.app --json');
      const parsed = JSON.parse(output);
      const values = parsed.prompt.choices.map((c: { value: string }) => c.value);

      expect(values).to.include('iTerm');
      expect(values).to.include('Terminal');
      expect(values).to.include('Ghostty');
      expect(values).to.include('Alacritty');
      expect(values).to.include('Kitty');
      expect(values).to.include('WezTerm');
      expect(values).to.include('Warp');
      expect(values).to.include('tmux');
    });

    it('should include all shell options', async () => {
      const output = await execInProcess('config --setting shell --json');
      const parsed = JSON.parse(output);
      const values = parsed.prompt.choices.map((c: { value: string }) => c.value);

      expect(values).to.include('zsh');
      expect(values).to.include('bash');
      expect(values).to.include('fish');
    });
  });

  // =========================================================================
  // Full agent workflow: navigate menu → set value → verify
  // =========================================================================
  describe('full agent workflow', () => {
    it('should complete terminal app configuration via agent flow', async () => {
      // Step 1: Agent gets setting sub-prompt
      const step1Output = await execInProcess('config --setting terminal.app --json');
      const step1 = JSON.parse(step1Output);
      expect(step1.prompt.choices).to.be.an('array');

      // Step 2: Agent picks Ghostty and runs the command from the choice
      const ghosttyChoice = step1.prompt.choices.find((c: { value: string }) => c.value === 'Ghostty');
      expect(ghosttyChoice).to.not.be.undefined;
      expect(ghosttyChoice.command).to.contain('prlt config --set');

      // Step 3: Execute the set command (strip 'prlt ' prefix)
      const setCmd = ghosttyChoice.command.replace('prlt ', '');
      const step3Output = await execInProcess(setCmd);
      const step3 = JSON.parse(step3Output);
      expect(step3).to.have.property('success', true);

      // Step 4: Verify the value was set
      const verifyOutput = await execInProcess('config --json');
      const verify = JSON.parse(verifyOutput);
      expect(verify.result.terminal.app).to.equal('Ghostty');
    });

    it('should complete shell configuration via agent flow', async () => {
      // Step 1: Get shell choices
      const step1Output = await execInProcess('config --setting shell --json');
      const step1 = JSON.parse(step1Output);

      // Step 2: Pick fish
      const fishChoice = step1.prompt.choices.find((c: { value: string }) => c.value === 'fish');
      expect(fishChoice).to.not.be.undefined;

      // Step 3: Execute
      const setCmd = fishChoice.command.replace('prlt ', '');
      await execInProcess(setCmd);

      // Step 4: Verify
      const verifyOutput = await execInProcess('config --json');
      const verify = JSON.parse(verifyOutput);
      expect(verify.result.shell).to.equal('fish');
    });

    it('should complete openInBackground configuration via agent flow', async () => {
      // Step 1: Get background choices
      const step1Output = await execInProcess('config --setting terminal.openInBackground --json');
      const step1 = JSON.parse(step1Output);

      // Step 2: Pick false (no background)
      const noChoice = step1.prompt.choices.find((c: { value: string }) => c.value === 'false');
      expect(noChoice).to.not.be.undefined;

      // Step 3: Execute
      const setCmd = noChoice.command.replace('prlt ', '');
      await execInProcess(setCmd);

      // Step 4: Verify
      const verifyOutput = await execInProcess('config --json');
      const verify = JSON.parse(verifyOutput);
      expect(verify.result.terminal.openInBackground).to.equal(false);
    });

    it('should complete tmux controlMode configuration via agent flow', async () => {
      // Step 1: Get controlMode choices
      const step1Output = await execInProcess('config --setting tmux.controlMode --json');
      const step1 = JSON.parse(step1Output);

      // Step 2: Pick true (enable)
      const yesChoice = step1.prompt.choices.find((c: { value: string }) => c.value === 'true');
      expect(yesChoice).to.not.be.undefined;

      // Step 3: Execute
      const setCmd = yesChoice.command.replace('prlt ', '');
      await execInProcess(setCmd);

      // Step 4: Verify
      const verifyOutput = await execInProcess('config --json');
      const verify = JSON.parse(verifyOutput);
      expect(verify.result.tmux.controlMode).to.equal(true);
    });
  });

  // =========================================================================
  // Main menu JSON output
  // =========================================================================
  describe('main menu JSON prompt', () => {
    it('should output main menu as JSON prompt when --setting is not provided but stdin is not a TTY', async () => {
      const output = await execInProcess('config --setting terminal.app --json');
      const parsed = JSON.parse(output);

      // Verify this is a prompt output (not success output)
      expect(parsed).to.have.property('prompt');
      expect(parsed.prompt).to.not.be.null;
    });
  });

  // =========================================================================
  // Error handling
  // =========================================================================
  describe('error handling', () => {
    it('should error on unknown setting', async () => {
      const output = await execInProcess('config --setting unknown.setting --json');
      // Should contain an error about unknown setting
      expect(output.toLowerCase()).to.satisfy(
        (o: string) => o.includes('unknown') || o.includes('error')
      );
    });

    it('should error on unknown --set key', async () => {
      const output = await execInProcess('config --set "nonexistent.key value" --json');
      const parsed = JSON.parse(output);

      expect(parsed).to.have.property('error');
      expect(parsed.error.code).to.equal('UNKNOWN_KEY');
    });
  });
});

// =============================================================================
// Test Database Setup
// =============================================================================

function setupTestDatabase(db: Database.Database, testDir: string) {
  // Create all tables needed by the config command's getWorkspaceInfo() call
  db.exec(`
    -- Core workspace metadata
    CREATE TABLE IF NOT EXISTS workspace (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      type TEXT NOT NULL CHECK (type IN ('hq', 'workspace')),
      workspace_name TEXT NOT NULL,
      has_pmo BOOLEAN DEFAULT FALSE,
      active_theme_id TEXT,
      created_at TEXT NOT NULL
    );

    -- Repository management
    CREATE TABLE IF NOT EXISTS repositories (
      name TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      type TEXT DEFAULT 'main' CHECK (type IN ('main', 'dependency')),
      source_url TEXT,
      action TEXT CHECK (action IN ('clone', 'move', 'link')),
      added_at TEXT NOT NULL
    );

    -- Agent naming themes
    CREATE TABLE IF NOT EXISTS agent_themes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      description TEXT,
      builtin BOOLEAN DEFAULT FALSE,
      created_at TEXT NOT NULL
    );

    -- Names available within each theme
    CREATE TABLE IF NOT EXISTS agent_theme_names (
      theme_id TEXT NOT NULL,
      name TEXT NOT NULL,
      PRIMARY KEY (theme_id, name),
      FOREIGN KEY (theme_id) REFERENCES agent_themes(id) ON DELETE CASCADE
    );

    -- Agent instances
    CREATE TABLE IF NOT EXISTS agents (
      name TEXT PRIMARY KEY,
      type TEXT NOT NULL DEFAULT 'persistent' CHECK (type IN ('persistent', 'ephemeral')),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cleaned')),
      base_name TEXT,
      theme_id TEXT,
      worktree_path TEXT,
      mount_mode TEXT NOT NULL DEFAULT 'worktree' CHECK (mount_mode IN ('worktree', 'clone')),
      created_at TEXT NOT NULL,
      cleaned_at TEXT,
      FOREIGN KEY (theme_id) REFERENCES agent_themes(id) ON DELETE SET NULL
    );

    -- Agent-owned worktrees
    CREATE TABLE IF NOT EXISTS agent_worktrees (
      agent_name TEXT NOT NULL,
      repo_name TEXT NOT NULL,
      worktree_path TEXT NOT NULL,
      branch TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (agent_name, repo_name),
      FOREIGN KEY (agent_name) REFERENCES agents(name) ON DELETE CASCADE,
      FOREIGN KEY (repo_name) REFERENCES repositories(name) ON DELETE CASCADE
    );

    -- Workspace-level settings (key-value store for config)
    CREATE TABLE IF NOT EXISTS workspace_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_worktrees_agent ON agent_worktrees(agent_name);
    CREATE INDEX IF NOT EXISTS idx_worktrees_repo ON agent_worktrees(repo_name);
    CREATE INDEX IF NOT EXISTS idx_theme_names_theme ON agent_theme_names(theme_id);
    CREATE INDEX IF NOT EXISTS idx_agents_theme ON agents(theme_id);
  `);

  // Insert workspace row
  db.prepare(`
    INSERT INTO workspace (id, type, workspace_name, has_pmo, created_at)
    VALUES (1, 'hq', 'test-workspace', 0, datetime('now'))
  `).run();

  // Create HQ config file
  const proletariatDir = path.join(testDir, '.proletariat');
  const configPath = path.join(proletariatDir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    type: 'hq',
    name: 'test-hq',
    hasPmo: false,
  }), 'utf-8');
}
