import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { exec } from './test-helpers.js';

/** Database row types for theme queries */
interface ThemeRow {
  id: string;
  name: string;
  display_name: string;
  description: string | null;
  builtin: number;
  created_at: string;
}

interface ThemeNameRow {
  name: string;
  theme_id?: string;
}

interface AgentRow {
  name: string;
  theme_id: string | null;
  created_at: string;
}

interface CountRow {
  count: number;
}

/**
 * End-to-end tests for Agent Theme Commands
 * Tests theme creation, listing, name management, and case-insensitive uniqueness
 */
describe('Agent Theme Commands E2E Tests', () => {
  let testDir: string;
  let originalCwd: string;
  let dbPath: string;
  let db: Database.Database;

  beforeEach(() => {
    originalCwd = process.cwd();
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'theme-e2e-'));
    process.chdir(testDir);

    // Setup test environment
    const proletariatDir = path.join(testDir, '.proletariat');
    fs.mkdirSync(proletariatDir, { recursive: true });
    dbPath = path.join(proletariatDir, 'workspace.db');

    db = new Database(dbPath);
    setupTestDatabase(db);
  });

  afterEach(() => {
    if (db) db.close();
    process.chdir(originalCwd);
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('prlt agents themes list', () => {
    it('should list built-in themes after seeding', () => {
      const output = exec('agents themes list');

      expect(output).to.contain('Billionaires');
      expect(output).to.contain('Toyota');
      expect(output).to.contain('Company');
    });

    it('should show available name counts', () => {
      const output = exec('agents themes list');

      expect(output).to.contain('available');
    });

    it('should show custom themes after creation', () => {
      // Create a custom theme
      exec('agents themes create greek-gods');

      const output = exec('agents themes list');

      expect(output).to.contain('greek-gods');
    });
  });

  describe('prlt agents themes create', () => {
    it('should create a custom theme', () => {
      const output = exec('agents themes create my-team');

      expect(output).to.contain('Created theme');
      expect(output).to.contain('my-team');

      // Verify in database
      const theme = db.prepare('SELECT * FROM agent_themes WHERE id = ?').get('my-team') as ThemeRow | undefined;
      expect(theme).to.exist;
      expect(theme!.name).to.equal('my-team');
    });

    it('should auto-format display name from ID', () => {
      exec('agents themes create cool-names');

      const theme = db.prepare('SELECT display_name FROM agent_themes WHERE id = ?').get('cool-names') as Pick<ThemeRow, 'display_name'> | undefined;
      expect(theme?.display_name).to.equal('Cool Names');
    });

    it('should use custom display name when provided', () => {
      exec('agents themes create test-theme --display-name "My Custom Theme"');

      const theme = db.prepare('SELECT display_name FROM agent_themes WHERE id = ?').get('test-theme') as Pick<ThemeRow, 'display_name'> | undefined;
      expect(theme?.display_name).to.equal('My Custom Theme');
    });

    it('should not allow duplicate theme IDs', () => {
      exec('agents themes create unique-theme');
      const output = exec('agents themes create unique-theme');

      expect(output.toLowerCase()).to.contain('already exists');
    });
  });

  describe('prlt agents themes add-names', () => {
    it('should add names to a theme', () => {
      exec('agents themes create test-theme');
      const output = exec('agents themes add-names test-theme alice bob charlie');

      expect(output).to.contain('Added');
      expect(output).to.contain('3');

      // Verify in database
      const names = db.prepare('SELECT name FROM agent_theme_names WHERE theme_id = ?').all('test-theme') as ThemeNameRow[];
      expect(names).to.have.lengthOf(3);
      expect(names.map(n => n.name)).to.include.members(['alice', 'bob', 'charlie']);
    });

    it('should preserve case but convert spaces to dashes', () => {
      exec('agents themes create test-theme');
      exec('agents themes add-names test-theme Alice BOB "Mary Jane"');

      const names = db.prepare('SELECT name FROM agent_theme_names WHERE theme_id = ?').all('test-theme') as ThemeNameRow[];
      const nameList = names.map(n => n.name);

      // Names preserve case but spaces are converted to dashes
      expect(nameList).to.include('Alice');
      expect(nameList).to.include('BOB');
      expect(nameList).to.include('Mary-Jane');
    });

    it('should prevent duplicate names (case-insensitive)', () => {
      exec('agents themes create test-theme');
      exec('agents themes add-names test-theme alice');
      exec('agents themes add-names test-theme ALICE Alice');

      // Should only have one 'alice'
      const names = db.prepare('SELECT name FROM agent_theme_names WHERE theme_id = ?').all('test-theme') as ThemeNameRow[];
      expect(names).to.have.lengthOf(1);
    });

    it('should error for non-existent theme', () => {
      const output = exec('agents themes add-names nonexistent-theme name1');

      expect(output.toLowerCase()).to.contain('not found');
    });
  });

  describe('Case-insensitive agent uniqueness', () => {
    it('should prevent adding agent with same name different case', () => {
      // First add an agent
      db.prepare('INSERT INTO agents (name, created_at) VALUES (?, ?)').run('TestAgent', new Date().toISOString());

      // Try to add same agent with different case - should be skipped
      db.prepare(`
        INSERT OR IGNORE INTO agents (name, created_at)
        SELECT ?, ?
        WHERE NOT EXISTS (SELECT 1 FROM agents WHERE LOWER(name) = LOWER(?))
      `).run('testagent', new Date().toISOString(), 'testagent');

      const agents = db.prepare('SELECT name FROM agents').all() as Pick<AgentRow, 'name'>[];
      expect(agents).to.have.lengthOf(1);
      expect(agents[0].name).to.equal('TestAgent');
    });
  });

  describe('Built-in theme protection', () => {
    it('should seed built-in themes on first access', () => {
      // List triggers seeding
      exec('agents themes list');

      const themes = db.prepare('SELECT * FROM agent_themes WHERE builtin = 1').all() as ThemeRow[];
      expect(themes.length).to.be.greaterThan(0);

      const themeIds = themes.map(t => t.id);
      expect(themeIds).to.include('billionaires');
      expect(themeIds).to.include('toyotas');
      expect(themeIds).to.include('companies');
    });

    it('should have names for built-in themes', () => {
      exec('agents themes list');

      const billionaireNames = db.prepare('SELECT COUNT(*) as count FROM agent_theme_names WHERE theme_id = ?').get('billionaires') as CountRow | undefined;
      expect(billionaireNames?.count).to.be.greaterThan(0);
    });
  });
});

// Helper functions
function setupTestDatabase(db: Database.Database) {
  // Create workspace schema
  db.exec(`
    -- Workspace table
    CREATE TABLE IF NOT EXISTS workspace (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      type TEXT NOT NULL CHECK (type IN ('hq', 'workspace')),
      workspace_name TEXT NOT NULL,
      has_pmo BOOLEAN DEFAULT FALSE,
      created_at TEXT NOT NULL
    );

    -- Repositories table
    CREATE TABLE IF NOT EXISTS repositories (
      name TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      type TEXT DEFAULT 'main',
      source_url TEXT,
      action TEXT,
      added_at TEXT NOT NULL
    );

    -- Agent themes table
    CREATE TABLE IF NOT EXISTS agent_themes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      description TEXT,
      builtin BOOLEAN DEFAULT FALSE,
      created_at TEXT NOT NULL
    );

    -- Agent theme names table
    CREATE TABLE IF NOT EXISTS agent_theme_names (
      theme_id TEXT NOT NULL,
      name TEXT NOT NULL,
      PRIMARY KEY (theme_id, name),
      FOREIGN KEY (theme_id) REFERENCES agent_themes(id) ON DELETE CASCADE
    );

    -- Agents table
    CREATE TABLE IF NOT EXISTS agents (
      name TEXT PRIMARY KEY,
      theme_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (theme_id) REFERENCES agent_themes(id) ON DELETE SET NULL
    );

    -- Agent worktrees table
    CREATE TABLE IF NOT EXISTS agent_worktrees (
      agent_name TEXT NOT NULL,
      repo_name TEXT NOT NULL,
      worktree_path TEXT NOT NULL,
      branch TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (agent_name, repo_name)
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_theme_names_theme ON agent_theme_names(theme_id);
    CREATE INDEX IF NOT EXISTS idx_agents_theme ON agents(theme_id);
  `);

  // Insert workspace config
  db.prepare(`
    INSERT INTO workspace (id, type, workspace_name, has_pmo, created_at)
    VALUES (1, 'hq', 'test-workspace', 0, ?)
  `).run(new Date().toISOString());

  // Create config file
  const proletariatDir = path.join(process.cwd(), '.proletariat');
  const configPath = path.join(proletariatDir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    version: '1.0.0',
    schemaVersion: 1
  }), 'utf-8');
}

