import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import Database from 'better-sqlite3'
import { execProduction as exec } from './test-helpers.js'

/** Database row type for agent_work queries */
interface AgentWorkRow {
  container_id: string | null
  environment: string
  status: string
}

/**
 * End-to-end tests for Docker Management Commands
 * Tests: prlt docker status, list, logs, start, stop, shell, restart, sync, clean, prune
 *
 * Note: These tests run without Docker available, so they test
 * the "Docker not running" code paths. Full Docker integration
 * tests would require a Docker environment.
 *
 * The CLI tests run from the CLI directory (not a temp dir) to avoid
 * TypeScript loader issues. Database tests use a separate temp database.
 */
describe('Docker Commands E2E Tests', () => {
  let testDir: string
  let dbPath: string
  let db: Database.Database

  beforeEach(() => {
    // Create temp dir for database tests only (not for CLI execution)
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docker-commands-e2e-'))

    // Setup test database
    const proletariatDir = path.join(testDir, '.proletariat')
    fs.mkdirSync(proletariatDir, { recursive: true })
    dbPath = path.join(proletariatDir, 'workspace.db')

    db = new Database(dbPath)
    setupTestDatabase(db)
  })

  afterEach(() => {
    if (db) db.close()
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true })
    }
  })

  /**
   * prlt docker status
   * Note: docker status doesn't need a workspace, just checks Docker daemon
   */
  describe('prlt docker status', () => {
    it('should show help with --help flag', () => {
      const output = exec('docker status --help')

      expect(output).to.contain('Check if Docker daemon is running')
      expect(output).to.contain('USAGE')
    })

    it('should report Docker status', () => {
      const output = exec('docker status')

      // Should contain status header
      expect(output).to.contain('Docker Status')

      // Should show either "Running" or "Not Running"
      const hasStatus = output.includes('Running') || output.includes('Not Running')
      expect(hasStatus).to.be.true
    })

    it('should indicate when Docker is not available', () => {
      // In test environment, Docker is typically not running
      const output = exec('docker status')

      // If Docker isn't running, should show appropriate message
      if (output.includes('Not Running')) {
        expect(output).to.contain('not available')
      }
    })
  })

  /**
   * prlt docker list
   * Note: These tests require a workspace. We test help and flag parsing,
   * and mark workspace-dependent tests appropriately.
   */
  describe('prlt docker list', () => {
    it('should show help with --help flag', () => {
      const output = exec('docker list --help')

      expect(output).to.contain('Show Docker containers from agent_work table')
      expect(output).to.contain('--all')
      expect(output).to.contain('--running')
      expect(output).to.contain('USAGE')
    })

    it('should accept --all flag without unknown flag error', () => {
      const output = exec('docker list --all --help')

      // Should not error with --all flag in help context
      expect(output).to.not.contain('Unknown flag')
      expect(output).to.not.contain('Unexpected argument')
    })

    it('should accept --running flag without unknown flag error', () => {
      const output = exec('docker list --running --help')

      // Should not error with --running flag in help context
      expect(output).to.not.contain('Unknown flag')
      expect(output).to.not.contain('Unexpected argument')
    })

    // Tests that require workspace context - run in workspace or skip
    it('should handle missing workspace gracefully', () => {
      const output = exec('docker list')

      // When run outside workspace, should indicate workspace required
      // or if Docker isn't running, show that message
      const validOutput =
        output.includes('Not in a workspace') ||
        output.includes('Docker is not running') ||
        output.includes('Docker Containers') ||
        output.includes('No containers')
      expect(validOutput).to.be.true
    })
  })

  /**
   * prlt docker clean
   * Note: These tests require a workspace. We test help and flag parsing,
   * and mark workspace-dependent tests appropriately.
   */
  describe('prlt docker clean', () => {
    it('should show help with --help flag', () => {
      const output = exec('docker clean --help')

      expect(output).to.contain('Remove orphaned containers')
      expect(output).to.contain('--force')
      expect(output).to.contain('--dry-run')
      expect(output).to.contain('--all')
      expect(output).to.contain('USAGE')
    })

    it('should accept --dry-run flag without unknown flag error', () => {
      const output = exec('docker clean --dry-run --help')

      // Should not error with --dry-run flag
      expect(output).to.not.contain('Unknown flag')
    })

    it('should accept --all flag without unknown flag error', () => {
      const output = exec('docker clean --all --help')

      // Should not error with --all flag
      expect(output).to.not.contain('Unknown flag')
    })

    it('should accept --force flag without unknown flag error', () => {
      const output = exec('docker clean --force --help')

      // Should accept --force flag
      expect(output).to.not.contain('Unknown flag')
    })

    it('should handle missing workspace gracefully', () => {
      const output = exec('docker clean --force')

      // When run outside workspace, should indicate workspace required
      // or if Docker isn't running, show that message
      const validOutput =
        output.includes('Not in a workspace') ||
        output.includes('Docker is not running') ||
        output.includes('No orphaned containers') ||
        output.includes('Removed')
      expect(validOutput).to.be.true
    })
  })

  /**
   * prlt docker logs
   */
  describe('prlt docker logs', () => {
    it('should show help with --help flag', () => {
      const output = exec('docker logs --help')

      expect(output).to.contain('View logs from a container')
      expect(output).to.contain('--follow')
      expect(output).to.contain('--tail')
      expect(output).to.contain('USAGE')
    })

    it('should accept --follow flag without unknown flag error', () => {
      const output = exec('docker logs --follow --help')

      expect(output).to.not.contain('Unknown flag')
    })

    it('should accept --tail flag without unknown flag error', () => {
      const output = exec('docker logs --tail 50 --help')

      expect(output).to.not.contain('Unknown flag')
    })

    it('should require a target argument', () => {
      const output = exec('docker logs')

      // Should indicate missing argument
      const validOutput =
        output.includes('Missing required arg') ||
        output.includes('target') ||
        output.includes('Docker is not running')
      expect(validOutput).to.be.true
    })

    it('should accept execution ID format', () => {
      const output = exec('docker logs WORK-001')

      // Should process the command (may fail due to no Docker or no execution)
      const validOutput =
        output.includes('Docker is not running') ||
        output.includes('not found') ||
        output.includes('Logs for')
      expect(validOutput).to.be.true
    })
  })

  /**
   * prlt docker stop
   */
  describe('prlt docker stop', () => {
    it('should show help with --help flag', () => {
      const output = exec('docker stop --help')

      expect(output).to.contain('Stop a running container')
      expect(output).to.contain('--force')
      expect(output).to.contain('--time')
      expect(output).to.contain('USAGE')
    })

    it('should accept --force flag without unknown flag error', () => {
      const output = exec('docker stop --force --help')

      expect(output).to.not.contain('Unknown flag')
    })

    it('should accept --time flag without unknown flag error', () => {
      const output = exec('docker stop --time 30 --help')

      expect(output).to.not.contain('Unknown flag')
    })

    it('should require a target argument', () => {
      const output = exec('docker stop')

      const validOutput =
        output.includes('Missing required arg') ||
        output.includes('target') ||
        output.includes('Docker is not running')
      expect(validOutput).to.be.true
    })
  })

  /**
   * prlt docker shell
   */
  describe('prlt docker shell', () => {
    it('should show help with --help flag', () => {
      const output = exec('docker shell --help')

      expect(output).to.contain('Open a shell in a running container')
      expect(output).to.contain('--shell')
      expect(output).to.contain('--user')
      expect(output).to.contain('USAGE')
    })

    it('should accept --shell flag without unknown flag error', () => {
      const output = exec('docker shell --shell /bin/bash --help')

      expect(output).to.not.contain('Unknown flag')
    })

    it('should accept --user flag without unknown flag error', () => {
      const output = exec('docker shell --user root --help')

      expect(output).to.not.contain('Unknown flag')
    })

    it('should require a target argument', () => {
      const output = exec('docker shell')

      const validOutput =
        output.includes('Missing required arg') ||
        output.includes('target') ||
        output.includes('Docker is not running')
      expect(validOutput).to.be.true
    })
  })

  /**
   * prlt docker restart
   */
  describe('prlt docker restart', () => {
    it('should show help with --help flag', () => {
      const output = exec('docker restart --help')

      expect(output).to.contain('Restart a container')
      expect(output).to.contain('--force')
      expect(output).to.contain('--time')
      expect(output).to.contain('USAGE')
    })

    it('should accept --force flag without unknown flag error', () => {
      const output = exec('docker restart --force --help')

      expect(output).to.not.contain('Unknown flag')
    })

    it('should require a target argument', () => {
      const output = exec('docker restart')

      const validOutput =
        output.includes('Missing required arg') ||
        output.includes('target') ||
        output.includes('Docker is not running')
      expect(validOutput).to.be.true
    })
  })

  /**
   * prlt docker start
   */
  describe('prlt docker start', () => {
    it('should show help with --help flag', () => {
      const output = exec('docker start --help')

      expect(output).to.contain('Start a stopped container')
      expect(output).to.contain('USAGE')
    })

    it('should require a target argument', () => {
      const output = exec('docker start')

      const validOutput =
        output.includes('Missing required arg') ||
        output.includes('target') ||
        output.includes('Docker is not running')
      expect(validOutput).to.be.true
    })

    it('should accept execution ID format', () => {
      const output = exec('docker start WORK-001')

      // Should process the command (may fail due to no Docker or no execution)
      const validOutput =
        output.includes('Docker is not running') ||
        output.includes('not found') ||
        output.includes('Started') ||
        output.includes('already running') ||
        output.includes('Failed to start') ||
        output.includes('Start Container')
      expect(validOutput).to.be.true
    })
  })

  /**
   * prlt docker sync
   */
  describe('prlt docker sync', () => {
    it('should show help with --help flag', () => {
      const output = exec('docker sync --help')

      expect(output).to.contain('Sync container status from Docker into the database')
      expect(output).to.contain('USAGE')
    })

    it('should handle missing workspace gracefully', () => {
      const output = exec('docker sync')

      // When run outside workspace, should indicate workspace required
      // or if Docker isn't running, show that message
      const validOutput =
        output.includes('Not in a workspace') ||
        output.includes('Docker is not running') ||
        output.includes('Syncing Containers') ||
        output.includes('Sync complete')
      expect(validOutput).to.be.true
    })
  })

  /**
   * prlt docker prune
   */
  describe('prlt docker prune', () => {
    it('should show help with --help flag', () => {
      const output = exec('docker prune --help')

      expect(output).to.contain('Remove unused Docker resources')
      expect(output).to.contain('--force')
      expect(output).to.contain('--dry-run')
      expect(output).to.contain('--all')
      expect(output).to.contain('--volumes')
      expect(output).to.contain('USAGE')
    })

    it('should accept --dry-run flag without unknown flag error', () => {
      const output = exec('docker prune --dry-run --help')

      expect(output).to.not.contain('Unknown flag')
    })

    it('should accept --all flag without unknown flag error', () => {
      const output = exec('docker prune --all --help')

      expect(output).to.not.contain('Unknown flag')
    })

    it('should accept --volumes flag without unknown flag error', () => {
      const output = exec('docker prune --volumes --help')

      expect(output).to.not.contain('Unknown flag')
    })

    it('should handle Docker not running gracefully', () => {
      const output = exec('docker prune --force')

      const validOutput =
        output.includes('Docker is not running') ||
        output.includes('Docker Prune') ||
        output.includes('prune completed')
      expect(validOutput).to.be.true
    })
  })

  /**
   * prlt docker (main menu)
   */
  describe('prlt docker', () => {
    it('should show help with --help flag', () => {
      const output = exec('docker --help')

      expect(output).to.contain('Manage Docker containers')
      // Subcommands are listed with their full names
      expect(output).to.contain('clean')
      expect(output).to.contain('list')
      expect(output).to.contain('COMMANDS')
    })

    it('should list available subcommands in examples', () => {
      const output = exec('docker --help')

      // Examples section shows full command syntax
      expect(output).to.contain('prlt docker status')
      expect(output).to.contain('prlt docker list')
      expect(output).to.contain('prlt docker logs')
      expect(output).to.contain('prlt docker start')
      expect(output).to.contain('prlt docker stop')
      expect(output).to.contain('prlt docker shell')
      expect(output).to.contain('prlt docker restart')
      expect(output).to.contain('prlt docker sync')
      expect(output).to.contain('prlt docker clean')
      expect(output).to.contain('prlt docker prune')
    })
  })

  /**
   * Database integration tests
   */
  describe('Database Integration', () => {
    it('should query executions with container_id', () => {
      const ticketId = createTicket(db, 'Container test', 'in-progress')

      createExecution(db, ticketId, 'agent-1', 'running', {
        environment: 'devcontainer',
        container_id: 'abc123',
      })

      const execution = db
        .prepare(
          `
        SELECT * FROM agent_work WHERE container_id IS NOT NULL
      `
        )
        .get() as AgentWorkRow | undefined

      expect(execution).to.exist
      expect(execution!.container_id).to.equal('abc123')
      expect(execution!.environment).to.equal('devcontainer')
    })

    it('should find orphaned executions (container_id but not running)', () => {
      const ticketId = createTicket(db, 'Orphan test', 'done')

      createExecution(db, ticketId, 'agent-1', 'completed', {
        environment: 'devcontainer',
        container_id: 'orphan123',
      })

      // Query for executions with containers that are not in running/starting status
      const orphanedExecutions = db
        .prepare(
          `
        SELECT * FROM agent_work
        WHERE container_id IS NOT NULL
        AND status NOT IN ('running', 'starting')
      `
        )
        .all()

      expect(orphanedExecutions).to.have.lengthOf(1)
    })

    it('should identify running executions with containers', () => {
      const ticketId1 = createTicket(db, 'Running', 'in-progress')
      const ticketId2 = createTicket(db, 'Completed', 'done')

      createExecution(db, ticketId1, 'agent-1', 'running', {
        environment: 'devcontainer',
        container_id: 'running123',
      })

      createExecution(db, ticketId2, 'agent-2', 'completed', {
        environment: 'devcontainer',
        container_id: 'completed456',
      })

      const activeExecutions = db
        .prepare(
          `
        SELECT * FROM agent_work
        WHERE container_id IS NOT NULL
        AND status IN ('running', 'starting')
      `
        )
        .all()

      expect(activeExecutions).to.have.lengthOf(1)
    })
  })
})

// =============================================================================
// Helper Functions
// =============================================================================

function setupTestDatabase(db: Database.Database) {
  db.exec(`
    -- Workspace configuration table
    CREATE TABLE IF NOT EXISTS workspace (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      type TEXT NOT NULL CHECK (type IN ('hq', 'workspace')),
      theme TEXT NOT NULL,
      workspace_name TEXT NOT NULL,
      has_pmo BOOLEAN DEFAULT FALSE,
      created_at TEXT NOT NULL
    );

    -- Themes table
    CREATE TABLE IF NOT EXISTS themes (
      name TEXT PRIMARY KEY,
      workspace_dir TEXT NOT NULL,
      add_command TEXT NOT NULL,
      remove_command TEXT NOT NULL,
      agents JSON NOT NULL
    );

    -- Agents table
    CREATE TABLE IF NOT EXISTS agents (
      name TEXT PRIMARY KEY,
      theme TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      path TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Repositories table
    CREATE TABLE IF NOT EXISTS repositories (
      name TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      type TEXT DEFAULT 'git',
      source_url TEXT,
      action TEXT,
      added_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pmo_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pmo_projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pmo_columns (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      position INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES pmo_projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS pmo_tickets (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      priority TEXT DEFAULT 'MEDIUM',
      category TEXT DEFAULT 'feature',
      status TEXT DEFAULT 'backlog',
      owner TEXT,
      assignee TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES pmo_projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS pmo_board_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      ticket_id TEXT NOT NULL UNIQUE,
      column_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES pmo_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (ticket_id) REFERENCES pmo_tickets(id) ON DELETE CASCADE,
      FOREIGN KEY (column_id) REFERENCES pmo_columns(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS agent_work (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      executor TEXT DEFAULT 'claude-code',
      mode TEXT DEFAULT 'foreground',
      environment TEXT DEFAULT 'host',
      display_mode TEXT DEFAULT 'terminal',
      sandboxed INTEGER DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'running',
      branch TEXT,
      pid TEXT,
      container_id TEXT,
      session_id TEXT,
      host TEXT,
      log_path TEXT,
      started_at TEXT DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT,
      exit_code INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_agent_work_agent ON agent_work(agent_name);
    CREATE INDEX IF NOT EXISTS idx_agent_work_status ON agent_work(status);
    CREATE INDEX IF NOT EXISTS idx_agent_work_container ON agent_work(container_id);
  `)

  // Insert workspace configuration
  db.prepare(
    `
    INSERT INTO workspace (id, type, theme, workspace_name, has_pmo, created_at)
    VALUES (1, 'hq', 'founders', 'test-workspace', 1, datetime('now'))
  `
  ).run()

  // Insert theme
  db.prepare(
    `
    INSERT INTO themes (name, workspace_dir, add_command, remove_command, agents)
    VALUES ('founders', 'founders', 'prlt agent add', 'prlt agent remove', '["agent-1", "agent-2"]')
  `
  ).run()

  // Insert test project
  db.prepare(
    `
    INSERT INTO pmo_projects (id, name, description)
    VALUES ('test-project', 'Test Project', 'E2E test project')
  `
  ).run()

  db.prepare(
    `
    INSERT INTO pmo_settings (key, value)
    VALUES ('pmo_path', 'pmo'), ('current_project', 'test-project')
  `
  ).run()

  const columns = [
    { id: 'backlog', name: 'Backlog', position: 0 },
    { id: 'in-progress', name: 'In Progress', position: 1 },
    { id: 'in-review', name: 'In Review', position: 2 },
    { id: 'done', name: 'Done', position: 3 },
  ]

  for (const col of columns) {
    db.prepare(
      `
      INSERT INTO pmo_columns (id, project_id, name, position)
      VALUES (?, 'test-project', ?, ?)
    `
    ).run(col.id, col.name, col.position)
  }

  // Create PMO directory structure
  const pmoPath = path.join(process.cwd(), 'pmo/projects/test-project')
  fs.mkdirSync(pmoPath, { recursive: true })

  // Create agents directory with founders subdirectory
  const agentsPath = path.join(process.cwd(), 'agents', 'founders')
  fs.mkdirSync(agentsPath, { recursive: true })
}

let ticketCounter = 0
function createTicket(
  db: Database.Database,
  title: string,
  columnId: string
): string {
  ticketCounter++
  const ticketId = `TKT-${String(ticketCounter).padStart(3, '0')}`

  db.prepare(
    `
    INSERT INTO pmo_tickets (id, project_id, title, status)
    VALUES (?, 'test-project', ?, ?)
  `
  ).run(ticketId, title, columnId === 'done' ? 'done' : 'active')

  db.prepare(
    `
    INSERT INTO pmo_board_tickets (project_id, ticket_id, column_id, position)
    VALUES ('test-project', ?, ?, 0)
  `
  ).run(ticketId, columnId)

  return ticketId
}

let executionCounter = 0
function createExecution(
  db: Database.Database,
  ticketId: string,
  agentName: string,
  status: string,
  options: {
    executor?: string
    mode?: string
    environment?: string
    display_mode?: string
    sandboxed?: boolean
    branch?: string
    pid?: string
    container_id?: string
    session_id?: string
    host?: string
    log_path?: string
  } = {}
): string {
  executionCounter++
  const execId = `WORK-${String(executionCounter).padStart(3, '0')}`

  db.prepare(
    `
    INSERT INTO agent_work (
      id, ticket_id, agent_name, status, executor, mode,
      environment, display_mode, sandboxed, branch,
      pid, container_id, session_id, host, log_path
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    execId,
    ticketId,
    agentName,
    status,
    options.executor || 'claude-code',
    options.mode || 'foreground',
    options.environment || 'host',
    options.display_mode || 'terminal',
    options.sandboxed !== undefined ? (options.sandboxed ? 1 : 0) : 1,
    options.branch || null,
    options.pid || null,
    options.container_id || null,
    options.session_id || null,
    options.host || null,
    options.log_path || null
  )

  return execId
}

