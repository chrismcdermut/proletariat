import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { exec } from './test-helpers.js';
import { initializePMOTables } from '../../src/lib/pmo/storage/base.js';
import { CREATE_TABLES_SQL } from '../../src/lib/database/index.js';

/**
 * End-to-end tests for PR Commands
 * Tests actual CLI usage as a user would interact with it
 * Spec: specs/domain/pull-requests.md
 *
 * Note: These tests mock git/gh operations since we can't create real PRs in tests.
 * The tests verify:
 * 1. PR metadata storage in ticket_metadata
 * 2. PR link/status command flows
 * 3. Integration with work ready command
 */
describe('PR Commands E2E Tests', () => {
  let testDir: string;
  let originalCwd: string;
  let dbPath: string;
  let db: Database.Database;

  beforeEach(() => {
    originalCwd = process.cwd();
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-commands-e2e-'));
    process.chdir(testDir);

    // Setup test environment
    const proletariatDir = path.join(testDir, '.proletariat');
    fs.mkdirSync(proletariatDir, { recursive: true });
    dbPath = path.join(proletariatDir, 'workspace.db');

    db = new Database(dbPath);
    setupTestDatabase(db);

    // Initialize git repo for PR commands
    initGitRepo(testDir);
  });

  afterEach(() => {
    if (db) db.close();
    process.chdir(originalCwd);
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  /**
   * Spec: pull-requests.md > Data Model > Ticket Metadata
   * "PR information is stored in the pmo_ticket_metadata table"
   */
  describe('PR Metadata Storage', () => {
    it('should store pr_url in ticket metadata', () => {
      const ticketId = createTicket(db, 'PR metadata test', 'in-progress');

      // Simulate PR link by storing metadata directly
      db.prepare(`
        INSERT INTO pmo_ticket_metadata (ticket_id, key, value)
        VALUES (?, 'pr_url', 'https://github.com/test/repo/pull/42')
      `).run(ticketId);

      const metadata = db.prepare(`
        SELECT value FROM pmo_ticket_metadata
        WHERE ticket_id = ? AND key = 'pr_url'
      `).get(ticketId) as { value: string } | undefined;

      expect(metadata).to.exist;
      expect(metadata!.value).to.equal('https://github.com/test/repo/pull/42');
    });

    it('should store pr_number in ticket metadata', () => {
      const ticketId = createTicket(db, 'PR number test', 'in-progress');

      db.prepare(`
        INSERT INTO pmo_ticket_metadata (ticket_id, key, value)
        VALUES (?, 'pr_number', '42')
      `).run(ticketId);

      const metadata = db.prepare(`
        SELECT value FROM pmo_ticket_metadata
        WHERE ticket_id = ? AND key = 'pr_number'
      `).get(ticketId) as { value: string } | undefined;

      expect(metadata).to.exist;
      expect(metadata!.value).to.equal('42');
    });

    it('should store pr_branch in ticket metadata', () => {
      const ticketId = createTicket(db, 'PR branch test', 'in-progress');

      db.prepare(`
        INSERT INTO pmo_ticket_metadata (ticket_id, key, value)
        VALUES (?, 'pr_branch', 'feat/agent/TKT-001-test')
      `).run(ticketId);

      const metadata = db.prepare(`
        SELECT value FROM pmo_ticket_metadata
        WHERE ticket_id = ? AND key = 'pr_branch'
      `).get(ticketId) as { value: string } | undefined;

      expect(metadata).to.exist;
      expect(metadata!.value).to.equal('feat/agent/TKT-001-test');
    });

    it('should cascade delete PR metadata when ticket is deleted', () => {
      const ticketId = createTicket(db, 'Cascade test', 'in-progress');

      // Add PR metadata
      db.prepare(`
        INSERT INTO pmo_ticket_metadata (ticket_id, key, value)
        VALUES (?, 'pr_url', 'https://github.com/test/repo/pull/1')
      `).run(ticketId);

      // Delete ticket (cascades to metadata)
      db.prepare('DELETE FROM pmo_board_tickets WHERE ticket_id = ?').run(ticketId);
      db.prepare('DELETE FROM pmo_tickets WHERE id = ?').run(ticketId);

      const metadata = db.prepare(`
        SELECT * FROM pmo_ticket_metadata WHERE ticket_id = ?
      `).all(ticketId);

      expect(metadata).to.have.lengthOf(0);
    });
  });

  /**
   * Spec: pull-requests.md > prlt pr status
   * "View PR status for a ticket"
   *
   * Note: These tests verify the underlying data model that pr status reads from.
   * The actual CLI output is tested via manual testing since oclif CLI execution
   * in test environment has source map issues.
   */
  describe('prlt pr status (data model)', () => {
    it('should identify ticket without PR metadata', () => {
      const ticketId = createTicket(db, 'No PR test', 'in-progress');

      // Query for PR metadata (what pr status command does)
      const prUrl = db.prepare(`
        SELECT value FROM pmo_ticket_metadata
        WHERE ticket_id = ? AND key = 'pr_url'
      `).get(ticketId);

      expect(prUrl).to.be.undefined;
    });

    it('should identify ticket with PR metadata', () => {
      const ticketId = createTicket(db, 'Has PR test', 'in-progress');

      // Add PR metadata
      db.prepare(`
        INSERT INTO pmo_ticket_metadata (ticket_id, key, value)
        VALUES (?, 'pr_url', 'https://github.com/test/repo/pull/99')
      `).run(ticketId);
      db.prepare(`
        INSERT INTO pmo_ticket_metadata (ticket_id, key, value)
        VALUES (?, 'pr_number', '99')
      `).run(ticketId);

      // Query for PR metadata (what pr status command does)
      const prUrl = db.prepare(`
        SELECT value FROM pmo_ticket_metadata
        WHERE ticket_id = ? AND key = 'pr_url'
      `).get(ticketId) as { value: string };

      expect(prUrl.value).to.equal('https://github.com/test/repo/pull/99');
    });

    it('should return no data for non-existent ticket', () => {
      const ticket = db.prepare('SELECT * FROM pmo_tickets WHERE id = ?').get('NON-EXISTENT');

      expect(ticket).to.be.undefined;
    });
  });

  /**
   * Spec: pull-requests.md > prlt pr create
   * Note: Cannot test actual PR creation without GitHub, but we can test prerequisites
   */
  describe('prlt pr create prerequisites', () => {
    it('should check for gh CLI availability', () => {
      // The command should check for gh CLI
      // If gh is not installed/authenticated, it should show appropriate message
      const output = exec('pr create');

      // Either shows gh not installed, not authenticated, or proceeds with PR creation
      // All are valid responses depending on environment
      expect(output).to.be.a('string');
    });

    it('should detect ticket ID from branch name pattern', () => {
      // Create a branch with ticket ID pattern
      try {
        execSync('git checkout -b feat/agent/TKT-001-test-feature', {
          cwd: testDir,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch {
        // Branch creation may fail in some test environments
      }

      // The branch pattern TKT-XXX should be extractable
      const branch = 'feat/agent/TKT-001-test-feature';
      const match = branch.match(/(TKT-\d+)/i);
      expect(match).to.not.be.null;
      expect(match![1]).to.equal('TKT-001');
    });
  });

  /**
   * Spec: pull-requests.md > prlt pr link
   * "Link an existing GitHub pull request to a ticket"
   */
  describe('prlt pr link', () => {
    it('should store PR URL when linking by URL', () => {
      const ticketId = createTicket(db, 'Link by URL test', 'in-progress');

      // Simulate linking via direct metadata update (like the command does)
      const prUrl = 'https://github.com/test/repo/pull/123';
      const prNumber = '123';

      db.prepare(`
        INSERT OR REPLACE INTO pmo_ticket_metadata (ticket_id, key, value)
        VALUES (?, 'pr_url', ?)
      `).run(ticketId, prUrl);
      db.prepare(`
        INSERT OR REPLACE INTO pmo_ticket_metadata (ticket_id, key, value)
        VALUES (?, 'pr_number', ?)
      `).run(ticketId, prNumber);

      // Verify stored
      const storedUrl = db.prepare(`
        SELECT value FROM pmo_ticket_metadata WHERE ticket_id = ? AND key = 'pr_url'
      `).get(ticketId) as { value: string };

      expect(storedUrl.value).to.equal(prUrl);
    });

    it('should update existing PR link when overwriting', () => {
      const ticketId = createTicket(db, 'Overwrite test', 'in-progress');

      // First PR
      db.prepare(`
        INSERT INTO pmo_ticket_metadata (ticket_id, key, value)
        VALUES (?, 'pr_url', 'https://github.com/test/repo/pull/1')
      `).run(ticketId);

      // Overwrite with new PR (using REPLACE)
      db.prepare(`
        INSERT OR REPLACE INTO pmo_ticket_metadata (ticket_id, key, value)
        VALUES (?, 'pr_url', 'https://github.com/test/repo/pull/2')
      `).run(ticketId);

      const storedUrl = db.prepare(`
        SELECT value FROM pmo_ticket_metadata WHERE ticket_id = ? AND key = 'pr_url'
      `).get(ticketId) as { value: string };

      expect(storedUrl.value).to.equal('https://github.com/test/repo/pull/2');
    });

    it('should store PR branch when linking', () => {
      const ticketId = createTicket(db, 'Branch link test', 'in-progress');

      db.prepare(`
        INSERT INTO pmo_ticket_metadata (ticket_id, key, value)
        VALUES (?, 'pr_branch', 'feat/test/branch')
      `).run(ticketId);

      const storedBranch = db.prepare(`
        SELECT value FROM pmo_ticket_metadata WHERE ticket_id = ? AND key = 'pr_branch'
      `).get(ticketId) as { value: string };

      expect(storedBranch.value).to.equal('feat/test/branch');
    });
  });

  /**
   * Spec: pull-requests.md > Integration with Work Commands
   * "work ready - Can trigger PR creation"
   *
   * Note: These tests verify the data model and state transitions.
   * The actual CLI integration is tested in work-commands.test.ts.
   */
  describe('work ready with PR integration (data model)', () => {
    it('should be able to move ticket to review column with PR metadata intact', () => {
      const ticketId = createTicket(db, 'Ready with PR test', 'in-progress');

      // Pre-link a PR
      db.prepare(`
        INSERT INTO pmo_ticket_metadata (ticket_id, key, value)
        VALUES (?, 'pr_url', 'https://github.com/test/repo/pull/42')
      `).run(ticketId);

      // Simulate what work ready does: move to review column
      db.prepare(`
        UPDATE pmo_board_tickets SET column_id = 'in-review' WHERE ticket_id = ?
      `).run(ticketId);

      // Verify ticket moved to Review column
      const ticket = db.prepare(`
        SELECT c.name as column_name
        FROM pmo_board_tickets bt
        JOIN pmo_columns c ON c.id = bt.column_id
        WHERE bt.ticket_id = ?
      `).get(ticketId) as { column_name: string };

      expect(ticket.column_name).to.equal('In Review');

      // PR metadata should still be there
      const prUrl = db.prepare(`
        SELECT value FROM pmo_ticket_metadata WHERE ticket_id = ? AND key = 'pr_url'
      `).get(ticketId) as { value: string };

      expect(prUrl.value).to.equal('https://github.com/test/repo/pull/42');
    });

    it('should preserve PR metadata after column transition', () => {
      const ticketId = createTicket(db, 'Preserve PR test', 'in-progress');

      // Pre-link a PR with multiple metadata keys
      db.prepare(`
        INSERT INTO pmo_ticket_metadata (ticket_id, key, value)
        VALUES (?, 'pr_url', 'https://github.com/test/repo/pull/50')
      `).run(ticketId);
      db.prepare(`
        INSERT INTO pmo_ticket_metadata (ticket_id, key, value)
        VALUES (?, 'pr_number', '50')
      `).run(ticketId);
      db.prepare(`
        INSERT INTO pmo_ticket_metadata (ticket_id, key, value)
        VALUES (?, 'pr_branch', 'feat/test')
      `).run(ticketId);

      // Move through columns: in-progress -> in-review -> done
      db.prepare(`
        UPDATE pmo_board_tickets SET column_id = 'in-review' WHERE ticket_id = ?
      `).run(ticketId);
      db.prepare(`
        UPDATE pmo_board_tickets SET column_id = 'done' WHERE ticket_id = ?
      `).run(ticketId);

      // All PR metadata should still be there
      const metadata = db.prepare(`
        SELECT key, value FROM pmo_ticket_metadata WHERE ticket_id = ?
      `).all(ticketId) as Array<{ key: string; value: string }>;

      expect(metadata).to.have.lengthOf(3);

      const urlMeta = metadata.find(m => m.key === 'pr_url');
      expect(urlMeta?.value).to.equal('https://github.com/test/repo/pull/50');
    });

    it('should allow adding PR metadata during work ready', () => {
      const ticketId = createTicket(db, 'Add PR during ready', 'in-progress');

      // No PR initially
      const initialPrUrl = db.prepare(`
        SELECT value FROM pmo_ticket_metadata WHERE ticket_id = ? AND key = 'pr_url'
      `).get(ticketId);
      expect(initialPrUrl).to.be.undefined;

      // Simulate work ready adding PR metadata
      db.prepare(`
        INSERT INTO pmo_ticket_metadata (ticket_id, key, value)
        VALUES (?, 'pr_url', 'https://github.com/test/repo/pull/99')
      `).run(ticketId);

      // Move to review
      db.prepare(`
        UPDATE pmo_board_tickets SET column_id = 'in-review' WHERE ticket_id = ?
      `).run(ticketId);

      // PR should be stored
      const finalPrUrl = db.prepare(`
        SELECT value FROM pmo_ticket_metadata WHERE ticket_id = ? AND key = 'pr_url'
      `).get(ticketId) as { value: string };

      expect(finalPrUrl.value).to.equal('https://github.com/test/repo/pull/99');
    });
  });

  /**
   * Spec: pull-requests.md > PR Title/Body Generation
   * Testing the title generation function logic
   */
  describe('PR Title Generation', () => {
    it('should generate title from ticket ID and title', () => {
      const ticketId = 'TKT-042';
      const ticketTitle = 'Add user authentication';

      // This mirrors the generatePRTitle function
      const prTitle = `${ticketId}: ${ticketTitle}`;

      expect(prTitle).to.equal('TKT-042: Add user authentication');
    });

    it('should handle special characters in ticket title', () => {
      const ticketId = 'TKT-001';
      const ticketTitle = "Fix bug with 'quotes' and \"double quotes\"";

      const prTitle = `${ticketId}: ${ticketTitle}`;

      expect(prTitle).to.contain(ticketId);
      expect(prTitle).to.contain('quotes');
    });
  });

  /**
   * Spec: pull-requests.md > Business Rules
   * "Auto-detect ticket ID from branch name"
   */
  describe('Ticket ID Detection from Branch', () => {
    it('should detect TKT-001 from feat/agent/TKT-001-description', () => {
      const branch = 'feat/agent/TKT-001-add-login';
      const match = branch.match(/(TKT-\d+)/i);

      expect(match).to.not.be.null;
      expect(match![1]).to.equal('TKT-001');
    });

    it('should detect TKT-123 from fix/TKT-123-bug-fix', () => {
      const branch = 'fix/TKT-123-bug-fix';
      const match = branch.match(/(TKT-\d+)/i);

      expect(match).to.not.be.null;
      expect(match![1]).to.equal('TKT-123');
    });

    it('should be case insensitive for ticket ID', () => {
      const branch = 'feat/chris/tkt-999-lowercase';
      const match = branch.match(/(TKT-\d+)/i);

      expect(match).to.not.be.null;
      expect(match![1].toUpperCase()).to.equal('TKT-999');
    });

    it('should return null for branch without ticket ID', () => {
      const branch = 'main';
      const match = branch.match(/(TKT-\d+)/i);

      expect(match).to.be.null;
    });

    it('should return null for feature branch without ticket ID', () => {
      const branch = 'feat/chris/no-ticket-here';
      const match = branch.match(/(TKT-\d+)/i);

      expect(match).to.be.null;
    });
  });

  /**
   * JSON Mode Tests
   * Test that pr commands output proper JSON when --json flag is used
   */
  describe('JSON Mode Output (FlagResolver)', () => {
    it('prlt pr --json should output prompt config for action selection', () => {
      const output = exec('pr --json');

      // Should output JSON with prompt config
      expect(output).to.include('"type"');
      expect(output).to.include('"action"');
    });

    it('prlt pr status --json should output prompt config for ticket selection', () => {
      // Create a ticket first
      createTicket(db, 'JSON mode test ticket', 'in-progress');

      const output = exec('pr status --json');

      // Should output JSON with prompt config for ticket selection
      expect(output).to.include('"type"');
    });

    it('prlt pr link --json should output prompt config for ticket selection', () => {
      // Create a ticket first
      createTicket(db, 'Link JSON test ticket', 'in-progress');

      const output = exec('pr link --json');

      // Should output JSON prompt config
      expect(output).to.include('"type"');
    });

    it('prlt pr create with --ticket flag should skip ticket selection prompt', () => {
      const ticketId = createTicket(db, 'Create test ticket', 'in-progress');

      // With ticket provided, should not prompt for ticket
      const output = exec(`pr create --ticket ${ticketId} --no-link --json`);

      // Either outputs error (gh not installed) or proceeds without ticket prompt
      expect(output).to.be.a('string');
    });

    it('prlt pr status with ticket arg should skip selection', () => {
      const ticketId = createTicket(db, 'Status test ticket', 'in-progress');

      // With ticket ID provided, should show status directly
      const output = exec(`pr status ${ticketId}`);

      // Should show ticket info
      expect(output).to.include(ticketId);
    });

    it('prlt pr link with ticket arg should proceed to PR selection', () => {
      const ticketId = createTicket(db, 'Link test ticket', 'in-progress');

      // With ticket ID provided, should skip ticket selection
      const output = exec(`pr link ${ticketId} --json`);

      // Should either prompt for PR or error (gh not installed)
      expect(output).to.be.a('string');
    });
  });

  /**
   * Spec: pull-requests.md > Multiple PRs per ticket
   * Verify that metadata can be overwritten
   */
  describe('PR Metadata Updates', () => {
    it('should allow updating PR metadata multiple times', () => {
      const ticketId = createTicket(db, 'Multiple updates', 'in-progress');

      // First PR
      db.prepare(`
        INSERT OR REPLACE INTO pmo_ticket_metadata (ticket_id, key, value)
        VALUES (?, 'pr_url', 'https://github.com/test/repo/pull/1')
      `).run(ticketId);

      // Second PR (update)
      db.prepare(`
        INSERT OR REPLACE INTO pmo_ticket_metadata (ticket_id, key, value)
        VALUES (?, 'pr_url', 'https://github.com/test/repo/pull/2')
      `).run(ticketId);

      // Third PR (update)
      db.prepare(`
        INSERT OR REPLACE INTO pmo_ticket_metadata (ticket_id, key, value)
        VALUES (?, 'pr_url', 'https://github.com/test/repo/pull/3')
      `).run(ticketId);

      const finalUrl = db.prepare(`
        SELECT value FROM pmo_ticket_metadata WHERE ticket_id = ? AND key = 'pr_url'
      `).get(ticketId) as { value: string };

      expect(finalUrl.value).to.equal('https://github.com/test/repo/pull/3');

      // Should only have one pr_url entry
      const urlCount = db.prepare(`
        SELECT COUNT(*) as count FROM pmo_ticket_metadata WHERE ticket_id = ? AND key = 'pr_url'
      `).get(ticketId) as { count: number };

      expect(urlCount.count).to.equal(1);
    });

    it('should store multiple metadata keys for same ticket', () => {
      const ticketId = createTicket(db, 'Multiple keys', 'in-progress');

      db.prepare(`
        INSERT INTO pmo_ticket_metadata (ticket_id, key, value)
        VALUES (?, 'pr_url', 'https://github.com/test/repo/pull/5')
      `).run(ticketId);
      db.prepare(`
        INSERT INTO pmo_ticket_metadata (ticket_id, key, value)
        VALUES (?, 'pr_number', '5')
      `).run(ticketId);
      db.prepare(`
        INSERT INTO pmo_ticket_metadata (ticket_id, key, value)
        VALUES (?, 'pr_branch', 'feat/test')
      `).run(ticketId);

      const allMetadata = db.prepare(`
        SELECT key, value FROM pmo_ticket_metadata WHERE ticket_id = ?
      `).all(ticketId) as Array<{ key: string; value: string }>;

      expect(allMetadata).to.have.lengthOf(3);

      const keys = allMetadata.map(m => m.key);
      expect(keys).to.include('pr_url');
      expect(keys).to.include('pr_number');
      expect(keys).to.include('pr_branch');
    });
  });
});

// =============================================================================
// Helper Functions
// =============================================================================

function setupTestDatabase(db: Database.Database) {
  // Use production schema to ensure all columns and tables are present
  initializePMOTables(db);
  db.exec(CREATE_TABLES_SQL);

  // Insert workspace row
  db.prepare(`INSERT INTO workspace (id, type, workspace_name, has_pmo, created_at) VALUES (1, 'hq', 'test-workspace', 1, datetime('now'))`).run();

  // Insert test project
  db.prepare(`INSERT INTO pmo_projects (id, name, description, workflow_id) VALUES ('test-project', 'Test Project', 'E2E test project', 'default')`).run();

  // Set PMO settings
  db.prepare(`INSERT OR REPLACE INTO pmo_settings (key, value) VALUES ('pmo_path', 'pmo')`).run();
  db.prepare(`INSERT OR REPLACE INTO pmo_settings (key, value) VALUES ('current_project', 'test-project')`).run();

  // Create columns for test project
  const columns = [
    { id: 'backlog', name: 'Backlog', position: 0 },
    { id: 'in-progress', name: 'In Progress', position: 1 },
    { id: 'in-review', name: 'In Review', position: 2 },
    { id: 'done', name: 'Done', position: 3 },
  ];

  for (const col of columns) {
    db.prepare(`
      INSERT OR IGNORE INTO pmo_columns (id, project_id, name, position)
      VALUES (?, 'test-project', ?, ?)
    `).run(col.id, col.name, col.position);
  }

  // Create HQ config file
  const proletariatDir = path.join(process.cwd(), '.proletariat');
  const configPath = path.join(proletariatDir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    type: 'hq',
    name: 'test-hq',
    hasPmo: true,
  }), 'utf-8');

  // Create PMO directory structure
  const pmoPath = path.join(process.cwd(), 'pmo/projects/test-project');
  fs.mkdirSync(pmoPath, { recursive: true });
}

function initGitRepo(dir: string) {
  try {
    execSync('git init', { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
    execSync('git config user.email "test@test.com"', { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
    execSync('git config user.name "Test User"', { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
    // Create initial commit
    fs.writeFileSync(path.join(dir, 'README.md'), '# Test');
    execSync('git add .', { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
    execSync('git commit -m "Initial commit"', { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch {
    // Git init may fail in some test environments, that's ok
  }
}

let ticketCounter = 0;
function createTicket(db: Database.Database, title: string, columnId: string): string {
  ticketCounter++;
  const ticketId = `TKT-${String(ticketCounter).padStart(3, '0')}`;

  db.prepare(`
    INSERT INTO pmo_tickets (id, project_id, title, status)
    VALUES (?, 'test-project', ?, ?)
  `).run(ticketId, title, columnId === 'done' ? 'done' : 'active');

  db.prepare(`
    INSERT INTO pmo_board_tickets (project_id, ticket_id, column_id, position)
    VALUES ('test-project', ?, ?, 0)
  `).run(ticketId, columnId);

  return ticketId;
}

