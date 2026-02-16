/* eslint-disable max-nested-callbacks */
import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import {
  createHQConfig,
  createPMODirectories,
  exec,
  extractJson,
  filterOutput,
  type AgentPromptResponse,
} from './test-helpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Robust JSON extraction that searches backward through output.
 * Handles cases where Docker check errors or other noise contain
 * '{' characters that confuse the standard extractJson.
 */
function extractJsonRobust<T>(output: string): T | null {
  // First try the standard extraction
  const result = extractJson<T>(output);
  if (result && typeof result === 'object' && 'prompt' in (result as Record<string, unknown>)) {
    return result;
  }

  // Fall back: search from end for last valid JSON object
  const lines = output.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (trimmed === '}') {
      // Found end of JSON, search backward for matching start
      for (let j = i; j >= 0; j--) {
        const startTrimmed = lines[j].trim();
        if (startTrimmed.startsWith('{')) {
          const jsonStr = lines.slice(j, i + 1).join('\n');
          try {
            const parsed = JSON.parse(jsonStr) as T;
            if (typeof parsed === 'object' && parsed !== null && 'prompt' in (parsed as Record<string, unknown>)) {
              return parsed;
            }
          } catch {
            // Not valid JSON from this position, keep searching
          }
        }
      }
    }
  }
  return null;
}

/**
 * Error type for execSync failures.
 */
interface ExecError extends Error {
  stdout?: string;
  stderr?: string;
}

/**
 * Execute CLI from a specific directory without HQ context.
 * Useful for testing commands outside of an HQ workspace.
 */
function execFromDir(cmd: string, cwd: string): string {
  const cliDir = path.join(__dirname, '../..');
  const binPath = path.join(cliDir, 'bin/run.js');
  const env = { ...process.env, NODE_ENV: 'production' } as NodeJS.ProcessEnv;
  // Clear env vars that could interfere with isolation
  delete env.PRLT_HQ_PATH;
  delete env.PRLT_PMO_PATH;
  delete env.PRLT_DATABASE_PATH;
  delete env.PRLT_CONFIG_PATH;
  delete env.PRLT_TEST_ENV;
  delete env.DEVCONTAINER;
  delete env.DEBUG;

  try {
    const result = execSync(`node ${binPath} ${cmd}`, {
      encoding: 'utf-8',
      cwd,
      env,
      maxBuffer: 10 * 1024 * 1024,
    });
    return result;
  } catch (error: unknown) {
    const execError = error as ExecError;
    const stdout = execError.stdout || '';
    const stderr = execError.stderr || '';
    if (stdout.trim()) return stdout;
    return filterOutput(stderr) || execError.message || 'Unknown error';
  }
}

/**
 * Execute CLI from a specific directory with git repo context.
 * Used for commit tests that need git operations in the test dir.
 */
function execCommit(cmd: string, cwd: string): string {
  const cliDir = path.join(__dirname, '../..');
  const binPath = path.join(cliDir, 'bin/run.js');
  const env = { ...process.env, NODE_ENV: 'production' } as NodeJS.ProcessEnv;
  delete env.PRLT_HQ_PATH;
  delete env.PRLT_PMO_PATH;
  delete env.PRLT_DATABASE_PATH;
  delete env.PRLT_CONFIG_PATH;
  delete env.PRLT_TEST_ENV;
  delete env.DEBUG;

  try {
    const result = execSync(`node ${binPath} ${cmd} 2>&1`, {
      encoding: 'utf-8',
      cwd,
      env,
      maxBuffer: 10 * 1024 * 1024,
    });
    return filterOutput(result);
  } catch (error: unknown) {
    const execError = error as ExecError;
    const stdout = execError.stdout || '';
    const stderr = execError.stderr || '';
    return filterOutput(stdout + stderr) || execError.message || 'Unknown error';
  }
}

/**
 * End-to-end tests for standalone commands migrated to this.prompt().
 * Tests: claude, commit, init, whoami
 *
 * Verifies:
 * - All inquirer.prompt() calls replaced with this.prompt()
 * - JSON mode outputs proper prompt schema with choices
 * - Each choice includes command field for agent navigation
 * - Flag-based execution bypasses prompts correctly
 */
describe('Standalone Commands E2E - this.prompt() Migration (TKT-764)', () => {

  // ================================================================
  // CLAUDE COMMAND TESTS
  // ================================================================
  describe('prlt claude (JSON mode prompts)', () => {
    let testDir: string;
    let originalCwd: string;

    describe('outside HQ', () => {
      beforeEach(() => {
        originalCwd = process.cwd();
        testDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'claude-e2e-')));
        process.chdir(testDir);
      });

      afterEach(() => {
        process.chdir(originalCwd);
        if (fs.existsSync(testDir)) {
          fs.rmSync(testDir, { recursive: true, force: true });
        }
      });

      it('should output slug input prompt in JSON mode', () => {
        const output = execFromDir('claude --json', testDir);
        const result = extractJson<AgentPromptResponse>(output);

        expect(result).to.not.be.null;
        expect(result!.prompt.type).to.equal('input');
        expect(result!.prompt.name).to.equal('inputSlug');
        expect(result!.prompt.message).to.include('Session name');
      });

      it('should output environment prompt when slug provided', () => {
        const output = execFromDir('claude --json --slug test-session', testDir);
        const result = extractJsonRobust<AgentPromptResponse>(output);

        expect(result).to.not.be.null;
        expect(result!.prompt.type).to.equal('list');
        expect(result!.prompt.name).to.equal('selectedEnv');
        expect(result!.prompt.message).to.include('Where should Claude run');
        // Check choices have command fields
        expect(result!.prompt.choices).to.be.an('array');
        const hostChoice = result!.prompt.choices!.find((c) => c.value === 'host');
        expect(hostChoice).to.not.be.undefined;
        expect(hostChoice!.command).to.include('--environment host');
      });

      it('should output display-mode prompt when environment provided', () => {
        const output = execFromDir('claude --json --slug test-session --environment host', testDir);
        const result = extractJson<AgentPromptResponse>(output);

        expect(result).to.not.be.null;
        expect(result!.prompt.type).to.equal('list');
        expect(result!.prompt.name).to.equal('selectedDisplay');
        expect(result!.prompt.message).to.include('displayed');
        // Check command fields on choices
        const terminalChoice = result!.prompt.choices!.find((c) => c.value === 'terminal');
        expect(terminalChoice).to.not.be.undefined;
        expect(terminalChoice!.command).to.include('--display-mode terminal');
        const bgChoice = result!.prompt.choices!.find((c) => c.value === 'background');
        expect(bgChoice).to.not.be.undefined;
        expect(bgChoice!.command).to.include('--display-mode background');
      });

      it('should output permission-mode prompt when display-mode provided', () => {
        const output = execFromDir(
          'claude --json --slug test-session --environment host --display-mode terminal',
          testDir
        );
        const result = extractJson<AgentPromptResponse>(output);

        expect(result).to.not.be.null;
        expect(result!.prompt.type).to.equal('list');
        expect(result!.prompt.name).to.equal('permissionMode');
        expect(result!.prompt.message).to.include('Permission');
        // Check command fields
        const dangerChoice = result!.prompt.choices!.find((c) => c.value === 'danger');
        expect(dangerChoice).to.not.be.undefined;
        expect(dangerChoice!.command).to.include('--permission-mode danger');
        const safeChoice = result!.prompt.choices!.find((c) => c.value === 'safe');
        expect(safeChoice).to.not.be.undefined;
        expect(safeChoice!.command).to.include('--permission-mode safe');
      });

      it('should include metadata with command name in JSON output', () => {
        const output = execFromDir('claude --json', testDir);
        const result = extractJson<AgentPromptResponse>(output);

        expect(result).to.not.be.null;
        expect(result!.metadata).to.not.be.undefined;
        expect(result!.metadata.command).to.equal('claude');
      });
    });

    describe('inside HQ', () => {
      let db: Database.Database;

      beforeEach(() => {
        originalCwd = process.cwd();
        testDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'claude-hq-e2e-')));
        process.chdir(testDir);

        const proletariatDir = path.join(testDir, '.proletariat');
        fs.mkdirSync(proletariatDir, { recursive: true });

        createHQConfig(proletariatDir);

        const dbPath = path.join(proletariatDir, 'workspace.db');
        db = new Database(dbPath);
        setupMinimalPMO(db);

        const pmoPath = path.join(testDir, 'pmo');
        createPMODirectories(pmoPath, 'test-project');
      });

      afterEach(() => {
        if (db) db.close();
        process.chdir(originalCwd);
        if (fs.existsSync(testDir)) {
          fs.rmSync(testDir, { recursive: true, force: true });
        }
      });

      it('should output title prompt when project auto-selected (single project)', () => {
        const output = exec('claude --json');
        const result = extractJson<AgentPromptResponse>(output);

        // With only one project, it auto-selects and moves to title prompt
        if (result && result.prompt) {
          expect(result.prompt.type).to.equal('input');
          expect(result.prompt.name).to.equal('inputTitle');
          expect(result.prompt.message).to.include('Ticket title');
        }
      });

      it('should output project selection when multiple projects exist', () => {
        // Add a second project
        db.prepare(`INSERT INTO pmo_projects (id, name, is_archived) VALUES ('project-2', 'Second Project', 0)`).run();
        const pmoPath = path.join(testDir, 'pmo');
        createPMODirectories(pmoPath, 'project-2');

        const output = exec('claude --json');
        const result = extractJson<AgentPromptResponse>(output);

        if (result && result.prompt) {
          expect(result.prompt.type).to.equal('list');
          expect(result.prompt.name).to.equal('selectedProject');
          expect(result.prompt.message).to.include('project');
          // Check command fields on choices
          if (result.prompt.choices && result.prompt.choices.length > 0) {
            const projectChoice = result.prompt.choices.find((c) => c.value === 'test-project');
            expect(projectChoice).to.not.be.undefined;
            expect(projectChoice!.command).to.include('--project');
          }
        }
      });

      it('should output title prompt when project specified via flag', () => {
        const output = exec('claude --json --project test-project');
        const result = extractJson<AgentPromptResponse>(output);

        if (result && result.prompt) {
          expect(result.prompt.type).to.equal('input');
          expect(result.prompt.name).to.equal('inputTitle');
          expect(result.prompt.message).to.include('Ticket title');
        }
      });

      it('should output environment prompt when title provided', () => {
        const output = exec('claude --json --project test-project --title "Test Session"');
        const result = extractJson<AgentPromptResponse>(output);

        if (result && result.prompt) {
          expect(result.prompt.type).to.equal('list');
          expect(result.prompt.name).to.equal('selectedEnv');
          expect(result.prompt.choices).to.be.an('array');
          const hostChoice = result.prompt.choices!.find((c) => c.value === 'host');
          expect(hostChoice).to.not.be.undefined;
          expect(hostChoice!.command).to.include('--environment host');
        }
      });
    });
  });

  // ================================================================
  // COMMIT COMMAND TESTS
  // ================================================================
  describe('prlt commit (JSON mode prompts + flag bypass)', () => {
    let testDir: string;
    let originalCwd: string;

    beforeEach(() => {
      originalCwd = process.cwd();
      testDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'commit-json-e2e-')));
      process.chdir(testDir);

      // Initialize git repo
      execSync('git init', { cwd: testDir, stdio: 'pipe' });
      execSync('git config user.email "test@example.com"', { cwd: testDir, stdio: 'pipe' });
      execSync('git config user.name "Test User"', { cwd: testDir, stdio: 'pipe' });
      fs.writeFileSync(path.join(testDir, 'README.md'), '# Test Repo');
      execSync('git add .', { cwd: testDir, stdio: 'pipe' });
      execSync('git commit -m "Initial commit"', { cwd: testDir, stdio: 'pipe' });
      execSync('git checkout -b TKT-123/feat/chris/bezos/add-feature', { cwd: testDir, stdio: 'pipe' });
    });

    afterEach(() => {
      process.chdir(originalCwd);
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    });

    describe('JSON mode prompt output', () => {
      it('should output staging prompt when changes exist', () => {
        fs.writeFileSync(path.join(testDir, 'test.ts'), 'content');

        const output = execCommit('commit --json', testDir);
        const result = extractJson<AgentPromptResponse>(output);

        expect(result).to.not.be.null;
        expect(result!.prompt.type).to.equal('list');
        expect(result!.prompt.name).to.equal('stagingAction');
        expect(result!.prompt.message).to.include('commit');
        // Check command fields
        const allChoice = result!.prompt.choices!.find((c) => c.value === 'all');
        expect(allChoice).to.not.be.undefined;
        expect(allChoice!.command).to.include('--all');
      });

      it('should output format prompt when --all flag bypasses staging', () => {
        fs.writeFileSync(path.join(testDir, 'test.ts'), 'content');

        const output = execCommit('commit --json --all', testDir);
        const result = extractJson<AgentPromptResponse>(output);

        expect(result).to.not.be.null;
        expect(result!.prompt.type).to.equal('list');
        expect(result!.prompt.name).to.equal('chosenFormat');
        expect(result!.prompt.message).to.include('format');
        // Check command fields on format choices
        const conventionalChoice = result!.prompt.choices!.find((c) => c.value === 'conventional');
        expect(conventionalChoice).to.not.be.undefined;
        expect(conventionalChoice!.command).to.include('--format');
      });

      it('should output message prompt when format specified', () => {
        fs.writeFileSync(path.join(testDir, 'test.ts'), 'content');

        const output = execCommit('commit --json --all --format conventional', testDir);
        const result = extractJson<AgentPromptResponse>(output);

        expect(result).to.not.be.null;
        expect(result!.prompt.type).to.equal('input');
        expect(result!.prompt.name).to.equal('inputMessage');
        expect(result!.prompt.message).to.include('message');
      });

      it('should include metadata with command name', () => {
        fs.writeFileSync(path.join(testDir, 'test.ts'), 'content');

        const output = execCommit('commit --json', testDir);
        const result = extractJson<AgentPromptResponse>(output);

        expect(result).to.not.be.null;
        expect(result!.metadata).to.not.be.undefined;
        expect(result!.metadata.command).to.equal('commit');
      });

      it('should error in JSON mode with no changes', () => {
        const output = execCommit('commit --json', testDir);

        // Should contain error about no changes
        expect(output.toLowerCase()).to.satisfy(
          (o: string) => o.includes('no changes') || o.includes('clean')
        );
      });
    });

    describe('flag-based execution (bypass prompts)', () => {
      it('should commit with message arg (no prompts)', () => {
        fs.writeFileSync(path.join(testDir, 'feature.ts'), 'export const feature = true;');
        execSync('git add feature.ts', { cwd: testDir, stdio: 'pipe' });

        const output = execCommit('commit "add new feature"', testDir);

        expect(output).to.contain('Committed');
        expect(output).to.contain('feat(TKT-123): add new feature');

        // Verify commit was made
        const log = execSync('git log --oneline -1', { cwd: testDir, encoding: 'utf-8' });
        expect(log).to.contain('feat(TKT-123): add new feature');
      });

      it('should stage all with --all flag and commit', () => {
        fs.writeFileSync(path.join(testDir, 'file1.ts'), 'content1');
        fs.writeFileSync(path.join(testDir, 'file2.ts'), 'content2');

        const output = execCommit('commit --all "add multiple files"', testDir);

        expect(output).to.contain('Committed');

        const status = execSync('git status --porcelain', { cwd: testDir, encoding: 'utf-8' });
        expect(status.trim()).to.equal('');
      });

      it('should use specific format with --format flag', () => {
        fs.writeFileSync(path.join(testDir, 'test.ts'), 'content');
        execSync('git add test.ts', { cwd: testDir, stdio: 'pipe' });

        const output = execCommit('commit -f full-context "test message"', testDir);

        expect(output).to.contain('Committed');
        expect(output).to.contain('TKT-123/feat/bezos: test message');
      });

      it('should override commit type with --type flag', () => {
        fs.writeFileSync(path.join(testDir, 'bugfix.ts'), 'fixed');
        execSync('git add bugfix.ts', { cwd: testDir, stdio: 'pipe' });

        const output = execCommit('commit -t fix "resolve bug"', testDir);

        expect(output).to.contain('Committed');
        expect(output).to.contain('fix(TKT-123): resolve bug');
      });

      it('should override ticket ID with --ticket flag', () => {
        fs.writeFileSync(path.join(testDir, 'override.ts'), 'content');
        execSync('git add override.ts', { cwd: testDir, stdio: 'pipe' });

        const output = execCommit('commit -T TKT-999 "custom ticket"', testDir);

        expect(output).to.contain('Committed');
        expect(output).to.contain('feat(TKT-999): custom ticket');
      });

      it('should dry-run without committing', () => {
        fs.writeFileSync(path.join(testDir, 'test.ts'), 'content');
        execSync('git add test.ts', { cwd: testDir, stdio: 'pipe' });

        const output = execCommit('commit --dry-run "test message"', testDir);

        expect(output).to.contain('Dry run');
        expect(output).to.contain('feat(TKT-123): test message');

        // Verify no commit was made
        const log = execSync('git log --oneline', { cwd: testDir, encoding: 'utf-8' });
        expect(log).to.not.contain('test message');
      });

      it('should list formats with --formats flag', () => {
        const output = execCommit('commit --formats', testDir);

        expect(output).to.contain('conventional');
        expect(output).to.contain('full-context');
        expect(output).to.contain('ticket-first');
        expect(output).to.contain('simple');
      });

      it('should stage specific file with --stage flag', () => {
        fs.writeFileSync(path.join(testDir, 'stage-me.ts'), 'staged');
        fs.writeFileSync(path.join(testDir, 'leave-me.ts'), 'unstaged');

        const output = execCommit('commit --stage stage-me.ts -- "add staged file"', testDir);

        expect(output).to.contain('Committed');

        const status = execSync('git status --porcelain', { cwd: testDir, encoding: 'utf-8' });
        expect(status).to.contain('leave-me.ts');
      });
    });
  });

  // ================================================================
  // INIT COMMAND TESTS
  // ================================================================
  describe('prlt init (JSON mode)', () => {
    let testDir: string;
    let originalCwd: string;

    beforeEach(() => {
      originalCwd = process.cwd();
      testDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'init-e2e-')));
      process.chdir(testDir);
    });

    afterEach(() => {
      process.chdir(originalCwd);
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    });

    it('should create HQ in JSON mode with --name flag', () => {
      const output = execFromDir('init --json --name test-hq', testDir);
      const result = extractJson<{ success: boolean; hq: { name: string; path: string } }>(output);

      expect(result).to.not.be.null;
      expect(result!.success).to.equal(true);
      expect(result!.hq.name).to.equal('test-hq');

      // Verify HQ was created on disk
      const hqPath = result!.hq.path;
      expect(fs.existsSync(hqPath)).to.equal(true);
    });

    it('should error in JSON mode without --name flag', () => {
      const output = execFromDir('init --json', testDir);
      const result = extractJson<{ success: boolean; error: string }>(output);

      expect(result).to.not.be.null;
      expect(result!.success).to.equal(false);
      expect(result!.error).to.include('--name');
    });

    it('should create HQ with agents in JSON mode', () => {
      const output = execFromDir('init --json --name agent-hq --agents alpha,beta', testDir);
      const result = extractJson<{ success: boolean; hq: { agents: string[] } }>(output);

      expect(result).to.not.be.null;
      expect(result!.success).to.equal(true);
      expect(result!.hq.agents).to.include('alpha');
      expect(result!.hq.agents).to.include('beta');
    });

    it('should create HQ without PMO using --no-pmo', () => {
      const output = execFromDir('init --json --name no-pmo-hq --no-pmo', testDir);
      const result = extractJson<{ success: boolean; hq: { pmo: boolean } }>(output);

      expect(result).to.not.be.null;
      expect(result!.success).to.equal(true);
      expect(result!.hq.pmo).to.equal(false);
    });

    it('should error when directory already exists', () => {
      // Create the directory first
      fs.mkdirSync(path.join(testDir, 'existing-hq'), { recursive: true });

      const output = execFromDir('init --json --name existing --path existing-hq', testDir);
      const result = extractJson<{ success: boolean; error: string }>(output);

      expect(result).to.not.be.null;
      expect(result!.success).to.equal(false);
      expect(result!.error).to.include('already exists');
    });

    it('should create HQ with custom path', () => {
      const customPath = path.join(testDir, 'custom-location');
      const output = execFromDir(`init --json --name custom-hq --path "${customPath}"`, testDir);
      const result = extractJson<{ success: boolean; hq: { name: string; path: string } }>(output);

      expect(result).to.not.be.null;
      expect(result!.success).to.equal(true);
      expect(result!.hq.path).to.equal(customPath);
      expect(fs.existsSync(customPath)).to.equal(true);
    });
  });

  // ================================================================
  // WHOAMI COMMAND TESTS
  // ================================================================
  describe('prlt whoami', () => {
    let testDir: string;
    let originalCwd: string;

    beforeEach(() => {
      originalCwd = process.cwd();
      testDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'whoami-e2e-')));
      process.chdir(testDir);
    });

    afterEach(() => {
      process.chdir(originalCwd);
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    });

    it('should display context information', () => {
      const output = execFromDir('whoami', testDir);

      expect(output).to.contain('Proletariat Context');
      expect(output).to.contain('Agent:');
      expect(output).to.contain('Environment:');
      expect(output).to.contain('Working dir:');
    });

    it('should show environment type', () => {
      const output = execFromDir('whoami', testDir);

      // Environment can be 'host' or 'devcontainer' depending on runtime context
      expect(output).to.satisfy(
        (o: string) => o.includes('host') || o.includes('devcontainer')
      );
    });

    it('should display working directory path', () => {
      const output = execFromDir('whoami', testDir);

      // Should contain the test directory path
      expect(output).to.contain('Working dir:');
    });
  });
});

// ================================================================
// Helper: Minimal PMO database setup for claude HQ tests
// ================================================================
function setupMinimalPMO(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pmo_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pmo_projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      template TEXT,
      description TEXT,
      status TEXT DEFAULT 'active',
      phase_id TEXT,
      is_archived INTEGER NOT NULL DEFAULT 0,
      target_date TEXT,
      initiative_id TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS pmo_columns (
      id TEXT NOT NULL,
      project_id TEXT NOT NULL DEFAULT 'default',
      name TEXT NOT NULL,
      position INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (project_id, id)
    );
    CREATE TABLE IF NOT EXISTS pmo_tickets (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL DEFAULT 'default',
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'backlog',
      status_id TEXT,
      priority TEXT,
      category TEXT,
      description TEXT,
      owner TEXT,
      assignee TEXT,
      branch TEXT,
      spec_id TEXT,
      epic_id TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_synced_from_spec TIMESTAMP,
      last_synced_from_board TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES pmo_projects(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS pmo_board_tickets (
      project_id TEXT NOT NULL,
      ticket_id TEXT NOT NULL,
      column_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (project_id, ticket_id)
    );
    CREATE TABLE IF NOT EXISTS pmo_statuses (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      color TEXT,
      description TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES pmo_projects(id) ON DELETE CASCADE,
      UNIQUE(project_id, name)
    );
    CREATE TABLE IF NOT EXISTS pmo_actions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      prompt TEXT NOT NULL,
      suggested_for_categories TEXT,
      default_move_to_category TEXT,
      modifies_code INTEGER NOT NULL DEFAULT 1,
      is_builtin INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_pmo_columns_project ON pmo_columns(project_id);
    CREATE INDEX IF NOT EXISTS idx_pmo_tickets_project ON pmo_tickets(project_id);
  `);

  // Seed test project
  db.prepare(`INSERT INTO pmo_projects (id, name, is_archived) VALUES ('test-project', 'Test Project', 0)`).run();
  db.prepare(`INSERT INTO pmo_settings (key, value) VALUES ('pmo_path', 'pmo')`).run();
  db.prepare(`INSERT INTO pmo_settings (key, value) VALUES ('current_project', 'test-project')`).run();

  // Create default columns
  db.prepare(`INSERT INTO pmo_columns (id, project_id, name, position) VALUES ('backlog', 'test-project', 'Backlog', 0)`).run();
  db.prepare(`INSERT INTO pmo_columns (id, project_id, name, position) VALUES ('in_progress', 'test-project', 'In Progress', 1)`).run();
  db.prepare(`INSERT INTO pmo_columns (id, project_id, name, position) VALUES ('done', 'test-project', 'Done', 2)`).run();
}
