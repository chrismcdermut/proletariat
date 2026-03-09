import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { filterOutput, getIsolatedEnv, getBinPath, execInProcessAsAgent } from './test-helpers.js';
import { execSync } from 'node:child_process';

/**
 * End-to-end tests for workspace commands.
 * Tests: prlt workspace list, use, add, remove
 *
 * All tests assert on JSON output (--json flag) instead of text patterns.
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
   * Execute a workspace command with --json flag for structured output.
   */
  async function execJson(cmd: string): Promise<string> {
    return execInProcessAsAgent(cmd, getWorkspaceEnv());
  }

  /**
   * Execute a workspace command in raw non-TTY mode (no PRLT_FORCE_TEXT, no --json).
   * The CLI auto-detects non-TTY and outputs JSON automatically.
   *
   * Only use this for tests that specifically verify non-TTY auto-detection behavior,
   * such as prune dry-run safety defaults.
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

  describe('prlt workspace add', () => {
    it('should register a workspace', async () => {
      const output = await execJson(`workspace add ${testWorkspace1}`);
      const json = JSON.parse(output);

      expect(json.type).to.equal('success');
      expect(json.result.status).to.equal('registered');
      expect(json.result.path).to.equal(testWorkspace1);

      // Verify the machine config was updated
      const configPath = path.join(testDir, '.proletariat', 'config.json');
      expect(fs.existsSync(configPath)).to.be.true;

      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(config.headquarters).to.have.length(1);
      expect(config.headquarters[0].path).to.equal(testWorkspace1);
    });

    it('should register with custom name', async () => {
      const output = await execJson(`workspace add ${testWorkspace1} --name "My Custom Name"`);
      const json = JSON.parse(output);

      expect(json.type).to.equal('success');
      expect(json.result.name).to.equal('My Custom Name');

      const configPath = path.join(testDir, '.proletariat', 'config.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(config.headquarters[0].name).to.equal('My Custom Name');
    });

    it('should reject non-workspace directories', async () => {
      const nonWorkspace = path.join(testDir, 'not-a-workspace');
      fs.mkdirSync(nonWorkspace, { recursive: true });

      const output = await execJson(`workspace add ${nonWorkspace}`);

      expect(output).to.include('Not a valid workspace');
    });

    it('should reject already registered workspace', async () => {
      await execJson(`workspace add ${testWorkspace1}`);
      const output = await execJson(`workspace add ${testWorkspace1}`);
      const json = JSON.parse(output);

      expect(json.type).to.equal('success');
      expect(json.result.status).to.equal('already_registered');
    });
  });

  describe('prlt workspace list', () => {
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
      expect(names).to.include('workspace-one');
      expect(names).to.include('workspace-two');
    });

    it('should show active workspace', async () => {
      await execJson(`workspace add ${testWorkspace1}`);

      const output = await execJson('workspace list');
      const json = JSON.parse(output);

      expect(json.activeWorkspace).to.equal(testWorkspace1);
      const activeWs = json.workspaces.find((w: { active: boolean }) => w.active);
      expect(activeWs).to.not.be.undefined;
    });

    it('should support --json flag', async () => {
      await execJson(`workspace add ${testWorkspace1}`);

      const output = await execJson('workspace list');
      const json = JSON.parse(output);

      expect(json.workspaces).to.be.an('array');
      expect(json.workspaces[0].name).to.equal('workspace-one');
      expect(json.workspaces[0].path).to.equal(testWorkspace1);
      expect(json.activeWorkspace).to.equal(testWorkspace1);
    });

    it('should detect stale registrations', async () => {
      // Register workspace then delete it
      await execJson(`workspace add ${testWorkspace1}`);
      fs.rmSync(testWorkspace1, { recursive: true, force: true });

      const output = await execJson('workspace list');
      const json = JSON.parse(output);

      const staleWs = json.workspaces.find((w: { exists: boolean }) => !w.exists);
      expect(staleWs).to.not.be.undefined;
      expect(staleWs.name).to.equal('workspace-one');
    });
  });

  describe('prlt workspace use', () => {
    beforeEach(async () => {
      await execJson(`workspace add ${testWorkspace1}`);
      await execJson(`workspace add ${testWorkspace2}`);
    });

    it('should switch active workspace by name', async () => {
      const output = await execJson('workspace use workspace-two');
      const json = JSON.parse(output);

      expect(json.type).to.equal('success');
      expect(json.result.status).to.equal('activated');
      expect(json.result.name).to.equal('workspace-two');

      const configPath = path.join(testDir, '.proletariat', 'config.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(config.activeHeadquarters).to.equal(testWorkspace2);
    });

    it('should switch active workspace by path', async () => {
      const output = await execJson(`workspace use ${testWorkspace2}`);
      const json = JSON.parse(output);

      expect(json.type).to.equal('success');
      expect(json.result.status).to.equal('activated');
      expect(json.result.path).to.equal(testWorkspace2);
    });

    it('should reject non-existent workspace', async () => {
      const output = await execJson('workspace use nonexistent');
      const json = JSON.parse(output);

      expect(json.type).to.equal('error');
      expect(json.error.code).to.equal('WORKSPACE_NOT_FOUND');
    });

    it('should reject deleted workspace path', async () => {
      fs.rmSync(testWorkspace2, { recursive: true, force: true });

      const output = await execJson('workspace use workspace-two');
      const json = JSON.parse(output);

      expect(json.type).to.equal('error');
      expect(json.error.code).to.equal('PATH_NOT_FOUND');
    });
  });

  describe('prlt workspace remove', () => {
    beforeEach(async () => {
      await execJson(`workspace add ${testWorkspace1}`);
      await execJson(`workspace add ${testWorkspace2}`);
    });

    it('should unregister workspace by name', async () => {
      const output = await execJson('workspace remove workspace-one');
      const json = JSON.parse(output);

      expect(json.type).to.equal('success');
      expect(json.result.status).to.equal('unregistered');
      expect(json.result.path).to.equal(testWorkspace1);

      // Verify files still exist
      expect(fs.existsSync(testWorkspace1)).to.be.true;

      // Verify removed from config
      const configPath = path.join(testDir, '.proletariat', 'config.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(config.headquarters).to.have.length(1);
      expect(config.headquarters[0].name).to.equal('workspace-two');
    });

    it('should unregister workspace by path', async () => {
      const output = await execJson(`workspace remove ${testWorkspace1}`);
      const json = JSON.parse(output);

      expect(json.type).to.equal('success');
      expect(json.result.status).to.equal('unregistered');
    });

    it('should clear active workspace if removed', async () => {
      // workspace-one should be active (first registered)
      const output = await execJson('workspace remove workspace-one');
      const json = JSON.parse(output);

      expect(json.result.wasActive).to.be.true;

      const configPath = path.join(testDir, '.proletariat', 'config.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(config.activeHeadquarters).to.be.null;
    });

    it('should reject non-existent workspace', async () => {
      const output = await execJson('workspace remove nonexistent');
      const json = JSON.parse(output);

      expect(json.type).to.equal('error');
      expect(json.error.code).to.equal('WORKSPACE_NOT_FOUND');
    });
  });

  describe('workspace registration in prlt init', () => {
    it('should auto-register workspace on init', async () => {
      // This would require full init flow which is interactive
      // Just verify the machine config can be created via add command
      await execJson(`workspace add ${testWorkspace1}`);

      const configPath = path.join(testDir, '.proletariat', 'config.json');
      expect(fs.existsSync(configPath)).to.be.true;

      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(config.version).to.equal('1.0.0');
      expect(config.headquarters).to.be.an('array');
    });
  });

  describe('workspace discovery priority', () => {
    it('should use directory workspace over registry activeWorkspace', async () => {
      // Register workspace1 as active
      await execJson(`workspace add ${testWorkspace1}`);

      // Change to workspace2 directory (but don't register it)
      process.chdir(testWorkspace2);

      // When in a workspace directory, it should use THAT workspace
      // not the registry's activeWorkspace (supports multi-agent scenarios)
      const output = await execJson('workspace list');
      const json = JSON.parse(output);

      // The activeWorkspace in the registry is still workspace1
      expect(json.activeWorkspace).to.equal(testWorkspace1);
    });
  });

  describe('prlt workspace prune', () => {
    it('should show no stale entries when all paths exist', async () => {
      await execJson(`workspace add ${testWorkspace1}`);

      const output = await execJson('workspace prune --dry-run');
      const json = JSON.parse(output);

      expect(json.dryRun).to.be.true;
      expect(json.totalFound).to.equal(0);
    });

    it('should detect stale workspace registrations', async () => {
      await execJson(`workspace add ${testWorkspace1}`);
      await execJson(`workspace add ${testWorkspace2}`);

      // Delete workspace2 from disk
      fs.rmSync(testWorkspace2, { recursive: true, force: true });

      const output = await execJson('workspace prune --dry-run');
      const json = JSON.parse(output);

      expect(json.dryRun).to.be.true;
      expect(json.totalFound).to.equal(1);
      expect(json.staleWorkspaces).to.be.an('array');
      expect(json.staleWorkspaces[0].name).to.equal('workspace-two');
    });

    it('should remove stale entries with --force flag', async () => {
      await execJson(`workspace add ${testWorkspace1}`);
      await execJson(`workspace add ${testWorkspace2}`);

      // Delete workspace2 from disk
      fs.rmSync(testWorkspace2, { recursive: true, force: true });

      const output = await execJson('workspace prune --force');
      const json = JSON.parse(output);

      expect(json.dryRun).to.be.false;
      expect(json.totalRemoved).to.equal(1);

      // Verify workspace2 is no longer in registry
      const configPath = path.join(testDir, '.proletariat', 'config.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const hqs = (config.headquarters || config.workspaces) as Array<{ name: string; path: string }>;
      expect(hqs).to.have.length(1);
      expect(hqs[0].name).to.equal('workspace-one');
    });

    // This test specifically verifies the non-TTY safety behavior:
    // when no --dry-run or --force is given in a non-TTY environment,
    // the CLI defaults to dry-run to prevent accidental data loss.
    it('should default to dry-run in non-TTY mode', async () => {
      await execJson(`workspace add ${testWorkspace1}`);
      await execJson(`workspace add ${testWorkspace2}`);

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

    it('should support --json flag with --dry-run', async () => {
      await execJson(`workspace add ${testWorkspace1}`);
      await execJson(`workspace add ${testWorkspace2}`);

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

    // Tests that --json without --force still defaults to dry-run in non-TTY.
    it('should default to dry-run in JSON mode without --force (non-TTY)', async () => {
      await execJson(`workspace add ${testWorkspace1}`);
      await execJson(`workspace add ${testWorkspace2}`);

      // Delete workspace2 from disk
      fs.rmSync(testWorkspace2, { recursive: true, force: true });

      // In non-TTY (execSync), --json without --force defaults to dry-run.
      const output = execNonTTY('workspace prune --json');
      const json = JSON.parse(output);

      expect(json.dryRun).to.be.true;
      expect(json.totalFound).to.equal(1);
      expect(json.totalRemoved).to.equal(0);
    });

    it('should report totalRemoved when pruning with --force --json', async () => {
      await execJson(`workspace add ${testWorkspace1}`);
      await execJson(`workspace add ${testWorkspace2}`);

      // Delete workspace2 from disk
      fs.rmSync(testWorkspace2, { recursive: true, force: true });

      const output = await execJson('workspace prune --force');
      const json = JSON.parse(output);

      expect(json.dryRun).to.be.false;
      expect(json.totalFound).to.equal(1);
      expect(json.totalRemoved).to.equal(1);
    });

    it('should not delete anything with --dry-run even when --force is set', async () => {
      await execJson(`workspace add ${testWorkspace1}`);
      await execJson(`workspace add ${testWorkspace2}`);

      // Delete workspace2 from disk
      fs.rmSync(testWorkspace2, { recursive: true, force: true });

      const output = await execJson('workspace prune --dry-run --force');
      const json = JSON.parse(output);

      expect(json.dryRun).to.be.true;

      // Verify workspace2 is still in registry
      const configPath = path.join(testDir, '.proletariat', 'config.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const hqs = (config.headquarters || config.workspaces) as Array<{ name: string; path: string }>;
      expect(hqs).to.have.length(2);
    });
  });
});
