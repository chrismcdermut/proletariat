/* eslint-disable max-nested-callbacks */
import { expect } from 'chai';
import Database from 'better-sqlite3';
import {
  createTestEnvironment,
  cleanupTestEnvironment,
  createHQConfig,
  createPMODirectories,
  addWorkspaceTables,
  execInProcess,
  extractJson as extractJsonOrNull,
  type TestEnvironment,
} from './test-helpers.js';

/**
 * Asserting wrapper around shared extractJson.
 * Throws if no valid JSON is found (appropriate for test assertions).
 */
function extractJson<T>(output: string): T {
  const result = extractJsonOrNull<T>(output);
  if (result === null) {
    throw new Error(`No JSON found in output (${output.length} chars): ${output.substring(0, 500)}...`);
  }
  return result;
}

/**
 * Setup test database with all tables required for work commands.
 * Includes: workflows, projects, tickets, columns, agent_work, actions, settings.
 */
async function setupTestDatabase(db: Database.Database, pmoPath: string): Promise<void> {
  db.exec(`
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
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workflow_id) REFERENCES pmo_workflows(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS pmo_columns (
      id TEXT NOT NULL,
      project_id TEXT NOT NULL DEFAULT 'default',
      name TEXT NOT NULL,
      position INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (project_id, id)
    );

    CREATE TABLE IF NOT EXISTS pmo_specs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT DEFAULT 'draft',
      type TEXT,
      problem TEXT,
      solution TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pmo_epics (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      position INTEGER NOT NULL DEFAULT 0,
      file_path TEXT,
      spec_id TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES pmo_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (spec_id) REFERENCES pmo_specs(id) ON DELETE SET NULL
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
      last_synced_from_board TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES pmo_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (spec_id) REFERENCES pmo_specs(id) ON DELETE SET NULL,
      FOREIGN KEY (epic_id) REFERENCES pmo_epics(id) ON DELETE SET NULL,
      FOREIGN KEY (status_id) REFERENCES pmo_workflow_statuses(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS pmo_board_tickets (
      project_id TEXT NOT NULL,
      ticket_id TEXT NOT NULL,
      column_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (project_id, ticket_id),
      FOREIGN KEY (project_id) REFERENCES pmo_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (ticket_id) REFERENCES pmo_tickets(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id, column_id) REFERENCES pmo_columns(project_id, id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS pmo_subtasks (
      id TEXT NOT NULL,
      ticket_id TEXT NOT NULL REFERENCES pmo_tickets(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      done INTEGER DEFAULT 0,
      position INTEGER NOT NULL,
      PRIMARY KEY (ticket_id, id)
    );

    CREATE TABLE IF NOT EXISTS pmo_ticket_dependencies (
      ticket_id TEXT NOT NULL,
      depends_on_ticket_id TEXT NOT NULL,
      dependency_type TEXT NOT NULL DEFAULT 'blocks',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (ticket_id, depends_on_ticket_id),
      FOREIGN KEY (ticket_id) REFERENCES pmo_tickets(id) ON DELETE CASCADE,
      FOREIGN KEY (depends_on_ticket_id) REFERENCES pmo_tickets(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS agent_work (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      executor TEXT NOT NULL,
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
      exit_code INTEGER,
      FOREIGN KEY (ticket_id) REFERENCES pmo_tickets(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS pmo_actions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      prompt TEXT NOT NULL,
      end_prompt TEXT,
      suggested_for_categories TEXT,
      default_move_to_category TEXT,
      modifies_code INTEGER NOT NULL DEFAULT 1,
      is_builtin INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pmo_ticket_metadata (
      ticket_id TEXT NOT NULL REFERENCES pmo_tickets(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value TEXT,
      PRIMARY KEY (ticket_id, key)
    );

    CREATE INDEX IF NOT EXISTS idx_pmo_tickets_project ON pmo_tickets(project_id);
    CREATE INDEX IF NOT EXISTS idx_pmo_tickets_status ON pmo_tickets(status);
    CREATE INDEX IF NOT EXISTS idx_pmo_tickets_status_id ON pmo_tickets(status_id);
    CREATE INDEX IF NOT EXISTS idx_pmo_projects_workflow ON pmo_projects(workflow_id);
    CREATE INDEX IF NOT EXISTS idx_agent_work_ticket ON agent_work(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_agent_work_status ON agent_work(status);
  `);

  // Insert default workflow
  db.prepare(`
    INSERT INTO pmo_workflows (id, name, description, is_builtin)
    VALUES ('default', 'Default', 'Default kanban workflow', 1)
  `).run();

  // Insert workflow statuses (board columns)
  const statuses = [
    { id: 'status-backlog', name: 'Backlog', category: 'backlog', position: 0, isDefault: 1 },
    { id: 'status-in-progress', name: 'In Progress', category: 'started', position: 1 },
    { id: 'status-review', name: 'Review', category: 'started', position: 2 },
    { id: 'status-done', name: 'Done', category: 'completed', position: 3 },
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

  // Insert settings
  db.prepare(`
    INSERT INTO pmo_settings (key, value)
    VALUES ('pmo_path', ?), ('current_project', 'test-project')
  `).run(pmoPath);

  // Insert columns (legacy support)
  const columns = [
    { id: 'backlog', name: 'Backlog', position: 0 },
    { id: 'in-progress', name: 'In Progress', position: 1 },
    { id: 'review', name: 'Review', position: 2 },
    { id: 'done', name: 'Done', position: 3 },
  ];

  for (const col of columns) {
    db.prepare(`
      INSERT INTO pmo_columns (id, project_id, name, position)
      VALUES (?, 'test-project', ?, ?)
    `).run(col.id, col.name, col.position);
  }

  // Insert default actions
  const actions = [
    { id: 'implement', name: 'implement', description: 'Implement the ticket requirements', prompt: 'Implement the following ticket...', modifiesCode: 1, isBuiltin: 1 },
    { id: 'groom', name: 'groom', description: 'Review and refine ticket details', prompt: 'Review and refine the following ticket...', modifiesCode: 0, isBuiltin: 1 },
    { id: 'review', name: 'review', description: 'Review code changes', prompt: 'Review the code changes for...', modifiesCode: 0, isBuiltin: 1 },
  ];

  for (const action of actions) {
    db.prepare(`
      INSERT INTO pmo_actions (id, name, description, prompt, modifies_code, is_builtin)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(action.id, action.name, action.description, action.prompt, action.modifiesCode, action.isBuiltin);
  }
}

/**
 * Integration tests for work command JSON mode.
 *
 * These tests verify that:
 * 1. Work commands support --json flag for machine-readable output
 * 2. JSON output includes proper prompt schema
 * 3. Flag accumulation works correctly in choices
 * 4. Full agent flows can navigate through multi-step prompts
 */
describe('Work Commands JSON Mode', () => {
  let env: TestEnvironment;
  let db: Database.Database;

  beforeEach(async () => {
    env = createTestEnvironment('work-json-');

    db = new Database(env.dbPath);
    await setupTestDatabase(db, env.pmoPath);

    // Add workspace tables so getWorkspaceInfo() can find workspace config
    addWorkspaceTables(db, { type: 'hq', workspaceName: 'test-hq', hasPmo: true });

    createHQConfig(env.proletariatDir);
    createPMODirectories(env.pmoPath, 'test-project');
  });

  afterEach(() => {
    if (db) db.close();
    cleanupTestEnvironment(env);
  });

  /**
   * Helper to insert a test ticket directly into the database.
   */
  function createTestTicket(
    id: string,
    title: string,
    statusId: string = 'status-backlog',
    assignee?: string
  ): void {
    const statusName = statusId === 'status-backlog' ? 'Backlog' :
                       statusId === 'status-in-progress' ? 'In Progress' :
                       statusId === 'status-review' ? 'Review' : 'Done';

    db.prepare(`
      INSERT INTO pmo_tickets (id, project_id, title, status, status_id, assignee)
      VALUES (?, 'test-project', ?, ?, ?, ?)
    `).run(id, title, statusName, statusId, assignee || null);

    const columnId = statusId === 'status-backlog' ? 'backlog' :
                     statusId === 'status-in-progress' ? 'in-progress' :
                     statusId === 'status-review' ? 'review' : 'done';
    db.prepare(`
      INSERT INTO pmo_board_tickets (project_id, ticket_id, column_id, position)
      VALUES ('test-project', ?, ?, 0)
    `).run(id, columnId);
  }

  /**
   * Helper to create an execution record for a ticket.
   */
  function createTestExecution(
    id: string,
    ticketId: string,
    agentName: string,
    status: string = 'running'
  ): void {
    db.prepare(`
      INSERT INTO agent_work (id, ticket_id, agent_name, executor, environment, status, branch)
      VALUES (?, ?, ?, 'claude-code', 'host', ?, 'feature/test-branch')
    `).run(id, ticketId, agentName, status);
  }

  /**
   * Helper to get ticket status from database.
   */
  function getTicketStatus(ticketId: string): { status: string; statusId: string } {
    const ticket = db.prepare('SELECT status, status_id FROM pmo_tickets WHERE id = ?').get(ticketId) as { status: string; status_id: string } | undefined;
    return {
      status: ticket?.status || 'unknown',
      statusId: ticket?.status_id || 'unknown',
    };
  }

  // ===========================================================================
  // work (menu) command tests
  // ===========================================================================

  describe('work --json (menu)', () => {
    it('should output valid JSON with prompt schema', async () => {
      const output = await execInProcess('work -P test-project --json');
      const json = extractJson<{
        prompt: { type: string; name: string; message: string; choices: unknown[] };
        metadata: { command: string; flags: Record<string, unknown> };
      }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('list');
      expect(json.prompt.choices).to.be.an('array');
      expect(json.prompt.choices.length).to.be.greaterThan(0);
      expect(json.metadata.command).to.equal('work');
    });

    it('should include project flag in choice commands', async () => {
      const output = await execInProcess('work -P test-project --json');
      const json = extractJson<{
        prompt: { choices: Array<{ name: string; command: string }> };
      }>(output);

      // Each choice (except cancel) should include project flag
      const nonCancelChoices = json.prompt.choices.filter(c => !c.name.toLowerCase().includes('cancel'));
      for (const choice of nonCancelChoices) {
        expect(choice.command).to.include('-P test-project');
        expect(choice.command).to.include('--json');
      }
    });

    it('should include start, spawn, watch, ready, and complete menu options', async () => {
      const output = await execInProcess('work -P test-project --json');
      const json = extractJson<{
        prompt: { choices: Array<{ name: string; command: string }> };
      }>(output);

      const choiceNames = json.prompt.choices.map(c => c.name.toLowerCase());
      expect(choiceNames.some(n => n.includes('start'))).to.be.true;
      expect(choiceNames.some(n => n.includes('spawn'))).to.be.true;
      expect(choiceNames.some(n => n.includes('ready'))).to.be.true;
      expect(choiceNames.some(n => n.includes('complete'))).to.be.true;
    });
  });

  // ===========================================================================
  // work ready command tests
  // ===========================================================================

  describe('work ready --json', () => {
    beforeEach(() => {
      // Create in-progress tickets
      createTestTicket('TKT-001', 'In progress ticket 1', 'status-in-progress', 'agent-1');
      createTestTicket('TKT-002', 'In progress ticket 2', 'status-in-progress', 'agent-2');
      createTestExecution('exec-001', 'TKT-001', 'agent-1', 'running');
    });

    it('should output prompt JSON when no ticket ID provided', async () => {
      const output = await execInProcess('work ready -P test-project --json');
      const json = extractJson<{
        prompt: { type: string; name: string; message: string; choices: Array<{ name: string; value: string; command?: string }> };
        metadata: { command: string; flags: Record<string, unknown> };
      }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('list');
      expect(json.prompt.choices).to.be.an('array');
      expect(json.prompt.choices.length).to.be.greaterThan(0);
      expect(json.metadata.command).to.equal('work ready');
    });

    it('should include --json flag in ticket selection commands', async () => {
      const output = await execInProcess('work ready -P test-project --json');
      const json = extractJson<{
        prompt: { choices: Array<{ command: string }> };
      }>(output);

      for (const choice of json.prompt.choices) {
        if (choice.command) {
          expect(choice.command).to.include('--json');
          expect(choice.command).to.include('work ready');
        }
      }
    });

    it('should only show in-progress tickets', async () => {
      // Add a backlog ticket (should not appear)
      createTestTicket('TKT-003', 'Backlog ticket', 'status-backlog');

      const output = await execInProcess('work ready -P test-project --json');
      const json = extractJson<{
        prompt: { choices: Array<{ name: string; value: string }> };
      }>(output);

      const choiceValues = json.prompt.choices.map(c => c.value);
      expect(choiceValues).to.include('TKT-001');
      expect(choiceValues).to.include('TKT-002');
      expect(choiceValues).to.not.include('TKT-003');
    });

    it('should move ticket to Review when all flags provided', async () => {
      // Execute without prompts
      const output = await execInProcess('work ready TKT-001 -P test-project --no-pr --machine');

      expect(output.toLowerCase()).to.include('work ready');
      expect(output).to.include('TKT-001');

      // Verify ticket moved to Review (work ready moves to Review, work complete moves to Done)
      const { statusId } = getTicketStatus('TKT-001');
      expect(statusId).to.equal('status-review');
    });

    // Note: Execution status update is tested as part of the ticket move flow
    // The ExecutionStorage.updateStatus is called when marking work ready
  });

  // ===========================================================================
  // work start command tests (initial prompts only)
  // ===========================================================================
  //
  // NOTE: work start is a complex multi-step command. This test suite only
  // covers the INITIAL prompts that can be tested without infrastructure.
  //
  // PROMPT FLOW: ticket → agent → action → environment → display → permissions
  //
  // TESTED:
  //   1. Ticket selection prompt (no ticket ID provided)
  //   2. Agent selection prompt (ticket ID provided, shows ephemeral option)
  //   3. Blocked ticket confirmation (ticket with unresolved blockers) ✓
  //   4. --force flag bypasses blocked confirmation ✓
  //
  // NOT TESTED (requires infrastructure or specific state):
  //   - Action selection prompt (requires completing agent selection step)
  //   - Environment selection (requires hasDevcontainerConfig to return true)
  //   - Display mode selection (requires devcontainer environment selected)
  //   - Permission mode selection (requires devcontainer environment selected)
  //   - Existing tmux session handling (requires active tmux session for ticket)
  //   - Unsaved work handling (requires agent with uncommitted git changes)
  //   - Branch creation/switching (requires git worktree setup)
  //   - Actual execution spawning (requires full agent infrastructure)
  //
  // To test these later steps, you would need:
  //   - Mock agents directory structure with devcontainer configs
  //   - Mock git state (worktrees, branches, uncommitted changes)
  //   - Mock tmux sessions
  //   - Or integration tests with real infrastructure
  //

  describe('work start --json (initial prompts)', () => {
    beforeEach(() => {
      // Create tickets for selection
      createTestTicket('TKT-030', 'Start ticket 1', 'status-backlog');
      createTestTicket('TKT-031', 'Start ticket 2', 'status-backlog');
      createTestTicket('TKT-032', 'In progress ticket', 'status-in-progress');

      // Seed coder name to avoid interactive prompt blocking JSON mode
      db.prepare("INSERT OR IGNORE INTO pmo_settings (key, value) VALUES ('coder.name', 'test-coder')").run();
    });

    it('should output ticket selection prompt when no ticket ID provided', async () => {
      const output = await execInProcess('work start -P test-project --json');
      const json = extractJson<{
        prompt: { type: string; name: string; message: string; choices: Array<{ name: string; value: string }> };
        metadata: { command: string; flags: Record<string, unknown> };
      }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('list');
      expect(json.prompt.message.toLowerCase()).to.include('ticket');
      expect(json.metadata.command).to.equal('work start');

      // Choices should include tickets
      const choiceValues = json.prompt.choices.map(c => c.value);
      expect(choiceValues).to.include('TKT-030');
      expect(choiceValues).to.include('TKT-031');
      expect(choiceValues).to.include('TKT-032');
    });

    it('should include ticket info in choice names', async () => {
      const output = await execInProcess('work start -P test-project --json');
      const json = extractJson<{
        prompt: { choices: Array<{ name: string; value: string }> };
      }>(output);

      // Each choice name should include ticket ID and title
      for (const choice of json.prompt.choices) {
        expect(choice.name).to.include(choice.value); // Contains ticket ID
      }
    });

    it('should output action selection prompt when ticket ID provided', async () => {
      // When ticket ID is provided and no staff agents exist, the command
      // auto-creates an ephemeral agent and prompts for action selection
      const output = await execInProcess('work start TKT-030 -P test-project --json');
      const json = extractJson<{
        prompt: { type: string; name: string; message: string; choices: Array<{ name: string; value: string }> };
        metadata: { command: string; flags: Record<string, unknown> };
      }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('list');
      expect(json.prompt.name).to.equal('selectedActionId');
      expect(json.metadata.command).to.equal('work start');

      // Choices should include builtin actions
      const choiceValues = json.prompt.choices.map(c => c.value);
      expect(choiceValues).to.include('implement');
    });

    it('should include action choices in prompt', async () => {
      const output = await execInProcess('work start TKT-030 -P test-project --json');
      const json = extractJson<{
        prompt: { choices: Array<{ name: string; value: string }> };
      }>(output);

      // Should have builtin actions and custom/adhoc options
      const choiceValues = json.prompt.choices.map(c => c.value);
      expect(choiceValues).to.include('implement');
      expect(choiceValues).to.include('__custom__');
      expect(choiceValues).to.include('__adhoc__');
    });

    it('should include --json flag in ticket selection commands', async () => {
      const output = await execInProcess('work start -P test-project --json');
      const json = extractJson<{
        prompt: { choices: Array<{ command?: string }> };
      }>(output);

      for (const choice of json.prompt.choices) {
        if (choice.command) {
          expect(choice.command).to.include('--json');
          expect(choice.command).to.include('work start');
        }
      }
    });

    it('should output error when ticket not found', async () => {
      const output = await execInProcess('work start NONEXISTENT -P test-project --json');
      const json = extractJson<{
        error: { code: string; message: string };
        metadata: { command: string };
      }>(output);

      expect(json.error).to.exist;
      expect(json.error.code).to.equal('TICKET_NOT_FOUND');
      expect(json.metadata.command).to.equal('work start');
    });

    describe('blocked ticket handling', () => {
      beforeEach(() => {
        // Create a blocker ticket (not done)
        createTestTicket('TKT-BLOCKER', 'Blocker ticket', 'status-in-progress');
        // Create a blocked ticket
        createTestTicket('TKT-BLOCKED', 'Blocked ticket', 'status-backlog');
        // Add dependency: TKT-BLOCKED is blocked by TKT-BLOCKER
        db.prepare(`
          INSERT INTO pmo_ticket_dependencies (ticket_id, depends_on_ticket_id, dependency_type)
          VALUES ('TKT-BLOCKED', 'TKT-BLOCKER', 'blocks')
        `).run();
      });

      it('should output blocked confirmation prompt when ticket has unresolved blockers', async () => {
        const output = await execInProcess('work start TKT-BLOCKED -P test-project --json');
        const json = extractJson<{
          prompt: { type: string; name: string; message: string; choices: Array<{ name: string; value: string }> };
          metadata: { command: string };
        }>(output);

        expect(json.prompt).to.exist;
        expect(json.prompt.type).to.equal('list');
        expect(json.prompt.name).to.equal('startAnyway');
        expect(json.prompt.message.toLowerCase()).to.include('start anyway');
        expect(json.metadata.command).to.equal('work start');

        // Choices should include yes/no options
        const choiceValues = json.prompt.choices.map(c => c.value);
        expect(choiceValues).to.include('yes');
        expect(choiceValues).to.include('no');
      });

      it('should skip blocked prompt when blocker is done', async () => {
        // Mark blocker as done
        db.prepare(`
          UPDATE pmo_tickets SET status = 'Done', status_id = 'status-done'
          WHERE id = 'TKT-BLOCKER'
        `).run();

        const output = await execInProcess('work start TKT-BLOCKED -P test-project --json');
        const json = extractJson<{
          prompt: { type: string; name: string };
        }>(output);

        // Should skip to action selection (no staff agents → auto ephemeral → action prompt)
        expect(json.prompt.name).to.not.equal('startAnyway');
        expect(json.prompt.name).to.equal('selectedActionId');
      });

      it('should skip blocked prompt with --force flag', async () => {
        const output = await execInProcess('work start TKT-BLOCKED -P test-project --force --json');
        const json = extractJson<{
          prompt: { type: string; name: string };
        }>(output);

        // Should skip to action selection (no staff agents → auto ephemeral → action prompt)
        expect(json.prompt.name).to.not.equal('startAnyway');
        expect(json.prompt.name).to.equal('selectedActionId');
      });
    });
  });

  // ===========================================================================
  // work complete command tests
  // ===========================================================================

  describe('work complete --json', () => {
    beforeEach(() => {
      // Create in-progress tickets
      createTestTicket('TKT-010', 'Complete me 1', 'status-in-progress', 'agent-1');
      createTestTicket('TKT-011', 'Complete me 2', 'status-in-progress', 'agent-2');
      createTestExecution('exec-010', 'TKT-010', 'agent-1', 'running');
    });

    it('should output prompt JSON when no ticket ID provided', async () => {
      const output = await execInProcess('work complete -P test-project --json');
      const json = extractJson<{
        prompt: { type: string; name: string; message: string; choices: Array<{ name: string; value: string }> };
        metadata: { command: string; flags: Record<string, unknown> };
      }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('list');
      expect(json.prompt.choices).to.be.an('array');
      expect(json.metadata.command).to.equal('work complete');
    });

    it('should include --json flag in ticket selection commands', async () => {
      const output = await execInProcess('work complete -P test-project --json');
      const json = extractJson<{
        prompt: { choices: Array<{ command?: string }> };
      }>(output);

      for (const choice of json.prompt.choices) {
        if (choice.command) {
          expect(choice.command).to.include('--json');
          expect(choice.command).to.include('work complete');
        }
      }
    });

    it('should only show in-progress tickets', async () => {
      createTestTicket('TKT-012', 'Backlog ticket', 'status-backlog');

      const output = await execInProcess('work complete -P test-project --json');
      const json = extractJson<{
        prompt: { choices: Array<{ name: string; value: string }> };
      }>(output);

      const choiceValues = json.prompt.choices.map(c => c.value);
      expect(choiceValues).to.include('TKT-010');
      expect(choiceValues).to.include('TKT-011');
      expect(choiceValues).to.not.include('TKT-012');
    });

    it('should move ticket to Done when ticket ID provided', async () => {
      const output = await execInProcess('work complete TKT-010 -P test-project --machine');

      expect(output.toLowerCase()).to.include('work complete');
      expect(output).to.include('TKT-010');

      const { statusId } = getTicketStatus('TKT-010');
      expect(statusId).to.equal('status-done');
    });

    // Note: Execution status update is tested as part of the ticket move flow
    // The ExecutionStorage.updateStatus is called when marking work complete
  });

  // ===========================================================================
  // work spawn command tests
  // ===========================================================================

  describe('work spawn --json', () => {
    beforeEach(() => {
      // Create tickets in backlog column
      createTestTicket('TKT-020', 'Spawn ticket 1', 'status-backlog');
      createTestTicket('TKT-021', 'Spawn ticket 2', 'status-backlog');
      createTestTicket('TKT-022', 'In progress ticket', 'status-in-progress');
    });

    it('should output mode selection prompt when no flags provided', async () => {
      const output = await execInProcess('work spawn -P test-project --json');
      const json = extractJson<{
        prompt: { type: string; name: string; message: string; choices: Array<{ name: string; value: string }> };
        metadata: { command: string; flags: Record<string, unknown> };
      }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('list');
      expect(json.prompt.choices).to.be.an('array');
      expect(json.metadata.command).to.equal('work spawn');

      // Should have All and Many options
      const choiceNames = json.prompt.choices.map(c => c.name.toLowerCase());
      expect(choiceNames.some(n => n.includes('all'))).to.be.true;
      expect(choiceNames.some(n => n.includes('many'))).to.be.true;
    });

    it('should output column selection prompt with --all flag', async () => {
      const output = await execInProcess('work spawn -P test-project --all --json');
      const json = extractJson<{
        prompt: { type: string; name: string; message: string; choices: Array<{ name: string; value: string }> };
        metadata: { command: string; flags: Record<string, unknown> };
      }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('list');
      expect(json.prompt.name).to.equal('selectedColumn');

      // Choices should be column names with ticket counts
      const choiceNames = json.prompt.choices.map(c => c.name.toLowerCase());
      expect(choiceNames.some(n => n.includes('backlog'))).to.be.true;
    });

    it('should output ticket selection prompt with --many flag', async () => {
      const output = await execInProcess('work spawn -P test-project --many --json');
      const json = extractJson<{
        prompt: { type: string; name: string; message: string; choices: Array<{ name: string; value: string }> };
        metadata: { command: string; flags: Record<string, unknown> };
      }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('checkbox');
      expect(json.prompt.name).to.equal('selectedTickets');

      // Choices should include ticket IDs
      const choiceValues = json.prompt.choices.map(c => c.value);
      expect(choiceValues).to.include('TKT-020');
      expect(choiceValues).to.include('TKT-021');
    });

    it('should output success JSON when ticket IDs provided directly', async () => {
      const output = await execInProcess('work spawn TKT-020 TKT-021 -P test-project --json');
      const json = extractJson<{
        success: boolean;
        result: { ticketsSelected: Array<{ id: string }>; count: number };
      }>(output);

      expect(json.success).to.be.true;
      expect(json.result.count).to.equal(2);
      expect(json.result.ticketsSelected.map(t => t.id)).to.include('TKT-020');
      expect(json.result.ticketsSelected.map(t => t.id)).to.include('TKT-021');
    });

    it('should include --executor codex in spawn confirmation command (smoke)', async () => {
      const output = await execInProcess('work spawn TKT-020 -P test-project --action implement --display terminal --skip-permissions --executor codex --json');
      const json = extractJson<{
        type: string;
        confirm_command: string;
      }>(output);

      expect(json.type).to.equal('confirmation_needed');
      expect(json.confirm_command).to.include('--executor codex');
      expect(json.confirm_command).to.include('work spawn TKT-020');
    });
  });

  // ===========================================================================
  // End-to-end Agent Flow Tests
  // ===========================================================================

  describe('End-to-end agent flows (--json flag)', () => {
    /**
     * Helper to simulate agent flow: execute command, parse JSON, return parsed result.
     */
    interface AgentPrompt {
      prompt: {
        type: string;
        name: string;
        message: string;
        choices?: Array<{ name: string; value: string; command?: string }>;
      };
      metadata: {
        command: string;
        flags: Record<string, unknown>;
      };
    }

    interface AgentSuccess {
      success: boolean;
      data: unknown;
    }

    async function agentExec(cmd: string): Promise<AgentPrompt | AgentSuccess> {
      const output = await execInProcess(cmd);
      return extractJson<AgentPrompt | AgentSuccess>(output);
    }

    function isPrompt(result: AgentPrompt | AgentSuccess): result is AgentPrompt {
      return 'prompt' in result;
    }

    /**
     * Helper to find a choice by partial name match.
     */
    function findChoice(
      choices: Array<{ name: string; value: string; command?: string }>,
      pattern: string
    ): { name: string; value: string; command?: string } | undefined {
      return choices.find(c => c.name.toLowerCase().includes(pattern.toLowerCase()));
    }

    /**
     * Helper to get the command from a choice (strips 'prlt ' prefix).
     */
    function execChoice(choice: { command?: string }): string {
      if (!choice.command) {
        throw new Error('Choice has no command field');
      }
      return choice.command.replace('prlt ', '');
    }

    /**
     * Helper to execute final command (strips --json flag, adds --no-pr to work ready to prevent interactive prompts).
     */
    async function execFinal(cmd: string): Promise<string> {
      const stripped = cmd.replace(' --json', '');
      // work ready may prompt for PR creation if gh is installed; bypass with --no-pr
      const safe = stripped.includes('work ready') ? stripped + ' --no-pr' : stripped;
      return await execInProcess(safe);
    }

    describe('work menu - full agent flow', () => {
      beforeEach(() => {
        createTestTicket('TKT-100', 'Flow test ticket', 'status-in-progress');
        createTestExecution('exec-100', 'TKT-100', 'agent-1', 'running');
      });

      it('should complete flow: menu → ready → ticket selection → verify result', async () => {
        // Step 1: Get work menu
        const step1Result = await agentExec('work -P test-project --json');
        expect(isPrompt(step1Result)).to.be.true;
        const step1 = step1Result as AgentPrompt;

        expect(step1.prompt.type).to.equal('list');
        expect(step1.prompt.choices).to.be.an('array');

        // Find "ready" option
        const readyChoice = findChoice(step1.prompt.choices!, 'ready');
        expect(readyChoice).to.exist;
        expect(readyChoice!.command).to.include('work ready');

        // Step 2: Select "ready" - get ticket selection
        const step2Result = await agentExec(execChoice(readyChoice!));
        expect(isPrompt(step2Result)).to.be.true;
        const step2 = step2Result as AgentPrompt;

        expect(step2.prompt.type).to.equal('list');
        expect(step2.prompt.choices).to.be.an('array');

        // Find the test ticket
        const ticketChoice = findChoice(step2.prompt.choices!, 'TKT-100');
        expect(ticketChoice).to.exist;

        // Step 3: Execute final command (without --json)
        const result = await execFinal(execChoice(ticketChoice!));

        // Verify ticket was marked ready (moves to Review column)
        expect(result.toLowerCase()).to.include('work ready');
        expect(result).to.include('TKT-100');

        // Verify in database - work ready moves to Review, not Done
        const { statusId } = getTicketStatus('TKT-100');
        expect(statusId).to.equal('status-review');
      });

      it('should complete flow: menu → complete → ticket selection → verify result', async () => {
        // Step 1: Get work menu
        const step1Result = await agentExec('work -P test-project --json');
        const step1 = step1Result as AgentPrompt;

        // Find "complete" option
        const completeChoice = findChoice(step1.prompt.choices!, 'complete');
        expect(completeChoice).to.exist;

        // Step 2: Select "complete" - get ticket selection
        const step2Result = await agentExec(execChoice(completeChoice!));
        const step2 = step2Result as AgentPrompt;

        // Find the test ticket
        const ticketChoice = findChoice(step2.prompt.choices!, 'TKT-100');
        expect(ticketChoice).to.exist;

        // Step 3: Execute final command
        const result = await execFinal(execChoice(ticketChoice!));

        // Verify ticket was marked complete
        expect(result.toLowerCase()).to.include('work complete');
        const { statusId } = getTicketStatus('TKT-100');
        expect(statusId).to.equal('status-done');
      });
    });

    describe('work ready - full agent flow', () => {
      beforeEach(() => {
        createTestTicket('TKT-200', 'Ready flow test 1', 'status-in-progress');
        createTestTicket('TKT-201', 'Ready flow test 2', 'status-in-progress');
        createTestExecution('exec-200', 'TKT-200', 'agent-1', 'running');
      });

      it('should complete flow: ticket selection → verify move to Review', async () => {
        // Step 1: Get ticket selection
        const step1Result = await agentExec('work ready -P test-project --json');
        const step1 = step1Result as AgentPrompt;

        expect(step1.prompt.type).to.equal('list');

        // Find first ticket
        const ticketChoice = findChoice(step1.prompt.choices!, 'TKT-200');
        expect(ticketChoice).to.exist;

        // Step 2: Execute selection
        const result = await execFinal(execChoice(ticketChoice!));

        expect(result).to.include('TKT-200');
        // work ready moves to Review column
        const { statusId } = getTicketStatus('TKT-200');
        expect(statusId).to.equal('status-review');
      });

      it('should skip prompts when ticket ID provided directly', async () => {
        const result = await execInProcess('work ready TKT-200 -P test-project --no-pr --machine');

        expect(result).to.include('TKT-200');
        // work ready moves to Review column
        const { statusId } = getTicketStatus('TKT-200');
        expect(statusId).to.equal('status-review');
      });
    });

    describe('work complete - full agent flow', () => {
      beforeEach(() => {
        createTestTicket('TKT-300', 'Complete flow test 1', 'status-in-progress');
        createTestTicket('TKT-301', 'Complete flow test 2', 'status-in-progress');
        createTestExecution('exec-300', 'TKT-300', 'agent-1', 'running');
      });

      it('should complete flow: ticket selection → verify move to Done', async () => {
        // Step 1: Get ticket selection
        const step1Result = await agentExec('work complete -P test-project --json');
        const step1 = step1Result as AgentPrompt;

        expect(step1.prompt.type).to.equal('list');

        // Find first ticket
        const ticketChoice = findChoice(step1.prompt.choices!, 'TKT-300');
        expect(ticketChoice).to.exist;

        // Step 2: Execute selection
        const result = await execFinal(execChoice(ticketChoice!));

        expect(result).to.include('TKT-300');
        const { statusId } = getTicketStatus('TKT-300');
        expect(statusId).to.equal('status-done');
      });

      it('should skip prompts when ticket ID provided directly', async () => {
        const result = await execInProcess('work complete TKT-300 -P test-project --machine');

        expect(result).to.include('TKT-300');
        const { statusId } = getTicketStatus('TKT-300');
        expect(statusId).to.equal('status-done');
      });
    });

    describe('work spawn - full agent flow', () => {
      beforeEach(() => {
        createTestTicket('TKT-400', 'Spawn flow test 1', 'status-backlog');
        createTestTicket('TKT-401', 'Spawn flow test 2', 'status-backlog');
        createTestTicket('TKT-402', 'Spawn flow test 3', 'status-in-progress');
      });

      it('should go to column selection with --all flag', async () => {
        // With --all flag, go directly to column selection
        const result = await agentExec('work spawn --all -P test-project --json');
        const step = result as AgentPrompt;

        expect(step.prompt.type).to.equal('list');
        expect(step.prompt.name).to.equal('selectedColumn');

        // Verify Backlog column shows ticket count
        const backlogChoice = findChoice(step.prompt.choices!, 'backlog');
        expect(backlogChoice).to.exist;
        expect(backlogChoice!.name).to.include('2'); // 2 tickets in backlog
      });

      it('should go to ticket selection with --many flag', async () => {
        // With --many flag, go directly to ticket checkbox
        const result = await agentExec('work spawn --many -P test-project --json');
        const step = result as AgentPrompt;

        expect(step.prompt.type).to.equal('checkbox');
        expect(step.prompt.name).to.equal('selectedTickets');

        // Verify all tickets are shown
        const ticketValues = step.prompt.choices!.map(c => c.value);
        expect(ticketValues).to.include('TKT-400');
        expect(ticketValues).to.include('TKT-401');
        expect(ticketValues).to.include('TKT-402');
      });

      it('should return success JSON when ticket IDs provided directly', async () => {
        const output = await execInProcess('work spawn TKT-400 TKT-401 -P test-project --json');
        const json = extractJson<{
          success: boolean;
          result: { ticketsSelected: Array<{ id: string }>; count: number };
        }>(output);

        expect(json.success).to.be.true;
        expect(json.result.count).to.equal(2);
        expect(json.result.ticketsSelected.map(t => t.id)).to.include('TKT-400');
        expect(json.result.ticketsSelected.map(t => t.id)).to.include('TKT-401');
      });

      // Note: --all and --many flags tested above
    });
  });

  // ===========================================================================
  // Backward Compatibility Tests
  // ===========================================================================

  describe('Backward compatibility (--json vs --machine)', () => {
    beforeEach(() => {
      createTestTicket('TKT-500', 'Compat test ticket', 'status-in-progress');
    });

    it('work ready: should produce same structure with --json and --machine', async () => {
      const jsonOutput = await execInProcess('work ready -P test-project --json');
      const machineOutput = await execInProcess('work ready -P test-project --machine');

      const jsonResult = extractJson<{ prompt: { type: string } }>(jsonOutput);
      const machineResult = extractJson<{ prompt: { type: string } }>(machineOutput);

      expect(machineResult.prompt.type).to.equal(jsonResult.prompt.type);
    });

    it('work complete: should produce same structure with --json and --machine', async () => {
      const jsonOutput = await execInProcess('work complete -P test-project --json');
      const machineOutput = await execInProcess('work complete -P test-project --machine');

      const jsonResult = extractJson<{ prompt: { type: string } }>(jsonOutput);
      const machineResult = extractJson<{ prompt: { type: string } }>(machineOutput);

      expect(machineResult.prompt.type).to.equal(jsonResult.prompt.type);
    });

    it('work spawn: should produce same structure with --json and --machine', async () => {
      const jsonOutput = await execInProcess('work spawn -P test-project --json');
      const machineOutput = await execInProcess('work spawn -P test-project --machine');

      const jsonResult = extractJson<{ prompt: { type: string } }>(jsonOutput);
      const machineResult = extractJson<{ prompt: { type: string } }>(machineOutput);

      expect(machineResult.prompt.type).to.equal(jsonResult.prompt.type);
    });

    it('work: should produce same structure with --json and --machine', async () => {
      const jsonOutput = await execInProcess('work -P test-project --json');
      const machineOutput = await execInProcess('work -P test-project --machine');

      const jsonResult = extractJson<{ prompt: { type: string } }>(jsonOutput);
      const machineResult = extractJson<{ prompt: { type: string } }>(machineOutput);

      expect(machineResult.prompt.type).to.equal(jsonResult.prompt.type);
    });
  });

  // ===========================================================================
  // Error Handling Tests
  // ===========================================================================

  describe('Error handling in JSON mode', () => {
    it('work ready: should output error JSON when no in-progress tickets', async () => {
      // No in-progress tickets exist (only backlog)
      createTestTicket('TKT-600', 'Backlog ticket', 'status-backlog');

      const output = await execInProcess('work ready -P test-project --json');
      const json = extractJson<{
        error: { code: string; message: string };
        metadata: { command: string };
      }>(output);

      expect(json.error).to.exist;
      expect(json.error.code).to.equal('NO_IN_PROGRESS_WORK');
      expect(json.metadata.command).to.equal('work ready');
    });

    it('work complete: should output error JSON when no completable tickets', async () => {
      createTestTicket('TKT-601', 'Backlog ticket', 'status-backlog');

      const output = await execInProcess('work complete -P test-project --json');
      const json = extractJson<{
        error: { code: string; message: string };
        metadata: { command: string };
      }>(output);

      expect(json.error).to.exist;
      expect(json.error.code).to.equal('NO_COMPLETABLE_WORK');
      expect(json.metadata.command).to.equal('work complete');
    });

    it('work spawn: should output error JSON when no tickets exist', async () => {
      // Remove all tickets by creating empty project scenario
      db.exec('DELETE FROM pmo_board_tickets');
      db.exec('DELETE FROM pmo_tickets');

      const output = await execInProcess('work spawn -P test-project --json');
      const json = extractJson<{
        error: { code: string; message: string };
        metadata: { command: string };
      }>(output);

      expect(json.error).to.exist;
      expect(json.error.code).to.equal('NO_TICKETS');
      expect(json.metadata.command).to.equal('work spawn');
    });
  });
});
