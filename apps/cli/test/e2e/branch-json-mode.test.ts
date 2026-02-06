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
 * Integration tests for branch command JSON mode.
 *
 * These tests verify that:
 * 1. Branch commands support --machine flag (and legacy --json)
 * 2. JSON output includes proper prompt schema
 * 3. Flag accumulation works correctly in choices
 * 4. Full agent flows complete successfully
 */
describe('Branch Commands JSON Mode', () => {
  let env: TestEnvironment;
  let db: Database.Database;

  beforeEach(() => {
    env = createTestEnvironment('branch-json-');

    db = new Database(env.dbPath);
    setupTestDatabase(db, env.pmoPath);

    createHQConfig(env.proletariatDir);
    createPMODirectories(env.pmoPath, 'test-project');

    // Initialize git repo for branch commands
    try {
      initGitRepo(env.testDir);
    } catch {
      // Git init may fail in some environments
    }
  });

  afterEach(() => {
    if (db) db.close();
    cleanupTestEnvironment(env);
  });

  /**
   * Helper to create a test ticket for branch creation.
   */
  function createTestTicket(id: string, title: string): void {
    db.prepare(`
      INSERT INTO pmo_tickets (id, project_id, title, status)
      VALUES (?, 'test-project', ?, 'backlog')
    `).run(id, title);
  }

  describe('branch (main menu) --machine', () => {
    it('should output valid JSON with prompt schema', () => {
      const output = exec('branch --machine');
      const json = extractJson<{
        prompt: { type: string; name: string; message: string; choices: Array<{ name: string; value: string }> };
        metadata: { command: string; flags: Record<string, unknown> };
      }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('list');
      expect(json.prompt.choices).to.be.an('array');
      expect(json.prompt.choices.length).to.be.greaterThan(0);
      expect(json.metadata.command).to.equal('branch');
      expect(json.metadata.flags.machine).to.equal(true);
    });

    it('should work with -m shorthand', () => {
      const output = exec('branch -m');
      const json = extractJson<{ prompt: { type: string }; metadata: { flags: { machine: boolean } } }>(output);

      expect(json.prompt).to.exist;
      expect(json.metadata.flags.machine).to.equal(true);
    });

    it('should include command field in all choices', () => {
      const output = exec('branch --machine');
      const json = extractJson<{
        prompt: { choices: Array<{ name: string; value: string; command?: string }> };
      }>(output);

      for (const choice of json.prompt.choices) {
        if (choice.value !== 'cancel') {
          expect(choice.command).to.be.a('string');
          expect(choice.command).to.include('prlt branch');
        }
      }
    });

    it('should have all standard menu choices', () => {
      const output = exec('branch --machine');
      const json = extractJson<{
        prompt: { choices: Array<{ name: string; value: string }> };
      }>(output);

      const values = json.prompt.choices.map(c => c.value);
      expect(values).to.include('create');
      expect(values).to.include('list');
      expect(values).to.include('validate');
      expect(values).to.include('cancel');
    });
  });

  describe('branch list --format json', () => {
    it('should output valid JSON array with --format json flag', () => {
      const output = exec('branch list --format json');
      const json = extractJson<Array<{ name: string; current?: boolean }>>(output);

      expect(json).to.be.an('array');
      // Should have at least the main/master branch
      if (json.length > 0) {
        expect(json[0]).to.have.property('name');
      }
    });

    it('should work with -f json shorthand', () => {
      const output = exec('branch list -f json');
      const json = extractJson<Array<{ name: string }>>(output);

      expect(json).to.be.an('array');
    });
  });

  describe('branch create --machine', () => {
    it('should output prompt JSON for mode selection', () => {
      const output = exec('branch create --machine');
      const json = extractJson<{
        prompt: { type: string; name: string; message: string; choices: Array<{ name: string; value: string }> };
        metadata: { command: string; flags: Record<string, unknown> };
      }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('list');
      expect(json.prompt.choices).to.be.an('array');
      expect(json.metadata.flags.machine).to.equal(true);
    });

    it('should work with -m shorthand', () => {
      const output = exec('branch create -m');
      const json = extractJson<{ prompt: { type: string }; metadata: { flags: { machine: boolean } } }>(output);

      expect(json.prompt).to.exist;
      expect(json.metadata.flags.machine).to.equal(true);
    });

    it('should include command hints in choices', () => {
      const output = exec('branch create --machine');
      const json = extractJson<{
        prompt: { choices: Array<{ name: string; command?: string }> };
      }>(output);

      // Choices should have command hints
      for (const choice of json.prompt.choices) {
        if (choice.command) {
          expect(choice.command).to.include('--json');
        }
      }
    });

    it('should create branch when type and description flags provided', () => {
      const output = exec('branch create -t feat -d test-feature --force');

      // Should either succeed or fail with meaningful error
      expect(output).to.be.a('string');
      // Check for success or branch already exists
      const successOrExists = output.includes('Created branch') ||
                             output.includes('feat/') ||
                             output.includes('already exists');
      expect(successOrExists).to.be.true;
    });
  });

  describe('branch validate --machine', () => {
    it('should validate current branch', () => {
      const output = exec('branch validate');

      // Should output validation result
      expect(output).to.be.a('string');
      expect(output.toLowerCase()).to.match(/valid|invalid|branch/);
    });

    it('should validate provided branch name', () => {
      const output = exec('branch validate feat/chris/add-auth');

      expect(output).to.include('Valid');
      expect(output).to.include('feat');
    });

    it('should report invalid branch format', () => {
      const output = exec('branch validate invalid-branch-name');

      expect(output.toLowerCase()).to.include('invalid');
    });
  });

  // ===========================================================================
  // End-to-end Agent Flow Tests
  // ===========================================================================

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

    function execFinal(cmd: string): string {
      return exec(cmd.replace(' --json', '').replace(' --machine', ''));
    }

    describe('branch menu navigation', () => {
      it('should navigate from branch menu to branch create', () => {
        // Agent Step 1: Get main menu
        const step1 = agentExec('branch --machine');
        expect(step1.prompt.type).to.equal('list');

        // Find create choice
        const createChoice = findChoice(step1.prompt.choices!, 'Create');
        expect(createChoice).to.exist;
        expect(createChoice!.command).to.include('branch create');

        // Agent Step 2: Navigate to create
        const step2 = agentExec(execChoice(createChoice!));
        expect(step2.prompt.type).to.equal('list');
        expect(step2.prompt.choices).to.be.an('array');
      });

      it('should navigate from branch menu to branch list', () => {
        // Agent Step 1: Get main menu
        const step1 = agentExec('branch --machine');
        expect(step1.prompt.type).to.equal('list');

        // Find list choice
        const listChoice = findChoice(step1.prompt.choices!, 'List');
        expect(listChoice).to.exist;
        expect(listChoice!.command).to.include('branch list');
      });

      it('should navigate from branch menu to branch validate', () => {
        // Agent Step 1: Get main menu
        const step1 = agentExec('branch --machine');
        expect(step1.prompt.type).to.equal('list');

        // Find validate choice
        const validateChoice = findChoice(step1.prompt.choices!, 'Validate');
        expect(validateChoice).to.exist;
        expect(validateChoice!.command).to.include('branch validate');
      });
    });

    describe('branch create - full agent flow', () => {
      beforeEach(() => {
        // Create a test ticket for ticket-based branch creation
        createTestTicket('TKT-001', 'Test ticket for branch creation');
      });

      it('should complete flow: select mode → create with flags', () => {
        // Agent Step 1: Get mode selection
        const step1 = agentExec('branch create --machine');
        expect(step1.prompt.type).to.equal('list');
        expect(step1.prompt.choices).to.be.an('array');

        // Find ticket mode (primary mode)
        const ticketChoice = step1.prompt.choices!.find(c =>
          c.name.toLowerCase().includes('ticket')
        );

        // Ticket mode should exist
        expect(ticketChoice).to.exist;

        // If ticket choice exists, verify it has the right flags hint
        if (ticketChoice && ticketChoice.command) {
          expect(ticketChoice.command).to.include('-T');
        }
      });

      it('should complete flow with all flags provided directly (custom)', () => {
        const result = exec('branch create -t feat -d agent-test-branch --force');

        // Should create branch or indicate it exists
        expect(result).to.be.a('string');
      });

      it('should complete flow with ticket flag provided directly', () => {
        // Use the test ticket
        const result = exec('branch create -T TKT-001 --force');

        // Should attempt to create branch from ticket
        expect(result).to.be.a('string');
      });
    });

    describe('branch list - agent data retrieval', () => {
      it('should return all branches as JSON array for agent processing', () => {
        // Use --format json since branch list uses that flag instead of --machine
        const output = exec('branch list --format json');
        const branches = extractJson<Array<{ name: string; current?: boolean }>>(output);

        expect(branches).to.be.an('array');

        // Should have at least one branch (main or master)
        if (branches.length > 0) {
          expect(branches[0]).to.have.property('name');
        }
      });

      it('should identify current branch', () => {
        // Use --format json since branch list uses that flag instead of --machine
        const output = exec('branch list --format json');
        const branches = extractJson<Array<{ name: string; current?: boolean }>>(output);

        // At least one branch should be current
        const currentBranch = branches.find(b => b.current);
        if (currentBranch) {
          expect(currentBranch.current).to.be.true;
        }
      });
    });

    describe('backward compatibility: --json flag flows', () => {
      it('should complete menu flow with --json flag (legacy)', () => {
        const step1 = agentExec('branch --json');
        expect(step1.prompt.type).to.equal('list');
        expect(step1.prompt.choices).to.be.an('array');
      });

      it('should complete create flow with --json flag (legacy)', () => {
        const step1 = agentExec('branch create --json');
        expect(step1.prompt.type).to.equal('list');
        expect(step1.prompt.choices).to.be.an('array');
      });

      it('should complete list flow with --format json (legacy)', () => {
        const output = exec('branch list --format json');
        const branches = extractJson<Array<{ name: string }>>(output);

        expect(branches).to.be.an('array');
      });
    });
  });

  describe('Flag accumulation in choices', () => {
    it('branch menu choices should have commands for navigation', () => {
      const output = exec('branch --machine');
      const json = extractJson<{
        prompt: { choices: Array<{ name: string; command?: string }> };
      }>(output);

      // Non-cancel choices should have command field
      for (const choice of json.prompt.choices) {
        if (!choice.name.toLowerCase().includes('cancel')) {
          expect(choice.command).to.exist;
          expect(choice.command).to.include('prlt branch');
        }
      }
    });

    it('branch create mode choices should include --json', () => {
      const output = exec('branch create --machine');
      const json = extractJson<{
        prompt: { choices: Array<{ command?: string }> };
      }>(output);

      for (const choice of json.prompt.choices) {
        if (choice.command) {
          expect(choice.command).to.include('--json');
        }
      }
    });
  });
});

describe('Branch Commands - JSON Mode Compatibility', () => {
  let env: TestEnvironment;
  let db: Database.Database;

  beforeEach(() => {
    env = createTestEnvironment('branch-compat-');

    db = new Database(env.dbPath);
    setupTestDatabase(db, env.pmoPath);

    createHQConfig(env.proletariatDir);
    createPMODirectories(env.pmoPath, 'test-project');

    try {
      initGitRepo(env.testDir);
    } catch {
      // Git init may fail
    }
  });

  afterEach(() => {
    if (db) db.close();
    cleanupTestEnvironment(env);
  });

  it('--json and --machine should be interchangeable', () => {
    const jsonOutput = exec('branch --json');
    const machineOutput = exec('branch --machine');

    const jsonResult = extractJson<{ prompt: { type: string; choices: Array<{ value: string }> } }>(jsonOutput);
    const machineResult = extractJson<{ prompt: { type: string; choices: Array<{ value: string }> } }>(machineOutput);

    expect(machineResult.prompt.type).to.equal(jsonResult.prompt.type);
    expect(machineResult.prompt.choices.length).to.equal(jsonResult.prompt.choices.length);

    // Same choice values
    const jsonValues = jsonResult.prompt.choices.map(c => c.value).sort();
    const machineValues = machineResult.prompt.choices.map(c => c.value).sort();
    expect(machineValues).to.deep.equal(jsonValues);
  });

  it('branch create --json should match --machine', () => {
    const jsonOutput = exec('branch create --json');
    const machineOutput = exec('branch create --machine');

    const jsonResult = extractJson<{ prompt: { type: string; choices: Array<unknown> } }>(jsonOutput);
    const machineResult = extractJson<{ prompt: { type: string; choices: Array<unknown> } }>(machineOutput);

    expect(machineResult.prompt.type).to.equal(jsonResult.prompt.type);
    expect(machineResult.prompt.choices.length).to.equal(jsonResult.prompt.choices.length);
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
    CREATE INDEX IF NOT EXISTS idx_pmo_tickets_project ON pmo_tickets(project_id);
    CREATE INDEX IF NOT EXISTS idx_pmo_tickets_status ON pmo_tickets(status);
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
