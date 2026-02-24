/**
 * Shared E2E test utilities for isolated test environments.
 *
 * This module provides utilities to ensure E2E tests run against isolated
 * test databases and PMO directories, preventing pollution of the real
 * workspace.db and ensuring test cleanup.
 *
 * Key isolation mechanisms:
 * 1. Creates temporary directories for each test
 * 2. Clears environment variables that could bypass isolation (PRLT_HQ_PATH, etc.)
 * 3. Changes process.cwd() to the test directory
 * 4. Cleans up all test artifacts after each test
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { initializePMOTables } from '../../src/lib/pmo/storage/base.js';
import { PMO_TABLES } from '../../src/lib/pmo/schema.js';
import { CREATE_TABLES_SQL } from '../../src/lib/database/index.js';

/**
 * Error type for execSync failures, which include stdout/stderr from the child process.
 */
interface ExecError extends Error {
  stdout?: string;
  stderr?: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Environment variables that could bypass test isolation.
 * These are explicitly cleared when running CLI commands to ensure
 * the CLI discovers the test database, not a real one.
 */
const ISOLATION_ENV_VARS = [
  'PRLT_HQ_PATH',
  'PRLT_PMO_PATH',
  'PRLT_DATABASE_PATH',
  'PRLT_CONFIG_PATH',
  'DEVCONTAINER',
  'PRLT_TEST_ENV',
];

export interface TestEnvironment {
  testDir: string;
  dbPath: string;
  pmoPath: string;
  proletariatDir: string;
  originalCwd: string;
}

/**
 * Creates an isolated test environment with a temporary directory,
 * database, and PMO structure.
 *
 * Usage in beforeEach:
 *   let env: TestEnvironment;
 *   beforeEach(() => {
 *     env = createTestEnvironment('my-test-');
 *   });
 *
 * @param prefix - Prefix for the temp directory name
 * @returns TestEnvironment with paths and cleanup utilities
 */
export function createTestEnvironment(prefix: string): TestEnvironment {
  const originalCwd = process.cwd();
  // Use realpath to resolve symlinks (important on macOS where /var -> /private/var)
  const testDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  process.chdir(testDir);

  const proletariatDir = path.join(testDir, '.proletariat');
  fs.mkdirSync(proletariatDir, { recursive: true });

  const dbPath = path.join(proletariatDir, 'workspace.db');
  const pmoPath = path.join(testDir, 'pmo');

  return {
    testDir,
    dbPath,
    pmoPath,
    proletariatDir,
    originalCwd,
  };
}

/**
 * Cleans up a test environment, restoring cwd and removing temp files.
 *
 * Usage in afterEach:
 *   afterEach(() => {
 *     cleanupTestEnvironment(env);
 *   });
 */
export function cleanupTestEnvironment(env: TestEnvironment): void {
  process.chdir(env.originalCwd);
  if (fs.existsSync(env.testDir)) {
    fs.rmSync(env.testDir, { recursive: true, force: true });
  }
}

/**
 * Creates a config.json file that marks the test directory as an HQ.
 * This is required for findPMO() to recognize the test directory.
 */
export function createHQConfig(proletariatDir: string, options: {
  name?: string;
  hasPmo?: boolean;
} = {}): void {
  const configPath = path.join(proletariatDir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    type: 'hq',
    name: options.name ?? 'test-hq',
    hasPmo: options.hasPmo ?? true,
  }), 'utf-8');
}

/**
 * Creates the standard PMO directory structure for tests.
 */
export function createPMODirectories(pmoPath: string, projectId: string = 'test-project'): void {
  const projectPath = path.join(pmoPath, 'projects', projectId);
  fs.mkdirSync(projectPath, { recursive: true });

  // Create specs directory
  const specsPath = path.join(pmoPath, 'specs');
  fs.mkdirSync(specsPath, { recursive: true });
}

/**
 * Creates epic directories for a project.
 */
export function createEpicDirectories(pmoPath: string, projectId: string = 'test-project'): void {
  const epicsDir = path.join(pmoPath, 'projects', projectId, 'epics');
  const statuses = ['draft', 'active', 'complete', 'dropped', 'future'];

  for (const status of statuses) {
    fs.mkdirSync(path.join(epicsDir, status), { recursive: true });
  }
}

// =============================================================================
// Production Schema Setup
// =============================================================================
// These helpers use the production PMO schema to ensure tests accurately
// reflect production behavior and prevent schema drift.

const T = PMO_TABLES;

/**
 * Sets up a test database using the production PMO schema.
 *
 * This is the recommended way to set up test databases as it:
 * - Uses the exact same schema as production (PMO_SCHEMA_SQL)
 * - Seeds all builtin data (workflows, phases, actions, templates)
 * - Prevents schema drift between tests and production
 *
 * Usage:
 *   const db = setupProductionSchema(env.dbPath, env.pmoPath);
 *   // db is ready to use with production schema and builtin data
 *
 * @param dbPath - Path to the SQLite database file
 * @param pmoPath - Path to the PMO directory (stored in settings)
 * @returns Database instance with production schema initialized
 */
export function setupProductionSchema(dbPath: string, pmoPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');

  // Initialize PMO tables using production schema and seeding
  // This runs migrations, creates tables, and seeds builtin data
  initializePMOTables(db);

  // Store PMO path in settings
  db.prepare(`INSERT OR REPLACE INTO ${T.settings} (key, value) VALUES ('pmo_path', ?)`).run(pmoPath);

  return db;
}

/**
 * Sets up a test database using the production workspace schema.
 *
 * This creates workspace-level tables (workspace, repositories, agents,
 * agent_themes, agent_theme_names, agent_worktrees, workspace_settings)
 * using the production CREATE_TABLES_SQL from database/index.ts.
 *
 * Use this for tests that only need workspace tables (repo, branch, theme commands).
 * For PMO tables, use setupProductionSchema instead.
 * For both, call setupProductionSchema first, then add workspace tables to the same db.
 *
 * @param dbPath - Path to the SQLite database file
 * @param options - Workspace configuration options
 * @returns Database instance with workspace schema initialized
 */
export function setupWorkspaceSchema(
  dbPath: string,
  options: {
    type?: 'hq' | 'workspace';
    workspaceName?: string;
    hasPmo?: boolean;
  } = {}
): Database.Database {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');

  // Create workspace tables using production schema
  db.exec(CREATE_TABLES_SQL);

  // Insert default workspace row
  const type = options.type ?? 'hq';
  const workspaceName = options.workspaceName ?? 'test-workspace';
  const hasPmo = options.hasPmo ?? false;
  db.prepare(`
    INSERT INTO workspace (id, type, workspace_name, has_pmo, created_at)
    VALUES (1, ?, ?, ?, datetime('now'))
  `).run(type, workspaceName, hasPmo ? 1 : 0);

  return db;
}

/**
 * Adds workspace tables to an existing database (e.g., one already set up with setupProductionSchema).
 *
 * @param db - Existing database instance
 * @param options - Workspace configuration options
 */
export function addWorkspaceTables(
  db: Database.Database,
  options: {
    type?: 'hq' | 'workspace';
    workspaceName?: string;
    hasPmo?: boolean;
  } = {}
): void {
  db.exec(CREATE_TABLES_SQL);

  const type = options.type ?? 'hq';
  const workspaceName = options.workspaceName ?? 'test-workspace';
  const hasPmo = options.hasPmo ?? true;
  db.prepare(`
    INSERT INTO workspace (id, type, workspace_name, has_pmo, created_at)
    VALUES (1, ?, ?, ?, datetime('now'))
  `).run(type, workspaceName, hasPmo ? 1 : 0);
}

/**
 * Creates a test project in the database.
 *
 * @param db - Database instance
 * @param options - Project options
 * @returns The project ID
 */
export function createTestProject(
  db: Database.Database,
  options: {
    id?: string;
    name?: string;
    description?: string;
    workflowId?: string;
  } = {}
): string {
  const id = options.id ?? 'test-project';
  const name = options.name ?? 'Test Project';
  const description = options.description ?? 'E2E test project';
  const workflowId = options.workflowId ?? 'default';

  db.prepare(`
    INSERT INTO ${T.projects} (id, name, description, workflow_id)
    VALUES (?, ?, ?, ?)
  `).run(id, name, description, workflowId);

  // Set as current project
  db.prepare(`INSERT OR REPLACE INTO ${T.settings} (key, value) VALUES ('current_project', ?)`).run(id);

  return id;
}

/**
 * Creates a test ticket in the database.
 *
 * @param db - Database instance
 * @param projectId - Project ID
 * @param options - Ticket options
 * @returns The ticket ID
 */
export function createTestTicket(
  db: Database.Database,
  projectId: string,
  options: {
    id?: string;
    title?: string;
    description?: string;
    status?: string;
    statusId?: string;
    priority?: string;
    category?: string;
  } = {}
): string {
  const id = options.id ?? `TKT-${Date.now()}`;
  const title = options.title ?? 'Test Ticket';
  const description = options.description ?? null;
  const status = options.status ?? 'Backlog';
  const statusId = options.statusId ?? 'default-backlog';
  const priority = options.priority ?? null;
  const category = options.category ?? null;

  db.prepare(`
    INSERT INTO ${T.tickets} (id, project_id, title, description, status, status_id, priority, category)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, projectId, title, description, status, statusId, priority, category);

  return id;
}

/**
 * Creates a custom workflow in the database.
 *
 * @param db - Database instance
 * @param options - Workflow options
 * @returns The workflow ID
 */
export function createTestWorkflow(
  db: Database.Database,
  options: {
    id?: string;
    name?: string;
    description?: string;
  } = {}
): string {
  const id = options.id ?? `test-workflow-${Date.now()}`;
  const name = options.name ?? 'Test Workflow';
  const description = options.description ?? null;

  db.prepare(`
    INSERT INTO ${T.workflows} (id, name, description, is_builtin)
    VALUES (?, ?, ?, 0)
  `).run(id, name, description);

  return id;
}

/**
 * Adds a status to a workflow.
 *
 * @param db - Database instance
 * @param workflowId - Workflow ID
 * @param options - Status options
 * @returns The status ID
 */
export function addTestWorkflowStatus(
  db: Database.Database,
  workflowId: string,
  options: {
    id?: string;
    name: string;
    category: string;
    position: number;
    isDefault?: boolean;
  }
): string {
  const id = options.id ?? `${workflowId}-${options.name.toLowerCase().replace(/\s+/g, '-')}`;

  db.prepare(`
    INSERT INTO ${T.workflow_statuses} (id, workflow_id, name, category, position, is_default)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, workflowId, options.name, options.category, options.position, options.isDefault ? 1 : 0);

  return id;
}

/**
 * Creates a test phase in the database.
 * Note: Production schema seeds default phases (idea, planned, active, completed, canceled).
 * Use this for creating additional custom phases for testing.
 *
 * @param db - Database instance
 * @param options - Phase options
 * @returns The phase ID
 */
export function createTestPhase(
  db: Database.Database,
  options: {
    id?: string;
    name: string;
    category: string;
    position?: number;
    description?: string;
    isDefault?: boolean;
  }
): string {
  const id = options.id ?? `phase-${options.name.toLowerCase().replace(/\s+/g, '-')}`;
  const position = options.position ?? 0;

  db.prepare(`
    INSERT INTO ${T.phases} (id, name, category, position, description, is_default)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, options.name, options.category, position, options.description ?? null, options.isDefault ? 1 : 0);

  return id;
}

/**
 * Creates a test spec in the database.
 *
 * @param db - Database instance
 * @param options - Spec options
 * @returns The spec ID
 */
export function createTestSpec(
  db: Database.Database,
  options: {
    id?: string;
    title?: string;
    status?: string;
  } = {}
): string {
  const id = options.id ?? `SPEC-${Date.now()}`;
  const title = options.title ?? 'Test Spec';
  const status = options.status ?? 'draft';

  db.prepare(`
    INSERT INTO ${T.specs} (id, title, status)
    VALUES (?, ?, ?)
  `).run(id, title, status);

  return id;
}

/**
 * Creates a test epic in the database.
 *
 * @param db - Database instance
 * @param projectId - Project ID
 * @param options - Epic options
 * @returns The epic ID
 */
export function createTestEpic(
  db: Database.Database,
  projectId: string,
  options: {
    id?: string;
    title?: string;
    description?: string;
    status?: string;
    position?: number;
  } = {}
): string {
  const id = options.id ?? `EPIC-${Date.now()}`;
  const title = options.title ?? 'Test Epic';
  const description = options.description ?? null;
  const status = options.status ?? 'active';
  const position = options.position ?? 0;

  db.prepare(`
    INSERT INTO ${T.epics} (id, project_id, title, description, status, position)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, projectId, title, description, status, position);

  return id;
}

/**
 * Gets the default status ID for a workflow.
 * Useful for creating tickets with the correct status_id.
 *
 * @param db - Database instance
 * @param workflowId - Workflow ID (defaults to 'default')
 * @returns The default status ID or first status if no default
 */
export function getDefaultStatusId(db: Database.Database, workflowId: string = 'default'): string {
  const result = db.prepare(`
    SELECT id FROM ${T.workflow_statuses}
    WHERE workflow_id = ?
    ORDER BY is_default DESC, position ASC
    LIMIT 1
  `).get(workflowId) as { id: string } | undefined;

  return result?.id ?? 'default-backlog';
}

/**
 * Gets a status ID by name for a workflow.
 *
 * @param db - Database instance
 * @param workflowId - Workflow ID
 * @param statusName - Status name to find
 * @returns The status ID or undefined if not found
 */
export function getStatusIdByName(
  db: Database.Database,
  workflowId: string,
  statusName: string
): string | undefined {
  const result = db.prepare(`
    SELECT id FROM ${T.workflow_statuses}
    WHERE workflow_id = ? AND name = ?
  `).get(workflowId, statusName) as { id: string } | undefined;

  return result?.id;
}

/**
 * Gets the isolated environment variables for running CLI commands.
 * This ensures that environment variables that could bypass test isolation
 * are explicitly cleared.
 *
 * NOTE: We use 'production' as the default NODE_ENV because when NODE_ENV=test,
 * oclif tries to load TypeScript source files directly from src/commands instead
 * of the compiled dist/commands. Since the spawned child process doesn't have
 * ts-node configured, this causes ERR_UNKNOWN_FILE_EXTENSION errors.
 */
export function getIsolatedEnv(nodeEnv: string = 'production'): NodeJS.ProcessEnv {
  const env = { ...process.env };

  // Clear environment variables that could bypass test isolation
  for (const varName of ISOLATION_ENV_VARS) {
    delete env[varName];
  }

  // Clear DEBUG to prevent oclif debug output that pollutes JSON
  delete env.DEBUG;

  // Suppress oclif warn-if-update-available plugin warnings during tests.
  // Without this, the plugin emits "Updated prlt available!" warnings to stderr
  // that can leak into command output and break JSON parsing.
  env.PRLT_SKIP_NEW_VERSION_CHECK = 'true';

  // Set NODE_ENV
  env.NODE_ENV = nodeEnv;

  return env;
}

/**
 * Filters out Node.js warnings and oclif debug noise from output.
 * This is the comprehensive filter used for most tests.
 */
export function filterOutput(output: string): string {
  return output.split('\n').filter((line: string) =>
    !line.includes('[ERR_UNKNOWN_FILE_EXTENSION]') &&
    !line.includes('Warning:') &&
    !line.includes('module: @oclif') &&
    !line.includes('task: findCommand') &&
    !line.includes('plugin: @') &&  // Filter all plugin: lines (e.g., plugin: @proletariat/cli)
    !line.includes('root: /') &&
    !line.includes('code: ERR_') &&
    !line.includes('message: Unknown file extension') &&
    !line.includes('See more details with DEBUG') &&
    !line.includes('node --trace-warnings') &&
    !line.includes('node --trace-deprecation') &&
    !line.includes('ExperimentalWarning') &&
    !line.includes('DeprecationWarning') &&
    !line.includes('(Use `node') &&
    !line.includes('Updated prlt available') &&
    !line.includes('npm install -g @proletariat/cli') &&
    line.trim() !== ''
  ).join('\n');
}

/**
 * Filters out Node.js warnings using debug prefix matching.
 * Used by docker-commands tests.
 */
export function filterNodeWarnings(output: string): string {
  // Known oclif debug prefixes to filter
  const debugPrefixes = [
    'plugin:',
    'root:',
    'module:',
    'task:',
    'version:',
    'channel:',
    'cacheDir:',
    'configDir:',
    'dataDir:',
    'dirname:',
    'errlog:',
    'home:',
    'shell:',
    'pjson:',
  ];

  return output
    .split('\n')
    .filter((line) => {
      // Filter out node warnings
      if (line.includes('ExperimentalWarning')) return false;
      if (line.includes('ERR_UNKNOWN')) return false;
      if (line.startsWith('(node:')) return false;

      // Filter oclif debug lines
      for (const prefix of debugPrefixes) {
        if (line.startsWith(prefix)) return false;
      }

      return true;
    })
    .join('\n');
}

/**
 * Gets the path to the CLI bin/run.js file.
 */
export function getBinPath(): string {
  return path.join(__dirname, '../../bin/run.js');
}

/**
 * Executes a CLI command in the isolated test environment.
 *
 * This function:
 * 1. Clears environment variables that could bypass isolation
 * 2. Runs the command from the test's current working directory
 * 3. Captures and returns stdout/stderr appropriately
 *
 * @param cmd - The CLI command to run (without 'prlt' prefix)
 * @returns The command output (stdout or filtered stderr)
 */
export function exec(cmd: string): string {
  try {
    const binPath = getBinPath();
    const result = execSync(`node ${binPath} ${cmd}`, {
      encoding: 'utf-8',
      cwd: process.cwd(),
      env: getIsolatedEnv(),
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large JSON output
    });
    return filterOutput(result);
  } catch (error: unknown) {
    const execError = error as ExecError;
    // Command failed - capture both stdout and stderr
    const stdout = execError.stdout || '';
    const stderr = execError.stderr || '';

    // Return filtered stdout if available (for expected error messages)
    if (stdout.trim()) {
      return filterOutput(stdout);
    }

    // Filter out Node.js warnings from stderr
    const filteredStderr = filterOutput(stderr);
    return filteredStderr || filterOutput(execError.message || 'Unknown error');
  }
}

/**
 * Executes a CLI command with output filtering applied.
 * Used by commit-commands tests that merge stdout/stderr.
 */
export function execWithFilter(cmd: string): string {
  try {
    const binPath = getBinPath();
    // Capture both stdout and stderr, then filter stderr noise
    const result = execSync(`node ${binPath} ${cmd} 2>&1`, {
      encoding: 'utf-8',
      cwd: process.cwd(),
      env: getIsolatedEnv(),
    });
    return filterOutput(result);
  } catch (error: unknown) {
    const execError = error as ExecError;
    const stdout = execError.stdout || '';
    const stderr = execError.stderr || '';
    // Return filtered output from either stream
    const combined = stdout + stderr;
    const filtered = filterOutput(combined);
    return filtered || execError.message || 'Unknown error';
  }
}

/**
 * Executes a CLI command in production mode from CLI directory.
 * Used by docker-commands tests and agent flow tests that need compiled JS.
 *
 * Sets PRLT_HQ_PATH to the current working directory (which should be the test
 * directory) so commands use the test database, not a real one.
 */
export function execProduction(cmd: string): string {
  try {
    const cliDir = path.join(__dirname, '../..');
    const binPath = path.join(cliDir, 'bin/run.js');

    // Get isolated env and set HQ path to current test directory
    const env = getIsolatedEnv('production');
    env.PRLT_HQ_PATH = process.cwd();
    env.PRLT_TEST_ENV = 'true'; // Required for PRLT_HQ_PATH to be respected

    const result = execSync(`node ${binPath} ${cmd}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
      cwd: cliDir, // Run from CLI directory for proper module resolution
    });
    return filterNodeWarnings(result);
  } catch (error: unknown) {
    const execError = error as ExecError;
    // Return output even if command exits with non-zero
    const output = execError.stdout || execError.stderr || execError.message || 'Unknown error';
    return filterNodeWarnings(output);
  }
}

/**
 * Executes a CLI command with minimal processing.
 * Returns raw output or error output without filtering.
 */
export function execRaw(cmd: string): string {
  try {
    const binPath = getBinPath();
    return execSync(`node ${binPath} ${cmd}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: getIsolatedEnv(),
    });
  } catch (error: unknown) {
    const execError = error as ExecError;
    // Return output even if command exits with non-zero
    return execError.stdout || execError.stderr || execError.message || 'Unknown error';
  }
}

/**
 * Executes a CLI command and expects it to succeed.
 * Throws an error if the command fails.
 */
export function execOrFail(cmd: string): string {
  const binPath = getBinPath();
  return execSync(`${binPath} ${cmd}`, {
    encoding: 'utf-8',
    cwd: process.cwd(),
    env: getIsolatedEnv(),
  });
}

// =============================================================================
// Agent Flow Test Helpers
// =============================================================================
// These helpers support E2E tests that simulate an AI agent navigating through
// CLI commands using the --machine/--json flags for JSON machine-readable output.
//
// Usage pattern:
//   1. agentExec('command --machine') - execute and get JSON response
//   2. findChoice(response.prompt.choices, 'pattern') - find a menu choice
//   3. execChoice(choice) - get the command string from the choice
//   4. Repeat until final step
//   5. execFinal(cmd) - execute without --json to perform the action
//   6. Verify the result
// =============================================================================

/**
 * Response type for agent prompt JSON output.
 * This is the structure returned by commands when --machine/--json is used.
 */
export interface AgentPromptResponse {
  prompt: {
    type: string;
    name: string;
    message: string;
    choices: Array<AgentPromptChoice>;
  };
  metadata: {
    command: string;
    flags: Record<string, unknown>;
  };
}

/**
 * Choice type for agent prompt responses.
 */
export interface AgentPromptChoice {
  name: string;
  value: string;
  command?: string;
  disabled?: boolean;
}

/**
 * Extract JSON from CLI output that may contain warnings or other noise.
 * Looks for the first line starting with { or [ and parses from there.
 *
 * @param output - Raw CLI output
 * @returns Parsed JSON object or null if no valid JSON found
 */
export function extractJson<T>(output: string): T | null {
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
    return null;
  }

  const jsonLines = lines.slice(jsonStart).join('\n');
  try {
    return JSON.parse(jsonLines) as T;
  } catch {
    return null;
  }
}

/**
 * Check if output indicates workspace/context errors that prevent JSON output.
 * Use this to skip tests gracefully when the environment isn't set up.
 *
 * @param output - CLI output to check
 * @returns true if output contains context error messages
 */
export function hasContextError(output: string): boolean {
  return (
    output.includes('Not in a workspace') ||
    output.includes('No workspace') ||
    output.includes('Not in an HQ') ||
    output.includes('No projects found') ||
    output.includes('No tickets') ||
    output.includes('No agents found') ||
    output.includes('Docker is not running') ||
    output.includes('ENOENT') ||
    output.includes('not found') ||
    output.includes('Error:')
  );
}

/**
 * Execute a CLI command with --machine flag and parse the JSON response.
 * This simulates an AI agent calling the CLI and receiving structured output.
 *
 * @param cmd - CLI command to execute (should include --machine or --json flag)
 * @returns Parsed AgentPromptResponse or null if context error or no JSON
 *
 * @example
 * const result = agentExec('ticket move -P test-project --machine');
 * if (result) {
 *   const ticketChoice = findChoice(result.prompt.choices, 'TKT-001');
 * }
 */
export function agentExec(cmd: string): AgentPromptResponse | null {
  const output = execProduction(cmd);
  if (hasContextError(output)) {
    return null;
  }
  return extractJson<AgentPromptResponse>(output);
}

/**
 * Find a choice in a prompt response by partial name match.
 * Case-insensitive matching.
 *
 * @param choices - Array of choices from prompt response
 * @param pattern - String pattern to match against choice names
 * @returns Matching choice or undefined if not found
 *
 * @example
 * const columnChoice = findChoice(response.prompt.choices, 'In Progress');
 */
export function findChoice(
  choices: AgentPromptChoice[],
  pattern: string
): AgentPromptChoice | undefined {
  return choices.find(c =>
    c.name.toLowerCase().includes(pattern.toLowerCase())
  );
}

/**
 * Find a choice by exact value match.
 *
 * @param choices - Array of choices from prompt response
 * @param value - Exact value to match
 * @returns Matching choice or undefined if not found
 */
export function findChoiceByValue(
  choices: AgentPromptChoice[],
  value: string
): AgentPromptChoice | undefined {
  return choices.find(c => c.value === value);
}

/**
 * Extract the command string from a choice.
 * Strips the 'prlt ' prefix so it can be passed to exec functions.
 *
 * @param choice - Choice object with command field
 * @returns Command string without 'prlt ' prefix
 * @throws Error if choice has no command field
 *
 * @example
 * const nextCmd = execChoice(ticketChoice);
 * const step2 = agentExec(nextCmd);
 */
export function execChoice(choice: AgentPromptChoice): string {
  if (!choice.command) {
    throw new Error(`Choice "${choice.name}" has no command field`);
  }
  return choice.command.replace('prlt ', '');
}

/**
 * Execute the final command in an agent flow (without --json/--machine).
 * This actually performs the action instead of returning another prompt.
 *
 * @param cmd - Command string (with or without --json/--machine flags)
 * @returns Command output after execution
 *
 * @example
 * const result = execFinal(execChoice(columnChoice));
 * expect(result).to.include('Moved');
 */
export function execFinal(cmd: string): string {
  const cleanCmd = cmd
    .replace(' --json', '')
    .replace(' --machine', '')
    .replace(' -m', '');
  return execProduction(cleanCmd);
}

/**
 * Execute a command with --force flag to skip confirmation prompts.
 * Useful for testing delete/destructive operations.
 *
 * @param cmd - Command string
 * @returns Command output after execution
 */
export function execWithForce(cmd: string): string {
  const cleanCmd = cmd
    .replace(' --json', '')
    .replace(' --machine', '')
    .replace(' -m', '');
  return execProduction(`${cleanCmd} --force`);
}

// =============================================================================
// Output Mode Helpers
// =============================================================================
// These helpers explicitly control the output mode for E2E tests, preventing
// accidental coupling to non-TTY auto-detection behavior.
//
// - execAsHuman(): Forces human-readable text output via PRLT_FORCE_TEXT=1.
//   Use for tests that assert on styled text (e.g., "Registered workspace").
//
// - execAsAgent(): Appends --json flag for explicit JSON/machine-readable output.
//   Use for tests that parse JSON responses or test agent workflows.
//
// Tests should NOT rely on the implicit non-TTY → JSON auto-detection, except
// for tests that specifically verify that behavior (e.g., prune dry-run safety).
// =============================================================================

/**
 * Execute a CLI command forcing human-readable text output.
 *
 * Sets PRLT_FORCE_TEXT=1 to override non-TTY auto-detection in execSync,
 * ensuring the CLI outputs styled text instead of JSON envelopes.
 *
 * Use this for tests that assert on human-readable output strings like
 * "Registered workspace", "Active workspace set to", etc.
 *
 * @param cmd - CLI command to run (without 'prlt' prefix)
 * @param env - Additional environment variables to merge
 * @returns Filtered command output (human-readable text)
 */
export function execAsHuman(cmd: string, env: NodeJS.ProcessEnv = {}): string {
  try {
    const binPath = getBinPath();
    const baseEnv: NodeJS.ProcessEnv = {
      ...getIsolatedEnv(),
      PRLT_FORCE_TEXT: '1',
      ...env,
    };

    const result = execSync(`node ${binPath} ${cmd}`, {
      encoding: 'utf-8',
      cwd: process.cwd(),
      env: baseEnv,
      maxBuffer: 10 * 1024 * 1024,
    });
    return filterOutput(result);
  } catch (error: unknown) {
    const execError = error as ExecError;
    const stdout = execError.stdout || '';
    const stderr = execError.stderr || '';
    if (stdout.trim()) {
      return filterOutput(stdout);
    }
    return filterOutput(stderr) || filterOutput(execError.message || 'Unknown error');
  }
}

/**
 * Execute a CLI command in agent/JSON mode with explicit --json flag.
 *
 * Appends --json to the command to explicitly request JSON output,
 * rather than relying on non-TTY auto-detection.
 *
 * Use this for tests that parse JSON responses or simulate agent workflows.
 *
 * @param cmd - CLI command to run (without 'prlt' prefix). --json is appended automatically.
 * @param env - Additional environment variables to merge
 * @returns Filtered command output (JSON string)
 */
export function execAsAgent(cmd: string, env: NodeJS.ProcessEnv = {}): string {
  const jsonCmd = cmd.includes('--json') ? cmd : `${cmd} --json`;
  try {
    const binPath = getBinPath();
    const baseEnv: NodeJS.ProcessEnv = {
      ...getIsolatedEnv(),
      ...env,
    };

    const result = execSync(`node ${binPath} ${jsonCmd}`, {
      encoding: 'utf-8',
      cwd: process.cwd(),
      env: baseEnv,
      maxBuffer: 10 * 1024 * 1024,
    });
    return filterOutput(result);
  } catch (error: unknown) {
    const execError = error as ExecError;
    const stdout = execError.stdout || '';
    const stderr = execError.stderr || '';
    if (stdout.trim()) {
      return filterOutput(stdout);
    }
    return filterOutput(stderr) || filterOutput(execError.message || 'Unknown error');
  }
}
