import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import { filterOutput, getIsolatedEnv, getBinPath, extractJson, execAsHuman, execAsAgent } from './test-helpers.js';

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
 * E2E tests for workspace commands with this.prompt() migration.
 *
 * Tests the full agentic flow: use flags to bypass interactive prompts
 * and verify end results (config state, output content).
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
  function getWorkspaceEnv(): NodeJS.ProcessEnv {
    return {
      HOME: testDir,
      PRLT_HQ_PATH: testWorkspace1,
      PRLT_TEST_ENV: 'true',
    };
  }

  /**
   * Execute a workspace command in human-readable text mode.
   * Uses PRLT_FORCE_TEXT=1 to override non-TTY auto-detection in execSync.
   *
   * Output mode: HUMAN-READABLE TEXT
   */
  function execHuman(cmd: string): string {
    return execAsHuman(cmd, getWorkspaceEnv());
  }

  /**
   * Execute a workspace command in explicit JSON/agent mode.
   * Appends --json flag to explicitly request JSON output.
   *
   * Output mode: JSON (explicit --json flag)
   */
  function execJson(cmd: string): string {
    return execAsAgent(cmd, getWorkspaceEnv());
  }

  /**
   * Execute a workspace command with --json and parse the JSON response.
   * Uses explicit --json flag for machine-readable output.
   *
   * Output mode: JSON (explicit --json flag)
   */
  function execWorkspaceJson<T>(cmd: string): T | null {
    const output = execJson(cmd);
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

  // Output mode: HUMAN-READABLE TEXT (via execHuman / PRLT_FORCE_TEXT=1)
  describe('workspace add', () => {
    it('should register a workspace and verify config updated', () => {
      const output = execHuman(`workspace add ${testWorkspace1}`);

      expect(output).to.include('Registered workspace');
      expect(output).to.include('workspace-alpha');

      // Verify the machine config was updated
      const config = readMachineConfig();
      const hqs = (config.headquarters || config.workspaces) as Array<{ name: string; path: string }>;
      expect(hqs).to.be.an('array');
      expect(hqs.length).to.be.at.least(1);
      expect(hqs[0].path).to.equal(testWorkspace1);
      expect(hqs[0].name).to.equal('workspace-alpha');
    });

    it('should register with custom name via --name flag', () => {
      const output = execHuman(`workspace add ${testWorkspace1} --name "Custom HQ Name"`);

      expect(output).to.include('Registered workspace');
      expect(output).to.include('Custom HQ Name');

      const config = readMachineConfig();
      const hqs = (config.headquarters || config.workspaces) as Array<{ name: string }>;
      expect(hqs[0].name).to.equal('Custom HQ Name');
    });

    it('should set first workspace as active automatically', () => {
      execHuman(`workspace add ${testWorkspace1}`);

      const config = readMachineConfig();
      const active = config.activeHeadquarters || config.activeWorkspace;
      expect(active).to.equal(testWorkspace1);
    });

    it('should register multiple workspaces', () => {
      execHuman(`workspace add ${testWorkspace1}`);
      execHuman(`workspace add ${testWorkspace2}`);

      const config = readMachineConfig();
      const hqs = (config.headquarters || config.workspaces) as Array<{ path: string }>;
      expect(hqs).to.have.length(2);
    });

    it('should reject non-workspace directory', () => {
      const nonWorkspace = path.join(testDir, 'not-a-workspace');
      fs.mkdirSync(nonWorkspace, { recursive: true });

      const output = execHuman(`workspace add ${nonWorkspace}`);

      expect(output).to.include('Not a valid workspace');
    });

    it('should reject non-existent path', () => {
      const output = execHuman(`workspace add ${path.join(testDir, 'nonexistent')}`);

      expect(output).to.include('does not exist');
    });

    it('should detect already registered workspace', () => {
      execHuman(`workspace add ${testWorkspace1}`);
      const output = execHuman(`workspace add ${testWorkspace1}`);

      expect(output).to.include('already registered');
    });
  });

  // ===========================================================================
  // workspace list - List registered workspaces
  // ===========================================================================

  describe('workspace list', () => {
    // Output mode: HUMAN-READABLE TEXT (via execHuman / PRLT_FORCE_TEXT=1)
    it('should show no workspaces when none registered', () => {
      const output = execHuman('workspace list');
      expect(output).to.include('No workspaces found');
    });

    // Output mode: HUMAN-READABLE TEXT (via execHuman / PRLT_FORCE_TEXT=1)
    it('should list registered workspaces', () => {
      execHuman(`workspace add ${testWorkspace1}`);
      execHuman(`workspace add ${testWorkspace2}`);

      const output = execHuman('workspace list');

      expect(output).to.include('workspace-alpha');
      expect(output).to.include('workspace-beta');
    });

    // Output mode: HUMAN-READABLE TEXT (via execHuman / PRLT_FORCE_TEXT=1)
    it('should show active workspace marker', () => {
      execHuman(`workspace add ${testWorkspace1}`);

      const output = execHuman('workspace list');

      expect(output).to.include('(active)');
    });

    // Output mode: JSON (explicit --json flag via execJson)
    it('should output valid JSON with --json flag', () => {
      execHuman(`workspace add ${testWorkspace1}`);
      execHuman(`workspace add ${testWorkspace2}`);

      const output = execJson('workspace list');
      const json = JSON.parse(output);

      expect(json.workspaces).to.be.an('array');
      expect(json.workspaces).to.have.length(2);
      expect(json.workspaces[0].name).to.equal('workspace-alpha');
      expect(json.workspaces[0].path).to.equal(testWorkspace1);
      expect(json.workspaces[1].name).to.equal('workspace-beta');
    });

    // Output mode: JSON (explicit --json flag via execJson)
    it('should indicate active workspace in JSON output', () => {
      execHuman(`workspace add ${testWorkspace1}`);

      const output = execJson('workspace list');
      const json = JSON.parse(output);

      expect(json.activeWorkspace).to.equal(testWorkspace1);
      const activeWs = json.workspaces.find((w: { active: boolean }) => w.active);
      expect(activeWs).to.not.be.undefined;
      expect(activeWs.path).to.equal(testWorkspace1);
    });

    // Output mode: HUMAN-READABLE TEXT (via execHuman / PRLT_FORCE_TEXT=1)
    it('should warn about stale registrations', () => {
      execHuman(`workspace add ${testWorkspace1}`);
      fs.rmSync(testWorkspace1, { recursive: true, force: true });

      const output = execHuman('workspace list');
      expect(output).to.include('Path no longer exists');
    });
  });

  // ===========================================================================
  // workspace use - Set active workspace
  // ===========================================================================

  // Output mode: HUMAN-READABLE TEXT (via execHuman / PRLT_FORCE_TEXT=1)
  describe('workspace use', () => {
    beforeEach(() => {
      execHuman(`workspace add ${testWorkspace1}`);
      execHuman(`workspace add ${testWorkspace2}`);
    });

    it('should switch active workspace by name', () => {
      const output = execHuman('workspace use workspace-beta');

      expect(output).to.include('Active workspace set to');
      expect(output).to.include('workspace-beta');

      const config = readMachineConfig();
      const active = config.activeHeadquarters || config.activeWorkspace;
      expect(active).to.equal(testWorkspace2);
    });

    it('should switch active workspace by path', () => {
      const output = execHuman(`workspace use ${testWorkspace2}`);

      expect(output).to.include('Active workspace set to');
      expect(output).to.include('workspace-beta');
    });

    // Output mode: JSON (explicit --json flag via execJson) — verifies end state
    it('should verify end state: config reflects new active workspace', () => {
      execHuman('workspace use workspace-beta');

      // Verify via list --json
      const listOutput = execJson('workspace list');
      const json = JSON.parse(listOutput);

      expect(json.activeWorkspace).to.equal(testWorkspace2);
    });

    it('should reject non-existent workspace name', () => {
      const output = execHuman('workspace use nonexistent');

      expect(output).to.include('Workspace not found');
    });

    it('should reject workspace with deleted path', () => {
      fs.rmSync(testWorkspace2, { recursive: true, force: true });

      const output = execHuman('workspace use workspace-beta');

      expect(output).to.include('no longer exists');
    });
  });

  // ===========================================================================
  // workspace remove - Unregister workspace
  // ===========================================================================

  // Output mode: HUMAN-READABLE TEXT (via execHuman / PRLT_FORCE_TEXT=1)
  describe('workspace remove', () => {
    beforeEach(() => {
      execHuman(`workspace add ${testWorkspace1}`);
      execHuman(`workspace add ${testWorkspace2}`);
    });

    it('should unregister workspace by name and preserve files', () => {
      const output = execHuman('workspace remove workspace-alpha');

      expect(output).to.include('Unregistered workspace');
      expect(output).to.include('NOT deleted');

      // Files should still exist
      expect(fs.existsSync(testWorkspace1)).to.be.true;

      // Verify removed from config
      const config = readMachineConfig();
      const hqs = (config.headquarters || config.workspaces) as Array<{ name: string }>;
      expect(hqs).to.have.length(1);
      expect(hqs[0].name).to.equal('workspace-beta');
    });

    it('should unregister workspace by path', () => {
      const output = execHuman(`workspace remove ${testWorkspace1}`);

      expect(output).to.include('Unregistered workspace');
    });

    it('should clear active workspace when removing active one', () => {
      // workspace-alpha is active (first registered)
      execHuman('workspace remove workspace-alpha');

      const config = readMachineConfig();
      // activeHeadquarters should be null after removing the active workspace
      expect(config.activeHeadquarters).to.be.null;
    });

    // Output mode: JSON (explicit --json flag via execJson) — verifies end state
    it('should verify end state: removed workspace absent from list', () => {
      execHuman('workspace remove workspace-alpha');

      const listOutput = execJson('workspace list');
      const json = JSON.parse(listOutput);

      const names = json.workspaces.map((w: { name: string }) => w.name);
      expect(names).to.not.include('workspace-alpha');
      expect(names).to.include('workspace-beta');
    });

    it('should reject non-existent workspace', () => {
      const output = execHuman('workspace remove nonexistent');

      expect(output).to.include('Workspace not found');
    });
  });

  // ===========================================================================
  // JSON mode prompt schema - workspace remove disambiguation
  // ===========================================================================

  // Output mode: JSON (explicit --json flag via execWorkspaceJson)
  describe('workspace remove --json (disambiguation prompt)', () => {
    let sameNameWorkspace1: string;
    let sameNameWorkspace2: string;

    beforeEach(() => {
      // Create two workspaces with the SAME name but different paths
      sameNameWorkspace1 = path.join(testDir, 'project-a');
      sameNameWorkspace2 = path.join(testDir, 'project-b');

      createTestWorkspace(sameNameWorkspace1);
      createTestWorkspace(sameNameWorkspace2);

      // Register both with the same name
      execHuman(`workspace add ${sameNameWorkspace1} --name "shared-name"`);
      execHuman(`workspace add ${sameNameWorkspace2} --name "shared-name"`);
    });

    it('should output prompt schema with choices when name is ambiguous', () => {
      const json = execWorkspaceJson<PromptJsonResponse>('workspace remove shared-name');

      expect(json).to.not.be.null;
      expect(json!.prompt).to.not.be.null;
      expect(json!.prompt.type).to.equal('list');
      expect(json!.prompt.name).to.equal('selected');
      expect(json!.prompt.message).to.include('Multiple workspaces');
      expect(json!.prompt.message).to.include('shared-name');
    });

    it('should include choices with command field for agent navigation', () => {
      const json = execWorkspaceJson<PromptJsonResponse>('workspace remove shared-name');

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

    it('should include metadata with command name', () => {
      const json = execWorkspaceJson<PromptJsonResponse>('workspace remove shared-name');

      expect(json).to.not.be.null;
      expect(json!.metadata.command).to.equal('workspace remove');
    });

    // Output mode: HUMAN-READABLE TEXT (via execHuman / PRLT_FORCE_TEXT=1)
    it('should resolve when using full path (no disambiguation needed)', () => {
      const output = execHuman(`workspace remove ${sameNameWorkspace1}`);

      expect(output).to.include('Unregistered workspace');

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

  // Output mode: JSON (explicit --json flag via execWorkspaceJson)
  describe('workspace use --json (disambiguation prompt)', () => {
    let sameNameWorkspace1: string;
    let sameNameWorkspace2: string;

    beforeEach(() => {
      // Create two workspaces with the SAME name but different paths
      sameNameWorkspace1 = path.join(testDir, 'hq-one');
      sameNameWorkspace2 = path.join(testDir, 'hq-two');

      createTestWorkspace(sameNameWorkspace1);
      createTestWorkspace(sameNameWorkspace2);

      // Register both with the same name
      execHuman(`workspace add ${sameNameWorkspace1} --name "duplicate-name"`);
      execHuman(`workspace add ${sameNameWorkspace2} --name "duplicate-name"`);
    });

    it('should output prompt schema with choices when name is ambiguous', () => {
      const json = execWorkspaceJson<PromptJsonResponse>('workspace use duplicate-name');

      expect(json).to.not.be.null;
      expect(json!.prompt).to.not.be.null;
      expect(json!.prompt.type).to.equal('list');
      expect(json!.prompt.name).to.equal('selected');
      expect(json!.prompt.message).to.include('Multiple workspaces');
      expect(json!.prompt.message).to.include('duplicate-name');
    });

    it('should include choices with command field for agent navigation', () => {
      const json = execWorkspaceJson<PromptJsonResponse>('workspace use duplicate-name');

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

    it('should include metadata with command name', () => {
      const json = execWorkspaceJson<PromptJsonResponse>('workspace use duplicate-name');

      expect(json).to.not.be.null;
      expect(json!.metadata.command).to.equal('workspace use');
    });

    // Output mode: HUMAN-READABLE TEXT (via execHuman / PRLT_FORCE_TEXT=1)
    it('should resolve when using full path (no disambiguation needed)', () => {
      const output = execHuman(`workspace use ${sameNameWorkspace2}`);

      expect(output).to.include('Active workspace set to');

      // Verify active workspace was set correctly
      const config = readMachineConfig();
      const active = config.activeHeadquarters || config.activeWorkspace;
      expect(active).to.equal(sameNameWorkspace2);
    });

    // Output mode: JSON for initial prompt (via execWorkspaceJson),
    // then HUMAN-READABLE TEXT for follow-up action (via execHuman)
    it('agent can follow command from choice to complete the action', () => {
      // Step 1: Agent gets disambiguation prompt (JSON mode)
      const json = execWorkspaceJson<PromptJsonResponse>('workspace use duplicate-name');
      expect(json).to.not.be.null;

      // Step 2: Agent picks the second choice and extracts the command
      const choices = json!.prompt.choices!;
      const secondChoice = choices[1];
      expect(secondChoice.command).to.be.a('string');

      // Step 3: Agent executes the command from the choice
      // (without prlt prefix, without --json to actually perform the action)
      const followUpCmd = secondChoice.command!
        .replace('prlt ', '')
        .replace(' --json', '');
      const result = execHuman(followUpCmd);

      expect(result).to.include('Active workspace set to');

      // Step 4: Verify end state
      const config = readMachineConfig();
      const active = config.activeHeadquarters || config.activeWorkspace;
      expect(active).to.equal(secondChoice.value);
    });
  });

  // ===========================================================================
  // Full workflow: add → use → list → remove
  // ===========================================================================

  // Output mode: Mixed — HUMAN-READABLE TEXT for actions (via execHuman),
  // JSON for verification steps (via execJson with explicit --json flag)
  describe('full workflow: add → use → list → remove', () => {
    it('should complete full lifecycle', () => {
      // Step 1: Add two workspaces (text mode)
      const addOutput1 = execHuman(`workspace add ${testWorkspace1}`);
      expect(addOutput1).to.include('Registered workspace');

      const addOutput2 = execHuman(`workspace add ${testWorkspace2}`);
      expect(addOutput2).to.include('Registered workspace');

      // Step 2: List and verify both present (JSON mode, explicit --json)
      const listJson = execJson('workspace list');
      const list = JSON.parse(listJson);
      expect(list.workspaces).to.have.length(2);

      // Step 3: Switch to second workspace (text mode)
      const useOutput = execHuman('workspace use workspace-beta');
      expect(useOutput).to.include('Active workspace set to');
      expect(useOutput).to.include('workspace-beta');

      // Step 4: Verify active workspace changed (JSON mode, explicit --json)
      const listJson2 = execJson('workspace list');
      const list2 = JSON.parse(listJson2);
      expect(list2.activeWorkspace).to.equal(testWorkspace2);

      // Step 5: Remove first workspace (text mode)
      const removeOutput = execHuman('workspace remove workspace-alpha');
      expect(removeOutput).to.include('Unregistered workspace');

      // Step 6: Verify only one workspace remains (JSON mode, explicit --json)
      const listJson3 = execJson('workspace list');
      const list3 = JSON.parse(listJson3);
      expect(list3.workspaces).to.have.length(1);
      expect(list3.workspaces[0].name).to.equal('workspace-beta');
      expect(list3.activeWorkspace).to.equal(testWorkspace2);
    });
  });
});
