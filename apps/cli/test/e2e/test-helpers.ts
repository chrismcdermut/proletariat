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

/**
 * Gets the isolated environment variables for running CLI commands.
 * This ensures that environment variables that could bypass test isolation
 * are explicitly cleared.
 */
export function getIsolatedEnv(nodeEnv: string = 'test'): NodeJS.ProcessEnv {
  const env = { ...process.env };

  // Clear environment variables that could bypass test isolation
  for (const varName of ISOLATION_ENV_VARS) {
    delete env[varName];
  }

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
    !line.includes('plugin: @chrismcdermut') &&
    !line.includes('plugin: @proletariat') &&
    !line.includes('root: /') &&
    !line.includes('code: ERR_') &&
    !line.includes('message: Unknown file extension') &&
    !line.includes('See more details with DEBUG') &&
    !line.includes('node --trace-warnings') &&
    !line.includes('node --trace-deprecation') &&
    !line.includes('ExperimentalWarning') &&
    !line.includes('DeprecationWarning') &&
    !line.includes('(Use `node') &&
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
    const cliDir = path.join(__dirname, '../..');
    const binPath = path.join(cliDir, 'bin/run.js');

    // Get isolated env (production mode for oclif) and set HQ path to current test directory
    const env = getIsolatedEnv('production');
    env.PRLT_HQ_PATH = process.cwd();
    env.PRLT_TEST_ENV = 'true'; // Required for PRLT_HQ_PATH to be respected in tests

    const result = execSync(`node ${binPath} ${cmd}`, {
      encoding: 'utf-8',
      cwd: cliDir, // Run from CLI dir so oclif finds commands
      env,
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large JSON output
    });
    return result;
  } catch (error: unknown) {
    const execError = error as ExecError;
    // Command failed - capture both stdout and stderr
    const stdout = execError.stdout || '';
    const stderr = execError.stderr || '';

    // Return stdout if available (for expected error messages)
    if (stdout.trim()) {
      return stdout;
    }

    // Filter out Node.js warnings from stderr
    const filteredStderr = filterOutput(stderr);
    return filteredStderr || execError.message || 'Unknown error';
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
 * Used by docker-commands tests that need compiled JS.
 */
export function execProduction(cmd: string): string {
  try {
    const cliDir = path.join(__dirname, '../..');
    const binPath = path.join(cliDir, 'bin/run.js');

    const result = execSync(`node ${binPath} ${cmd}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: getIsolatedEnv('production'),
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
 * Looks for the first line starting with { and parses from there.
 *
 * @param output - Raw CLI output
 * @returns Parsed JSON object or null if no valid JSON found
 */
export function extractJson<T>(output: string): T | null {
  const lines = output.split('\n');
  let jsonStart = -1;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('{')) {
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
