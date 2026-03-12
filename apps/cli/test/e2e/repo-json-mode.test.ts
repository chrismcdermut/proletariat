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
  execInProcess,
  findChoice as sharedFindChoice,
  execChoice as sharedExecChoice,
  type TestEnvironment,
  type AgentPromptChoice,
} from './test-helpers.js';
import { initializePMOTables } from '../../src/lib/pmo/storage/base.js';
import { CREATE_TABLES_SQL } from '../../src/lib/database/index.js';

// Local exec wrapper that uses execInProcess with filtering
const exec = async (cmd: string): Promise<string> => {
  return execInProcess(cmd);
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
    it('should output valid JSON with prompt schema', async () => {
      const output = await exec('repo --machine');
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

    it('should work with -m shorthand', async () => {
      const output = await exec('repo -m');
      const json = extractJson<{ prompt: { type: string }; metadata: { flags: { machine: boolean } } }>(output);

      expect(json.prompt).to.exist;
      expect(json.metadata.flags.machine).to.equal(true);
    });

    it('should include command field in all choices', async () => {
      const output = await exec('repo --machine');
      const json = extractJson<{
        prompt: { choices: Array<{ name: string; command?: string }> };
      }>(output);

      for (const choice of json.prompt.choices) {
        expect(choice.command).to.be.a('string');
        expect(choice.command).to.include('prlt repo');
      }
    });

    it('should include --json flag in choice commands for flag accumulation', async () => {
      const output = await exec('repo --machine');
      const json = extractJson<{
        prompt: { choices: Array<{ command?: string }> };
      }>(output);

      for (const choice of json.prompt.choices) {
        expect(choice.command).to.include('--json');
      }
    });
  });

  describe('repo list --format json', () => {
    it('should output valid JSON array with --format json flag', async () => {
      // Add a test repo first
      const testRepoPath = path.join(env.testDir, 'repos', 'list-test-repo');
      fs.mkdirSync(testRepoPath, { recursive: true });
      initGitRepo(testRepoPath);
      createTestRepo('list-test-repo', 'repos/list-test-repo');

      const output = await exec('repo list --format json');
      const json = extractJson<Array<{ name: string; path: string }>>(output);

      expect(json).to.be.an('array');
      expect(json.length).to.be.greaterThan(0);
      expect(json[0]).to.have.property('name');
      expect(json[0]).to.have.property('path');
    });

    it('should output valid JSON with -f json shorthand', async () => {
      // Add a test repo first
      const testRepoPath = path.join(env.testDir, 'repos', 'shorthand-test-repo');
      fs.mkdirSync(testRepoPath, { recursive: true });
      initGitRepo(testRepoPath);
      createTestRepo('shorthand-test-repo', 'repos/shorthand-test-repo');

      const output = await exec('repo list -f json');
      const json = extractJson<Array<{ name: string }>>(output);

      expect(json).to.be.an('array');
      expect(json.length).to.be.greaterThan(0);
    });
  });

  describe('repo add --machine', () => {
    it('should output prompt JSON when path not provided', async () => {
      const output = await exec('repo add --machine');
      const json = extractJson<{
        prompt: { type: string; name: string; message: string };
        metadata: { command: string; flags: Record<string, unknown> };
      }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('list');
      expect(json.metadata.command).to.equal('repo add');
      expect(json.metadata.flags.machine).to.equal(true);
    });

    it('should work with -m shorthand', async () => {
      const output = await exec('repo add -m');
      const json = extractJson<{ prompt: { type: string }; metadata: { flags: { machine: boolean } } }>(output);

      expect(json.prompt).to.exist;
      expect(json.metadata.flags.machine).to.equal(true);
    });

    // Note: Adding repos requires test isolation which isn't supported with execInProcess.
    // The repo add prompt JSON output is tested above.
  });

  describe('repo view --machine', () => {

    it('should output prompt JSON when name not provided', async () => {
      // Add a test repo first so view has something to show
      const testRepoPath = path.join(env.testDir, 'repos', 'view-test-repo');
      fs.mkdirSync(testRepoPath, { recursive: true });
      initGitRepo(testRepoPath);
      createTestRepo('view-test-repo', 'repos/view-test-repo');

      const output = await exec('repo view --machine');
      const json = extractJson<{
        prompt: { type: string; name: string; message: string; choices: Array<{ name: string; value: string }> };
        metadata: { command: string; flags: Record<string, unknown> };
      }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('list');
      expect(json.metadata.flags.machine).to.equal(true);
    });

    it('should include command field in choices for flag accumulation', async () => {
      // Add a test repo first so view has something to show
      const testRepoPath = path.join(env.testDir, 'repos', 'view-flag-test-repo');
      fs.mkdirSync(testRepoPath, { recursive: true });
      initGitRepo(testRepoPath);
      createTestRepo('view-flag-test-repo', 'repos/view-flag-test-repo');

      const output = await exec('repo view --machine');
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
    it('should output prompt JSON when name not provided', async () => {
      // Add a test repo first so remove has something to show
      const testRepoPath = path.join(env.testDir, 'repos', 'remove-test-repo');
      fs.mkdirSync(testRepoPath, { recursive: true });
      initGitRepo(testRepoPath);
      createTestRepo('remove-test-repo', 'repos/remove-test-repo');

      const output = await exec('repo remove --machine');
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
    async function agentExec(cmd: string): Promise<AgentPrompt> {
      const output = await exec(cmd);
      return extractJson<AgentPrompt>(output);
    }

    const findChoice = sharedFindChoice;
    const execChoice = sharedExecChoice;

    describe('repo menu navigation', () => {
      it('should navigate from repo menu to repo add', async () => {
        // Agent Step 1: Get main menu
        const step1 = await agentExec('repo --machine');
        expect(step1.prompt.type).to.equal('list');

        // Find add choice
        const addChoice = findChoice(step1.prompt.choices!, 'Add repository');
        expect(addChoice).to.exist;
        expect(addChoice!.command).to.include('repo add');

        // Agent Step 2: Navigate to repo add
        const step2 = await agentExec(execChoice(addChoice!));
        expect(step2.prompt.type).to.equal('list');
        expect(step2.prompt.choices).to.be.an('array');
      });

      it('should navigate from repo menu to repo list', async () => {
        // Agent Step 1: Get main menu
        const step1 = await agentExec('repo --machine');
        expect(step1.prompt.type).to.equal('list');

        // Find list choice
        const listChoice = findChoice(step1.prompt.choices!, 'List all repositories');
        expect(listChoice).to.exist;
        expect(listChoice!.command).to.include('repo list');
        expect(listChoice!.command).to.include('--json');
      });

      it('should navigate from repo menu to repo view', async () => {
        // Agent Step 1: Get main menu
        const step1 = await agentExec('repo --machine');
        expect(step1.prompt.type).to.equal('list');

        // Find view choice
        const viewChoice = findChoice(step1.prompt.choices!, 'View repository details');
        expect(viewChoice).to.exist;
        expect(viewChoice!.command).to.include('repo view');
      });

      it('should navigate from repo menu to repo remove', async () => {
        // Agent Step 1: Get main menu
        const step1 = await agentExec('repo --machine');
        expect(step1.prompt.type).to.equal('list');

        // Find remove choice
        const removeChoice = findChoice(step1.prompt.choices!, 'Remove repository');
        expect(removeChoice).to.exist;
        expect(removeChoice!.command).to.include('repo remove');
      });
    });

    describe('repo add - agent navigation', () => {
      it('should show method selection options', async () => {
        const step1 = await agentExec('repo add --machine');
        expect(step1.prompt.type).to.equal('list');
        expect(step1.prompt.choices).to.be.an('array');

        // Should have manual and bulk options
        const manualChoice = findChoice(step1.prompt.choices!, 'Enter path');
        expect(manualChoice).to.exist;
      });
    });

    describe('repo view - agent navigation', () => {
      it('should output repo selection prompt', async () => {
        // Add a test repo first
        const testRepoPath = path.join(env.testDir, 'repos', 'agent-view-repo');
        fs.mkdirSync(testRepoPath, { recursive: true });
        initGitRepo(testRepoPath);
        createTestRepo('agent-view-repo', 'repos/agent-view-repo');

        const step1 = await agentExec('repo view --machine');
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
      it('should output repo selection prompt', async () => {
        // Add a test repo first
        const testRepoPath = path.join(env.testDir, 'repos', 'agent-remove-repo');
        fs.mkdirSync(testRepoPath, { recursive: true });
        initGitRepo(testRepoPath);
        createTestRepo('agent-remove-repo', 'repos/agent-remove-repo');

        const step1 = await agentExec('repo remove --machine');
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
      it('should return repos as JSON array with --format json', async () => {
        // Add a test repo first
        const testRepoPath = path.join(env.testDir, 'repos', 'agent-list-repo');
        fs.mkdirSync(testRepoPath, { recursive: true });
        initGitRepo(testRepoPath);
        createTestRepo('agent-list-repo', 'repos/agent-list-repo');

        // Use --format json since repo list uses that flag
        const output = await exec('repo list --format json');
        const repos = extractJson<Array<{ name: string; path: string }>>(output);

        expect(repos).to.be.an('array');
        expect(repos.length).to.be.greaterThan(0);
        expect(repos[0]).to.have.property('name');
        expect(repos[0]).to.have.property('path');
      });
    });

    describe('backward compatibility: --json flag', () => {
      it('should work with --json flag same as --machine for prompts', async () => {
        const machineResult = await agentExec('repo --machine');
        const jsonResult = await agentExec('repo --json');

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
  // Use production PMO schema (ensures all columns including position, epic_id, etc.)
  initializePMOTables(db);

  // Create workspace tables using production schema
  db.exec(CREATE_TABLES_SQL);

  // Insert workspace record
  db.prepare(`
    INSERT INTO workspace (id, type, workspace_name, has_pmo, created_at)
    VALUES (1, 'hq', 'test-workspace', 1, datetime('now'))
  `).run();

  // Insert test project (builtin 'default' workflow is seeded by initializePMOTables)
  db.prepare(`
    INSERT INTO pmo_projects (id, name, description, workflow_id)
    VALUES ('test-project', 'Test Project', 'E2E test project', 'default')
  `).run();

  db.prepare(`
    INSERT OR REPLACE INTO pmo_settings (key, value)
    VALUES ('pmo_path', ?)
  `).run(pmoPath);
  db.prepare(`
    INSERT OR REPLACE INTO pmo_settings (key, value)
    VALUES ('current_project', 'test-project')
  `).run();
}
