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
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
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
export function getIsolatedEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };

  // Clear environment variables that could bypass test isolation
  for (const varName of ISOLATION_ENV_VARS) {
    delete env[varName];
  }

  // Set NODE_ENV to test
  env.NODE_ENV = 'test';

  return env;
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
    const binPath = path.join(__dirname, '../../bin/run.js');
    const result = execSync(`${binPath} ${cmd}`, {
      encoding: 'utf-8',
      cwd: process.cwd(),
      env: getIsolatedEnv(),
    });
    return result;
  } catch (error: any) {
    // Command failed - capture both stdout and stderr
    const stdout = error.stdout || '';
    const stderr = error.stderr || '';

    // Return stdout if available (for expected error messages)
    if (stdout.trim()) {
      return stdout;
    }

    // Filter out Node.js warnings from stderr
    const filteredStderr = stderr.split('\n').filter((line: string) =>
      !line.includes('[ERR_UNKNOWN_FILE_EXTENSION]') &&
      !line.includes('Warning:') &&
      !line.includes('module: @oclif')
    ).join('\n');

    return filteredStderr || error.message;
  }
}

/**
 * Executes a CLI command and expects it to succeed.
 * Throws an error if the command fails.
 */
export function execOrFail(cmd: string): string {
  const binPath = path.join(__dirname, '../../bin/run.js');
  return execSync(`${binPath} ${cmd}`, {
    encoding: 'utf-8',
    cwd: process.cwd(),
    env: getIsolatedEnv(),
  });
}
