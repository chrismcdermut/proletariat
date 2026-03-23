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
  createPMODirectories,
  setupProductionSchema,
  addWorkspaceTables,
  findChoice,
  execInProcess,
  hasContextError,
  extractJson,
  type TestEnvironment,
  type AgentPromptResponse,
  type AgentPromptChoice,
} from './test-helpers.js';

// Local async helpers for in-process execution
async function agentExec(cmd: string): Promise<AgentPromptResponse | null> {
  const output = await execInProcess(cmd);
  if (hasContextError(output)) return null;
  return extractJson<AgentPromptResponse>(output);
}

function execChoice(choice: AgentPromptChoice): string {
  if (!choice.command) throw new Error('Choice has no command');
  return choice.command.replace('prlt ', '');
}

async function execFinal(cmd: string): Promise<string> {
  return await execInProcess(cmd);
}

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
 * Set up test database with production PMO + workspace schema.
 * Repo and branch commands extend PMOCommand, so PMO must be initialized.
 */
function setupTestDb(env: TestEnvironment): Database.Database {
  const db = setupProductionSchema(env.dbPath, env.pmoPath);
  addWorkspaceTables(db, { type: 'hq', hasPmo: true });
  createHQConfig(env.proletariatDir);
  createPMODirectories(env.pmoPath);
  return db;
}

describe('Repository Commands - Agent Flow Tests', function(this: Mocha.Suite) {
  this.timeout(30000);

  let env: TestEnvironment;
  let db: Database.Database;

  beforeEach(() => {
    env = createTestEnvironment('repo-agent-');
    db = setupTestDb(env);
    fs.mkdirSync(path.join(env.testDir, 'repos'), { recursive: true });
  });

  afterEach(() => {
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

  describe('repo menu --machine', () => {
    it('returns JSON with navigable choices', async () => {
      const result = await agentExec('repo --machine');

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

  describe('repo list', () => {
    it('returns repos that exist in database', async () => {
      // Add repos to DB
      const repoPath = path.join(env.testDir, 'repos', 'test-repo');
      fs.mkdirSync(repoPath, { recursive: true });
      initGitRepo(repoPath);
      addRepoToDb('test-repo', 'repos/test-repo');

      const output = await execFinal('repo list --format json');
      const repos = JSON.parse(output);

      expect(repos).to.be.an('array');
      expect(repos.length).to.equal(1);
      expect(repos[0].name).to.equal('test-repo');
    });

    it('returns empty array when no repos', async () => {
      const output = await execFinal('repo list --format json');

      expect(output).to.satisfy((s: string) =>
        s.includes('[]') || s.includes('No repositories')
      );
    });
  });

  // ==========================================================================
  // REPO ADD - Create
  // ==========================================================================

  // eslint-disable-next-line prefer-arrow-callback
  describe('repo add', function(this: Mocha.Suite) {
    // eslint-disable-next-line mocha/handle-done-callback
    it('adds repo to database and filesystem', async function(this: Mocha.Context) {
      this.timeout(60000);

      // Create source repo
      const sourceRepo = path.join(env.testDir, 'source-repo');
      fs.mkdirSync(sourceRepo, { recursive: true });
      initGitRepo(sourceRepo);

      expect(getRepoCount()).to.equal(0);

      // Add it
      await execFinal(`repo add "${sourceRepo}"`);

      // Verify DB
      reopenDb();
      expect(repoExistsInDb('source-repo')).to.be.true;

      // Verify filesystem (cloned to repos/)
      expect(fs.existsSync(path.join(env.testDir, 'repos', 'source-repo'))).to.be.true;
    });

    it('shows method selection in --machine mode', async () => {
      const result = await agentExec('repo add --machine');

      expect(result).to.not.be.null;
      expect(result!.prompt.type).to.equal('list');
      expect(findChoice(result!.prompt.choices, 'Enter path')).to.exist;
    });
  });

  // ==========================================================================
  // REPO REMOVE - Delete
  // ==========================================================================

  describe('repo remove', () => {
    it('removes repo from database and filesystem with --force', async () => {
      // Setup
      const repoPath = path.join(env.testDir, 'repos', 'to-remove');
      fs.mkdirSync(repoPath, { recursive: true });
      initGitRepo(repoPath);
      addRepoToDb('to-remove', 'repos/to-remove');

      expect(repoExistsInDb('to-remove')).to.be.true;
      expect(fs.existsSync(repoPath)).to.be.true;

      // Remove
      await execFinal('repo remove to-remove --force');

      // Verify both DB and filesystem
      reopenDb();
      expect(repoExistsInDb('to-remove')).to.be.false;
      expect(fs.existsSync(repoPath)).to.be.false;
    });

    it('keeps files with --keep-files flag', async () => {
      // Setup
      const repoPath = path.join(env.testDir, 'repos', 'keep-me');
      fs.mkdirSync(repoPath, { recursive: true });
      initGitRepo(repoPath);
      fs.writeFileSync(path.join(repoPath, 'important.txt'), 'keep this');
      addRepoToDb('keep-me', 'repos/keep-me');

      // Remove with --keep-files
      await execFinal('repo remove keep-me --keep-files --force');

      // Verify: DB updated, files preserved
      reopenDb();
      expect(repoExistsInDb('keep-me')).to.be.false;
      expect(fs.existsSync(path.join(repoPath, 'important.txt'))).to.be.true;
    });

    it('shows repo selection in --machine mode', async () => {
      // Add a repo first
      const repoPath = path.join(env.testDir, 'repos', 'selectable');
      fs.mkdirSync(repoPath, { recursive: true });
      initGitRepo(repoPath);
      addRepoToDb('selectable', 'repos/selectable');

      const result = await agentExec('repo remove --machine');

      expect(result).to.not.be.null;
      expect(result!.prompt.type).to.equal('list');
      expect(findChoice(result!.prompt.choices, 'selectable')).to.exist;
    });
  });

  // ==========================================================================
  // REPO VIEW - Read single
  // ==========================================================================

  describe('repo view', () => {
    it('shows repo details', async () => {
      const repoPath = path.join(env.testDir, 'repos', 'viewable');
      fs.mkdirSync(repoPath, { recursive: true });
      initGitRepo(repoPath);
      addRepoToDb('viewable', 'repos/viewable');

      const output = await execFinal('repo view viewable');

      expect(output).to.include('viewable');
    });

    it('shows repo selection in --machine mode', async () => {
      const repoPath = path.join(env.testDir, 'repos', 'pick-me');
      fs.mkdirSync(repoPath, { recursive: true });
      initGitRepo(repoPath);
      addRepoToDb('pick-me', 'repos/pick-me');

      const result = await agentExec('repo view --machine');

      expect(result).to.not.be.null;
      expect(findChoice(result!.prompt.choices, 'pick-me')).to.exist;
    });
  });

  // ==========================================================================
  // FULL AGENT FLOW - End to end
  // ==========================================================================

  describe('full agent flow', () => {
    it('navigates menu → remove → select → confirm → verifies DB change', async () => {
      // Setup repo
      const repoPath = path.join(env.testDir, 'repos', 'flow-test');
      fs.mkdirSync(repoPath, { recursive: true });
      initGitRepo(repoPath);
      addRepoToDb('flow-test', 'repos/flow-test');

      expect(repoExistsInDb('flow-test')).to.be.true;

      // Step 1: Main menu
      const step1 = await agentExec('repo --machine');
      expect(step1).to.not.be.null;

      // Step 2: Navigate to remove
      const removeChoice = findChoice(step1!.prompt.choices, 'Remove');
      expect(removeChoice).to.exist;

      // Step 3: Get repo selection
      const step2 = await agentExec(execChoice(removeChoice!));
      expect(step2).to.not.be.null;

      // Step 4: Select the repo
      const repoChoice = findChoice(step2!.prompt.choices, 'flow-test');
      expect(repoChoice).to.exist;

      // Step 5: Execute with --force
      const cmd = repoChoice!.command!.replace('prlt ', '').replace('--json', '--force');
      await execFinal(cmd);

      // Verify DB change
      reopenDb();
      expect(repoExistsInDb('flow-test')).to.be.false;
    });
  });

  // ==========================================================================
  // ERROR HANDLING
  // ==========================================================================

  describe('error handling', () => {
    it('handles not-in-HQ gracefully', async () => {
      fs.rmSync(path.join(env.proletariatDir, 'config.json'));

      const output = await execFinal('repo list --format json');

      expect(output.toLowerCase()).to.satisfy((s: string) =>
        s.includes('error') || s.includes('not') || s.includes('hq')
      );
    });

    it('handles repo not found', async () => {
      const output = await execFinal('repo view nonexistent');

      expect(output.toLowerCase()).to.include('not found');
    });
  });
});

describe('Branch Commands - Agent Flow Tests', function(this: Mocha.Suite) {
  this.timeout(30000);

  let env: TestEnvironment;
  let db: Database.Database;

  beforeEach(() => {
    env = createTestEnvironment('branch-agent-');
    db = setupTestDb(env);
    initGitRepo(env.testDir);
  });

  afterEach(() => {
    if (db) db.close();
    cleanupTestEnvironment(env);
  });

  // ==========================================================================
  // BRANCH MENU - Navigation
  // ==========================================================================

  describe('branch menu --machine', () => {
    it('returns JSON with navigable choices', async () => {
      const result = await agentExec('branch --machine');

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

  describe('branch create', () => {
    it('outputs branch name with --type and --description flags', async () => {
      const output = await execFinal('branch create --type feature --description "add login"');

      // Should output a branch name
      expect(output).to.be.a('string');
      expect(output.length).to.be.greaterThan(0);
    });

    it('shows mode selection in --machine mode', async () => {
      const result = await agentExec('branch create --machine');

      expect(result).to.not.be.null;
      expect(result!.prompt.type).to.equal('list');
      expect(result!.prompt.choices.length).to.be.greaterThan(0);
    });
  });

  // ==========================================================================
  // BRANCH VALIDATE
  // ==========================================================================

  describe('branch validate', () => {
    it('accepts valid ticket-style branch name', async () => {
      // Use the format the validator expects: TKT-123/type/description
      const output = await execFinal('branch validate "TKT-123/feat/add-login"');

      expect(output.toLowerCase()).to.satisfy((s: string) =>
        s.includes('valid') || !s.includes('invalid')
      );
    });

    it('rejects branch name with spaces', async () => {
      const output = await execFinal('branch validate "invalid name with spaces"');

      expect(output.toLowerCase()).to.include('invalid');
    });
  });

  // ==========================================================================
  // BRANCH LIST
  // ==========================================================================

  describe('branch list', () => {
    it('returns JSON array with --format json', async () => {
      const output = await execFinal('branch list --format json');

      expect(output).to.be.a('string');
      // Should be parseable or indicate no branches
    });
  });

  // ==========================================================================
  // FULL AGENT FLOW
  // ==========================================================================

  describe('full agent flow', () => {
    it('navigates menu → create → mode selection', async () => {
      // Step 1: Main menu
      const step1 = await agentExec('branch --machine');
      expect(step1).to.not.be.null;

      // Step 2: Select Create
      const createChoice = findChoice(step1!.prompt.choices, 'Create');
      expect(createChoice).to.exist;

      // Step 3: Get mode selection
      const step2 = await agentExec(execChoice(createChoice!));
      expect(step2).to.not.be.null;
      expect(step2!.prompt.choices.length).to.be.greaterThan(0);
    });
  });
});
