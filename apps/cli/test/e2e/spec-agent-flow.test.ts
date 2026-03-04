/**
 * E2E tests for spec commands agent flow using --machine flag.
 *
 * These tests simulate an AI agent navigating through the spec commands
 * using JSON machine-readable output.
 */

import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import {
  createTestEnvironment,
  cleanupTestEnvironment,
  createHQConfig,
  createPMODirectories,
  filterOutput,
  type TestEnvironment,
} from './test-helpers.js';
import { SQLiteStorage } from '../../src/lib/pmo/storage-sqlite.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ExecError extends Error {
  stdout?: string;
  stderr?: string;
}

interface AgentPromptChoice {
  name: string;
  value: string;
  command?: string;
}

interface AgentPromptResponse {
  prompt: {
    type: string;
    name: string;
    message: string;
    choices?: AgentPromptChoice[];
    context?: { hint: string };
  };
  metadata: {
    command: string;
    flags: Record<string, unknown>;
  };
}

/**
 * Execute CLI command in the test environment and parse JSON response.
 * This runs from the test directory, not the CLI directory.
 */
function getCleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  // Clear isolation variables to prevent polluting production database
  delete env.PRLT_HQ_PATH;
  delete env.PRLT_PMO_PATH;
  delete env.PRLT_DATABASE_PATH;
  delete env.PRLT_CONFIG_PATH;
  delete env.DEVCONTAINER;
  delete env.PRLT_TEST_ENV;
  // Clear debug variables that cause oclif noise
  delete env.DEBUG;
  delete env.OCLIF_DEBUG;
  // Use production mode to run compiled JavaScript (test mode tries to load .ts files)
  env.NODE_ENV = 'production';
  return env;
}

function execMachine(cmd: string, testDir: string): AgentPromptResponse | null {
  try {
    const binPath = path.join(__dirname, '../../bin/run.js');

    const result = execSync(`node ${binPath} ${cmd}`, {
      encoding: 'utf-8',
      cwd: testDir,
      env: getCleanEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    return extractJson(result);
  } catch (error) {
    const execError = error as ExecError;
    const output = execError.stdout || execError.stderr || '';
    return extractJson(output);
  }
}

/**
 * Execute CLI command in test environment without JSON parsing.
 */
function execCmd(cmd: string, testDir: string): string {
  try {
    const binPath = path.join(__dirname, '../../bin/run.js');

    const result = execSync(`node ${binPath} ${cmd}`, {
      encoding: 'utf-8',
      cwd: testDir,
      env: getCleanEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    return filterOutput(result);
  } catch (error) {
    const execError = error as ExecError;
    const output = execError.stdout || execError.stderr || '';
    return filterOutput(output);
  }
}

function extractJson(output: string): AgentPromptResponse | null {
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
    return JSON.parse(jsonLines) as AgentPromptResponse;
  } catch {
    return null;
  }
}

function findChoice(choices: AgentPromptChoice[], pattern: string): AgentPromptChoice | undefined {
  return choices.find(c => c.name.toLowerCase().includes(pattern.toLowerCase()));
}

function findChoiceByValue(choices: AgentPromptChoice[], value: string): AgentPromptChoice | undefined {
  return choices.find(c => c.value === value);
}

function execChoice(choice: AgentPromptChoice): string {
  if (!choice.command) {
    throw new Error(`Choice "${choice.name}" has no command field`);
  }
  return choice.command.replace('prlt ', '');
}

function execFinal(cmd: string, testDir: string): string {
  const cleanCmd = cmd
    .replace(' --json', '')
    .replace(' --machine', '')
    .replace(' -m', '');
  return execCmd(cleanCmd, testDir);
}

describe('Spec Commands Agent Flow', () => {
  let env: TestEnvironment;
  let storage: SQLiteStorage;

  async function setupTestDatabase() {
    // Create empty database file first (SQLiteStorage requires it to exist)
    const db = new Database(env.dbPath);
    db.close();

    // Use SQLiteStorage for proper schema initialization
    storage = new SQLiteStorage(env.dbPath);

    // Create a project with default workflow
    await storage.createProject({
      id: 'test-project',
      name: 'Test Project',
      template: 'kanban',
    });
  }

  async function createTestSpec(id: string, title: string, status: 'draft' | 'active' | 'implemented' = 'active') {
    await storage.createSpec({
      id,
      title,
      status,
      type: 'product',
    });
  }

  async function createTestTicket(id: string, title: string) {
    // Get the backlog status for the project
    const board = await storage.getBoard('test-project');
    const backlogStatus = board.columns.find(c => c.name === 'Backlog');

    await storage.createTicket('test-project', {
      id,
      title,
      statusId: backlogStatus?.id,
    });
  }

  beforeEach(async () => {
    env = createTestEnvironment('spec-agent-flow-');
    createHQConfig(env.proletariatDir);
    createPMODirectories(env.pmoPath, 'test-project');
    await setupTestDatabase();
  });

  afterEach(async () => {
    if (storage) await storage.close();
    cleanupTestEnvironment(env);
  });

  describe('spec --machine (menu)', () => {
    it('should output menu choices with command field', () => {
      const result = execMachine('spec --machine', env.testDir);

      expect(result).to.not.be.null;
      expect(result!.prompt.type).to.equal('list');
      expect(result!.prompt.name).to.equal('action');
      expect(result!.prompt.choices).to.be.an('array');

      // Verify key choices have command field
      const createChoice = findChoiceByValue(result!.prompt.choices!, 'create');
      expect(createChoice).to.exist;
      expect(createChoice!.command).to.include('spec create');

      const viewChoice = findChoiceByValue(result!.prompt.choices!, 'view');
      expect(viewChoice).to.exist;
      expect(viewChoice!.command).to.include('spec view');
    });
  });

  describe('spec list --machine', () => {
    beforeEach(async () => {
      await createTestSpec('test-spec-1', 'Test Spec One', 'active');
      await createTestSpec('test-spec-2', 'Test Spec Two', 'draft');
    });

    it('should output specs as structured data', () => {
      const output = execCmd('spec list --machine', env.testDir);

      // spec list outputs success data, not a prompt (JSON is pretty-printed)
      expect(output).to.include('"success": true');
      expect(output).to.include('"specs"');
      expect(output).to.include('test-spec-1');
    });
  });

  describe('spec view - full agent flow', () => {
    beforeEach(async () => {
      await createTestSpec('view-spec-1', 'Spec to View', 'active');
    });

    it('should complete flow: select spec → view details', () => {
      // Agent Step 1: Get available specs
      const step1 = execMachine('spec view -P test-project --machine', env.testDir);

      expect(step1).to.not.be.null;
      expect(step1!.prompt.type).to.equal('list');
      expect(step1!.prompt.name).to.equal('spec');

      const specChoice = findChoice(step1!.prompt.choices!, 'Spec to View');
      expect(specChoice).to.exist;
      expect(specChoice!.command).to.include('--spec');

      // Agent Step 2: View the spec
      const result = execFinal(execChoice(specChoice!), env.testDir);

      // Verify spec details are shown
      expect(result).to.include('Spec to View');
    });
  });

  describe('spec plan - full agent flow', () => {
    beforeEach(async () => {
      await createTestSpec('plan-spec-1', 'Spec to Plan', 'active');
    });

    it('should complete flow: select spec → show plan info', () => {
      // Agent Step 1: Get available specs
      const step1 = execMachine('spec plan --machine', env.testDir);

      expect(step1).to.not.be.null;
      expect(step1!.prompt.type).to.equal('list');
      expect(step1!.prompt.name).to.equal('spec');

      const specChoice = findChoice(step1!.prompt.choices!, 'Spec to Plan');
      expect(specChoice).to.exist;
      expect(specChoice!.command).to.include('--spec');

      // Agent Step 2: Execute plan
      const result = execFinal(execChoice(specChoice!), env.testDir);

      // Verify plan output
      expect(result).to.include('Spec to Plan');
    });
  });

  describe('spec ticket - full agent flow', () => {
    beforeEach(async () => {
      await createTestTicket('TKT-SPEC-1', 'Ticket for spec');
      await createTestSpec('spec-for-ticket', 'Spec for Ticket', 'active');

      // Create spec file in PMO directory
      const specDir = path.join(env.pmoPath, 'projects', 'test-project', 'specs', 'active');
      fs.mkdirSync(specDir, { recursive: true });
      fs.writeFileSync(path.join(specDir, 'spec-for-ticket.md'), '# Spec for Ticket\n');
    });

    it('should complete flow: select ticket → select spec → link', async () => {
      // Agent Step 1: Get available tickets
      const step1 = execMachine('spec ticket -P test-project --machine', env.testDir);

      expect(step1).to.not.be.null;
      expect(step1!.prompt.type).to.equal('list');

      const ticketChoice = findChoice(step1!.prompt.choices!, 'TKT-SPEC-1');
      expect(ticketChoice).to.exist;
      expect(ticketChoice!.command).to.include('--ticket');

      // Agent Step 2: Select ticket, get spec choices
      const step2 = execMachine(execChoice(ticketChoice!), env.testDir);

      expect(step2).to.not.be.null;
      expect(step2!.prompt.type).to.equal('list');
      expect(step2!.prompt.name).to.equal('spec');

      const specChoice = findChoice(step2!.prompt.choices!, 'Spec for Ticket');
      expect(specChoice).to.exist;
      expect(specChoice!.command).to.include('--spec');

      // Agent Step 3: Execute the link
      const result = execFinal(execChoice(specChoice!), env.testDir);

      // Verify link
      expect(result.toLowerCase()).to.match(/link|spec|assign/);

      // Verify in database using storage
      const ticket = await storage.getTicket('TKT-SPEC-1');
      expect(ticket?.specId).to.equal('spec-for-ticket');
    });
  });

  describe('spec create - full agent flow', () => {
    it('should output input prompt for title with context hint', () => {
      // Agent Step 1: Start create, get title prompt
      const step1 = execMachine('spec create --machine', env.testDir);

      expect(step1).to.not.be.null;
      expect(step1!.prompt.type).to.equal('input');
      expect(step1!.prompt.name).to.equal('title');
      expect(step1!.prompt.message).to.include('title');

      // Verify context hint for how to provide value
      expect(step1!.prompt.context).to.exist;
      expect(step1!.prompt.context!.hint).to.include('--title');
    });

    it('should output type choices in interactive mode', () => {
      // Agent Step 2: Interactive mode with title, get type choices
      const step2 = execMachine('spec create --title "My New Spec" -i --machine', env.testDir);

      expect(step2).to.not.be.null;
      expect(step2!.prompt.type).to.equal('list');
      expect(step2!.prompt.name).to.equal('type');

      const productChoice = findChoice(step2!.prompt.choices!, 'Product');
      expect(productChoice).to.exist;
    });

    it('should create spec when all flags provided', async () => {
      // Execute create with all flags
      const result = execFinal('spec create --title "Agent Created Spec" --type product --status draft', env.testDir);

      expect(result).to.include('Created spec');
      expect(result).to.include('Agent Created Spec');

      // Verify in database using storage
      const specs = await storage.listSpecs();
      const createdSpec = specs.find(s => s.title === 'Agent Created Spec');
      expect(createdSpec).to.exist;
    });
  });

  describe('spec link depends - full agent flow', () => {
    beforeEach(async () => {
      await createTestSpec('dependent-spec', 'Dependent Spec', 'active');
      await createTestSpec('dependency-spec', 'Dependency Spec', 'active');
    });

    it('should complete flow: select target spec → create dependency', async () => {
      // Agent Step 1: Start with dependent spec, get target choices
      const step1 = execMachine('spec link depends dependent-spec --machine', env.testDir);

      expect(step1).to.not.be.null;
      expect(step1!.prompt.type).to.equal('list');

      const targetChoice = findChoice(step1!.prompt.choices!, 'Dependency Spec');
      expect(targetChoice).to.exist;

      // Agent Step 2: Execute the link
      const result = execFinal(execChoice(targetChoice!), env.testDir);

      // Verify link
      expect(result.toLowerCase()).to.match(/depend|link|added/);

      // Verify in database using storage
      const deps = await storage.listSpecDependencies('dependent-spec');
      const hasDep = deps.some(d => d.dependsOnSpecId === 'dependency-spec');
      expect(hasDep).to.be.true;
    });
  });

  // Note: 'spec link relates' subcommand does not exist (only depends/remove exist)
  describe.skip('spec link relates - full agent flow', () => {
    beforeEach(async () => {
      await createTestSpec('spec-a', 'Spec A', 'active');
      await createTestSpec('spec-b', 'Spec B', 'active');
    });

    it('should complete flow: select related spec → create relation', () => {
      // Agent Step 1: Start with spec-a, get related spec choices
      const step1 = execMachine('spec link relates spec-a --machine', env.testDir);

      expect(step1).to.not.be.null;
      expect(step1!.prompt.type).to.equal('list');

      const relatedChoice = findChoice(step1!.prompt.choices!, 'Spec B');
      expect(relatedChoice).to.exist;

      // Agent Step 2: Execute the link
      const result = execFinal(execChoice(relatedChoice!), env.testDir);

      // Verify link
      expect(result.toLowerCase()).to.match(/relate|link|added/);
    });
  });
});
