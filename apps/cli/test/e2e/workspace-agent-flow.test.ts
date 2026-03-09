import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { extractJson, execInProcessAsAgent } from './test-helpers.js';

/**
 * Response type for JSON prompt output from workspace commands with --json flag.
 */
interface PromptJsonResponse {
  prompt: {
    type: string;
    name: string;
    message: string;
    choices?: Array<{
      name: string;
      value: string;
      command?: string;
    }>;
  };
  metadata: {
    command: string;
    flags: Record<string, unknown>;
    timestamp?: string;
  };
}

/**
 * E2E tests for workspace commands with JSON output assertions.
 *
 * Tests the full agentic flow: use --json flag to get structured output
 * and verify end results (config state, JSON response content).
 *
 * Workspace commands manage the ~/.proletariat/config.json machine registry,
 * so we isolate by setting HOME to a temp directory.
 */
describe('Workspace Commands E2E - Agent Flow', () => {
  let testDir: string;
  let originalCwd: string;
  let originalHome: string | undefined;
  let testWorkspace1: string;
  let testWorkspace2: string;

  /**
   * Get the machine config path within the test HOME directory.
   */
  function getMachineConfigPath(): string {
    return path.join(testDir, '.proletariat', 'config.json');
  }

  /**
   * Read the machine config from the test HOME directory.
   */
  function readMachineConfig(): Record<string, unknown> {
    const configPath = getMachineConfigPath();
    if (!fs.existsSync(configPath)) return {};
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  }

  /**
   * Workspace-specific env vars shared by all exec helpers in this suite.
   * Sets HOME to testDir for machine config isolation and PRLT_HQ_PATH
   * to bypass the init hook.
   */
  function getWorkspaceEnv(): Record<string, string | undefined> {
    return {
      HOME: testDir,
      PRLT_HQ_PATH: testWorkspace1,
      PRLT_TEST_ENV: 'true',
    };
  }

  /**
   * Execute a workspace command with --json flag for structured output.
   */
  async function execJson(cmd: string): Promise<string> {
    return await execInProcessAsAgent(cmd, getWorkspaceEnv());
  }

  /**
   * Execute a workspace command with --json and parse the JSON response.
   */
  async function execWorkspaceJson<T>(cmd: string): Promise<T | null> {
    const output = await execJson(cmd);
    return extractJson<T>(output);
  }

  /**
   * Create a valid HQ workspace directory for testing.
   */
  function createTestWorkspace(wsPath: string, name?: string): void {
    fs.mkdirSync(path.join(wsPath, '.proletariat'), { recursive: true });
    fs.writeFileSync(
      path.join(wsPath, '.proletariat', 'config.json'),
      JSON.stringify({
        version: '1.0.0',
        schemaVersion: 1,
        type: 'hq',
        name: name || path.basename(wsPath),
      })
    );
    // Create workspace.db file (empty for testing)
    fs.writeFileSync(path.join(wsPath, '.proletariat', 'workspace.db'), '');
  }

  beforeEach(() => {
    originalCwd = process.cwd();
    originalHome = process.env.HOME;

    // Create a temp directory for testing
    testDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ws-agent-flow-')));
    process.env.HOME = testDir;

    // Create two test workspaces
    testWorkspace1 = path.join(testDir, 'workspace-alpha');
    testWorkspace2 = path.join(testDir, 'workspace-beta');

    createTestWorkspace(testWorkspace1);
    createTestWorkspace(testWorkspace2);

    process.chdir(testDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (originalHome) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  // ===========================================================================
  // workspace add - Register workspace
  // ===========================================================================

  describe('workspace add', () => {
    it('should register a workspace and verify config updated', async () => {
      const output = await execJson(`workspace add ${testWorkspace1}`);
      const json = JSON.parse(output);

      expect(json.type).to.equal('success');
      expect(json.result.status).to.equal('registered');
      expect(json.result.path).to.equal(testWorkspace1);
      expect(json.result.name).to.equal('workspace-alpha');

      // Verify the machine config was updated
      const config = readMachineConfig();
      const hqs = (config.headquarters || config.workspaces) as Array<{ name: string; path: string }>;
      expect(hqs).to.be.an('array');
      expect(hqs.length).to.be.at.least(1);
      expect(hqs[0].path).to.equal(testWorkspace1);
      expect(hqs[0].name).to.equal('workspace-alpha');
    });

    it('should register with custom name via --name flag', async () => {
      const output = await execJson(`workspace add ${testWorkspace1} --name "Custom HQ Name"`);
      const json = JSON.parse(output);

      expect(json.type).to.equal('success');
      expect(json.result.name).to.equal('Custom HQ Name');

      const config = readMachineConfig();
      const hqs = (config.headquarters || config.workspaces) as Array<{ name: string }>;
      expect(hqs[0].name).to.equal('Custom HQ Name');
    });

    it('should set first workspace as active automatically', async () => {
      await execJson(`workspace add ${testWorkspace1}`);

      const config = readMachineConfig();
      const active = config.activeHeadquarters || config.activeWorkspace;
      expect(active).to.equal(testWorkspace1);
    });

    it('should register multiple workspaces', async () => {
      await execJson(`workspace add ${testWorkspace1}`);
      await execJson(`workspace add ${testWorkspace2}`);

      const config = readMachineConfig();
      const hqs = (config.headquarters || config.workspaces) as Array<{ path: string }>;
      expect(hqs).to.have.length(2);
    });

    it('should reject non-workspace directory', async () => {
      const nonWorkspace = path.join(testDir, 'not-a-workspace');
      fs.mkdirSync(nonWorkspace, { recursive: true });

      const output = await execJson(`workspace add ${nonWorkspace}`);

      expect(output).to.include('Not a valid workspace');
    });

    it('should reject non-existent path', async () => {
      const output = await execJson(`workspace add ${path.join(testDir, 'nonexistent')}`);

      expect(output).to.include('does not exist');
    });

    it('should detect already registered workspace', async () => {
      await execJson(`workspace add ${testWorkspace1}`);
      const output = await execJson(`workspace add ${testWorkspace1}`);
      const json = JSON.parse(output);

      expect(json.type).to.equal('success');
      expect(json.result.status).to.equal('already_registered');
    });
  });

  // ===========================================================================
  // workspace list - List registered workspaces
  // ===========================================================================

  describe('workspace list', () => {
    it('should show no workspaces when none registered', async () => {
      const output = await execJson('workspace list');
      const json = JSON.parse(output);

      expect(json.workspaces).to.be.an('array');
      expect(json.workspaces).to.have.length(0);
    });

    it('should list registered workspaces', async () => {
      await execJson(`workspace add ${testWorkspace1}`);
      await execJson(`workspace add ${testWorkspace2}`);

      const output = await execJson('workspace list');
      const json = JSON.parse(output);

      expect(json.workspaces).to.have.length(2);
      const names = json.workspaces.map((w: { name: string }) => w.name);
      expect(names).to.include('workspace-alpha');
      expect(names).to.include('workspace-beta');
    });

    it('should show active workspace marker', async () => {
      await execJson(`workspace add ${testWorkspace1}`);

      const output = await execJson('workspace list');
      const json = JSON.parse(output);

      expect(json.activeWorkspace).to.equal(testWorkspace1);
      const activeWs = json.workspaces.find((w: { active: boolean }) => w.active);
      expect(activeWs).to.not.be.undefined;
    });

    it('should output valid JSON with --json flag', async () => {
      await execJson(`workspace add ${testWorkspace1}`);
      await execJson(`workspace add ${testWorkspace2}`);

      const output = await execJson('workspace list');
      const json = JSON.parse(output);

      expect(json.workspaces).to.be.an('array');
      expect(json.workspaces).to.have.length(2);
      expect(json.workspaces[0].name).to.equal('workspace-alpha');
      expect(json.workspaces[0].path).to.equal(testWorkspace1);
      expect(json.workspaces[1].name).to.equal('workspace-beta');
    });

    it('should indicate active workspace in JSON output', async () => {
      await execJson(`workspace add ${testWorkspace1}`);

      const output = await execJson('workspace list');
      const json = JSON.parse(output);

      expect(json.activeWorkspace).to.equal(testWorkspace1);
      const activeWs = json.workspaces.find((w: { active: boolean }) => w.active);
      expect(activeWs).to.not.be.undefined;
      expect(activeWs.path).to.equal(testWorkspace1);
    });

    it('should detect stale registrations', async () => {
      await execJson(`workspace add ${testWorkspace1}`);
      fs.rmSync(testWorkspace1, { recursive: true, force: true });

      const output = await execJson('workspace list');
      const json = JSON.parse(output);

      const staleWs = json.workspaces.find((w: { exists: boolean }) => !w.exists);
      expect(staleWs).to.not.be.undefined;
    });
  });

  // ===========================================================================
  // workspace use - Set active workspace
  // ===========================================================================

  describe('workspace use', () => {
    beforeEach(async () => {
      await execJson(`workspace add ${testWorkspace1}`);
      await execJson(`workspace add ${testWorkspace2}`);
    });

    it('should switch active workspace by name', async () => {
      const output = await execJson('workspace use workspace-beta');
      const json = JSON.parse(output);

      expect(json.type).to.equal('success');
      expect(json.result.status).to.equal('activated');
      expect(json.result.name).to.equal('workspace-beta');

      const config = readMachineConfig();
      const active = config.activeHeadquarters || config.activeWorkspace;
      expect(active).to.equal(testWorkspace2);
    });

    it('should switch active workspace by path', async () => {
      const output = await execJson(`workspace use ${testWorkspace2}`);
      const json = JSON.parse(output);

      expect(json.type).to.equal('success');
      expect(json.result.status).to.equal('activated');
      expect(json.result.path).to.equal(testWorkspace2);
    });

    it('should verify end state: config reflects new active workspace', async () => {
      await execJson('workspace use workspace-beta');

      // Verify via list --json
      const listOutput = await execJson('workspace list');
      const json = JSON.parse(listOutput);

      expect(json.activeWorkspace).to.equal(testWorkspace2);
    });

    it('should reject non-existent workspace name', async () => {
      const output = await execJson('workspace use nonexistent');
      const json = JSON.parse(output);

      expect(json.type).to.equal('error');
      expect(json.error.code).to.equal('WORKSPACE_NOT_FOUND');
    });

    it('should reject workspace with deleted path', async () => {
      fs.rmSync(testWorkspace2, { recursive: true, force: true });

      const output = await execJson('workspace use workspace-beta');
      const json = JSON.parse(output);

      expect(json.type).to.equal('error');
      expect(json.error.code).to.equal('PATH_NOT_FOUND');
    });
  });

  // ===========================================================================
  // workspace remove - Unregister workspace
  // ===========================================================================

  describe('workspace remove', () => {
    beforeEach(async () => {
      await execJson(`workspace add ${testWorkspace1}`);
      await execJson(`workspace add ${testWorkspace2}`);
    });

    it('should unregister workspace by name and preserve files', async () => {
      const output = await execJson('workspace remove workspace-alpha');
      const json = JSON.parse(output);

      expect(json.type).to.equal('success');
      expect(json.result.status).to.equal('unregistered');
      expect(json.result.path).to.equal(testWorkspace1);

      // Files should still exist
      expect(fs.existsSync(testWorkspace1)).to.be.true;

      // Verify removed from config
      const config = readMachineConfig();
      const hqs = (config.headquarters || config.workspaces) as Array<{ name: string }>;
      expect(hqs).to.have.length(1);
      expect(hqs[0].name).to.equal('workspace-beta');
    });

    it('should unregister workspace by path', async () => {
      const output = await execJson(`workspace remove ${testWorkspace1}`);
      const json = JSON.parse(output);

      expect(json.type).to.equal('success');
      expect(json.result.status).to.equal('unregistered');
    });

    it('should clear active workspace when removing active one', async () => {
      // workspace-alpha is active (first registered)
      const output = await execJson('workspace remove workspace-alpha');
      const json = JSON.parse(output);

      expect(json.result.wasActive).to.be.true;

      const config = readMachineConfig();
      // activeHeadquarters should be null after removing the active workspace
      expect(config.activeHeadquarters).to.be.null;
    });

    it('should verify end state: removed workspace absent from list', async () => {
      await execJson('workspace remove workspace-alpha');

      const listOutput = await execJson('workspace list');
      const json = JSON.parse(listOutput);

      const names = json.workspaces.map((w: { name: string }) => w.name);
      expect(names).to.not.include('workspace-alpha');
      expect(names).to.include('workspace-beta');
    });

    it('should reject non-existent workspace', async () => {
      const output = await execJson('workspace remove nonexistent');
      const json = JSON.parse(output);

      expect(json.type).to.equal('error');
      expect(json.error.code).to.equal('WORKSPACE_NOT_FOUND');
    });
  });

  // ===========================================================================
  // JSON mode prompt schema - workspace remove disambiguation
  // ===========================================================================

  describe('workspace remove --json (disambiguation prompt)', () => {
    let sameNameWorkspace1: string;
    let sameNameWorkspace2: string;

    beforeEach(async () => {
      // Create two workspaces with the SAME name but different paths
      sameNameWorkspace1 = path.join(testDir, 'project-a');
      sameNameWorkspace2 = path.join(testDir, 'project-b');

      createTestWorkspace(sameNameWorkspace1);
      createTestWorkspace(sameNameWorkspace2);

      // Register both with the same name
      await execJson(`workspace add ${sameNameWorkspace1} --name "shared-name"`);
      await execJson(`workspace add ${sameNameWorkspace2} --name "shared-name"`);
    });

    it('should output prompt schema with choices when name is ambiguous', async () => {
      const json = await execWorkspaceJson<PromptJsonResponse>('workspace remove shared-name');

      expect(json).to.not.be.null;
      expect(json!.prompt).to.not.be.null;
      expect(json!.prompt.type).to.equal('list');
      expect(json!.prompt.name).to.equal('selected');
      expect(json!.prompt.message).to.include('Multiple workspaces');
      expect(json!.prompt.message).to.include('shared-name');
    });

    it('should include choices with command field for agent navigation', async () => {
      const json = await execWorkspaceJson<PromptJsonResponse>('workspace remove shared-name');

      expect(json).to.not.be.null;
      const choices = json!.prompt.choices!;
      expect(choices).to.be.an('array');
      expect(choices.length).to.equal(2);

      // Each choice should have name, value, and command fields
      for (const choice of choices) {
        expect(choice).to.have.property('name');
        expect(choice).to.have.property('value');
        expect(choice).to.have.property('command');
        expect(choice.command).to.include('prlt workspace remove');
        expect(choice.command).to.include('--json');
      }
    });

    it('should include metadata with command name', async () => {
      const json = await execWorkspaceJson<PromptJsonResponse>('workspace remove shared-name');

      expect(json).to.not.be.null;
      expect(json!.metadata.command).to.equal('workspace remove');
    });

    it('should resolve when using full path (no disambiguation needed)', async () => {
      const output = await execJson(`workspace remove ${sameNameWorkspace1}`);
      const json = JSON.parse(output);

      expect(json.type).to.equal('success');
      expect(json.result.status).to.equal('unregistered');

      // Verify only one workspace remains
      const config = readMachineConfig();
      const hqs = (config.headquarters || config.workspaces) as Array<{ path: string }>;
      expect(hqs).to.have.length(1);
      expect(hqs[0].path).to.equal(sameNameWorkspace2);
    });
  });

  // ===========================================================================
  // JSON mode prompt schema - workspace use disambiguation
  // ===========================================================================

  describe('workspace use --json (disambiguation prompt)', () => {
    let sameNameWorkspace1: string;
    let sameNameWorkspace2: string;

    beforeEach(async () => {
      // Create two workspaces with the SAME name but different paths
      sameNameWorkspace1 = path.join(testDir, 'hq-one');
      sameNameWorkspace2 = path.join(testDir, 'hq-two');

      createTestWorkspace(sameNameWorkspace1);
      createTestWorkspace(sameNameWorkspace2);

      // Register both with the same name
      await execJson(`workspace add ${sameNameWorkspace1} --name "duplicate-name"`);
      await execJson(`workspace add ${sameNameWorkspace2} --name "duplicate-name"`);
    });

    it('should output prompt schema with choices when name is ambiguous', async () => {
      const json = await execWorkspaceJson<PromptJsonResponse>('workspace use duplicate-name');

      expect(json).to.not.be.null;
      expect(json!.prompt).to.not.be.null;
      expect(json!.prompt.type).to.equal('list');
      expect(json!.prompt.name).to.equal('selected');
      expect(json!.prompt.message).to.include('Multiple workspaces');
      expect(json!.prompt.message).to.include('duplicate-name');
    });

    it('should include choices with command field for agent navigation', async () => {
      const json = await execWorkspaceJson<PromptJsonResponse>('workspace use duplicate-name');

      expect(json).to.not.be.null;
      const choices = json!.prompt.choices!;
      expect(choices).to.be.an('array');
      expect(choices.length).to.equal(2);

      // Each choice should have name, value, and command fields
      for (const choice of choices) {
        expect(choice).to.have.property('name');
        expect(choice).to.have.property('value');
        expect(choice).to.have.property('command');
        expect(choice.command).to.include('prlt workspace use');
        expect(choice.command).to.include('--json');
      }
    });

    it('should include metadata with command name', async () => {
      const json = await execWorkspaceJson<PromptJsonResponse>('workspace use duplicate-name');

      expect(json).to.not.be.null;
      expect(json!.metadata.command).to.equal('workspace use');
    });

    it('should resolve when using full path (no disambiguation needed)', async () => {
      const output = await execJson(`workspace use ${sameNameWorkspace2}`);
      const json = JSON.parse(output);

      expect(json.type).to.equal('success');
      expect(json.result.status).to.equal('activated');

      // Verify active workspace was set correctly
      const config = readMachineConfig();
      const active = config.activeHeadquarters || config.activeWorkspace;
      expect(active).to.equal(sameNameWorkspace2);
    });

    it('agent can follow command from choice to complete the action', async () => {
      // Step 1: Agent gets disambiguation prompt (JSON mode)
      const json = await execWorkspaceJson<PromptJsonResponse>('workspace use duplicate-name');
      expect(json).to.not.be.null;

      // Step 2: Agent picks the second choice and extracts the command
      const choices = json!.prompt.choices!;
      const secondChoice = choices[1];
      expect(secondChoice.command).to.be.a('string');

      // Step 3: Agent executes the command from the choice (strip 'prlt ' prefix)
      const followUpCmd = secondChoice.command!.replace('prlt ', '');
      const result = await execJson(followUpCmd.replace(' --json', ''));
      const resultJson = JSON.parse(result);

      expect(resultJson.type).to.equal('success');
      expect(resultJson.result.status).to.equal('activated');

      // Step 4: Verify end state
      const config = readMachineConfig();
      const active = config.activeHeadquarters || config.activeWorkspace;
      expect(active).to.equal(secondChoice.value);
    });
  });

  // ===========================================================================
  // Full workflow: add → use → list → remove
  // ===========================================================================

  describe('full workflow: add → use → list → remove', () => {
    it('should complete full lifecycle', async () => {
      // Step 1: Add two workspaces
      const addOutput1 = await execJson(`workspace add ${testWorkspace1}`);
      const add1 = JSON.parse(addOutput1);
      expect(add1.type).to.equal('success');
      expect(add1.result.status).to.equal('registered');

      const addOutput2 = await execJson(`workspace add ${testWorkspace2}`);
      const add2 = JSON.parse(addOutput2);
      expect(add2.type).to.equal('success');
      expect(add2.result.status).to.equal('registered');

      // Step 2: List and verify both present
      const listJson = await execJson('workspace list');
      const list = JSON.parse(listJson);
      expect(list.workspaces).to.have.length(2);

      // Step 3: Switch to second workspace
      const useOutput = await execJson('workspace use workspace-beta');
      const use = JSON.parse(useOutput);
      expect(use.type).to.equal('success');
      expect(use.result.status).to.equal('activated');
      expect(use.result.name).to.equal('workspace-beta');

      // Step 4: Verify active workspace changed
      const listJson2 = await execJson('workspace list');
      const list2 = JSON.parse(listJson2);
      expect(list2.activeWorkspace).to.equal(testWorkspace2);

      // Step 5: Remove first workspace
      const removeOutput = await execJson('workspace remove workspace-alpha');
      const remove = JSON.parse(removeOutput);
      expect(remove.type).to.equal('success');
      expect(remove.result.status).to.equal('unregistered');

      // Step 6: Verify only one workspace remains
      const listJson3 = await execJson('workspace list');
      const list3 = JSON.parse(listJson3);
      expect(list3.workspaces).to.have.length(1);
      expect(list3.workspaces[0].name).to.equal('workspace-beta');
      expect(list3.activeWorkspace).to.equal(testWorkspace2);
    });
  });
});
