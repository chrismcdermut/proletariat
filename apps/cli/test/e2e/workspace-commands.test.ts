import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { filterOutput, getIsolatedEnv, getBinPath, execInProcessAsHuman, execInProcessAsAgent } from './test-helpers.js';
import { execSync } from 'node:child_process';

/**
 * End-to-end tests for workspace commands.
 * Tests: prlt workspace list, use, add, remove
 */
describe('Workspace Commands E2E Tests', () => {
  let testDir: string;
  let originalCwd: string;
  let originalHome: string | undefined;
  let testWorkspace1: string;
  let testWorkspace2: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    originalHome = process.env.HOME;

    // Create a temp directory for testing
    testDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-e2e-')));
    process.env.HOME = testDir;

    // Create two test workspaces
    testWorkspace1 = path.join(testDir, 'workspace-one');
    testWorkspace2 = path.join(testDir, 'workspace-two');

    for (const wsPath of [testWorkspace1, testWorkspace2]) {
      fs.mkdirSync(path.join(wsPath, '.proletariat'), { recursive: true });
      fs.writeFileSync(
        path.join(wsPath, '.proletariat', 'config.json'),
        JSON.stringify({
          version: '1.0.0',
          schemaVersion: 1,
          type: 'hq',
          name: path.basename(wsPath),
        })
      );
      // Create workspace.db file (just empty for testing)
      fs.writeFileSync(path.join(wsPath, '.proletariat', 'workspace.db'), '');
    }

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
   * Execute a workspace command in human-readable text mode.
   * Uses PRLT_FORCE_TEXT=1 to override non-TTY auto-detection.
   *
   * Output mode: HUMAN-READABLE TEXT
   */
  async function execHuman(cmd: string): Promise<string> {
    return execInProcessAsHuman(cmd, getWorkspaceEnv());
  }

  /**
   * Execute a workspace command in explicit JSON/agent mode.
   * Appends --json flag to explicitly request JSON output.
   *
   * Output mode: JSON (explicit --json flag)
   */
  async function execJson(cmd: string): Promise<string> {
    return execInProcessAsAgent(cmd, getWorkspaceEnv());
  }

  /**
   * Execute a workspace command in raw non-TTY mode (no PRLT_FORCE_TEXT, no --json).
   * The CLI auto-detects non-TTY and outputs JSON automatically.
   *
   * Output mode: NON-TTY AUTO-DETECTED (for testing non-TTY safety behavior)
   *
   * Only use this for tests that specifically verify non-TTY auto-detection behavior,
   * such as prune dry-run safety defaults.
   *
   * NOTE: This helper retains execSync because it needs raw non-TTY detection
   * behavior (no PRLT_FORCE_TEXT set), which the in-process helpers override.
   */
  function execNonTTY(cmd: string): string {
    try {
      const binPath = getBinPath();
      const env: NodeJS.ProcessEnv = {
        ...getIsolatedEnv(),
        ...getWorkspaceEnv(),
      };

      const result = execSync(`node ${binPath} ${cmd}`, {
        encoding: 'utf-8',
        cwd: process.cwd(),
        env,
      });
      return filterOutput(result);
    } catch (error: unknown) {
      const execError = error as { stdout?: string; stderr?: string; message?: string };
      const stdout = execError.stdout || '';
      const stderr = execError.stderr || '';
      return filterOutput(stdout + stderr) || execError.message || 'Unknown error';
    }
  }

  // Output mode: HUMAN-READABLE TEXT (via execHuman / PRLT_FORCE_TEXT=1)
  describe('prlt workspace add', () => {
    it('should register a workspace', async () => {
      const output = await execHuman(`workspace add ${testWorkspace1}`);

      expect(output).to.include('Registered workspace');
      expect(output).to.include('workspace-one');

      // Verify the machine config was updated
      const configPath = path.join(testDir, '.proletariat', 'config.json');
      expect(fs.existsSync(configPath)).to.be.true;

      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(config.headquarters).to.have.length(1);
      expect(config.headquarters[0].path).to.equal(testWorkspace1);
    });

    it('should register with custom name', async () => {
      const output = await execHuman(`workspace add ${testWorkspace1} --name "My Custom Name"`);

      expect(output).to.include('Registered workspace');
      expect(output).to.include('My Custom Name');

      const configPath = path.join(testDir, '.proletariat', 'config.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(config.headquarters[0].name).to.equal('My Custom Name');
    });

    it('should reject non-workspace directories', async () => {
      const nonWorkspace = path.join(testDir, 'not-a-workspace');
      fs.mkdirSync(nonWorkspace, { recursive: true });

      const output = await execHuman(`workspace add ${nonWorkspace}`);

      expect(output).to.include('Not a valid workspace');
    });

    it('should reject already registered workspace', async () => {
      await execHuman(`workspace add ${testWorkspace1}`);
      const output = await execHuman(`workspace add ${testWorkspace1}`);

      expect(output).to.include('already registered');
    });
  });

  // Output mode: HUMAN-READABLE TEXT (via execHuman / PRLT_FORCE_TEXT=1)
  // except --json test which uses explicit --json flag (via execJson)
  describe('prlt workspace list', () => {
    it('should show no workspaces when none registered', async () => {
      const output = await execHuman('workspace list');
      expect(output).to.include('No workspaces found');
    });

    it('should list registered workspaces', async () => {
      await execHuman(`workspace add ${testWorkspace1}`);
      await execHuman(`workspace add ${testWorkspace2}`);

      const output = await execHuman('workspace list');

      expect(output).to.include('workspace-one');
      expect(output).to.include('workspace-two');
    });

    it('should show active workspace marker', async () => {
      await execHuman(`workspace add ${testWorkspace1}`);

      const output = await execHuman('workspace list');

      expect(output).to.include('(active)');
    });

    // Output mode: JSON (explicit --json flag via execJson)
    it('should support --json flag', async () => {
      await execHuman(`workspace add ${testWorkspace1}`);

      const output = await execJson('workspace list');
      const json = JSON.parse(output);

      expect(json.workspaces).to.be.an('array');
      expect(json.workspaces[0].name).to.equal('workspace-one');
      expect(json.workspaces[0].path).to.equal(testWorkspace1);
      expect(json.activeWorkspace).to.equal(testWorkspace1);
    });

    it('should warn about stale registrations', async () => {
      // Register workspace then delete it
      await execHuman(`workspace add ${testWorkspace1}`);
      fs.rmSync(testWorkspace1, { recursive: true, force: true });

      const output = await execHuman('workspace list');

      expect(output).to.include('Path no longer exists');
    });
  });

  // Output mode: HUMAN-READABLE TEXT (via execHuman / PRLT_FORCE_TEXT=1)
  describe('prlt workspace use', () => {
    beforeEach(async () => {
      await execHuman(`workspace add ${testWorkspace1}`);
      await execHuman(`workspace add ${testWorkspace2}`);
    });

    it('should switch active workspace by name', async () => {
      const output = await execHuman('workspace use workspace-two');

      expect(output).to.include('Active workspace set to');
      expect(output).to.include('workspace-two');

      const configPath = path.join(testDir, '.proletariat', 'config.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(config.activeHeadquarters).to.equal(testWorkspace2);
    });

    it('should switch active workspace by path', async () => {
      const output = await execHuman(`workspace use ${testWorkspace2}`);

      expect(output).to.include('Active workspace set to');
      expect(output).to.include('workspace-two');
    });

    it('should reject non-existent workspace', async () => {
      const output = await execHuman('workspace use nonexistent');

      expect(output).to.include('Workspace not found');
    });

    it('should reject deleted workspace path', async () => {
      fs.rmSync(testWorkspace2, { recursive: true, force: true });

      const output = await execHuman('workspace use workspace-two');

      expect(output).to.include('no longer exists');
    });
  });

  // Output mode: HUMAN-READABLE TEXT (via execHuman / PRLT_FORCE_TEXT=1)
  describe('prlt workspace remove', () => {
    beforeEach(async () => {
      await execHuman(`workspace add ${testWorkspace1}`);
      await execHuman(`workspace add ${testWorkspace2}`);
    });

    it('should unregister workspace by name', async () => {
      const output = await execHuman('workspace remove workspace-one');

      expect(output).to.include('Unregistered workspace');
      expect(output).to.include('NOT deleted');

      // Verify files still exist
      expect(fs.existsSync(testWorkspace1)).to.be.true;

      // Verify removed from config
      const configPath = path.join(testDir, '.proletariat', 'config.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(config.headquarters).to.have.length(1);
      expect(config.headquarters[0].name).to.equal('workspace-two');
    });

    it('should unregister workspace by path', async () => {
      const output = await execHuman(`workspace remove ${testWorkspace1}`);

      expect(output).to.include('Unregistered workspace');
    });

    it('should clear active workspace if removed', async () => {
      // workspace-one should be active (first registered)
      await execHuman('workspace remove workspace-one');

      const configPath = path.join(testDir, '.proletariat', 'config.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(config.activeHeadquarters).to.be.null;
    });

    it('should reject non-existent workspace', async () => {
      const output = await execHuman('workspace remove nonexistent');

      expect(output).to.include('Workspace not found');
    });
  });

  // Output mode: HUMAN-READABLE TEXT (via execHuman / PRLT_FORCE_TEXT=1)
  describe('workspace registration in prlt new', () => {
    it('should auto-register workspace on new', async () => {
      // This would require full new flow which is interactive
      // Just verify the machine config can be created via add command
      await execHuman(`workspace add ${testWorkspace1}`);

      const configPath = path.join(testDir, '.proletariat', 'config.json');
      expect(fs.existsSync(configPath)).to.be.true;

      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(config.version).to.equal('1.0.0');
      expect(config.headquarters).to.be.an('array');
    });
  });

  // Output mode: JSON (explicit --json flag via execJson)
  describe('workspace discovery priority', () => {
    it('should use directory workspace over registry activeWorkspace', async () => {
      // Register workspace1 as active
      await execHuman(`workspace add ${testWorkspace1}`);

      // Change to workspace2 directory (but don't register it)
      process.chdir(testWorkspace2);

      // When in a workspace directory, it should use THAT workspace
      // not the registry's activeWorkspace (supports multi-agent scenarios)
      const output = await execJson('workspace list');
      const json = JSON.parse(output);

      // The activeWorkspace in the registry is still workspace1
      expect(json.activeWorkspace).to.equal(testWorkspace1);

      // But if we were running a command that uses findHQRoot(),
      // it would find workspace2 (the current directory) first
      // This is validated by the unit tests in machine-config.test.ts
    });
  });

  describe('prlt workspace prune', () => {
    // Output mode: HUMAN-READABLE TEXT (via execHuman / PRLT_FORCE_TEXT=1)
    it('should show no stale entries when all paths exist', async () => {
      await execHuman(`workspace add ${testWorkspace1}`);

      const output = await execHuman('workspace prune --dry-run');

      expect(output).to.include('No stale entries found');
    });

    // Output mode: HUMAN-READABLE TEXT (via execHuman / PRLT_FORCE_TEXT=1)
    it('should detect stale workspace registrations', async () => {
      await execHuman(`workspace add ${testWorkspace1}`);
      await execHuman(`workspace add ${testWorkspace2}`);

      // Delete workspace2 from disk
      fs.rmSync(testWorkspace2, { recursive: true, force: true });

      const output = await execHuman('workspace prune --dry-run');

      expect(output).to.include('Stale workspace registrations');
      expect(output).to.include('workspace-two');
      expect(output).to.include('Path no longer exists');
      expect(output).to.include('[DRY RUN]');
    });

    // Output mode: HUMAN-READABLE TEXT (via execHuman / PRLT_FORCE_TEXT=1)
    it('should remove stale entries with --force flag', async () => {
      await execHuman(`workspace add ${testWorkspace1}`);
      await execHuman(`workspace add ${testWorkspace2}`);

      // Delete workspace2 from disk
      fs.rmSync(testWorkspace2, { recursive: true, force: true });

      const output = await execHuman('workspace prune --force');

      expect(output).to.include('Pruned');
      expect(output).to.include('1 workspace registration(s)');

      // Verify workspace2 is no longer in registry
      const configPath = path.join(testDir, '.proletariat', 'config.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const hqs = (config.headquarters || config.workspaces) as Array<{ name: string; path: string }>;
      expect(hqs).to.have.length(1);
      expect(hqs[0].name).to.equal('workspace-one');
    });

    // Output mode: NON-TTY AUTO-DETECTED (via execNonTTY — no PRLT_FORCE_TEXT, no --json)
    // This test specifically verifies the non-TTY safety behavior:
    // when no --dry-run or --force is given in a non-TTY environment,
    // the CLI defaults to dry-run to prevent accidental data loss.
    it('should default to dry-run in non-TTY mode', async () => {
      await execHuman(`workspace add ${testWorkspace1}`);
      await execHuman(`workspace add ${testWorkspace2}`);

      // Delete workspace2 from disk
      fs.rmSync(testWorkspace2, { recursive: true, force: true });

      // Running without --dry-run or --force in non-TTY (execSync) should default to dry-run.
      // In non-TTY mode, the CLI outputs JSON automatically (no --json flag needed).
      const output = execNonTTY('workspace prune');
      const json = JSON.parse(output);

      expect(json.dryRun).to.be.true;
      expect(json.totalFound).to.equal(1);
      expect(json.totalRemoved).to.equal(0);
      expect(json.staleWorkspaces).to.be.an('array');
      expect(json.staleWorkspaces[0].name).to.equal('workspace-two');

      // Verify workspace2 is still in registry (not deleted)
      const configPath = path.join(testDir, '.proletariat', 'config.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const hqs = (config.headquarters || config.workspaces) as Array<{ name: string; path: string }>;
      expect(hqs).to.have.length(2);
    });

    // Output mode: JSON (explicit --json flag via execJson)
    it('should support --json flag with --dry-run', async () => {
      await execHuman(`workspace add ${testWorkspace1}`);
      await execHuman(`workspace add ${testWorkspace2}`);

      // Delete workspace2 from disk
      fs.rmSync(testWorkspace2, { recursive: true, force: true });

      const output = await execJson('workspace prune --dry-run');
      const json = JSON.parse(output);

      expect(json.dryRun).to.be.true;
      expect(json.staleWorkspaces).to.be.an('array');
      expect(json.staleWorkspaces).to.have.length(1);
      expect(json.staleWorkspaces[0].name).to.equal('workspace-two');
      expect(json.totalFound).to.equal(1);
      expect(json.totalRemoved).to.equal(0);
    });

    // Output mode: NON-TTY AUTO-DETECTED (via execNonTTY — no PRLT_FORCE_TEXT, with --json)
    // Tests that --json without --force still defaults to dry-run in non-TTY.
    it('should default to dry-run in JSON mode without --force (non-TTY)', async () => {
      await execHuman(`workspace add ${testWorkspace1}`);
      await execHuman(`workspace add ${testWorkspace2}`);

      // Delete workspace2 from disk
      fs.rmSync(testWorkspace2, { recursive: true, force: true });

      // In non-TTY (execSync), --json without --force defaults to dry-run.
      const output = execNonTTY('workspace prune --json');
      const json = JSON.parse(output);

      expect(json.dryRun).to.be.true;
      expect(json.totalFound).to.equal(1);
      expect(json.totalRemoved).to.equal(0);
    });

    // Output mode: JSON (explicit --json flag via execJson)
    it('should report totalRemoved when pruning with --force --json', async () => {
      await execHuman(`workspace add ${testWorkspace1}`);
      await execHuman(`workspace add ${testWorkspace2}`);

      // Delete workspace2 from disk
      fs.rmSync(testWorkspace2, { recursive: true, force: true });

      const output = await execJson('workspace prune --force');
      const json = JSON.parse(output);

      expect(json.dryRun).to.be.false;
      expect(json.totalFound).to.equal(1);
      expect(json.totalRemoved).to.equal(1);
    });

    // Output mode: HUMAN-READABLE TEXT (via execHuman / PRLT_FORCE_TEXT=1)
    it('should not delete anything with --dry-run even when --force is set', async () => {
      await execHuman(`workspace add ${testWorkspace1}`);
      await execHuman(`workspace add ${testWorkspace2}`);

      // Delete workspace2 from disk
      fs.rmSync(testWorkspace2, { recursive: true, force: true });

      const output = await execHuman('workspace prune --dry-run --force');

      expect(output).to.include('[DRY RUN]');

      // Verify workspace2 is still in registry
      const configPath = path.join(testDir, '.proletariat', 'config.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const hqs = (config.headquarters || config.workspaces) as Array<{ name: string; path: string }>;
      expect(hqs).to.have.length(2);
    });
  });
});
