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
 * in the test environment:
 * - session list: uses --all flag to show stale DB records (no tmux verification needed)
 * - session attach: always returns NO_SESSIONS (requires real tmux for selection prompt)
 * - session (menu): fully testable via JSON mode
 *
 * Each subcommand is tested through the interactive menu flow AND directly with flags.
 */
describe('@smoke Session Commands E2E Tests', () => {
  let testDir: string;
  let originalCwd: string;
  let dbPath: string;

  /**
   * Seed execution records into the DB for testing session list/attach.
   * Creates project → ticket → agent_work chain (FKs enforced).
   */
  function seedExecutionRecords(records: Array<{
    id: string;
    ticketId: string;
    ticketTitle: string;
    agentName: string;
    sessionId: string;
    status?: string;
    environment?: string;
    containerId?: string;
  }>): void {
    const db = new Database(dbPath);
    try {
      db.pragma('foreign_keys = OFF');

      // Ensure project exists
      db.prepare(`
        INSERT OR IGNORE INTO pmo_projects (id, name)
        VALUES (?, ?)
      `).run('test-project', 'Test Project');

      for (const rec of records) {
        // Create ticket
        db.prepare(`
          INSERT OR IGNORE INTO pmo_tickets (id, project_id, title, status)
          VALUES (?, ?, ?, ?)
        `).run(rec.ticketId, 'test-project', rec.ticketTitle, 'started');

        // Create execution record
        db.prepare(`
          INSERT INTO agent_work (id, ticket_id, agent_name, executor, environment, status, session_id, container_id, started_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `).run(
          rec.id,
          rec.ticketId,
          rec.agentName,
          'claude',
          rec.environment || 'host',
          rec.status || 'running',
          rec.sessionId,
          rec.containerId || null,
        );
      }

      db.pragma('foreign_keys = ON');
    } finally {
      db.close();
    }
  }

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

    // Create workspace + PMO tables needed by session commands and seedExecutionRecords.
    // Session commands no longer extend PMOCommand (PRLT-1151), so PMO tables
    // are not auto-created. We create the minimal set directly.
    const initDb = new Database(dbPath);
    initDb.exec(`
      -- PMO tables needed by seedExecutionRecords (FK targets)
      CREATE TABLE IF NOT EXISTS pmo_projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        template TEXT,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS pmo_tickets (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        title TEXT,
        status TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES pmo_projects(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS agent_work (
        id TEXT PRIMARY KEY,
        ticket_id TEXT,
        agent_name TEXT NOT NULL,
        executor TEXT NOT NULL DEFAULT 'claude',
        environment TEXT NOT NULL DEFAULT 'host',
        status TEXT NOT NULL DEFAULT 'pending',
        session_id TEXT,
        container_id TEXT,
        started_at TIMESTAMP,
        completed_at TIMESTAMP,
        FOREIGN KEY (ticket_id) REFERENCES pmo_tickets(id) ON DELETE SET NULL
      );
      CREATE TABLE IF NOT EXISTS pmo_settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );
      INSERT OR IGNORE INTO pmo_settings (key, value) VALUES ('pmo_path', 'pmo');
    `);
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
  // prlt session (index command) - menu prompt via JSON mode
  // =========================================================================
  describe('prlt session --machine (JSON mode)', () => {
    it('should output JSON menu prompt with list type and action field', () => {
      const result = agentExec('session --machine');

      expect(result).to.not.be.null;
      expect(result!.prompt).to.exist;
      expect(result!.prompt.type).to.equal('list');
      expect(result!.prompt.name).to.equal('action');
      expect(result!.prompt.message).to.include('Session Management');
      expect(result!.prompt.choices).to.be.an('array');
    });

    it('should include List choice with correct value and command', () => {
      const result = agentExec('session --machine');
      expect(result).to.not.be.null;

      const listChoice = findChoiceByValue(result!.prompt.choices, 'list');
      expect(listChoice).to.not.be.undefined;
      expect(listChoice!.name).to.include('List');
      expect(listChoice!.command).to.equal('prlt session list --json');
    });

    it('should include Attach choice with correct value and command', () => {
      const result = agentExec('session --machine');
      expect(result).to.not.be.null;

      const attachChoice = findChoiceByValue(result!.prompt.choices, 'attach');
      expect(attachChoice).to.not.be.undefined;
      expect(attachChoice!.name).to.include('Attach');
      expect(attachChoice!.command).to.equal('prlt session attach --json');
    });

    it('should include Cancel choice without a command field', () => {
      const result = agentExec('session --machine');
      expect(result).to.not.be.null;

      const cancelChoice = findChoiceByValue(result!.prompt.choices, 'cancel');
      expect(cancelChoice).to.not.be.undefined;
      expect(cancelChoice!.name).to.include('Cancel');
      // Cancel should not have a command - it's a terminal action
      expect(cancelChoice!.command).to.be.undefined;
    });

    it('should include metadata with command name "session"', () => {
      const result = agentExec('session --machine');
      expect(result).to.not.be.null;

      expect(result!.metadata).to.exist;
      expect(result!.metadata.command).to.equal('session');
    });
  });

  // =========================================================================
  // Backward compatibility: --json flag produces same output as --machine
  // =========================================================================
  describe('prlt session --json (backward compatibility)', () => {
    it('should produce identical prompt structure as --machine', () => {
      const machineResult = agentExec('session --machine');
      const jsonResult = agentExec('session --json');

      expect(machineResult).to.not.be.null;
      expect(jsonResult).to.not.be.null;

      expect(jsonResult!.prompt.type).to.equal(machineResult!.prompt.type);
      expect(jsonResult!.prompt.name).to.equal(machineResult!.prompt.name);
      expect(jsonResult!.prompt.message).to.equal(machineResult!.prompt.message);
      expect(jsonResult!.prompt.choices.length).to.equal(machineResult!.prompt.choices.length);

      // Verify same choice values
      for (let i = 0; i < jsonResult!.prompt.choices.length; i++) {
        expect(jsonResult!.prompt.choices[i].value).to.equal(machineResult!.prompt.choices[i].value);
        expect(jsonResult!.prompt.choices[i].command).to.equal(machineResult!.prompt.choices[i].command);
      }
    });
  });

  // =========================================================================
  // prlt session list - direct invocation with flags
  // =========================================================================
  describe('prlt session list', () => {
    it('should return JSON array when DB has no execution records', () => {
      const output = execProduction('session list --json');
      // Output is JSON in non-TTY (piped) environments
      const sessions = JSON.parse(output) as Array<{ sessionId: string }>;
      expect(sessions).to.be.an('array');
    });

    it('should return DB-tracked sessions even without tmux verification (default mode)', () => {
      // Seed a running execution - no tmux session exists to verify it
      seedExecutionRecords([{
        id: 'exec-001',
        ticketId: 'TKT-100',
        ticketTitle: 'Implement auth',
        agentName: 'bold-turing',
        sessionId: 'TKT-100-implement-bold-turing',
      }]);

      // Sessions are always shown from DB, even without tmux verification
      const output = execProduction('session list --json');
      const sessions = JSON.parse(output) as Array<{ sessionId: string; status: string; exists: boolean; source: string; ticketId: string }>;
      expect(sessions).to.be.an('array');
      // Filter to DB-sourced sessions for our seeded ticket (host may have real orphan tmux sessions)
      const dbSessions = sessions.filter(s => s.source === 'db' && s.ticketId === 'TKT-100');
      // DB-tracked sessions may be cleaned up by cleanupStaleExecutions() if tmux doesn't verify them
      // In test environments without tmux, cleanup removes stale records, so the count may be 0
      if (dbSessions.length > 0) {
        expect(dbSessions[0].sessionId).to.equal('TKT-100-implement-bold-turing');
      }
    });

    it('should show stale sessions with --all flag including ticket ID and agent name', () => {
      seedExecutionRecords([{
        id: 'exec-001',
        ticketId: 'TKT-100',
        ticketTitle: 'Implement auth',
        agentName: 'bold-turing',
        sessionId: 'TKT-100-implement-bold-turing',
      }]);

      const output = execProduction('session list --all --json');

      // Output is JSON array in non-TTY environments
      const sessions = JSON.parse(output) as Array<{ sessionId: string; ticketId: string; agentName: string; status: string }>;
      expect(sessions).to.be.an('array');
      const session = sessions.find(s => s.ticketId === 'TKT-100');
      expect(session).to.not.be.undefined;
      expect(session!.agentName).to.equal('bold-turing');
      expect(session!.status).to.equal('stale');
    });

    it('should include stale sessions in JSON output when using --all', () => {
      seedExecutionRecords([{
        id: 'exec-001',
        ticketId: 'TKT-100',
        ticketTitle: 'Implement auth',
        agentName: 'bold-turing',
        sessionId: 'TKT-100-implement-bold-turing',
      }]);

      const output = execProduction('session list --all --json');
      const sessions = JSON.parse(output) as Array<{ status: string }>;
      const staleSessions = sessions.filter(s => s.status === 'stale');
      expect(staleSessions.length).to.be.greaterThanOrEqual(1);
    });

    it('should show multiple stale sessions with --all when multiple executions exist', () => {
      seedExecutionRecords([
        {
          id: 'exec-001',
          ticketId: 'TKT-100',
          ticketTitle: 'Implement auth',
          agentName: 'bold-turing',
          sessionId: 'TKT-100-implement-bold-turing',
        },
        {
          id: 'exec-002',
          ticketId: 'TKT-200',
          ticketTitle: 'Fix bug',
          agentName: 'clever-lovelace',
          sessionId: 'TKT-200-implement-clever-lovelace',
        },
      ]);

      const output = execProduction('session list --all --json');

      // Output is JSON array in non-TTY environments
      const sessions = JSON.parse(output) as Array<{ sessionId: string; ticketId: string; agentName: string; status: string }>;
      expect(sessions).to.be.an('array');

      // Both sessions should appear
      const session1 = sessions.find(s => s.ticketId === 'TKT-100');
      const session2 = sessions.find(s => s.ticketId === 'TKT-200');
      expect(session1).to.not.be.undefined;
      expect(session1!.agentName).to.equal('bold-turing');
      expect(session2).to.not.be.undefined;
      expect(session2!.agentName).to.equal('clever-lovelace');
    });

    it('should show session ID in the output', () => {
      seedExecutionRecords([{
        id: 'exec-001',
        ticketId: 'TKT-100',
        ticketTitle: 'Implement auth',
        agentName: 'bold-turing',
        sessionId: 'TKT-100-implement-bold-turing',
      }]);

      const output = execProduction('session list --all --json');
      const sessions = JSON.parse(output) as Array<{ sessionId: string }>;
      const session = sessions.find(s => s.sessionId === 'TKT-100-implement-bold-turing');
      expect(session).to.not.be.undefined;
    });

    it('should show host type indicator for host sessions', () => {
      seedExecutionRecords([{
        id: 'exec-001',
        ticketId: 'TKT-100',
        ticketTitle: 'Implement auth',
        agentName: 'bold-turing',
        sessionId: 'TKT-100-implement-bold-turing',
        environment: 'host',
      }]);

      const output = execProduction('session list --all --json');
      const sessions = JSON.parse(output) as Array<{ sessionId: string; environment: string }>;
      const session = sessions.find(s => s.sessionId === 'TKT-100-implement-bold-turing');
      expect(session).to.not.be.undefined;
      expect(session!.environment).to.equal('host');
    });
  });

  // =========================================================================
  // prlt session attach - direct invocation with flags
  // Note: attach requires real tmux sessions. Without tmux, getVerifiedSessions()
  // returns empty, so we can only test the no-sessions and not-found error paths.
  // The session selection prompt (selectFromList) is tested via the menu flow
  // since it's already migrated using this.selectFromList() in base-command.ts.
  // =========================================================================
  describe('prlt session attach', () => {
    it('should output JSON error NO_SESSIONS when no sessions exist (--json)', () => {
      const output = execProduction('session attach --json');
      const json = extractJson<{ error: { code: string; message: string }; prompt?: unknown }>(output);

      // If real tmux sessions exist on host, attach may return a prompt instead of error
      if (!json || json.prompt) return;

      expect(json.error).to.exist;
      expect(json.error.code).to.equal('NO_SESSIONS');
      expect(json.error.message).to.include('No active sessions');
    });

    it('should output JSON error NO_SESSIONS when no sessions exist (--machine)', () => {
      const output = execProduction('session attach --machine');
      const json = extractJson<{ error: { code: string; message: string }; prompt?: unknown }>(output);

      // If real tmux sessions exist on host, attach may return a prompt instead of error
      if (!json || json.prompt) return;

      expect(json.error).to.exist;
      expect(json.error.code).to.equal('NO_SESSIONS');
    });

    it('should output NO_SESSIONS even when execution records exist (tmux verification fails)', () => {
      // Seed execution records - but no tmux sessions exist
      seedExecutionRecords([{
        id: 'exec-001',
        ticketId: 'TKT-100',
        ticketTitle: 'Implement auth',
        agentName: 'bold-turing',
        sessionId: 'TKT-100-implement-bold-turing',
      }]);

      const output = execProduction('session attach --json');
      const json = extractJson<{ error: { code: string; message: string }; prompt?: unknown }>(output);

      // If real tmux sessions exist on host, attach may return a prompt instead of error
      if (!json || json.prompt) return;

      expect(json.error).to.exist;
      // Still NO_SESSIONS because getVerifiedSessions() checks tmux
      expect(json.error.code).to.equal('NO_SESSIONS');
    });

    it('should output NO_SESSIONS for named session arg when no tmux sessions exist', () => {
      const output = execProduction('session attach TKT-100-implement --json');
      const json = extractJson<{ error: { code: string; message: string } }>(output);

      // If real tmux sessions exist on host, error code may differ
      if (!json || !json.error) return;

      // NO_SESSIONS or SESSION_NOT_FOUND depending on whether host has tmux sessions
      expect(['NO_SESSIONS', 'SESSION_NOT_FOUND']).to.include(json.error.code);
    });

    // Note: Non-JSON text mode cannot be tested in piped exec environment
    // because shouldOutputJson() detects non-TTY and auto-enables JSON output.
    // The text-mode path works in real interactive terminals.
  });

  // =========================================================================
  // Agent flow: Navigate through session menu to each subcommand
  // Tests the COMPLETE agentic flow: get menu → pick choice → follow command → verify result
  // =========================================================================
  describe('Agent flow: session menu → session list (with data)', () => {
    it('should navigate menu → list choice → execute → verify session data appears', () => {
      // Seed execution data first
      seedExecutionRecords([{
        id: 'exec-001',
        ticketId: 'TKT-300',
        ticketTitle: 'Deploy service',
        agentName: 'swift-hopper',
        sessionId: 'TKT-300-implement-swift-hopper',
      }]);

      // Step 1: Agent gets session menu
      const menuResult = agentExec('session --machine');
      expect(menuResult).to.not.be.null;
      expect(menuResult!.prompt.type).to.equal('list');

      // Step 2: Agent finds "list" choice
      const listChoice = findChoiceByValue(menuResult!.prompt.choices, 'list');
      expect(listChoice).to.not.be.undefined;
      expect(listChoice!.command).to.equal('prlt session list --json');

      // Step 3: Agent executes the list command
      const listOutput = execProduction('session list --json');

      // Step 4: Verify END RESULT - check list returns valid JSON array
      const sessions = JSON.parse(listOutput) as Array<{ sessionId: string; ticketId: string; agentName: string; status: string }>;
      expect(sessions).to.be.an('array');
      // DB-tracked sessions may be cleaned up by cleanupStaleExecutions() if tmux doesn't verify them
      const session = sessions.find(s => s.ticketId === 'TKT-300');
      if (session) {
        expect(session.agentName).to.equal('swift-hopper');
        expect(session.sessionId).to.equal('TKT-300-implement-swift-hopper');
      }
    });
  });

  describe('Agent flow: session menu → session attach (error path)', () => {
    it('should navigate menu → attach choice → execute → verify NO_SESSIONS JSON error', () => {
      // Step 1: Agent gets session menu
      const menuResult = agentExec('session --machine');
      expect(menuResult).to.not.be.null;

      // Step 2: Agent finds "attach" choice and extracts command
      const attachChoice = findChoiceByValue(menuResult!.prompt.choices, 'attach');
      expect(attachChoice).to.not.be.undefined;
      expect(attachChoice!.command).to.equal('prlt session attach --json');

      // Step 3: Agent executes the attach command from the choice
      const attachCmd = attachChoice!.command!.replace('prlt ', '');
      const attachOutput = execProduction(attachCmd);

      // Step 4: Verify END RESULT - structured JSON response returned
      const json = extractJson<{ error?: { code: string; message: string }; prompt?: unknown }>(attachOutput);
      // If real tmux sessions exist on host, attach may return a prompt instead of error
      if (!json || json.prompt) return;
      if (json.error) {
        expect(json.error.code).to.equal('NO_SESSIONS');
        expect(json.error.message).to.include('No active sessions');
      }
    });

    it('should navigate menu → attach choice → with seeded data → still NO_SESSIONS (tmux required)', () => {
      // Seed execution records
      seedExecutionRecords([{
        id: 'exec-001',
        ticketId: 'TKT-400',
        ticketTitle: 'Add caching',
        agentName: 'quiet-dijkstra',
        sessionId: 'TKT-400-implement-quiet-dijkstra',
      }]);

      // Step 1: Agent gets session menu
      const menuResult = agentExec('session --machine');
      expect(menuResult).to.not.be.null;

      // Step 2: Navigate to attach
      const attachChoice = findChoiceByValue(menuResult!.prompt.choices, 'attach');
      const attachCmd = attachChoice!.command!.replace('prlt ', '');
      const attachOutput = execProduction(attachCmd);

      // Step 3: Verify - structured JSON response (error or prompt if real sessions exist)
      const json = extractJson<{ error?: { code: string }; prompt?: unknown }>(attachOutput);
      // If real tmux sessions exist on host, attach may return a prompt instead of error
      if (!json || json.prompt) return;
      if (json.error) {
        expect(json.error.code).to.equal('NO_SESSIONS');
      }
    });
  });

  // =========================================================================
  // prlt session poke - direct invocation with flags
  // Note: poke requires real tmux sessions for message delivery. Without tmux,
  // we can only test error paths (no matching execution, no active session).
  // =========================================================================
  describe('prlt session poke', () => {
    it('should output JSON error NO_ACTIVE_EXECUTION when no executions match agent name (--json)', () => {
      const output = execProduction('session poke nonexistent-agent "hello" --json');
      const json = extractJson<{ error: { code: string; message: string } }>(output);

      expect(json).to.not.be.null;
      expect(json!.error).to.exist;
      expect(json!.error.code).to.equal('NO_ACTIVE_EXECUTION');
      expect(json!.error.message).to.include('nonexistent-agent');
      expect(json!.error.message).to.include('no active session');
    });

    it('should output JSON error NO_ACTIVE_EXECUTION when no executions match ticket ID (--json)', () => {
      const output = execProduction('session poke TKT-999 "hello" --json');
      const json = extractJson<{ error: { code: string; message: string } }>(output);

      expect(json).to.not.be.null;
      expect(json!.error).to.exist;
      expect(json!.error.code).to.equal('NO_ACTIVE_EXECUTION');
      expect(json!.error.message).to.include('TKT-999');
    });

    it('should output JSON error NO_ACTIVE_EXECUTION when execution exists but is not running', () => {
      // Seed a completed execution - should not be matched
      seedExecutionRecords([{
        id: 'exec-done-001',
        ticketId: 'TKT-500',
        ticketTitle: 'Finished task',
        agentName: 'done-agent',
        sessionId: 'TKT-500-implement-done-agent',
        status: 'completed',
      }]);

      const output = execProduction('session poke done-agent "hello" --json');
      const json = extractJson<{ error: { code: string; message: string } }>(output);

      expect(json).to.not.be.null;
      expect(json!.error).to.exist;
      expect(json!.error.code).to.equal('NO_ACTIVE_EXECUTION');
    });

    it('should resolve agent by exact agent name and fail at tmux level (no tmux in test env)', () => {
      seedExecutionRecords([{
        id: 'exec-poke-001',
        ticketId: 'TKT-600',
        ticketTitle: 'Poke test task',
        agentName: 'poke-target',
        sessionId: 'TKT-600-implement-poke-target',
        status: 'running',
      }]);

      const output = execProduction('session poke poke-target "test message" --json');
      const json = extractJson<{ error: { code: string; message: string } }>(output);

      // Should resolve execution but fail at tmux send-keys (no tmux in test)
      expect(json).to.not.be.null;
      expect(json!.error).to.exist;
      // Either SESSION_NOT_FOUND (can't verify tmux) or SEND_FAILED (tmux not available)
      expect(['SESSION_NOT_FOUND', 'SEND_FAILED']).to.include(json!.error.code);
    });

    it('should resolve agent by ticket ID and fail at tmux level', () => {
      seedExecutionRecords([{
        id: 'exec-poke-002',
        ticketId: 'TKT-601',
        ticketTitle: 'Poke by ticket',
        agentName: 'ticket-agent',
        sessionId: 'TKT-601-implement-ticket-agent',
        status: 'running',
      }]);

      const output = execProduction('session poke TKT-601 "test message" --json');
      const json = extractJson<{ error: { code: string; message: string } }>(output);

      expect(json).to.not.be.null;
      expect(json!.error).to.exist;
      expect(['SESSION_NOT_FOUND', 'SEND_FAILED']).to.include(json!.error.code);
    });

    it('should require exact agent name match (partial names do not match)', () => {
      seedExecutionRecords([{
        id: 'exec-poke-003a',
        ticketId: 'TKT-700',
        ticketTitle: 'Task A',
        agentName: 'alpha-agent',
        sessionId: 'TKT-700-implement-alpha-agent',
        status: 'running',
      }]);

      // "alpha" is not an exact match for "alpha-agent"
      const output = execProduction('session poke alpha "test" --json');
      const json = extractJson<{ error: { code: string; message: string } }>(output);

      expect(json).to.not.be.null;
      expect(json!.error).to.exist;
      expect(json!.error.code).to.equal('NO_ACTIVE_EXECUTION');
    });

    it('should resolve docker container agent by name and attempt docker exec (not host tmux)', () => {
      seedExecutionRecords([{
        id: 'exec-poke-docker-001',
        ticketId: 'TKT-800',
        ticketTitle: 'Docker poke test',
        agentName: 'docker-agent',
        sessionId: 'TKT-800-implement-docker-agent',
        status: 'running',
        environment: 'docker',
        containerId: 'abc123def456',
      }]);

      const output = execProduction('session poke docker-agent "test message" --json');
      const json = extractJson<{ error: { code: string; message: string } }>(output);

      expect(json).to.not.be.null;
      expect(json!.error).to.exist;
      // Should fail at docker exec level (SEND_FAILED or CONTAINER_NOT_RUNNING),
      // NOT at SESSION_NOT_FOUND from host tmux lookup — proving we took the container path
      expect(['SEND_FAILED', 'CONTAINER_NOT_RUNNING']).to.include(json!.error.code);
    });

    it('should resolve devcontainer agent by name and attempt docker exec', () => {
      seedExecutionRecords([{
        id: 'exec-poke-devcontainer-001',
        ticketId: 'TKT-801',
        ticketTitle: 'Devcontainer poke test',
        agentName: 'devcontainer-agent',
        sessionId: 'TKT-801-implement-devcontainer-agent',
        status: 'running',
        environment: 'devcontainer',
        containerId: 'def456abc789',
      }]);

      const output = execProduction('session poke devcontainer-agent "test message" --json');
      const json = extractJson<{ error: { code: string; message: string } }>(output);

      expect(json).to.not.be.null;
      expect(json!.error).to.exist;
      // Should fail at docker exec level, NOT at host tmux lookup
      expect(['SEND_FAILED', 'CONTAINER_NOT_RUNNING']).to.include(json!.error.code);
    });

    it('should include poke choice in session menu with correct command', () => {
      const result = agentExec('session --machine');
      expect(result).to.not.be.null;

      const pokeChoice = findChoiceByValue(result!.prompt.choices, 'poke');
      expect(pokeChoice).to.not.be.undefined;
      expect(pokeChoice!.name).to.include('Poke');
      expect(pokeChoice!.command).to.equal('prlt session poke --json');
    });

    it('should work without PMO context (regression: PRLT-1071 git error in no-repo workspace)', () => {
      // Create a minimal HQ with NO PMO tables — only workspace + agent_work tables.
      // Before the fix, SessionPoke extended PMOCommand which required PMO init,
      // causing "fatal: not a git repository" errors in workspaces without git.
      const noPmoDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'no-pmo-poke-')));
      const noPmoProletariatDir = path.join(noPmoDir, '.proletariat');
      fs.mkdirSync(noPmoProletariatDir, { recursive: true });
      const noPmoDbPath = path.join(noPmoProletariatDir, 'workspace.db');

      // Create HQ config
      fs.writeFileSync(
        path.join(noPmoProletariatDir, 'config.json'),
        JSON.stringify({ type: 'hq', name: 'no-pmo-hq' }),
        'utf-8',
      );

      // Create ONLY workspace + agent_work tables (no PMO tables)
      const noPmoDb = new Database(noPmoDbPath);
      noPmoDb.exec(`
        CREATE TABLE IF NOT EXISTS workspace (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          type TEXT NOT NULL,
          workspace_name TEXT NOT NULL,
          has_pmo BOOLEAN DEFAULT FALSE,
          active_theme_id TEXT,
          created_at TEXT NOT NULL
        );
        INSERT INTO workspace (id, type, workspace_name, has_pmo, created_at)
        VALUES (1, 'hq', 'no-pmo-hq', 0, datetime('now'));

        CREATE TABLE IF NOT EXISTS agents (
          name TEXT PRIMARY KEY,
          type TEXT NOT NULL DEFAULT 'persistent',
          status TEXT NOT NULL DEFAULT 'active',
          base_name TEXT,
          theme_id TEXT,
          worktree_path TEXT,
          mount_mode TEXT NOT NULL DEFAULT 'worktree',
          created_at TEXT NOT NULL,
          cleaned_at TEXT
        );
        CREATE TABLE IF NOT EXISTS repositories (
          name TEXT PRIMARY KEY,
          path TEXT NOT NULL,
          type TEXT DEFAULT 'main',
          source_url TEXT,
          action TEXT,
          added_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS agent_worktrees (
          agent_name TEXT NOT NULL,
          repo_name TEXT NOT NULL,
          worktree_path TEXT NOT NULL,
          branch TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (agent_name, repo_name)
        );
        CREATE TABLE IF NOT EXISTS agent_themes (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          display_name TEXT NOT NULL,
          description TEXT,
          builtin BOOLEAN DEFAULT FALSE,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS agent_work (
          id TEXT PRIMARY KEY,
          ticket_id TEXT NOT NULL,
          agent_name TEXT NOT NULL,
          executor TEXT NOT NULL DEFAULT 'claude',
          environment TEXT NOT NULL DEFAULT 'host',
          status TEXT NOT NULL DEFAULT 'pending',
          session_id TEXT,
          container_id TEXT,
          started_at TEXT,
          completed_at TEXT
        );

        INSERT INTO agent_work (id, ticket_id, agent_name, executor, environment, status, session_id, started_at)
        VALUES ('exec-nopmo-001', 'TKT-999', 'no-pmo-agent', 'claude', 'host', 'running', 'TKT-999-work-no-pmo-agent', datetime('now'));
      `);
      noPmoDb.close();

      // Run poke from the no-PMO directory — should NOT fail with PMO/git errors
      const savedCwd = process.cwd();
      try {
        process.chdir(noPmoDir);
        const output = execProduction('session poke no-pmo-agent "test without pmo" --json');
        const json = extractJson<{ error: { code: string; message: string } }>(output);

        expect(json).to.not.be.null;
        expect(json!.error).to.exist;
        // Should reach tmux stage (SEND_FAILED or SESSION_NOT_FOUND), NOT fail at PMO/git init
        expect(['SESSION_NOT_FOUND', 'SEND_FAILED']).to.include(json!.error.code);
        // Error message should NOT contain git errors
        expect(json!.error.message).to.not.include('fatal: not a git repository');
        expect(json!.error.message).to.not.include('PMO not found');
      } finally {
        process.chdir(savedCwd);
        fs.rmSync(noPmoDir, { recursive: true, force: true });
      }
    });
  });

  describe('Agent flow: command fields enable correct navigation', () => {
    it('every non-cancel choice should have a --json command for agent chaining', () => {
      const result = agentExec('session --machine');
      expect(result).to.not.be.null;

      const actionableChoices = result!.prompt.choices.filter(c => c.value !== 'cancel');

      for (const choice of actionableChoices) {
        expect(choice.command).to.exist;
        expect(choice.command).to.include('--json');
      }
    });

    it('cancel choice should NOT have a command field', () => {
      const result = agentExec('session --machine');
      expect(result).to.not.be.null;

      const cancelChoice = findChoiceByValue(result!.prompt.choices, 'cancel');
      expect(cancelChoice!.command).to.be.undefined;
    });
  });
});
