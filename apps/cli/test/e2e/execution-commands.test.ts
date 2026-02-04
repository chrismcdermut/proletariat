import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { exec, extractJson, type AgentPromptResponse } from './test-helpers.js';

/**
 * End-to-end tests for Execution Commands (migrated to this.prompt())
 * Tests: prlt execution list, logs, stop, and the main execution menu
 *
 * These tests exercise the COMPLETE agentic flow end-to-end:
 * - Use flags/args to bypass interactive prompts
 * - Verify JSON mode outputs proper prompt schema with choices
 * - Verify end results (DB state, output content)
 */
describe('Execution Commands E2E Tests', () => {
  let testDir: string;
  let originalCwd: string;
  let dbPath: string;
  let db: Database.Database;

  beforeEach(() => {
    executionCounter = 0; // Reset counter between tests
    originalCwd = process.cwd();
    testDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'execution-e2e-')));
    process.chdir(testDir);

    // Setup test environment
    const proletariatDir = path.join(testDir, '.proletariat');
    const logsDir = path.join(proletariatDir, 'logs');
    fs.mkdirSync(logsDir, { recursive: true });

    // Create agents directory (needed for getWorkspaceInfo agent discovery)
    const agentsDir = path.join(testDir, 'agents', 'staff');
    fs.mkdirSync(agentsDir, { recursive: true });

    // Create PMO directory structure (needed for PMOCommand init)
    const pmoDir = path.join(testDir, 'pmo', 'projects', 'test-project');
    fs.mkdirSync(pmoDir, { recursive: true });

    // Create config.json (needed for findPMO fallback)
    const configPath = path.join(proletariatDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      type: 'hq',
      name: 'test-hq',
      hasPmo: true,
    }), 'utf-8');

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

  // =========================================================================
  // execution (main menu) - JSON mode
  // =========================================================================
  describe('prlt execution --json', () => {
    it('should output JSON prompt schema with menu choices', () => {
      const output = exec('execution --json');
      const json = extractJson<AgentPromptResponse>(output);

      expect(json).to.not.be.null;
      expect(json!.prompt).to.exist;
      expect(json!.prompt.type).to.equal('list');
      expect(json!.prompt.name).to.equal('action');
      expect(json!.prompt.message).to.include('What would you like to do');
      expect(json!.prompt.choices).to.be.an('array');
      expect(json!.prompt.choices.length).to.be.greaterThanOrEqual(4);
    });

    it('should include command field in each choice for agent navigation', () => {
      const output = exec('execution --json');
      const json = extractJson<AgentPromptResponse>(output);

      expect(json).to.not.be.null;
      const choices = json!.prompt.choices;

      // Verify key choices exist with command fields
      const listChoice = choices.find(c => c.value === 'list');
      expect(listChoice).to.exist;
      expect(listChoice!.command).to.include('prlt execution list');

      const logsChoice = choices.find(c => c.value === 'logs');
      expect(logsChoice).to.exist;
      expect(logsChoice!.command).to.include('prlt execution logs');

      const stopChoice = choices.find(c => c.value === 'stop');
      expect(stopChoice).to.exist;
      expect(stopChoice!.command).to.include('prlt execution stop');

      const stopAllChoice = choices.find(c => c.value === 'stop-all');
      expect(stopAllChoice).to.exist;
      expect(stopAllChoice!.command).to.include('prlt execution stop --all');
    });

    it('should include metadata with command name', () => {
      const output = exec('execution --json');
      const json = extractJson<AgentPromptResponse>(output);

      expect(json).to.not.be.null;
      expect(json!.metadata).to.exist;
      expect(json!.metadata.command).to.equal('execution');
    });
  });

  // =========================================================================
  // execution list
  // =========================================================================
  describe('prlt execution list', () => {
    it('should list executions when they exist', () => {
      createExecution(db, 'TKT-001', 'agent-1', 'running');
      createExecution(db, 'TKT-002', 'agent-2', 'completed');

      const output = exec('execution list');

      expect(output).to.contain('WORK-');
      expect(output).to.contain('agent-1');
      expect(output).to.contain('agent-2');
      expect(output).to.contain('TKT-001');
      expect(output).to.contain('TKT-002');
    });

    it('should show empty message when no executions', () => {
      const output = exec('execution list');

      expect(output).to.contain('No executions found');
    });

    it('should filter by --status running', () => {
      createExecution(db, 'TKT-001', 'agent-1', 'running');
      createExecution(db, 'TKT-002', 'agent-2', 'completed');

      const output = exec('execution list --status running');

      expect(output).to.contain('agent-1');
      expect(output).not.to.contain('agent-2');
    });

    it('should filter by --status completed', () => {
      createExecution(db, 'TKT-001', 'agent-1', 'running');
      createExecution(db, 'TKT-002', 'agent-2', 'completed');

      const output = exec('execution list --status completed');

      expect(output).not.to.contain('agent-1');
      expect(output).to.contain('agent-2');
    });

    it('should filter by --agent', () => {
      createExecution(db, 'TKT-001', 'agent-1', 'running');
      createExecution(db, 'TKT-002', 'agent-2', 'running');

      const output = exec('execution list --agent agent-1');

      expect(output).to.contain('agent-1');
      expect(output).not.to.contain('agent-2');
    });

    it('should respect --limit flag', () => {
      for (let i = 1; i <= 5; i++) {
        createExecution(db, `TKT-${String(i).padStart(3, '0')}`, 'agent-1', 'completed');
      }

      const output = exec('execution list --limit 2');
      // Count occurrences of WORK- pattern (each execution starts with WORK-)
      const matches = output.match(/WORK-/g) || [];
      expect(matches.length).to.equal(2);
    });
  });

  // =========================================================================
  // execution logs
  // =========================================================================
  describe('prlt execution logs', () => {
    it('should display logs for an execution with a log file', () => {
      const logPath = path.join(testDir, '.proletariat', 'logs', 'work-WORK-001.log');
      fs.writeFileSync(logPath, 'Line 1: Starting agent\nLine 2: Processing ticket\nLine 3: Done\n');
      createExecution(db, 'TKT-001', 'agent-1', 'running', { log_path: logPath });

      const output = exec('execution logs WORK-001');

      expect(output).to.contain('Line 1: Starting agent');
      expect(output).to.contain('Line 2: Processing ticket');
      expect(output).to.contain('Line 3: Done');
    });

    it('should show message when execution has no log file', () => {
      createExecution(db, 'TKT-001', 'agent-1', 'running');

      const output = exec('execution logs WORK-001');

      expect(output).to.contain('No log file');
    });

    it('should error when execution not found', () => {
      const output = exec('execution logs NONEXISTENT');

      expect(output.toLowerCase()).to.contain('not found');
    });

    it('should output JSON prompt with execution choices when no ID given', () => {
      createExecution(db, 'TKT-001', 'agent-1', 'running');
      createExecution(db, 'TKT-002', 'agent-2', 'completed');

      const output = exec('execution logs --json');
      const json = extractJson<AgentPromptResponse>(output);

      expect(json).to.not.be.null;
      expect(json!.prompt).to.exist;
      expect(json!.prompt.type).to.equal('list');
      expect(json!.prompt.name).to.equal('selectedId');
      expect(json!.prompt.message).to.include('Select execution to view logs');
      expect(json!.prompt.choices).to.be.an('array');
      expect(json!.prompt.choices.length).to.equal(2);
    });

    it('should include command field in JSON execution choices', () => {
      createExecution(db, 'TKT-001', 'agent-1', 'running');

      const output = exec('execution logs --json');
      const json = extractJson<AgentPromptResponse>(output);

      expect(json).to.not.be.null;
      const choice = json!.prompt.choices[0];
      expect(choice.command).to.exist;
      expect(choice.command).to.include('prlt execution logs');
      expect(choice.command).to.include('WORK-001');
      expect(choice.command).to.include('--json');
    });

    it('should include metadata in JSON output', () => {
      createExecution(db, 'TKT-001', 'agent-1', 'running');

      const output = exec('execution logs --json');
      const json = extractJson<AgentPromptResponse>(output);

      expect(json).to.not.be.null;
      expect(json!.metadata).to.exist;
      expect(json!.metadata.command).to.equal('execution logs');
    });
  });

  // =========================================================================
  // execution stop
  // =========================================================================
  describe('prlt execution stop', () => {
    it('should stop a running execution by ID', () => {
      createExecution(db, 'TKT-001', 'agent-1', 'running');

      const output = exec('execution stop WORK-001');

      expect(output).to.contain('Stopped');
      expect(output).to.contain('WORK-001');

      // Verify DB state updated
      const row = db.prepare('SELECT status FROM agent_work WHERE id = ?').get('WORK-001') as { status: string };
      expect(row.status).to.equal('stopped');
    });

    it('should show message when execution is already stopped', () => {
      createExecution(db, 'TKT-001', 'agent-1', 'stopped');

      const output = exec('execution stop WORK-001');

      expect(output).to.contain('not running');
    });

    it('should error when execution not found', () => {
      const output = exec('execution stop NONEXISTENT');

      expect(output.toLowerCase()).to.contain('not found');
    });

    it('should stop all running executions with --all flag', () => {
      createExecution(db, 'TKT-001', 'agent-1', 'running');
      createExecution(db, 'TKT-002', 'agent-2', 'running');

      const output = exec('execution stop --all');

      expect(output).to.contain('Stopping 2 execution(s)');

      // Verify DB state
      const rows = db.prepare('SELECT status FROM agent_work WHERE status = ?').all('stopped') as { status: string }[];
      expect(rows.length).to.equal(2);
    });

    it('should stop executions by agent with --agent flag', () => {
      createExecution(db, 'TKT-001', 'agent-1', 'running');
      createExecution(db, 'TKT-002', 'agent-2', 'running');

      const output = exec('execution stop --agent agent-1');

      expect(output).to.contain('Stopping 1 execution(s)');

      // Verify only agent-1's execution was stopped
      const agent1 = db.prepare('SELECT status FROM agent_work WHERE agent_name = ?').get('agent-1') as { status: string };
      expect(agent1.status).to.equal('stopped');

      const agent2 = db.prepare('SELECT status FROM agent_work WHERE agent_name = ?').get('agent-2') as { status: string };
      expect(agent2.status).to.equal('running');
    });

    it('should show empty message when no running executions to stop', () => {
      const output = exec('execution stop --all');

      expect(output).to.contain('No running executions');
    });

    it('should output JSON prompt with execution choices when no ID given', () => {
      createExecution(db, 'TKT-001', 'agent-1', 'running');
      createExecution(db, 'TKT-002', 'agent-2', 'starting');

      const output = exec('execution stop --json');
      const json = extractJson<AgentPromptResponse>(output);

      expect(json).to.not.be.null;
      expect(json!.prompt).to.exist;
      expect(json!.prompt.type).to.equal('list');
      expect(json!.prompt.name).to.equal('selectedId');
      expect(json!.prompt.message).to.include('Select execution to stop');
      expect(json!.prompt.choices).to.be.an('array');
      expect(json!.prompt.choices.length).to.equal(2);
    });

    it('should include command field in JSON stop choices', () => {
      createExecution(db, 'TKT-001', 'agent-1', 'running');

      const output = exec('execution stop --json');
      const json = extractJson<AgentPromptResponse>(output);

      expect(json).to.not.be.null;
      const choice = json!.prompt.choices[0];
      expect(choice.command).to.exist;
      expect(choice.command).to.include('prlt execution stop');
      expect(choice.command).to.include('WORK-001');
      expect(choice.command).to.include('--json');
    });

    it('should include metadata in JSON output', () => {
      createExecution(db, 'TKT-001', 'agent-1', 'running');

      const output = exec('execution stop --json');
      const json = extractJson<AgentPromptResponse>(output);

      expect(json).to.not.be.null;
      expect(json!.metadata).to.exist;
      expect(json!.metadata.command).to.equal('execution stop');
    });

    it('should also include starting executions in stop list', () => {
      createExecution(db, 'TKT-001', 'agent-1', 'starting');

      const output = exec('execution stop --json');
      const json = extractJson<AgentPromptResponse>(output);

      expect(json).to.not.be.null;
      expect(json!.prompt.choices.length).to.equal(1);
      expect(json!.prompt.choices[0].name).to.contain('WORK-001');
    });
  });
});

// =============================================================================
// Helper Functions
// =============================================================================

function setupTestDatabase(db: Database.Database) {
  // Workspace tables (needed for getWorkspaceInfo)
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_themes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      description TEXT,
      builtin BOOLEAN DEFAULT FALSE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_theme_names (
      theme_id TEXT NOT NULL,
      name TEXT NOT NULL,
      PRIMARY KEY (theme_id, name),
      FOREIGN KEY (theme_id) REFERENCES agent_themes(id) ON DELETE CASCADE
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

    CREATE TABLE IF NOT EXISTS workspace_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_worktrees_agent ON agent_worktrees(agent_name);
    CREATE INDEX IF NOT EXISTS idx_worktrees_repo ON agent_worktrees(repo_name);
    CREATE INDEX IF NOT EXISTS idx_theme_names_theme ON agent_theme_names(theme_id);
    CREATE INDEX IF NOT EXISTS idx_agents_theme ON agents(theme_id);
  `);

  // Insert workspace config
  db.prepare(`
    INSERT INTO workspace (id, type, workspace_name, has_pmo, created_at)
    VALUES (1, 'hq', 'test-hq', 1, datetime('now'))
  `).run();

  // NOTE: PMO tables (pmo_projects, pmo_actions, etc.) are NOT created here.
  // They are auto-created by the CLI's SQLiteStorage constructor when the
  // command runs (via ensurePMOTables()). This avoids schema mismatch issues
  // as the schema evolves with migrations.

  // Agent work table (for ExecutionStorage)
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_work (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      executor TEXT NOT NULL DEFAULT 'claude-code',
      environment TEXT NOT NULL DEFAULT 'host',
      display_mode TEXT NOT NULL DEFAULT 'terminal',
      sandboxed INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'starting',
      branch TEXT,
      pid TEXT,
      container_id TEXT,
      session_id TEXT,
      host TEXT,
      log_path TEXT,
      started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      completed_at TIMESTAMP,
      exit_code INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_agent_work_agent ON agent_work(agent_name);
    CREATE INDEX IF NOT EXISTS idx_agent_work_status ON agent_work(status);
    CREATE INDEX IF NOT EXISTS idx_agent_work_ticket ON agent_work(ticket_id);
  `);
}

let executionCounter = 0;
function createExecution(
  db: Database.Database,
  ticketId: string,
  agentName: string,
  status: string,
  options: {
    executor?: string;
    environment?: string;
    display_mode?: string;
    sandboxed?: boolean;
    branch?: string;
    pid?: string;
    container_id?: string;
    session_id?: string;
    host?: string;
    log_path?: string;
  } = {}
): string {
  executionCounter++;
  const execId = `WORK-${String(executionCounter).padStart(3, '0')}`;

  db.prepare(`
    INSERT INTO agent_work (
      id, ticket_id, agent_name, status, executor,
      environment, display_mode, sandboxed, branch,
      pid, container_id, session_id, host, log_path
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    execId,
    ticketId,
    agentName,
    status,
    options.executor || 'claude-code',
    options.environment || 'host',
    options.display_mode || 'terminal',
    options.sandboxed !== undefined ? (options.sandboxed ? 1 : 0) : 1,
    options.branch || null,
    options.pid || null,
    options.container_id || null,
    options.session_id || null,
    options.host || null,
    options.log_path || null
  );

  return execId;
}
