import { expect } from 'chai';
import {
  execInProcess,
  findChoice,
  execChoice,
  extractJson,
  hasContextError,
  type AgentPromptResponse,
} from './test-helpers.js';

async function agentExec(cmd: string): Promise<AgentPromptResponse | null> {
  const output = await execInProcess(cmd);
  if (hasContextError(output)) {
    return null;
  }
  const json = extractJson<AgentPromptResponse>(output);
  if (json && (!json.prompt || typeof json.prompt !== 'object')) {
    return null;
  }
  return json;
}

/**
 * E2E Agent Flow Tests for GitHub CLI Commands
 *
 * Tests the full agent navigation flow for the gh namespace:
 * - prlt gh --machine
 * - prlt gh status --machine
 * - prlt gh login --machine
 * - prlt gh token --machine
 *
 * These tests verify that AI agents can:
 * 1. Call commands with --machine flag
 * 2. Receive structured JSON responses
 * 3. Follow command fields to navigate through menus
 * 4. Complete the full workflow
 */
describe('GitHub CLI Commands - Agent Flow E2E Tests', () => {
  /**
   * prlt gh --machine
   * Main menu - should present choices for status/login/token
   */
  describe('prlt gh --machine (main menu)', () => {
    it('should output JSON with action choices', async () => {
      const result = await agentExec('gh --machine');

      expect(result).to.not.be.null;
      expect(result!.prompt).to.exist;
      expect(result!.prompt.type).to.equal('list');
      expect(result!.prompt.name).to.equal('action');
      expect(result!.prompt.message).to.include('GitHub');
      expect(result!.prompt.choices).to.be.an('array');
      expect(result!.prompt.choices.length).to.be.greaterThan(0);
    });

    it('should have choice for Check status with command field', async () => {
      const result = await agentExec('gh --machine');
      expect(result).to.not.be.null;

      const statusChoice = findChoice(result!.prompt.choices, 'status');
      expect(statusChoice).to.exist;
      expect(statusChoice!.command).to.exist;
      expect(statusChoice!.command).to.include('gh status');
      expect(statusChoice!.command).to.include('--json');
    });

    it('should have choice for Login with command field', async () => {
      const result = await agentExec('gh --machine');
      expect(result).to.not.be.null;

      const loginChoice = findChoice(result!.prompt.choices, 'login');
      expect(loginChoice).to.exist;
      expect(loginChoice!.command).to.exist;
      expect(loginChoice!.command).to.include('gh login');
      expect(loginChoice!.command).to.include('--json');
    });

    it('should have choice for GH_TOKEN setup with command field', async () => {
      const result = await agentExec('gh --machine');
      expect(result).to.not.be.null;

      const tokenChoice = findChoice(result!.prompt.choices, 'token');
      expect(tokenChoice).to.exist;
      expect(tokenChoice!.command).to.exist;
      expect(tokenChoice!.command).to.include('gh token');
      expect(tokenChoice!.command).to.include('--json');
    });

    it('should complete flow: select status → get status info', async () => {
      // Step 1: Get menu choices
      const step1 = await agentExec('gh --machine');
      expect(step1).to.not.be.null;

      const statusChoice = findChoice(step1!.prompt.choices, 'status');
      expect(statusChoice).to.exist;

      // Step 2: Execute status command (from choice.command)
      const statusOutput = await execInProcess(execChoice(statusChoice!));

      // Should get JSON response with status info
      const statusJson = extractJson<{ success: boolean; result: Record<string, unknown> }>(statusOutput);
      expect(statusJson).to.not.be.null;
      expect(statusJson!.success).to.equal(true);
      expect(statusJson!.result).to.have.property('ghInstalled');
    });
  });

  /**
   * prlt gh status --machine
   * Returns JSON with GitHub CLI status information
   */
  describe('prlt gh status --machine', () => {
    it('should output JSON with status fields', async () => {
      const output = await execInProcess('gh status --machine');
      const json = extractJson<{ success: boolean; result: Record<string, unknown> }>(output);

      expect(json).to.not.be.null;
      expect(json!.success).to.equal(true);
      expect(json!.result).to.have.property('ghInstalled');
      expect(json!.result).to.have.property('ghAuthenticated');
      expect(json!.result).to.have.property('ghTokenSet');
      expect(json!.result).to.have.property('ready');
    });

    it('should have ghInstalled as boolean', async () => {
      const output = await execInProcess('gh status --machine');
      const json = extractJson<{ success: boolean; result: { ghInstalled: boolean } }>(output);

      expect(json).to.not.be.null;
      expect(typeof json!.result.ghInstalled).to.equal('boolean');
    });

    it('should include metadata with command info', async () => {
      const output = await execInProcess('gh status --machine');
      const json = extractJson<{ metadata: { command: string } }>(output);

      expect(json).to.not.be.null;
      expect(json!.metadata).to.exist;
      expect(json!.metadata.command).to.equal('gh status');
    });
  });

  /**
   * prlt gh login --machine
   * Returns JSON with authentication status or error
   */
  describe('prlt gh login --machine', () => {
    it('should output JSON response', async () => {
      const output = await execInProcess('gh login --machine');
      const json = extractJson<Record<string, unknown>>(output);

      expect(json).to.not.be.null;
      // Will have either success (if authenticated) or error (if gh not installed or needs interactive)
      const hasExpectedField = 'success' in json! || 'error' in json!;
      expect(hasExpectedField).to.be.true;
    });

    it('should include metadata', async () => {
      const output = await execInProcess('gh login --machine');
      const json = extractJson<{ metadata: { command: string } }>(output);

      expect(json).to.not.be.null;
      expect(json!.metadata).to.exist;
      expect(json!.metadata.command).to.equal('gh login');
    });

    it('should return error if gh CLI not installed', async () => {
      const output = await execInProcess('gh login --machine');
      const json = extractJson<{ error?: { code: string }; success?: boolean; result?: { authenticated: boolean } }>(output);

      expect(json).to.not.be.null;
      // If gh is not installed, should have error with GH_NOT_INSTALLED code
      // If gh is installed and authenticated, should have success with authenticated: true
      // If gh is installed but not authenticated, should have error with REQUIRES_INTERACTIVE code
      if (json!.error) {
        expect(['GH_NOT_INSTALLED', 'REQUIRES_INTERACTIVE']).to.include(json!.error.code);
      } else {
        expect(json!.success).to.equal(true);
        expect(json!.result).to.have.property('authenticated');
      }
    });
  });

  /**
   * prlt gh token --machine
   * Returns JSON with GH_TOKEN setup information
   */
  describe('prlt gh token --machine', () => {
    it('should output JSON response', async () => {
      const output = await execInProcess('gh token --machine');
      const json = extractJson<Record<string, unknown>>(output);

      expect(json).to.not.be.null;
      // Will have either success or error
      const hasExpectedField = 'success' in json! || 'error' in json!;
      expect(hasExpectedField).to.be.true;
    });

    it('should include metadata', async () => {
      const output = await execInProcess('gh token --machine');
      const json = extractJson<{ metadata: { command: string } }>(output);

      expect(json).to.not.be.null;
      expect(json!.metadata).to.exist;
      expect(json!.metadata.command).to.equal('gh token');
    });

    it('should return appropriate response based on gh CLI state', async () => {
      const output = await execInProcess('gh token --machine');
      const json = extractJson<{
        error?: { code: string; message: string };
        success?: boolean;
        result?: { ghTokenSet: boolean; setupCommand?: string };
      }>(output);

      expect(json).to.not.be.null;

      if (json!.error) {
        // gh CLI not installed or not authenticated
        expect(['GH_NOT_INSTALLED', 'GH_NOT_AUTHENTICATED']).to.include(json!.error.code);
        expect(json!.error.message).to.be.a('string');
      } else {
        // gh CLI is installed and authenticated
        expect(json!.success).to.equal(true);
        expect(json!.result).to.have.property('ghTokenSet');

        // If token not set, should include setup instructions
        if (json!.result!.ghTokenSet === false) {
          expect(json!.result).to.have.property('setupCommand');
          expect(json!.result).to.have.property('sourceCommand');
        }
      }
    });
  });

  /**
   * Full agent navigation flow tests
   */
  describe('Full agent navigation flows', () => {
    it('should navigate: gh menu → status → get status info', async () => {
      // Step 1: Start at gh menu
      const menu = await agentExec('gh --machine');
      expect(menu).to.not.be.null;

      // Step 2: Find and select status
      const statusChoice = findChoice(menu!.prompt.choices, 'status');
      expect(statusChoice).to.exist;
      expect(statusChoice!.command).to.exist;

      // Step 3: Execute status command from choice
      const statusCmd = execChoice(statusChoice!);
      const statusOutput = await execInProcess(statusCmd);
      const statusJson = extractJson<{ success: boolean; result: { ghInstalled: boolean } }>(statusOutput);

      expect(statusJson).to.not.be.null;
      expect(statusJson!.success).to.equal(true);
      expect(statusJson!.result).to.have.property('ghInstalled');
    });

    it('should navigate: gh menu → login → get login status', async () => {
      // Step 1: Start at gh menu
      const menu = await agentExec('gh --machine');
      expect(menu).to.not.be.null;

      // Step 2: Find and select login
      const loginChoice = findChoice(menu!.prompt.choices, 'login');
      expect(loginChoice).to.exist;
      expect(loginChoice!.command).to.exist;

      // Step 3: Execute login command from choice
      const loginCmd = execChoice(loginChoice!);
      const loginOutput = await execInProcess(loginCmd);
      const loginJson = extractJson<Record<string, unknown>>(loginOutput);

      expect(loginJson).to.not.be.null;
      // Should have either success or error response
      expect('success' in loginJson! || 'error' in loginJson!).to.be.true;
    });

    it('should navigate: gh menu → token → get token setup info', async () => {
      // Step 1: Start at gh menu
      const menu = await agentExec('gh --machine');
      expect(menu).to.not.be.null;

      // Step 2: Find and select token
      const tokenChoice = findChoice(menu!.prompt.choices, 'token');
      expect(tokenChoice).to.exist;
      expect(tokenChoice!.command).to.exist;

      // Step 3: Execute token command from choice
      const tokenCmd = execChoice(tokenChoice!);
      const tokenOutput = await execInProcess(tokenCmd);
      const tokenJson = extractJson<Record<string, unknown>>(tokenOutput);

      expect(tokenJson).to.not.be.null;
      // Should have either success or error response
      expect('success' in tokenJson! || 'error' in tokenJson!).to.be.true;
    });
  });

  /**
   * Legacy --json flag support
   */
  describe('Legacy --json flag support', () => {
    it('gh --json should work same as --machine', async () => {
      const machineOutput = await agentExec('gh --machine');
      const jsonOutput = await agentExec('gh --json');

      expect(machineOutput).to.not.be.null;
      expect(jsonOutput).to.not.be.null;

      // Both should have same structure
      expect(machineOutput!.prompt.type).to.equal(jsonOutput!.prompt.type);
      expect(machineOutput!.prompt.name).to.equal(jsonOutput!.prompt.name);
    });

    it('gh status --json should work same as --machine', async () => {
      const machineOutput = await execInProcess('gh status --machine');
      const jsonOutput = await execInProcess('gh status --json');

      const machineJson = extractJson<{ success: boolean }>(machineOutput);
      const legacyJson = extractJson<{ success: boolean }>(jsonOutput);

      expect(machineJson).to.not.be.null;
      expect(legacyJson).to.not.be.null;
      expect(machineJson!.success).to.equal(legacyJson!.success);
    });
  });
});
