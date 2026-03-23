import { expect } from 'chai';
import Database from 'better-sqlite3';
import {
  execInProcess,
  extractJson,
  agentExec,
  findChoiceByValue,
  createTestEnvironment,
  cleanupTestEnvironment,
  createHQConfig,
  createPMODirectories,
  setupProductionSchema,
  addWorkspaceTables,
  TestEnvironment,
} from './test-helpers.js';

/**
 * End-to-end tests for `prlt session peek` command (TKT-989)
 *
 * Tests: prlt session peek <target> with various flags
 *
 * Note: Since tmux sessions may or may not exist in the test environment,
 * these tests focus on:
 * - Command registration (peek appears in session menu)
 * - Flag parsing (--lines, --json work without errors)
 * - JSON output structure (correct fields in output)
 * - Error paths for non-existent targets
 */
describe('Session Peek Commands E2E Tests', () => {
  let env: TestEnvironment;
  let db: Database.Database;

  beforeEach(() => {
    env = createTestEnvironment('session-peek-e2e-');

    // Create HQ config and PMO directories
    createHQConfig(env.proletariatDir, { hasPmo: true });
    createPMODirectories(env.pmoPath, 'default');

    // Initialize PMO tables using production schema
    db = setupProductionSchema(env.dbPath, env.pmoPath);

    // Add workspace tables (for agent/session discovery)
    addWorkspaceTables(db, { type: 'hq', workspaceName: 'test-hq', hasPmo: true });
  });

  afterEach(() => {
    if (db) db.close();
    cleanupTestEnvironment(env);
  });

  // =========================================================================
  // Session menu includes peek
  // =========================================================================
  describe('session menu includes peek', () => {
    it('should have peek choice in session menu', () => {
      const result = agentExec('session --machine');

      expect(result).to.not.be.null;
      expect(result!.prompt.choices).to.be.an('array');

      const peekChoice = findChoiceByValue(result!.prompt.choices, 'peek');
      expect(peekChoice).to.not.be.undefined;
      expect(peekChoice!.name).to.include('Peek');
      expect(peekChoice!.command).to.equal('prlt session peek --json');
    });

    it('should have peek choice between attach and health', () => {
      const result = agentExec('session --machine');
      expect(result).to.not.be.null;

      const values = result!.prompt.choices.map(c => c.value);
      const attachIdx = values.indexOf('attach');
      const peekIdx = values.indexOf('peek');
      const healthIdx = values.indexOf('health');

      expect(peekIdx).to.be.greaterThan(attachIdx);
      expect(peekIdx).to.be.lessThan(healthIdx);
    });
  });

  // =========================================================================
  // prlt session peek --json output structure
  // When tmux sessions exist, peek returns either a prompt (no target) or
  // success data (with target). When no tmux, it returns NO_SESSIONS error.
  // =========================================================================
  describe('prlt session peek --json (output structure)', () => {
    it('should return valid JSON with known type field', async () => {
      const output = await execInProcess('session peek --json');
      const json = extractJson<{ type: string }>(output);

      expect(json).to.not.be.null;
      // Output should be either 'error' (no sessions) or 'prompt' (has sessions, no target)
      expect(json!.type).to.be.oneOf(['error', 'prompt']);
    });

    it('should return NO_SESSIONS error or prompt depending on environment', async () => {
      const output = await execInProcess('session peek --json');
      const json = extractJson<{ type: string; error?: { code: string }; prompt?: { type: string } }>(output);

      expect(json).to.not.be.null;
      if (json!.type === 'error') {
        expect(json!.error!.code).to.equal('NO_SESSIONS');
      } else if (json!.type === 'prompt') {
        // Interactive selection prompt (tmux sessions exist)
        expect(json!.prompt!.type).to.equal('list');
      }
    });
  });

  // =========================================================================
  // prlt session peek <target> --json (non-existent target)
  // =========================================================================
  describe('prlt session peek <nonexistent-target> --json', () => {
    it('should return SESSION_NOT_FOUND or NO_SESSIONS for non-existent target', async () => {
      const output = await execInProcess('session peek NONEXISTENT-TARGET-12345 --json');
      const json = extractJson<{ type: string; error?: { code: string; message: string } }>(output);

      expect(json).to.not.be.null;
      expect(json!.type).to.equal('error');
      expect(json!.error).to.exist;
      // Either NO_SESSIONS (no tmux at all) or SESSION_NOT_FOUND (tmux exists but target doesn't match)
      expect(json!.error!.code).to.be.oneOf(['NO_SESSIONS', 'SESSION_NOT_FOUND']);
    });

    it('should return error for non-existent ticket ID', async () => {
      const output = await execInProcess('session peek TKT-99999 --json');
      const json = extractJson<{ type: string; error?: { code: string } }>(output);

      expect(json).to.not.be.null;
      expect(json!.type).to.equal('error');
      expect(json!.error!.code).to.be.oneOf(['NO_SESSIONS', 'SESSION_NOT_FOUND']);
    });

    it('should return error for non-existent execution ID', async () => {
      const output = await execInProcess('session peek WORK-ZZZZZZZZ --json');
      const json = extractJson<{ type: string; error?: { code: string } }>(output);

      expect(json).to.not.be.null;
      expect(json!.type).to.equal('error');
      expect(json!.error!.code).to.be.oneOf(['NO_SESSIONS', 'SESSION_NOT_FOUND']);
    });
  });

  // =========================================================================
  // prlt session peek --lines flag parsing
  // =========================================================================
  describe('prlt session peek --lines flag', () => {
    it('should accept --lines flag without error', async () => {
      const output = await execInProcess('session peek --lines 100 --json');
      const json = extractJson<{ type: string; metadata?: { flags?: { lines?: number } } }>(output);

      expect(json).to.not.be.null;
      // Regardless of whether sessions exist, the command should parse flags correctly
      expect(json!.type).to.be.oneOf(['error', 'prompt']);
    });

    it('should accept -l shorthand flag', async () => {
      const output = await execInProcess('session peek -l 25 --json');
      const json = extractJson<{ type: string }>(output);

      expect(json).to.not.be.null;
      expect(json!.type).to.be.oneOf(['error', 'prompt']);
    });
  });

  // =========================================================================
  // Agent flow: session menu → peek
  // =========================================================================
  describe('Agent flow: session menu → peek choice', () => {
    it('should navigate menu → peek choice → execute → verify valid JSON output', async () => {
      // Step 1: Get session menu
      const menuResult = agentExec('session --machine');
      expect(menuResult).to.not.be.null;

      // Step 2: Find peek choice and extract command
      const peekChoice = findChoiceByValue(menuResult!.prompt.choices, 'peek');
      expect(peekChoice).to.not.be.undefined;
      expect(peekChoice!.command).to.equal('prlt session peek --json');

      // Step 3: Execute the peek command
      const peekCmd = peekChoice!.command!.replace('prlt ', '');
      const peekOutput = await execInProcess(peekCmd);

      // Step 4: Verify structured JSON output (either error or prompt)
      const json = extractJson<{ type: string }>(peekOutput);
      expect(json).to.not.be.null;
      expect(json!.type).to.be.oneOf(['error', 'prompt', 'success']);
    });
  });

  // =========================================================================
  // JSON output structure for success case
  // =========================================================================
  describe('prlt session peek --json (success structure)', () => {
    it('should include expected fields when session is found and captured', async () => {
      // This test may not always produce a success result (depends on tmux).
      // But when it does, verify the structure.
      const output = await execInProcess('session peek --json');
      const json = extractJson<{
        type: string;
        result?: {
          sessionId: string;
          ticketId: string;
          agentName: string;
          environment: string;
          lines: number;
          content: string;
        };
      }>(output);

      expect(json).to.not.be.null;

      if (json!.type === 'success') {
        expect(json!.result).to.exist;
        expect(json!.result!.sessionId).to.be.a('string');
        expect(json!.result!.ticketId).to.be.a('string');
        expect(json!.result!.agentName).to.be.a('string');
        expect(json!.result!.environment).to.be.oneOf(['host', 'container']);
        expect(json!.result!.lines).to.be.a('number');
        expect(json!.result!.content).to.be.a('string');
      }
    });
  });
});
