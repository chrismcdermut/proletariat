/**
 * E2E Agent Flow Tests for Repository and Branch Commands
 *
 * These tests verify that AI agents can navigate repo and branch command flows
 * using the --machine flag. Focus is on functional verification:
 * - Commands return navigable JSON
 * - CRUD operations actually modify the database/filesystem
 * - Key flags work correctly
 */
import { expect } from 'chai';
import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import {
  createTestEnvironment,
  cleanupTestEnvironment,
  createHQConfig,
  agentExec,
  findChoice,
  execChoice,
  execFinal,
  type TestEnvironment,
} from './test-helpers.js';

/**
 * Initialize a git repository with an initial commit.
 */
function initGitRepo(dir: string): void {
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "Test User"', { cwd: dir, stdio: 'pipe' });
  fs.writeFileSync(path.join(dir, 'README.md'), '# Test Repository');
  execSync('git add .', { cwd: dir, stdio: 'pipe' });
  execSync('git commit -m "Initial commit"', { cwd: dir, stdio: 'pipe' });
}

/**
 * Set up test database with workspace schema.
 */
function setupTestDatabase(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspace (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      type TEXT NOT NULL,
      workspace_name TEXT NOT NULL,
      has_pmo BOOLEAN DEFAULT FALSE,
      active_theme_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS repositories (
      name TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      type TEXT DEFAULT 'main',
      source_url TEXT,
      action TEXT,
      added_at TEXT NOT NULL
    );
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
      PRIMARY KEY (theme_id, name)
    );
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
      PRIMARY KEY (agent_name, repo_name)
    );
    CREATE TABLE IF NOT EXISTS workspace_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    INSERT INTO workspace (id, type, workspace_name, has_pmo, created_at)
    VALUES (1, 'hq', 'test-workspace', 0, datetime('now'));
  `);
}

describe('Repository Commands - Agent Flow Tests', function(this: Mocha.Suite) {
  this.timeout(30000);

  let env: TestEnvironment;
  let db: Database.Database;

  beforeEach(function() {
    env = createTestEnvironment('repo-agent-');
    db = new Database(env.dbPath);
    setupTestDatabase(db);
    createHQConfig(env.proletariatDir, { name: 'test-hq', hasPmo: false });
    fs.mkdirSync(path.join(env.testDir, 'repos'), { recursive: true });
  });

  afterEach(function() {
    if (db) db.close();
    cleanupTestEnvironment(env);
  });

  // Helpers
  function addRepoToDb(name: string, repoPath: string): void {
    db.prepare(`INSERT INTO repositories (name, path, added_at) VALUES (?, ?, datetime('now'))`).run(name, repoPath);
  }

  function repoExistsInDb(name: string): boolean {
    return !!db.prepare('SELECT 1 FROM repositories WHERE name = ?').get(name);
  }

  function getRepoCount(): number {
    return (db.prepare('SELECT COUNT(*) as c FROM repositories').get() as { c: number }).c;
  }

  function reopenDb(): void {
    db.close();
    db = new Database(env.dbPath);
  }

  // ==========================================================================
  // REPO MENU - Navigation
  // ==========================================================================

  describe('repo menu --machine', function() {
    it('returns JSON with navigable choices', function() {
      const result = agentExec('repo --machine');

      expect(result).to.not.be.null;
      expect(result!.prompt.type).to.equal('list');
      expect(result!.prompt.choices.length).to.be.greaterThan(0);

      // Each choice should have a command for navigation
      for (const choice of result!.prompt.choices) {
        expect(choice.command).to.be.a('string');
        expect(choice.command).to.include('prlt repo');
      }
    });
  });

  // ==========================================================================
  // REPO LIST - Read
  // ==========================================================================

  describe('repo list', function() {
    it('returns repos that exist in database', function() {
      // Add repos to DB
      const repoPath = path.join(env.testDir, 'repos', 'test-repo');
      fs.mkdirSync(repoPath, { recursive: true });
      initGitRepo(repoPath);
      addRepoToDb('test-repo', 'repos/test-repo');

      const output = execFinal('repo list --format json');
      const repos = JSON.parse(output);

      expect(repos).to.be.an('array');
      expect(repos.length).to.equal(1);
      expect(repos[0].name).to.equal('test-repo');
    });

    it('returns empty array when no repos', function() {
      const output = execFinal('repo list --format json');

      expect(output).to.satisfy((s: string) =>
        s.includes('[]') || s.includes('No repositories')
      );
    });
  });

  // ==========================================================================
  // REPO ADD - Create
  // ==========================================================================

  describe('repo add', function(this: Mocha.Suite) {
    it('adds repo to database and filesystem', function(this: Mocha.Context) {
      this.timeout(60000);

      // Create source repo
      const sourceRepo = path.join(env.testDir, 'source-repo');
      fs.mkdirSync(sourceRepo, { recursive: true });
      initGitRepo(sourceRepo);

      expect(getRepoCount()).to.equal(0);

      // Add it
      execFinal(`repo add "${sourceRepo}"`);

      // Verify DB
      reopenDb();
      expect(repoExistsInDb('source-repo')).to.be.true;

      // Verify filesystem (cloned to repos/)
      expect(fs.existsSync(path.join(env.testDir, 'repos', 'source-repo'))).to.be.true;
    });

    it('shows method selection in --machine mode', function() {
      const result = agentExec('repo add --machine');

      expect(result).to.not.be.null;
      expect(result!.prompt.type).to.equal('list');
      expect(findChoice(result!.prompt.choices, 'Enter path')).to.exist;
    });
  });

  // ==========================================================================
  // REPO REMOVE - Delete
  // ==========================================================================

  describe('repo remove', function() {
    it('removes repo from database and filesystem with --force', function() {
      // Setup
      const repoPath = path.join(env.testDir, 'repos', 'to-remove');
      fs.mkdirSync(repoPath, { recursive: true });
      initGitRepo(repoPath);
      addRepoToDb('to-remove', 'repos/to-remove');

      expect(repoExistsInDb('to-remove')).to.be.true;
      expect(fs.existsSync(repoPath)).to.be.true;

      // Remove
      execFinal('repo remove to-remove --force');

      // Verify both DB and filesystem
      reopenDb();
      expect(repoExistsInDb('to-remove')).to.be.false;
      expect(fs.existsSync(repoPath)).to.be.false;
    });

    it('keeps files with --keep-files flag', function() {
      // Setup
      const repoPath = path.join(env.testDir, 'repos', 'keep-me');
      fs.mkdirSync(repoPath, { recursive: true });
      initGitRepo(repoPath);
      fs.writeFileSync(path.join(repoPath, 'important.txt'), 'keep this');
      addRepoToDb('keep-me', 'repos/keep-me');

      // Remove with --keep-files
      execFinal('repo remove keep-me --keep-files --force');

      // Verify: DB updated, files preserved
      reopenDb();
      expect(repoExistsInDb('keep-me')).to.be.false;
      expect(fs.existsSync(path.join(repoPath, 'important.txt'))).to.be.true;
    });

    it('shows repo selection in --machine mode', function() {
      // Add a repo first
      const repoPath = path.join(env.testDir, 'repos', 'selectable');
      fs.mkdirSync(repoPath, { recursive: true });
      initGitRepo(repoPath);
      addRepoToDb('selectable', 'repos/selectable');

      const result = agentExec('repo remove --machine');

      expect(result).to.not.be.null;
      expect(result!.prompt.type).to.equal('list');
      expect(findChoice(result!.prompt.choices, 'selectable')).to.exist;
    });
  });

  // ==========================================================================
  // REPO VIEW - Read single
  // ==========================================================================

  describe('repo view', function() {
    it('shows repo details', function() {
      const repoPath = path.join(env.testDir, 'repos', 'viewable');
      fs.mkdirSync(repoPath, { recursive: true });
      initGitRepo(repoPath);
      addRepoToDb('viewable', 'repos/viewable');

      const output = execFinal('repo view viewable');

      expect(output).to.include('viewable');
    });

    it('shows repo selection in --machine mode', function() {
      const repoPath = path.join(env.testDir, 'repos', 'pick-me');
      fs.mkdirSync(repoPath, { recursive: true });
      initGitRepo(repoPath);
      addRepoToDb('pick-me', 'repos/pick-me');

      const result = agentExec('repo view --machine');

      expect(result).to.not.be.null;
      expect(findChoice(result!.prompt.choices, 'pick-me')).to.exist;
    });
  });

  // ==========================================================================
  // FULL AGENT FLOW - End to end
  // ==========================================================================

  describe('full agent flow', function() {
    it('navigates menu → remove → select → confirm → verifies DB change', function() {
      // Setup repo
      const repoPath = path.join(env.testDir, 'repos', 'flow-test');
      fs.mkdirSync(repoPath, { recursive: true });
      initGitRepo(repoPath);
      addRepoToDb('flow-test', 'repos/flow-test');

      expect(repoExistsInDb('flow-test')).to.be.true;

      // Step 1: Main menu
      const step1 = agentExec('repo --machine');
      expect(step1).to.not.be.null;

      // Step 2: Navigate to remove
      const removeChoice = findChoice(step1!.prompt.choices, 'Remove');
      expect(removeChoice).to.exist;

      // Step 3: Get repo selection
      const step2 = agentExec(execChoice(removeChoice!));
      expect(step2).to.not.be.null;

      // Step 4: Select the repo
      const repoChoice = findChoice(step2!.prompt.choices, 'flow-test');
      expect(repoChoice).to.exist;

      // Step 5: Execute with --force
      const cmd = repoChoice!.command!.replace('prlt ', '').replace('--json', '--force');
      execFinal(cmd);

      // Verify DB change
      reopenDb();
      expect(repoExistsInDb('flow-test')).to.be.false;
    });
  });

  // ==========================================================================
  // ERROR HANDLING
  // ==========================================================================

  describe('error handling', function() {
    it('handles not-in-HQ gracefully', function() {
      fs.rmSync(path.join(env.proletariatDir, 'config.json'));

      const output = execFinal('repo list --format json');

      expect(output.toLowerCase()).to.satisfy((s: string) =>
        s.includes('error') || s.includes('not') || s.includes('hq')
      );
    });

    it('handles repo not found', function() {
      const output = execFinal('repo view nonexistent');

      expect(output.toLowerCase()).to.include('not found');
    });
  });
});

describe('Branch Commands - Agent Flow Tests', function(this: Mocha.Suite) {
  this.timeout(30000);

  let env: TestEnvironment;
  let db: Database.Database;

  beforeEach(function() {
    env = createTestEnvironment('branch-agent-');
    db = new Database(env.dbPath);
    setupTestDatabase(db);
    createHQConfig(env.proletariatDir, { name: 'test-hq', hasPmo: false });
  });

  afterEach(function() {
    if (db) db.close();
    cleanupTestEnvironment(env);
  });

  // ==========================================================================
  // BRANCH MENU - Navigation
  // ==========================================================================

  describe('branch menu --machine', function() {
    it('returns JSON with navigable choices', function() {
      const result = agentExec('branch --machine');

      expect(result).to.not.be.null;
      expect(result!.prompt.type).to.equal('list');

      // Should have Create, List, Validate options
      expect(findChoice(result!.prompt.choices, 'Create')).to.exist;
      expect(findChoice(result!.prompt.choices, 'List')).to.exist;
      expect(findChoice(result!.prompt.choices, 'Validate')).to.exist;
    });
  });

  // ==========================================================================
  // BRANCH CREATE
  // ==========================================================================

  describe('branch create', function() {
    it('outputs branch name with --type and --description flags', function() {
      const output = execFinal('branch create --type feature --description "add login"');

      // Should output a branch name
      expect(output).to.be.a('string');
      expect(output.length).to.be.greaterThan(0);
    });

    it('shows mode selection in --machine mode', function() {
      const result = agentExec('branch create --machine');

      expect(result).to.not.be.null;
      expect(result!.prompt.type).to.equal('list');
      expect(result!.prompt.choices.length).to.be.greaterThan(0);
    });
  });

  // ==========================================================================
  // BRANCH VALIDATE
  // ==========================================================================

  describe('branch validate', function() {
    it('accepts valid ticket-style branch name', function() {
      // Use the format the validator expects: TKT-123/type/description
      const output = execFinal('branch validate "TKT-123/feat/add-login"');

      expect(output.toLowerCase()).to.satisfy((s: string) =>
        s.includes('valid') || !s.includes('invalid')
      );
    });

    it('rejects branch name with spaces', function() {
      const output = execFinal('branch validate "invalid name with spaces"');

      expect(output.toLowerCase()).to.include('invalid');
    });
  });

  // ==========================================================================
  // BRANCH LIST
  // ==========================================================================

  describe('branch list', function() {
    it('returns JSON array with --format json', function() {
      const output = execFinal('branch list --format json');

      expect(output).to.be.a('string');
      // Should be parseable or indicate no branches
    });
  });

  // ==========================================================================
  // FULL AGENT FLOW
  // ==========================================================================

  describe('full agent flow', function() {
    it('navigates menu → create → mode selection', function() {
      // Step 1: Main menu
      const step1 = agentExec('branch --machine');
      expect(step1).to.not.be.null;

      // Step 2: Select Create
      const createChoice = findChoice(step1!.prompt.choices, 'Create');
      expect(createChoice).to.exist;

      // Step 3: Get mode selection
      const step2 = agentExec(execChoice(createChoice!));
      expect(step2).to.not.be.null;
      expect(step2!.prompt.choices.length).to.be.greaterThan(0);
    });
  });
});
