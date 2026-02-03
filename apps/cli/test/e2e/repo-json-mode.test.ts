import { expect } from 'chai';
import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import {
  createTestEnvironment,
  cleanupTestEnvironment,
  createHQConfig,
  createPMODirectories,
  execProduction,
  filterOutput,
  findChoice as sharedFindChoice,
  execChoice as sharedExecChoice,
  type TestEnvironment,
  type AgentPromptChoice,
} from './test-helpers.js';

// Local exec wrapper that uses execProduction with filtering
const exec = (cmd: string): string => {
  const output = execProduction(cmd);
  return filterOutput(output);
};

/**
 * Initialize a git repository in a directory.
 */
function initGitRepo(dir: string): void {
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "Test User"', { cwd: dir, stdio: 'pipe' });
  fs.writeFileSync(path.join(dir, 'README.md'), '# Test');
  execSync('git add .', { cwd: dir, stdio: 'pipe' });
  execSync('git commit -m "Initial commit"', { cwd: dir, stdio: 'pipe' });
}

/**
 * Extract JSON from CLI output that may contain warnings.
 * Looks for the first line starting with { or [ and parses from there.
 */
function extractJson<T>(output: string): T {
  const lines = output.split('\n');
  let jsonStart = -1;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      jsonStart = i;
      break;
    }
  }

  if (jsonStart === -1) {
    throw new Error(`No JSON found in output: ${output.substring(0, 500)}...`);
  }

  const jsonLines = lines.slice(jsonStart).join('\n');
  return JSON.parse(jsonLines) as T;
}

/**
 * Integration tests for repo command JSON mode.
 *
 * These tests verify that:
 * 1. Repo commands support --machine flag (and legacy --json)
 * 2. JSON output includes proper prompt schema
 * 3. Flag accumulation works correctly in choices
 * 4. Full agent flows complete with database verification
 */
describe('Repo Commands JSON Mode', () => {
  let env: TestEnvironment;
  let db: Database.Database;

  beforeEach(() => {
    env = createTestEnvironment('repo-json-');

    db = new Database(env.dbPath);
    setupTestDatabase(db, env.pmoPath);

    createHQConfig(env.proletariatDir);
    createPMODirectories(env.pmoPath, 'test-project');
  });

  afterEach(() => {
    if (db) db.close();
    cleanupTestEnvironment(env);
  });

  /**
   * Helper to create a test repository directly in the database.
   */
  function createTestRepo(name: string, repoPath: string): void {
    // Create a fake git directory for the repo
    fs.mkdirSync(repoPath, { recursive: true });
    fs.mkdirSync(path.join(repoPath, '.git'), { recursive: true });

    db.prepare(`
      INSERT INTO repositories (name, path, type, added_at)
      VALUES (?, ?, 'main', datetime('now'))
    `).run(name, repoPath);
  }

  describe('repo (main menu) --machine', () => {
    it('should output valid JSON with prompt schema', () => {
      const output = exec('repo --machine');
      const json = extractJson<{
        prompt: { type: string; name: string; message: string; choices: Array<{ name: string; value: string }> };
        metadata: { command: string; flags: Record<string, unknown> };
      }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('list');
      expect(json.prompt.choices).to.be.an('array');
      expect(json.prompt.choices.length).to.be.greaterThan(0);
      expect(json.metadata.command).to.equal('repo');
      expect(json.metadata.flags.machine).to.equal(true);
    });

    it('should work with -m shorthand', () => {
      const output = exec('repo -m');
      const json = extractJson<{ prompt: { type: string }; metadata: { flags: { machine: boolean } } }>(output);

      expect(json.prompt).to.exist;
      expect(json.metadata.flags.machine).to.equal(true);
    });

    it('should include command field in all choices', () => {
      const output = exec('repo --machine');
      const json = extractJson<{
        prompt: { choices: Array<{ name: string; command?: string }> };
      }>(output);

      for (const choice of json.prompt.choices) {
        expect(choice.command).to.be.a('string');
        expect(choice.command).to.include('prlt repo');
      }
    });

    it('should include --json flag in choice commands for flag accumulation', () => {
      const output = exec('repo --machine');
      const json = extractJson<{
        prompt: { choices: Array<{ command?: string }> };
      }>(output);

      for (const choice of json.prompt.choices) {
        expect(choice.command).to.include('--json');
      }
    });
  });

  describe('repo list --format json', () => {
    it('should output valid JSON array with --format json flag', () => {
      // Add a test repo first
      const testRepoPath = path.join(env.testDir, 'repos', 'list-test-repo');
      fs.mkdirSync(testRepoPath, { recursive: true });
      initGitRepo(testRepoPath);
      createTestRepo('list-test-repo', 'repos/list-test-repo');

      const output = exec('repo list --format json');
      const json = extractJson<Array<{ name: string; path: string }>>(output);

      expect(json).to.be.an('array');
      expect(json.length).to.be.greaterThan(0);
      expect(json[0]).to.have.property('name');
      expect(json[0]).to.have.property('path');
    });

    it('should output valid JSON with -f json shorthand', () => {
      // Add a test repo first
      const testRepoPath = path.join(env.testDir, 'repos', 'shorthand-test-repo');
      fs.mkdirSync(testRepoPath, { recursive: true });
      initGitRepo(testRepoPath);
      createTestRepo('shorthand-test-repo', 'repos/shorthand-test-repo');

      const output = exec('repo list -f json');
      const json = extractJson<Array<{ name: string }>>(output);

      expect(json).to.be.an('array');
      expect(json.length).to.be.greaterThan(0);
    });
  });

  describe('repo add --machine', () => {
    it('should output prompt JSON when path not provided', () => {
      const output = exec('repo add --machine');
      const json = extractJson<{
        prompt: { type: string; name: string; message: string };
        metadata: { command: string; flags: Record<string, unknown> };
      }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('list');
      expect(json.metadata.command).to.equal('repo add');
      expect(json.metadata.flags.machine).to.equal(true);
    });

    it('should work with -m shorthand', () => {
      const output = exec('repo add -m');
      const json = extractJson<{ prompt: { type: string }; metadata: { flags: { machine: boolean } } }>(output);

      expect(json.prompt).to.exist;
      expect(json.metadata.flags.machine).to.equal(true);
    });

    // Note: Adding repos requires test isolation which isn't supported with execProduction.
    // The repo add prompt JSON output is tested above.
  });

  describe('repo view --machine', () => {

    it('should output prompt JSON when name not provided', () => {
      // Add a test repo first so view has something to show
      const testRepoPath = path.join(env.testDir, 'repos', 'view-test-repo');
      fs.mkdirSync(testRepoPath, { recursive: true });
      initGitRepo(testRepoPath);
      createTestRepo('view-test-repo', 'repos/view-test-repo');

      const output = exec('repo view --machine');
      const json = extractJson<{
        prompt: { type: string; name: string; message: string; choices: Array<{ name: string; value: string }> };
        metadata: { command: string; flags: Record<string, unknown> };
      }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('list');
      expect(json.metadata.flags.machine).to.equal(true);
    });

    it('should include command field in choices for flag accumulation', () => {
      // Add a test repo first so view has something to show
      const testRepoPath = path.join(env.testDir, 'repos', 'view-flag-test-repo');
      fs.mkdirSync(testRepoPath, { recursive: true });
      initGitRepo(testRepoPath);
      createTestRepo('view-flag-test-repo', 'repos/view-flag-test-repo');

      const output = exec('repo view --machine');
      const json = extractJson<{
        prompt: { choices: Array<{ command?: string; value: string }> };
      }>(output);

      for (const choice of json.prompt.choices) {
        if (choice.command) {
          expect(choice.command).to.include('--json');
        }
      }
    });
  });

  describe('repo remove --machine', () => {
    it('should output prompt JSON when name not provided', () => {
      // Add a test repo first so remove has something to show
      const testRepoPath = path.join(env.testDir, 'repos', 'remove-test-repo');
      fs.mkdirSync(testRepoPath, { recursive: true });
      initGitRepo(testRepoPath);
      createTestRepo('remove-test-repo', 'repos/remove-test-repo');

      const output = exec('repo remove --machine');
      const json = extractJson<{
        prompt: { type: string; name: string; message: string; choices: Array<{ name: string; value: string }> };
        metadata: { command: string; flags: Record<string, unknown> };
      }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('list');
      expect(json.metadata.flags.machine).to.equal(true);
    });
  });

  // ===========================================================================
  // End-to-end Agent Flow Tests
  // ===========================================================================
  // Note: These tests verify JSON structure and navigation patterns.
  // Tests that need database isolation use the working HQ context.

  describe('End-to-end agent flows (--machine flag)', () => {
    interface AgentPrompt {
      prompt: {
        type: string;
        name: string;
        message: string;
        choices?: AgentPromptChoice[];
        context?: Record<string, unknown>;
      };
      metadata: {
        command: string;
        flags: Record<string, unknown>;
      };
    }

    // Local agentExec that uses the local exec function with extractJson
    function agentExec(cmd: string): AgentPrompt {
      const output = exec(cmd);
      return extractJson<AgentPrompt>(output);
    }

    const findChoice = sharedFindChoice;
    const execChoice = sharedExecChoice;

    describe('repo menu navigation', () => {
      it('should navigate from repo menu to repo add', () => {
        // Agent Step 1: Get main menu
        const step1 = agentExec('repo --machine');
        expect(step1.prompt.type).to.equal('list');

        // Find add choice
        const addChoice = findChoice(step1.prompt.choices!, 'Add repository');
        expect(addChoice).to.exist;
        expect(addChoice!.command).to.include('repo add');

        // Agent Step 2: Navigate to repo add
        const step2 = agentExec(execChoice(addChoice!));
        expect(step2.prompt.type).to.equal('list');
        expect(step2.prompt.choices).to.be.an('array');
      });

      it('should navigate from repo menu to repo list', () => {
        // Agent Step 1: Get main menu
        const step1 = agentExec('repo --machine');
        expect(step1.prompt.type).to.equal('list');

        // Find list choice
        const listChoice = findChoice(step1.prompt.choices!, 'List all repositories');
        expect(listChoice).to.exist;
        expect(listChoice!.command).to.include('repo list');
        expect(listChoice!.command).to.include('--json');
      });

      it('should navigate from repo menu to repo view', () => {
        // Agent Step 1: Get main menu
        const step1 = agentExec('repo --machine');
        expect(step1.prompt.type).to.equal('list');

        // Find view choice
        const viewChoice = findChoice(step1.prompt.choices!, 'View repository details');
        expect(viewChoice).to.exist;
        expect(viewChoice!.command).to.include('repo view');
      });

      it('should navigate from repo menu to repo remove', () => {
        // Agent Step 1: Get main menu
        const step1 = agentExec('repo --machine');
        expect(step1.prompt.type).to.equal('list');

        // Find remove choice
        const removeChoice = findChoice(step1.prompt.choices!, 'Remove repository');
        expect(removeChoice).to.exist;
        expect(removeChoice!.command).to.include('repo remove');
      });
    });

    describe('repo add - agent navigation', () => {
      it('should show method selection options', () => {
        const step1 = agentExec('repo add --machine');
        expect(step1.prompt.type).to.equal('list');
        expect(step1.prompt.choices).to.be.an('array');

        // Should have manual and bulk options
        const manualChoice = findChoice(step1.prompt.choices!, 'Enter path');
        expect(manualChoice).to.exist;
      });
    });

    describe('repo view - agent navigation', () => {
      it('should output repo selection prompt', () => {
        // Add a test repo first
        const testRepoPath = path.join(env.testDir, 'repos', 'agent-view-repo');
        fs.mkdirSync(testRepoPath, { recursive: true });
        initGitRepo(testRepoPath);
        createTestRepo('agent-view-repo', 'repos/agent-view-repo');

        const step1 = agentExec('repo view --machine');
        expect(step1.prompt.type).to.equal('list');
        expect(step1.prompt.message).to.include('Select repository');
        expect(step1.prompt.choices).to.be.an('array');

        // Each choice should have command with --json flag
        for (const choice of step1.prompt.choices!) {
          if (choice.command && !choice.name.toLowerCase().includes('cancel')) {
            expect(choice.command).to.include('--json');
          }
        }
      });
    });

    describe('repo remove - agent navigation', () => {
      it('should output repo selection prompt', () => {
        // Add a test repo first
        const testRepoPath = path.join(env.testDir, 'repos', 'agent-remove-repo');
        fs.mkdirSync(testRepoPath, { recursive: true });
        initGitRepo(testRepoPath);
        createTestRepo('agent-remove-repo', 'repos/agent-remove-repo');

        const step1 = agentExec('repo remove --machine');
        expect(step1.prompt.type).to.equal('list');
        expect(step1.prompt.message).to.include('Select repository');
        expect(step1.prompt.choices).to.be.an('array');

        // Each choice should have command with --json flag
        for (const choice of step1.prompt.choices!) {
          if (choice.command && !choice.name.toLowerCase().includes('cancel')) {
            expect(choice.command).to.include('--json');
          }
        }
      });
    });

    describe('repo list - JSON output', () => {
      it('should return repos as JSON array with --format json', () => {
        // Add a test repo first
        const testRepoPath = path.join(env.testDir, 'repos', 'agent-list-repo');
        fs.mkdirSync(testRepoPath, { recursive: true });
        initGitRepo(testRepoPath);
        createTestRepo('agent-list-repo', 'repos/agent-list-repo');

        // Use --format json since repo list uses that flag
        const output = exec('repo list --format json');
        const repos = extractJson<Array<{ name: string; path: string }>>(output);

        expect(repos).to.be.an('array');
        expect(repos.length).to.be.greaterThan(0);
        expect(repos[0]).to.have.property('name');
        expect(repos[0]).to.have.property('path');
      });
    });

    describe('backward compatibility: --json flag', () => {
      it('should work with --json flag same as --machine for prompts', () => {
        const machineResult = agentExec('repo --machine');
        const jsonResult = agentExec('repo --json');

        // Both should have same structure
        expect(machineResult.prompt.type).to.equal(jsonResult.prompt.type);
        expect(machineResult.prompt.choices!.length).to.equal(jsonResult.prompt.choices!.length);
      });
    });
  });
});

/**
 * Helper function to set up test database with full workspace schema.
 * Matches the schema from src/lib/database/index.ts
 */
function setupTestDatabase(db: Database.Database, pmoPath: string) {
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

    -- Agent naming themes (optional)
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

    -- Agent instances in workspace
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
      last_commit_hash TEXT,
      commits_ahead INTEGER NOT NULL DEFAULT 0,
      is_clean INTEGER NOT NULL DEFAULT 1,
      last_checked TEXT,
      PRIMARY KEY (agent_name, repo_name),
      FOREIGN KEY (agent_name) REFERENCES agents(name) ON DELETE CASCADE,
      FOREIGN KEY (repo_name) REFERENCES repositories(name) ON DELETE CASCADE
    );

    -- Workspace-level settings (key-value store)
    CREATE TABLE IF NOT EXISTS workspace_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- PMO tables
    CREATE TABLE IF NOT EXISTS pmo_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pmo_workflows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      is_builtin INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pmo_workflow_statuses (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      color TEXT,
      description TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workflow_id) REFERENCES pmo_workflows(id) ON DELETE CASCADE,
      UNIQUE(workflow_id, name)
    );

    CREATE TABLE IF NOT EXISTS pmo_phases (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      color TEXT,
      description TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pmo_projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      template TEXT,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      phase_id TEXT,
      workflow_id TEXT,
      is_archived INTEGER NOT NULL DEFAULT 0,
      target_date TIMESTAMP,
      initiative_id TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pmo_tickets (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL DEFAULT 'default',
      title TEXT NOT NULL,
      description TEXT,
      priority TEXT,
      category TEXT,
      status TEXT NOT NULL DEFAULT 'backlog',
      status_id TEXT,
      owner TEXT,
      assignee TEXT,
      branch TEXT,
      spec_id TEXT,
      epic_id TEXT,
      labels TEXT NOT NULL DEFAULT '[]',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_synced_from_spec TIMESTAMP,
      last_synced_from_board TIMESTAMP
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_repositories_type ON repositories(type);
    CREATE INDEX IF NOT EXISTS idx_worktrees_agent ON agent_worktrees(agent_name);
    CREATE INDEX IF NOT EXISTS idx_worktrees_repo ON agent_worktrees(repo_name);
    CREATE INDEX IF NOT EXISTS idx_theme_names_theme ON agent_theme_names(theme_id);
    CREATE INDEX IF NOT EXISTS idx_agents_theme ON agents(theme_id);
  `);

  // Insert workspace record
  db.prepare(`
    INSERT INTO workspace (id, type, workspace_name, has_pmo, created_at)
    VALUES (1, 'hq', 'test-workspace', 1, datetime('now'))
  `).run();

  // Insert workflow
  db.prepare(`
    INSERT INTO pmo_workflows (id, name, description, is_builtin)
    VALUES ('default', 'Default', 'Default kanban workflow', 1)
  `).run();

  // Insert workflow statuses
  const statuses = [
    { id: 'status-backlog', name: 'Backlog', category: 'backlog', position: 0, isDefault: 1 },
    { id: 'status-in-progress', name: 'In Progress', category: 'started', position: 1 },
    { id: 'status-done', name: 'Done', category: 'completed', position: 2 },
  ];

  for (const status of statuses) {
    db.prepare(`
      INSERT INTO pmo_workflow_statuses (id, workflow_id, name, category, position, is_default)
      VALUES (?, 'default', ?, ?, ?, ?)
    `).run(status.id, status.name, status.category, status.position, status.isDefault || 0);
  }

  // Insert test project
  db.prepare(`
    INSERT INTO pmo_projects (id, name, description, workflow_id)
    VALUES ('test-project', 'Test Project', 'E2E test project', 'default')
  `).run();

  db.prepare(`
    INSERT INTO pmo_settings (key, value)
    VALUES ('pmo_path', ?), ('current_project', 'test-project')
  `).run(pmoPath);
}
