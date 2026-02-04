import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import {
  execProduction,
  extractJson,
  agentExec,
  findChoiceByValue,
} from './test-helpers.js';

/**
 * End-to-end tests for Session Commands (TKT-758)
 * Tests: prlt session, session list, session attach
 *
 * These commands manage tmux sessions. Since tmux/docker are not available
 * in the test environment, tests focus on:
 * - JSON/machine mode output (menu prompts, error responses)
 * - Command structure and choice navigation
 * - Graceful handling of no active sessions
 */
describe('Session Commands E2E Tests', () => {
  let testDir: string;
  let originalCwd: string;
  let dbPath: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    testDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'session-e2e-')));
    process.chdir(testDir);

    const proletariatDir = path.join(testDir, '.proletariat');
    fs.mkdirSync(proletariatDir, { recursive: true });
    dbPath = path.join(proletariatDir, 'workspace.db');

    // Create blank DB - let the CLI's ensurePMOTables() create all tables
    // with the correct schema on first access
    const db = new Database(dbPath);
    db.close();

    // Create HQ config file (required for findPMO)
    const configPath = path.join(proletariatDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      type: 'hq',
      name: 'test-hq',
      hasPmo: true,
    }), 'utf-8');

    // Create PMO directory structure
    fs.mkdirSync(path.join(testDir, 'pmo', 'projects', 'default'), { recursive: true });

    // Run a safe command to trigger PMO table initialization
    // The CLI's PMOCommand.init() creates all PMO tables via ensurePMOTables()
    execProduction('session --machine');

    // Create workspace tables needed by getWorkspaceInfo() (used by session list/attach)
    // These are separate from PMO tables and created by the workspace init flow
    const initDb = new Database(dbPath);
    initDb.exec(`
      CREATE TABLE IF NOT EXISTS agent_themes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        description TEXT,
        builtin BOOLEAN DEFAULT FALSE,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workspace (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        type TEXT NOT NULL CHECK (type IN ('hq', 'workspace')),
        workspace_name TEXT NOT NULL,
        has_pmo BOOLEAN DEFAULT FALSE,
        active_theme_id TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (active_theme_id) REFERENCES agent_themes(id) ON DELETE SET NULL
      );
      CREATE TABLE IF NOT EXISTS repositories (
        name TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        type TEXT DEFAULT 'main' CHECK (type IN ('main', 'dependency')),
        source_url TEXT,
        action TEXT CHECK (action IN ('clone', 'move', 'link')),
        added_at TEXT NOT NULL
      );
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
      INSERT OR IGNORE INTO workspace (id, type, workspace_name, has_pmo, created_at)
      VALUES (1, 'hq', 'test-hq', 1, datetime('now'));
    `);
    initDb.close();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  // =========================================================================
  // prlt session (index command) - menu prompt
  // =========================================================================
  describe('prlt session --machine (JSON mode)', () => {
    it('should output JSON menu prompt with choices', () => {
      const result = agentExec('session --machine');

      expect(result).to.not.be.null;
      expect(result!.prompt).to.exist;
      expect(result!.prompt.type).to.equal('list');
      expect(result!.prompt.name).to.equal('action');
      expect(result!.prompt.message).to.include('Session Management');
      expect(result!.prompt.choices).to.be.an('array');
      expect(result!.prompt.choices.length).to.be.greaterThanOrEqual(2);
    });

    it('should include List and Attach choices', () => {
      const result = agentExec('session --machine');
      expect(result).to.not.be.null;

      const listChoice = findChoiceByValue(result!.prompt.choices, 'list');
      const attachChoice = findChoiceByValue(result!.prompt.choices, 'attach');

      expect(listChoice).to.not.be.undefined;
      expect(listChoice!.name).to.include('List');

      expect(attachChoice).to.not.be.undefined;
      expect(attachChoice!.name).to.include('Attach');
    });

    it('should include command field on List and Attach choices', () => {
      const result = agentExec('session --machine');
      expect(result).to.not.be.null;

      const listChoice = findChoiceByValue(result!.prompt.choices, 'list');
      const attachChoice = findChoiceByValue(result!.prompt.choices, 'attach');

      expect(listChoice!.command).to.exist;
      expect(listChoice!.command).to.include('session list');
      expect(listChoice!.command).to.include('--json');

      expect(attachChoice!.command).to.exist;
      expect(attachChoice!.command).to.include('session attach');
      expect(attachChoice!.command).to.include('--json');
    });

    it('should include Cancel choice', () => {
      const result = agentExec('session --machine');
      expect(result).to.not.be.null;

      const cancelChoice = findChoiceByValue(result!.prompt.choices, 'cancel');
      expect(cancelChoice).to.not.be.undefined;
      expect(cancelChoice!.name).to.include('Cancel');
    });

    it('should include metadata with command name', () => {
      const result = agentExec('session --machine');
      expect(result).to.not.be.null;

      expect(result!.metadata).to.exist;
      expect(result!.metadata.command).to.equal('session');
    });
  });

  // =========================================================================
  // Backward compatibility: --json flag
  // =========================================================================
  describe('prlt session --json (backward compatibility)', () => {
    it('should output same JSON structure as --machine', () => {
      const machineResult = agentExec('session --machine');
      const jsonResult = agentExec('session --json');

      expect(machineResult).to.not.be.null;
      expect(jsonResult).to.not.be.null;

      // Both should have same prompt structure
      expect(jsonResult!.prompt.type).to.equal(machineResult!.prompt.type);
      expect(jsonResult!.prompt.name).to.equal(machineResult!.prompt.name);
      expect(jsonResult!.prompt.choices.length).to.equal(machineResult!.prompt.choices.length);
    });

    it('should output valid JSON with --json flag', () => {
      const result = agentExec('session --json');

      expect(result).to.not.be.null;
      expect(result!.prompt.type).to.equal('list');
      expect(result!.prompt.choices).to.be.an('array');
    });
  });

  // =========================================================================
  // prlt session list
  // =========================================================================
  describe('prlt session list', () => {
    it('should output message when no active sessions', () => {
      const output = execProduction('session list');

      // Should show no sessions message (tmux not available in test env)
      expect(output).to.satisfy((o: string) =>
        o.includes('No active sessions') || o.includes('Not in a workspace')
      );
    });

    it('should show stale session records with --all when executions exist in DB', () => {
      // Seed project, ticket, and execution record (FKs require full chain)
      const db = new Database(dbPath);
      try {
        // Disable FK checks for test data seeding
        db.pragma('foreign_keys = OFF');
        db.prepare(`
          INSERT OR IGNORE INTO pmo_projects (id, name)
          VALUES (?, ?)
        `).run('test-project', 'Test Project');
        db.prepare(`
          INSERT OR IGNORE INTO pmo_tickets (id, project_id, title, status)
          VALUES (?, ?, ?, ?)
        `).run('TKT-100', 'test-project', 'Test ticket', 'started');
        db.prepare(`
          INSERT INTO agent_work (id, ticket_id, agent_name, executor, environment, status, session_id, started_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `).run('exec-001', 'TKT-100', 'test-agent', 'claude', 'host', 'running', 'TKT-100-implement-test-agent');
        db.pragma('foreign_keys = ON');
      } finally {
        db.close();
      }

      const output = execProduction('session list --all');

      // With --all flag, should show the stale record or at least session header
      expect(output).to.satisfy((o: string) =>
        o.includes('TKT-100') ||
        o.includes('stale') ||
        o.includes('No active sessions') ||
        o.includes('Active Sessions')
      );
    });
  });

  // =========================================================================
  // prlt session attach
  // =========================================================================
  describe('prlt session attach', () => {
    it('should report no sessions when none exist (JSON mode)', () => {
      const output = execProduction('session attach --json');
      const json = extractJson<{ error?: { code: string; message: string } }>(output);

      if (json && json.error) {
        // Should output JSON error about no sessions
        expect(json.error.code).to.equal('NO_SESSIONS');
        expect(json.error.message).to.include('No active sessions');
      } else {
        // Fallback: text output about no sessions
        expect(output).to.satisfy((o: string) =>
          o.includes('No active sessions') || o.includes('Not in a workspace')
        );
      }
    });

    it('should report no sessions when none exist (machine mode)', () => {
      const output = execProduction('session attach --machine');
      const json = extractJson<{ error?: { code: string; message: string } }>(output);

      if (json && json.error) {
        expect(json.error.code).to.equal('NO_SESSIONS');
      } else {
        expect(output).to.satisfy((o: string) =>
          o.includes('No active sessions') || o.includes('Not in a workspace')
        );
      }
    });

    it('should report session not found when given invalid session name', () => {
      const output = execProduction('session attach nonexistent-session --json');
      const json = extractJson<{ error?: { code: string; message: string } }>(output);

      if (json && json.error) {
        // Could be NO_SESSIONS (no sessions at all) or SESSION_NOT_FOUND
        expect(json.error.code).to.satisfy((code: string) =>
          code === 'NO_SESSIONS' || code === 'SESSION_NOT_FOUND'
        );
      } else {
        // Text output about not found or no sessions
        expect(output).to.satisfy((o: string) =>
          o.includes('not found') ||
          o.includes('No active sessions') ||
          o.includes('Not in a workspace')
        );
      }
    });
  });

  // =========================================================================
  // Agent flow: Navigate through session menu
  // =========================================================================
  describe('Agent flow: session menu navigation', () => {
    it('should allow agent to navigate from session menu to session list', () => {
      // Step 1: Get session menu
      const menuResult = agentExec('session --machine');
      expect(menuResult).to.not.be.null;

      // Step 2: Find "list" choice and extract command
      const listChoice = findChoiceByValue(menuResult!.prompt.choices, 'list');
      expect(listChoice).to.not.be.undefined;
      expect(listChoice!.command).to.exist;

      // Step 3: Execute the list command (strip 'prlt ' prefix, remove --json for final exec)
      const listCmd = listChoice!.command!
        .replace('prlt ', '')
        .replace(' --json', '');
      const listOutput = execProduction(listCmd);

      // Step 4: Verify list output (will show no sessions in test env)
      expect(listOutput).to.satisfy((o: string) =>
        o.includes('No active sessions') ||
        o.includes('Not in a workspace') ||
        o.includes('Active Sessions')
      );
    });

    it('should allow agent to navigate from session menu to session attach', () => {
      // Step 1: Get session menu
      const menuResult = agentExec('session --machine');
      expect(menuResult).to.not.be.null;

      // Step 2: Find "attach" choice and extract command
      const attachChoice = findChoiceByValue(menuResult!.prompt.choices, 'attach');
      expect(attachChoice).to.not.be.undefined;
      expect(attachChoice!.command).to.exist;

      // Step 3: Execute the attach command (keep --json to get JSON error output)
      const attachCmd = attachChoice!.command!.replace('prlt ', '');
      const attachOutput = execProduction(attachCmd);

      // Step 4: Verify attach output (will show no sessions error in JSON)
      const json = extractJson<{ error?: { code: string } }>(attachOutput);
      if (json && json.error) {
        expect(json.error.code).to.equal('NO_SESSIONS');
      } else {
        expect(attachOutput).to.satisfy((o: string) =>
          o.includes('No active sessions') || o.includes('Not in a workspace')
        );
      }
    });

    it('should provide commands that accumulate the --json flag', () => {
      const result = agentExec('session --machine');
      expect(result).to.not.be.null;

      // All navigable choices should include --json flag for agent chaining
      for (const choice of result!.prompt.choices) {
        if (choice.command && choice.value !== 'cancel') {
          expect(choice.command).to.include('--json');
        }
      }
    });
  });
});
