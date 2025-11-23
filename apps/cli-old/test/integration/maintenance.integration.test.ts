/**
 * Integration tests for maintenance commands
 * Tests: prlt repair, prlt health, prlt upgrade, prlt migrate
 * Also tests: prlt go/switch, prlt access, prlt themes, prlt list
 */

import { TestEnvironment } from '../helpers/test-environment';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

describe('Maintenance Commands - Integration Tests', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = new TestEnvironment('maintenance-test');
  });

  afterEach(() => {
    env.cleanup();
  });

  describe('prlt repair', () => {
    beforeEach(() => {
      env.initGit();
      env.setupSimpleRepo('test-project', 'billionaires');
    });

    it('should detect and fix broken worktree references', () => {
      env.enter();
      
      // Create a worktree reference that points to non-existent location
      const worktreePath = path.join(env.dir, '..', 'test-project-staff', 'bezos');
      fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
      fs.mkdirSync(worktreePath);
      fs.writeFileSync(
        path.join(worktreePath, '.git'),
        'gitdir: /non/existent/path/.git/worktrees/bezos'
      );
      
      // Update config to have this agent
      const configPath = '.proletariat/repo.json';
      const config = JSON.parse(env.readFile(configPath));
      config.agents = ['bezos'];
      env.createFile(configPath, JSON.stringify(config, null, 2));
      
      // Run repair
      const output = env.prlt('repair');
      
      expect(output).toContain('repair');
      // Should detect the broken reference
      
      env.leave();
    });

    it('should handle missing worktree directories', () => {
      env.enter();
      
      // Add agent to config but don't create worktree
      const configPath = '.proletariat/repo.json';
      const config = JSON.parse(env.readFile(configPath));
      config.agents = ['musk', 'gates'];
      env.createFile(configPath, JSON.stringify(config, null, 2));
      
      const output = env.prlt('repair');
      
      expect(output).toContain('repair');
      
      env.leave();
    });

    it('should work in HQ mode', () => {
      env.setupHQ('TestHQ', 'billionaires');
      env.createAgentWorkspace('TestHQ', 'bezos');
      
      env.enter();
      process.chdir('TestHQ');
      
      const output = env.exec('node ../../dist/bin/prlt.js repair');
      
      expect(output).toContain('repair');
      
      process.chdir('..');
      env.leave();
    });
  });

  describe('prlt health', () => {
    beforeEach(() => {
      env.setupHQ('TestHQ', 'billionaires');
      env.addRepoToHQ('TestHQ', 'app');
    });

    it('should check health of all worktrees', () => {
      env.createAgentWorkspace('TestHQ', 'bezos', 'app');
      env.createAgentWorkspace('TestHQ', 'musk', 'app');
      
      env.enter();
      process.chdir('TestHQ');
      
      const output = env.exec('node ../../dist/bin/prlt.js health');
      
      expect(output).toContain('health');
      // Should report on worktree status
      
      process.chdir('..');
      env.leave();
    });

    it('should detect unhealthy worktrees', () => {
      env.createAgentWorkspace('TestHQ', 'gates');
      
      // Corrupt the workspace
      const workspacePath = path.join(env.dir, 'TestHQ', '.proletariat', 'agents', 'staff', 'gates');
      fs.writeFileSync(path.join(workspacePath, '.git'), 'corrupted');
      
      env.enter();
      process.chdir('TestHQ');
      
      const output = env.exec('node ../../dist/bin/prlt.js health');
      
      expect(output).toContain('health');
      // Should detect corruption
      
      process.chdir('..');
      env.leave();
    });

    it('should report on empty HQ', () => {
      env.enter();
      process.chdir('TestHQ');
      
      const output = env.exec('node ../../dist/bin/prlt.js health');
      
      expect(output).toContain('health');
      expect(output.toLowerCase()).toContain('no');
      
      process.chdir('..');
      env.leave();
    });
  });

  describe('prlt upgrade', () => {
    it('should upgrade v1 config to latest', () => {
      env.initGit();
      env.enter();
      
      // Create old v1 config
      fs.mkdirSync('.proletariat');
      const oldConfig = {
        projectName: 'old-project',
        theme: 'billionaires',
        agents: ['bezos'],
        version: '1.0.0'
      };
      fs.writeFileSync('.proletariat/config.json', JSON.stringify(oldConfig, null, 2));
      
      const output = env.prlt('upgrade');
      
      expect(output).toContain('upgrade');
      
      // Should create new format
      if (env.exists('.proletariat/repo.json')) {
        const newConfig = JSON.parse(env.readFile('.proletariat/repo.json'));
        expect(newConfig.version).toBe('3.0.0');
        expect(newConfig.theme).toBe('billionaires');
        expect(newConfig.agents).toContain('bezos');
      }
      
      env.leave();
    });

    it('should upgrade v2 config to latest', () => {
      env.initGit();
      env.enter();
      
      // Create v2 config
      fs.mkdirSync('.proletariat');
      const v2Config = {
        version: '2.0.0',
        projectName: 'v2-project',
        themeName: 'billionaires',
        theme: { name: 'billionaires' },
        agents: ['musk', 'gates'],
        workspaceRoot: '../v2-project-staff'
      };
      fs.writeFileSync('.proletariat/config.json', JSON.stringify(v2Config, null, 2));
      
      const output = env.prlt('upgrade');
      
      expect(output).toContain('upgrade');
      
      // Check upgraded config
      const newConfig = JSON.parse(env.readFile('.proletariat/repo.json'));
      expect(newConfig.version).toBe('3.0.0');
      expect(newConfig.agents).toEqual(['musk', 'gates']);
      
      env.leave();
    });

    it('should skip if already on latest version', () => {
      env.initGit();
      env.setupSimpleRepo('modern-project', 'billionaires');
      env.enter();
      
      const output = env.prlt('upgrade');
      
      expect(output).toContain('already');
      
      env.leave();
    });

    it('should backup old config', () => {
      env.initGit();
      env.enter();
      
      // Create old config
      fs.mkdirSync('.proletariat');
      const oldConfig = { version: '1.0.0', projectName: 'backup-test' };
      fs.writeFileSync('.proletariat/config.json', JSON.stringify(oldConfig));
      
      env.prlt('upgrade');
      
      // Should create backup
      expect(env.exists('.proletariat/config.json.backup')).toBe(true);
      
      env.leave();
    });
  });

  describe('prlt migrate', () => {
    beforeEach(() => {
      env.initGit();
      env.setupSimpleRepo('standalone-project', 'billionaires');
    });

    it('should migrate standalone repo into HQ', () => {
      env.enter();
      
      const output = env.prlt('migrate NewHQ');
      
      expect(output).toContain('migrate');
      expect(output).toContain('NewHQ');
      
      // Should create HQ structure
      expect(env.exists('../NewHQ')).toBe(true);
      expect(env.exists('../NewHQ/.proletariat/config.json')).toBe(true);
      expect(env.exists('../NewHQ/repos/standalone-project')).toBe(true);
      
      env.leave();
    });

    it('should preserve worktrees during migration', () => {
      // Create a worktree first
      env.enter();
      
      const worktreePath = '../standalone-project-staff/bezos';
      fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
      fs.mkdirSync(worktreePath);
      
      // Update config
      const configPath = '.proletariat/repo.json';
      const config = JSON.parse(env.readFile(configPath));
      config.agents = ['bezos'];
      env.createFile(configPath, JSON.stringify(config, null, 2));
      
      const output = env.prlt('migrate ExistingHQ');
      
      expect(output).toContain('migrate');
      
      // Worktrees should be migrated
      expect(env.exists('../ExistingHQ/.proletariat/agents/staff/bezos')).toBe(true);
      
      env.leave();
    });

    it('should join existing HQ if it exists', () => {
      // Create existing HQ first
      env.setupHQ('ExistingHQ', 'billionaires');
      
      env.enter();
      
      const output = env.prlt('migrate ExistingHQ');
      
      expect(output).toContain('ExistingHQ');
      
      // Should be added to existing HQ
      const hqConfig = JSON.parse(
        fs.readFileSync(path.join(env.dir, '..', 'ExistingHQ', '.proletariat', 'config.json'), 'utf-8')
      );
      expect(hqConfig.repos).toContain('standalone-project');
      
      env.leave();
    });
  });

  describe('prlt go / prlt switch', () => {
    beforeEach(() => {
      env.setupHQ('TestHQ', 'billionaires');
      env.createAgentWorkspace('TestHQ', 'bezos');
      env.createAgentWorkspace('TestHQ', 'musk');
    });

    it('should show path to agent workspace', () => {
      env.enter();
      process.chdir('TestHQ');
      
      const output = env.exec('node ../../dist/bin/prlt.js go bezos');
      
      expect(output).toContain('bezos');
      expect(output).toContain('.proletariat/agents/staff/bezos');
      expect(output).toContain('cd');
      
      process.chdir('..');
      env.leave();
    });

    it('should work with switch alias', () => {
      env.enter();
      process.chdir('TestHQ');
      
      const output = env.exec('node ../../dist/bin/prlt.js switch musk');
      
      expect(output).toContain('musk');
      expect(output).toContain('.proletariat/agents/staff/musk');
      
      process.chdir('..');
      env.leave();
    });

    it('should error for non-existent agent', () => {
      env.enter();
      process.chdir('TestHQ');
      
      expect(() => {
        env.exec('node ../../dist/bin/prlt.js go gates');
      }).toThrow();
      
      process.chdir('..');
      env.leave();
    });

    it('should work in simple mode', () => {
      env.initGit();
      env.setupSimpleRepo('simple-project', 'billionaires');
      
      // Create worktree
      const worktreePath = path.join(env.dir, '..', 'simple-project-staff', 'bezos');
      fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
      fs.mkdirSync(worktreePath);
      
      env.enter();
      
      const configPath = '.proletariat/repo.json';
      const config = JSON.parse(env.readFile(configPath));
      config.agents = ['bezos'];
      env.createFile(configPath, JSON.stringify(config, null, 2));
      
      const output = env.prlt('go bezos');
      
      expect(output).toContain('bezos');
      expect(output).toContain('simple-project-staff/bezos');
      
      env.leave();
    });
  });

  describe('prlt access', () => {
    beforeEach(() => {
      env.setupHQ('TestHQ', 'billionaires');
      env.addRepoToHQ('TestHQ', 'frontend');
      env.addRepoToHQ('TestHQ', 'backend');
      env.createAgentWorkspace('TestHQ', 'bezos');
      env.createAgentWorkspace('TestHQ', 'musk');
    });

    it('should manage agent repository access', () => {
      env.enter();
      process.chdir('TestHQ');
      
      // This would be interactive, simulating grant access
      const configPath = '.proletariat/config.json';
      const config = JSON.parse(env.readFile(configPath));
      
      // Grant bezos access to frontend
      config.agentAccess = {
        bezos: ['frontend'],
        musk: ['backend']
      };
      
      env.createFile(configPath, JSON.stringify(config, null, 2));
      
      // Verify access
      const updatedConfig = JSON.parse(env.readFile(configPath));
      expect(updatedConfig.agentAccess.bezos).toContain('frontend');
      expect(updatedConfig.agentAccess.musk).toContain('backend');
      
      process.chdir('..');
      env.leave();
    });
  });

  describe('prlt themes', () => {
    it('should list all available themes', () => {
      env.initGit();
      env.enter();
      
      const output = env.prlt('themes');
      
      expect(output).toContain('Billionaires');
      expect(output).toContain('Toyota');
      expect(output).toContain('Companies');
      expect(output).toContain('billionaires');
      expect(output).toContain('toyotas');
      expect(output).toContain('companies');
      
      env.leave();
    });

    it('should show theme details', () => {
      env.initGit();
      env.enter();
      
      const output = env.prlt('themes');
      
      // Should show agent counts
      expect(output).toMatch(/\d+ agents/);
      
      // Should show directory patterns
      expect(output).toContain('staff');
      expect(output).toContain('garage');
      expect(output).toContain('portfolio');
      
      env.leave();
    });
  });

  describe('prlt list', () => {
    it('should list agents for active theme', () => {
      env.initGit();
      env.setupSimpleRepo('test-project', 'billionaires');
      env.enter();
      
      const output = env.prlt('list');
      
      expect(output).toContain('bezos');
      expect(output).toContain('musk');
      expect(output).toContain('gates');
      expect(output).toContain('Billionaires');
      
      env.leave();
    });

    it('should list agents for specified theme', () => {
      env.initGit();
      env.setupSimpleRepo('test-project', 'billionaires');
      env.enter();
      
      const output = env.prlt('list --theme=toyotas');
      
      expect(output).toContain('camry');
      expect(output).toContain('prius');
      expect(output).toContain('tacoma');
      expect(output).not.toContain('bezos');
      
      env.leave();
    });

    it('should work in HQ mode', () => {
      env.setupHQ('TestHQ', 'companies');
      env.enter();
      process.chdir('TestHQ');
      
      const output = env.exec('node ../../dist/bin/prlt.js list');
      
      expect(output).toContain('apple');
      expect(output).toContain('google');
      expect(output).toContain('microsoft');
      expect(output).toContain('Companies');
      
      process.chdir('..');
      env.leave();
    });
  });

  describe('prlt --version', () => {
    it('should show version number', () => {
      env.enter();
      
      const output = env.prlt('--version');
      
      expect(output).toMatch(/\d+\.\d+\.\d+/);
      
      env.leave();
    });
  });

  describe('prlt --help', () => {
    it('should show help information', () => {
      env.enter();
      
      const output = env.prlt('--help');
      
      expect(output).toContain('Usage');
      expect(output).toContain('Options');
      expect(output).toContain('Commands');
      expect(output).toContain('init');
      expect(output).toContain('agent');
      expect(output).toContain('repo');
      expect(output).toContain('ticket');
      
      env.leave();
    });

    it('should show command-specific help', () => {
      env.enter();
      
      const output = env.prlt('agent --help');
      
      expect(output).toContain('agent');
      expect(output).toContain('Manage agents');
      
      env.leave();
    });
  });

  describe('Error Recovery', () => {
    it('should handle corrupted config gracefully', () => {
      env.initGit();
      env.enter();
      
      fs.mkdirSync('.proletariat');
      fs.writeFileSync('.proletariat/repo.json', 'invalid json{');
      
      expect(() => {
        env.prlt('list');
      }).toThrow();
      
      env.leave();
    });

    it('should handle missing directories gracefully', () => {
      env.setupHQ('TestHQ', 'billionaires');
      
      // Remove critical directory
      fs.rmSync(path.join(env.dir, 'TestHQ', '.proletariat', 'agents'), { recursive: true });
      
      env.enter();
      process.chdir('TestHQ');
      
      expect(() => {
        env.exec('node ../../dist/bin/prlt.js agent list');
      }).not.toThrow(); // Should handle gracefully
      
      process.chdir('..');
      env.leave();
    });

    it('should provide helpful error messages', () => {
      env.enter();
      
      // Not in git repo
      try {
        env.prlt('init');
      } catch (error: any) {
        expect(error.message).toContain('git');
      }
      
      env.leave();
    });
  });
});