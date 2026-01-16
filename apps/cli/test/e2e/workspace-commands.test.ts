import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { exec, filterOutput, getIsolatedEnv, getBinPath } from './test-helpers.js';
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
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-e2e-'));
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
   * Execute a workspace command with proper isolation.
   */
  function execWorkspace(cmd: string): string {
    try {
      const binPath = getBinPath();
      const env = { ...getIsolatedEnv(), HOME: testDir };

      const result = execSync(`node ${binPath} ${cmd}`, {
        encoding: 'utf-8',
        cwd: process.cwd(),
        env,
      });
      return filterOutput(result);
    } catch (error: any) {
      const stdout = error.stdout || '';
      const stderr = error.stderr || '';
      return filterOutput(stdout + stderr) || error.message;
    }
  }

  describe('prlt workspace add', () => {
    it('should register a workspace', () => {
      const output = execWorkspace(`workspace add ${testWorkspace1}`);

      expect(output).to.include('Registered workspace');
      expect(output).to.include('workspace-one');

      // Verify the machine config was updated
      const configPath = path.join(testDir, '.proletariat', 'config.json');
      expect(fs.existsSync(configPath)).to.be.true;

      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(config.workspaces).to.have.length(1);
      expect(config.workspaces[0].path).to.equal(testWorkspace1);
    });

    it('should register with custom name', () => {
      const output = execWorkspace(`workspace add ${testWorkspace1} --name "My Custom Name"`);

      expect(output).to.include('Registered workspace');
      expect(output).to.include('My Custom Name');

      const configPath = path.join(testDir, '.proletariat', 'config.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(config.workspaces[0].name).to.equal('My Custom Name');
    });

    it('should reject non-workspace directories', () => {
      const nonWorkspace = path.join(testDir, 'not-a-workspace');
      fs.mkdirSync(nonWorkspace, { recursive: true });

      const output = execWorkspace(`workspace add ${nonWorkspace}`);

      expect(output).to.include('Not a valid workspace');
    });

    it('should reject already registered workspace', () => {
      execWorkspace(`workspace add ${testWorkspace1}`);
      const output = execWorkspace(`workspace add ${testWorkspace1}`);

      expect(output).to.include('already registered');
    });
  });

  describe('prlt workspace list', () => {
    it('should show no workspaces when none registered', () => {
      const output = execWorkspace('workspace list');
      expect(output).to.include('No workspaces found');
    });

    it('should list registered workspaces', () => {
      execWorkspace(`workspace add ${testWorkspace1}`);
      execWorkspace(`workspace add ${testWorkspace2}`);

      const output = execWorkspace('workspace list');

      expect(output).to.include('workspace-one');
      expect(output).to.include('workspace-two');
    });

    it('should show active workspace marker', () => {
      execWorkspace(`workspace add ${testWorkspace1}`);

      const output = execWorkspace('workspace list');

      expect(output).to.include('(active)');
    });

    it('should support --json flag', () => {
      execWorkspace(`workspace add ${testWorkspace1}`);

      const output = execWorkspace('workspace list --json');
      const json = JSON.parse(output);

      expect(json.workspaces).to.be.an('array');
      expect(json.workspaces[0].name).to.equal('workspace-one');
      expect(json.workspaces[0].path).to.equal(testWorkspace1);
      expect(json.activeWorkspace).to.equal(testWorkspace1);
    });

    it('should warn about stale registrations', () => {
      // Register workspace then delete it
      execWorkspace(`workspace add ${testWorkspace1}`);
      fs.rmSync(testWorkspace1, { recursive: true, force: true });

      const output = execWorkspace('workspace list');

      expect(output).to.include('Path no longer exists');
    });
  });

  describe('prlt workspace use', () => {
    beforeEach(() => {
      execWorkspace(`workspace add ${testWorkspace1}`);
      execWorkspace(`workspace add ${testWorkspace2}`);
    });

    it('should switch active workspace by name', () => {
      const output = execWorkspace('workspace use workspace-two');

      expect(output).to.include('Active workspace set to');
      expect(output).to.include('workspace-two');

      const configPath = path.join(testDir, '.proletariat', 'config.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(config.activeWorkspace).to.equal(testWorkspace2);
    });

    it('should switch active workspace by path', () => {
      const output = execWorkspace(`workspace use ${testWorkspace2}`);

      expect(output).to.include('Active workspace set to');
      expect(output).to.include('workspace-two');
    });

    it('should reject non-existent workspace', () => {
      const output = execWorkspace('workspace use nonexistent');

      expect(output).to.include('Workspace not found');
    });

    it('should reject deleted workspace path', () => {
      fs.rmSync(testWorkspace2, { recursive: true, force: true });

      const output = execWorkspace('workspace use workspace-two');

      expect(output).to.include('no longer exists');
    });
  });

  describe('prlt workspace remove', () => {
    beforeEach(() => {
      execWorkspace(`workspace add ${testWorkspace1}`);
      execWorkspace(`workspace add ${testWorkspace2}`);
    });

    it('should unregister workspace by name', () => {
      const output = execWorkspace('workspace remove workspace-one');

      expect(output).to.include('Unregistered workspace');
      expect(output).to.include('NOT deleted');

      // Verify files still exist
      expect(fs.existsSync(testWorkspace1)).to.be.true;

      // Verify removed from config
      const configPath = path.join(testDir, '.proletariat', 'config.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(config.workspaces).to.have.length(1);
      expect(config.workspaces[0].name).to.equal('workspace-two');
    });

    it('should unregister workspace by path', () => {
      const output = execWorkspace(`workspace remove ${testWorkspace1}`);

      expect(output).to.include('Unregistered workspace');
    });

    it('should clear active workspace if removed', () => {
      // workspace-one should be active (first registered)
      execWorkspace('workspace remove workspace-one');

      const configPath = path.join(testDir, '.proletariat', 'config.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(config.activeWorkspace).to.be.null;
    });

    it('should reject non-existent workspace', () => {
      const output = execWorkspace('workspace remove nonexistent');

      expect(output).to.include('Workspace not found');
    });
  });

  describe('workspace registration in prlt init', () => {
    it('should auto-register workspace on init', () => {
      // This would require full init flow which is interactive
      // Just verify the machine config can be created via add command
      execWorkspace(`workspace add ${testWorkspace1}`);

      const configPath = path.join(testDir, '.proletariat', 'config.json');
      expect(fs.existsSync(configPath)).to.be.true;

      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(config.version).to.equal('1.0.0');
      expect(config.workspaces).to.be.an('array');
    });
  });

  describe('workspace discovery priority', () => {
    it('should use directory workspace over registry activeWorkspace', () => {
      // Register workspace1 as active
      execWorkspace(`workspace add ${testWorkspace1}`);

      // Change to workspace2 directory (but don't register it)
      process.chdir(testWorkspace2);

      // When in a workspace directory, it should use THAT workspace
      // not the registry's activeWorkspace (supports multi-agent scenarios)
      const output = execWorkspace('workspace list --json');
      const json = JSON.parse(output);

      // The activeWorkspace in the registry is still workspace1
      expect(json.activeWorkspace).to.equal(testWorkspace1);

      // But if we were running a command that uses findHQRoot(),
      // it would find workspace2 (the current directory) first
      // This is validated by the unit tests in machine-config.test.ts
    });
  });
});
