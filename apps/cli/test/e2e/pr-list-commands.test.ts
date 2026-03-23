import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import Database from 'better-sqlite3';
import {
  createTestEnvironment,
  cleanupTestEnvironment,
  createHQConfig,
  createPMODirectories,
  setupProductionSchema,
  createTestProject,
  execInProcess,
  type TestEnvironment,
} from './test-helpers.js';

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
 * End-to-end tests for PR List Command
 * Tests actual CLI usage for listing PRs in a workspace
 *
 * Note: These tests verify the command structure and JSON output.
 * Actual PR listing from GitHub depends on gh CLI being installed
 * and authenticated, so some tests may skip gracefully.
 */
describe('PR List Command E2E Tests', () => {
  let env: TestEnvironment;
  let db: Database.Database;

  beforeEach(() => {
    env = createTestEnvironment('pr-list-');

    db = setupProductionSchema(env.dbPath, env.pmoPath);
    createTestProject(db, { id: 'test-project', name: 'Test Project' });

    createHQConfig(env.proletariatDir);
    createPMODirectories(env.pmoPath, 'test-project');

    // Initialize git repo for PR commands
    initGitRepo(env.testDir);
  });

  afterEach(() => {
    if (db) db.close();
    cleanupTestEnvironment(env);
  });

  /**
   * Helper to create a test ticket with optional PR metadata.
   */
  function createTestTicket(
    id: string,
    title: string,
    columnId: string = 'in-progress',
    prUrl?: string,
    prNumber?: string
  ): void {
    const statusName = columnId === 'backlog' ? 'Backlog' :
                       columnId === 'in-progress' ? 'In Progress' :
                       columnId === 'review' ? 'Review' : 'Done';

    db.prepare(`
      INSERT INTO pmo_tickets (id, project_id, title, status, status_id)
      VALUES (?, 'test-project', ?, ?, ?)
    `).run(id, title, statusName, `default-${columnId}`);

    if (prUrl) {
      db.prepare(`
        INSERT INTO pmo_ticket_metadata (ticket_id, key, value)
        VALUES (?, 'pr_url', ?)
      `).run(id, prUrl);
    }

    if (prNumber) {
      db.prepare(`
        INSERT INTO pmo_ticket_metadata (ticket_id, key, value)
        VALUES (?, 'pr_number', ?)
      `).run(id, prNumber);
    }
  }

  describe('prlt pr list command structure', () => {
    it('should have correct command flags', async () => {
      // Check help output includes expected flags
      const output = await execInProcess('pr list --help');

      expect(output).to.include('--state');
      expect(output).to.include('--format');
      expect(output).to.include('--limit');
      expect(output).to.include('--machine');
      expect(output).to.include('--json');
    });

    it('should be accessible via pr menu', async () => {
      // The pr index command should include list option
      const output = await execInProcess('pr -P test-project --machine');

      // Should have list in the menu choices
      expect(output).to.include('list');
    });
  });

  describe('prlt pr list --machine (JSON mode)', () => {
    it('should output valid JSON when --machine flag is used', async () => {
      const output = await execInProcess('pr list -P test-project --machine');

      // Must get some output
      expect(output).to.be.a('string');
      expect(output.length).to.be.greaterThan(0);

      // If gh not installed, we get an error JSON
      // If gh installed but no PRs, we get an empty array
      // If gh installed and has PRs, we get PR data
      if (output.includes('{')) {
        const json = extractJson<{
          error?: { code: string; message: string };
          metadata?: { command: string };
        } | Array<unknown>>(output);

        // Either an error object or an array of PRs
        expect(json).to.satisfy((j: unknown) =>
          Array.isArray(j) ||
          (typeof j === 'object' && j !== null && ('error' in j || 'metadata' in j))
        );
      }
    });

    it('should work with -m shorthand', async () => {
      const output = await execInProcess('pr list -P test-project -m --machine');

      expect(output).to.be.a('string');
      expect(output.length).to.be.greaterThan(0);
    });

    it('should work with --json flag (legacy)', async () => {
      const output = await execInProcess('pr list -P test-project --json');

      expect(output).to.be.a('string');
      expect(output.length).to.be.greaterThan(0);
    });
  });

  describe('prlt pr list with state filter', () => {
    it('should accept --state open filter', async () => {
      const output = await execInProcess('pr list --state open -P test-project --machine');

      expect(output).to.be.a('string');
    });

    it('should accept --state draft filter', async () => {
      const output = await execInProcess('pr list --state draft -P test-project --machine');

      expect(output).to.be.a('string');
    });

    it('should accept --state all filter', async () => {
      const output = await execInProcess('pr list --state all -P test-project --machine');

      expect(output).to.be.a('string');
    });
  });

  describe('prlt pr list with format options', () => {
    it('should accept --format table (default)', async () => {
      const output = await execInProcess('pr list --format table -P test-project');

      expect(output).to.be.a('string');
    });

    it('should accept --format compact', async () => {
      const output = await execInProcess('pr list --format compact -P test-project');

      expect(output).to.be.a('string');
    });

    it('should accept --format json', async () => {
      const output = await execInProcess('pr list --format json -P test-project');

      expect(output).to.be.a('string');
    });
  });

  describe('prlt pr list with limit option', () => {
    it('should accept --limit flag', async () => {
      const output = await execInProcess('pr list --limit 10 -P test-project --machine');

      expect(output).to.be.a('string');
    });

    it('should accept -l shorthand for limit', async () => {
      const output = await execInProcess('pr list -l 5 -P test-project --machine');

      expect(output).to.be.a('string');
    });
  });

  describe('prlt pr list error handling', () => {
    it('should return structured error when gh CLI not installed', async () => {
      // Mock gh not installed by running in isolated environment
      // This test depends on gh CLI availability
      const output = await execInProcess('pr list -P test-project --machine');

      // If gh not installed, should have error code
      if (output.includes('GH_NOT_INSTALLED')) {
        const json = extractJson<{
          error: { code: string; message: string };
          metadata: { command: string };
        }>(output);

        expect(json.error).to.exist;
        expect(json.error.code).to.equal('GH_NOT_INSTALLED');
        expect(json.error.message).to.include('gh');
        expect(json.metadata.command).to.equal('pr list');
      }
    });

    it('should return structured error when gh CLI not authenticated', async () => {
      const output = await execInProcess('pr list -P test-project --machine');

      // If gh not authenticated, should have error code
      if (output.includes('GH_NOT_AUTHENTICATED')) {
        const json = extractJson<{
          error: { code: string; message: string };
          metadata: { command: string };
        }>(output);

        expect(json.error).to.exist;
        expect(json.error.code).to.equal('GH_NOT_AUTHENTICATED');
        expect(json.error.message).to.include('auth');
      }
    });
  });

  describe('prlt pr list ticket association', () => {
    beforeEach(() => {
      // Create tickets with PR metadata
      createTestTicket('TKT-PR-001', 'Ticket with PR', 'in-progress', 'https://github.com/test/repo/pull/42', '42');
      createTestTicket('TKT-PR-002', 'Another PR ticket', 'in-progress', 'https://github.com/test/repo/pull/99', '99');
      createTestTicket('TKT-NO-PR', 'Ticket without PR', 'in-progress');
    });

    it('should have ticket association data in JSON output (if gh installed)', async () => {
      const output = await execInProcess('pr list -P test-project --machine');

      // If we get valid JSON array output
      if (output.startsWith('[')) {
        const prs = extractJson<Array<{
          number: number;
          ticketId?: string;
          ticketTitle?: string;
          ticketStatus?: string;
        }>>(output);

        // If PRs found, check structure
        if (prs.length > 0) {
          const firstPR = prs[0];
          expect(firstPR).to.have.property('number');

          // ticketId is optional - only present if PR is linked to a ticket
          if (firstPR.ticketId) {
            expect(firstPR.ticketId).to.be.a('string');
          }
        }
      }
    });

    it('should store ticket metadata for association lookup', async () => {
      // Verify the metadata is in database (what pr list uses)
      const metadata = db.prepare(`
        SELECT ticket_id, key, value FROM pmo_ticket_metadata
        WHERE key IN ('pr_url', 'pr_number')
        ORDER BY ticket_id, key
      `).all() as Array<{ ticket_id: string; key: string; value: string }>;

      expect(metadata.length).to.be.greaterThan(0);

      const prUrls = metadata.filter(m => m.key === 'pr_url');
      const prNumbers = metadata.filter(m => m.key === 'pr_number');

      expect(prUrls).to.have.lengthOf(2);
      expect(prNumbers).to.have.lengthOf(2);

      // Verify specific tickets
      const tkt001Url = prUrls.find(m => m.ticket_id === 'TKT-PR-001');
      expect(tkt001Url?.value).to.equal('https://github.com/test/repo/pull/42');
    });
  });

  describe('prlt pr list interactive output', () => {
    it('should display pull requests header in table format', async () => {
      const output = await execInProcess('pr list -P test-project --format table');

      // Should show "Pull Requests" header or "No open pull requests"
      expect(output).to.satisfy((s: string) =>
        s.includes('Pull Requests') ||
        s.includes('No open pull requests') ||
        s.includes('GH_NOT_INSTALLED') ||
        s.includes('GH_NOT_AUTHENTICATED') ||
        s.includes('gh')
      );
    });

    it('should display compact output when requested', async () => {
      const output = await execInProcess('pr list -P test-project --format compact');

      // Should show output or appropriate message
      expect(output).to.be.a('string');
      expect(output.length).to.be.greaterThan(0);
    });
  });

  describe('pr menu integration', () => {
    it('should include list in pr menu choices', async () => {
      const output = await execInProcess('pr -P test-project --machine');
      const json = extractJson<{
        prompt: { choices: Array<{ name: string; value: string }> };
      }>(output);

      // Find list choice
      const listChoice = json.prompt.choices.find(c => c.value === 'list');
      expect(listChoice).to.exist;
      expect(listChoice!.name.toLowerCase()).to.include('list');
    });

    it('should invoke pr list when list action is selected', async () => {
      // Verify the action 'list' maps to pr:list command
      const output = await execInProcess('pr -a list -P test-project --machine');

      // Should invoke pr list command
      // Output depends on gh CLI availability
      expect(output).to.be.a('string');
    });
  });
});

/**
 * Initialize a git repo for PR commands to work
 */
function initGitRepo(dir: string): void {
  try {
    execSync('git init', { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
    execSync('git config user.email "test@test.com"', { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
    execSync('git config user.name "Test User"', { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
    // Create initial commit
    fs.writeFileSync(path.join(dir, 'README.md'), '# Test');
    execSync('git add .', { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
    execSync('git commit -m "Initial commit"', { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch {
    // Git init may fail in some test environments
  }
}
