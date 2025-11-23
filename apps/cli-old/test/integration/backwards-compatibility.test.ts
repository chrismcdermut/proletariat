/**
 * Backwards Compatibility Tests
 * Ensures that existing installations continue to work after updates
 */

import { TestEnvironment } from '../helpers/test-environment';
import * as fs from 'fs';
import * as path from 'path';

describe('Backwards Compatibility - Integration Tests', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = new TestEnvironment('compat-test');
  });

  afterEach(() => {
    env.cleanup();
  });

  describe('Version 1.0.0 Configs (Original Format)', () => {
    beforeEach(() => {
      env.initGit();
      env.enter();
      
      // Create v1.0.0 config structure
      fs.mkdirSync('.proletariat');
      const v1Config = {
        projectName: 'legacy-project',
        theme: 'billionaires',
        agents: ['bezos', 'musk'],
        version: '1.0.0'
      };
      fs.writeFileSync('.proletariat/config.json', JSON.stringify(v1Config, null, 2));
      
      // Create v1 worktree structure
      const worktreePath = path.join(env.dir, '..', 'legacy-project-staff');
      fs.mkdirSync(worktreePath, { recursive: true });
      fs.mkdirSync(path.join(worktreePath, 'bezos'));
      fs.mkdirSync(path.join(worktreePath, 'musk'));
      
      env.leave();
    });

    it('should still read v1 config for status commands', () => {
      env.enter();
      
      // These commands should work without requiring upgrade
      const output = env.prlt('staff');
      
      expect(output).toContain('bezos');
      expect(output).toContain('musk');
      
      env.leave();
    });

    it('should auto-upgrade v1 config when adding new agents', () => {
      env.enter();
      
      // Commands that modify state should trigger auto-upgrade
      const output = env.prlt('hire gates');
      
      // Should upgrade and complete the operation
      expect(output).toContain('gates');
      
      // Check that config was upgraded
      if (env.exists('.proletariat/repo.json')) {
        const newConfig = JSON.parse(env.readFile('.proletariat/repo.json'));
        expect(newConfig.version).toBe('3.0.0');
        expect(newConfig.agents).toContain('gates');
        expect(newConfig.agents).toContain('bezos'); // Preserved
        expect(newConfig.agents).toContain('musk');  // Preserved
      }
      
      env.leave();
    });

    it('should preserve existing worktrees during upgrade', () => {
      env.enter();
      
      // Manually trigger upgrade
      const output = env.prlt('upgrade');
      
      expect(output).toContain('Upgraded');
      
      // Original worktrees should still be accessible
      const statusOutput = env.prlt('staff');
      expect(statusOutput).toContain('bezos');
      expect(statusOutput).toContain('musk');
      
      // Worktree directories should still exist
      expect(env.exists('../legacy-project-staff/bezos')).toBe(true);
      expect(env.exists('../legacy-project-staff/musk')).toBe(true);
      
      env.leave();
    });
  });

  describe('Version 2.0.0 Configs (Theme Object Format)', () => {
    beforeEach(() => {
      env.initGit();
      env.enter();
      
      // Create v2.0.0 config structure
      fs.mkdirSync('.proletariat');
      const v2Config = {
        version: '2.0.0',
        projectName: 'v2-project',
        themeName: 'billionaires',
        theme: {
          name: 'billionaires',
          directory: 'staff',
          commands: {
            create: 'hire',
            remove: 'fire',
            list: 'staff'
          },
          agents: ['altman', 'bezos', 'gates', 'musk']
        },
        agents: ['bezos', 'gates'],
        workspaceRoot: path.join(env.dir, '..', 'v2-project-staff')
      };
      fs.writeFileSync('.proletariat/config.json', JSON.stringify(v2Config, null, 2));
      
      env.leave();
    });

    it('should read v2 config correctly', () => {
      env.enter();
      
      const output = env.prlt('staff');
      
      expect(output).toContain('bezos');
      expect(output).toContain('gates');
      
      env.leave();
    });

    it('should upgrade v2 to v3 format', () => {
      env.enter();
      
      const output = env.prlt('upgrade');
      
      expect(output).toContain('Upgraded');
      
      // Check new format
      const newConfig = JSON.parse(env.readFile('.proletariat/repo.json'));
      expect(newConfig.version).toBe('3.0.0');
      expect(newConfig.type).toBe('simple');
      expect(newConfig.theme).toBe('billionaires');
      expect(newConfig.agents).toEqual(['bezos', 'gates']);
      
      env.leave();
    });
  });

  describe('HQ Mode Compatibility', () => {
    it('should upgrade simple repos to HQ when migrating', () => {
      env.initGit();
      env.setupSimpleRepo('simple-project', 'billionaires');
      env.enter();
      
      // Add some agents first
      const configPath = '.proletariat/repo.json';
      const config = JSON.parse(env.readFile(configPath));
      config.agents = ['bezos', 'musk'];
      env.createFile(configPath, JSON.stringify(config, null, 2));
      
      // Migrate to HQ
      const output = env.prlt('migrate TestHQ');
      
      expect(output).toContain('Migrated');
      
      // Check HQ structure
      expect(env.exists('../TestHQ')).toBe(true);
      expect(env.exists('../TestHQ/.proletariat/config.json')).toBe(true);
      
      const hqConfig = JSON.parse(
        fs.readFileSync(path.join(env.dir, '..', 'TestHQ', '.proletariat', 'config.json'), 'utf-8')
      );
      expect(hqConfig.type).toBe('hq');
      expect(hqConfig.version).toBe('3.0.0');
      
      env.leave();
    });

    it('should handle mixed version repos in same HQ', () => {
      // Create HQ with v3
      env.setupHQ('MixedHQ', 'billionaires');
      
      // Add a v3 repo
      env.addRepoToHQ('MixedHQ', 'modern-repo');
      
      // Create a v1 repo to be added
      const v1RepoPath = path.join(env.dir, 'v1-repo');
      fs.mkdirSync(v1RepoPath);
      env.exec(`git init`, { cwd: v1RepoPath });
      fs.mkdirSync(path.join(v1RepoPath, '.proletariat'));
      fs.writeFileSync(
        path.join(v1RepoPath, '.proletariat', 'config.json'),
        JSON.stringify({
          version: '1.0.0',
          projectName: 'v1-repo',
          theme: 'billionaires',
          agents: ['jobs']
        })
      );
      
      env.enter();
      process.chdir('MixedHQ');
      
      // Try to add the v1 repo
      const output = env.exec(`node ../../dist/bin/prlt.js repo add ${v1RepoPath}`);
      
      // Should handle the mixed versions gracefully
      expect(output).toContain('v1-repo');
      
      process.chdir('..');
      env.leave();
    });
  });

  describe('Breaking Changes Protection', () => {
    it('should warn about incompatible theme changes', () => {
      env.initGit();
      env.enter();
      
      // Create config with cars theme
      fs.mkdirSync('.proletariat');
      const config = {
        version: '3.0.0',
        type: 'simple',
        projectName: 'car-project',
        theme: 'toyotas',
        agents: ['camry', 'prius'],
        workspaceRoot: '../car-project-garage'
      };
      fs.writeFileSync('.proletariat/repo.json', JSON.stringify(config, null, 2));
      
      // Try to use billionaire commands (wrong theme)
      expect(() => {
        env.prlt('hire bezos');
      }).toThrow(); // Should fail - wrong theme
      
      // Correct theme command should work
      const output = env.prlt('drive tacoma');
      expect(output).not.toThrow();
      
      env.leave();
    });

    it('should handle corrupt configs gracefully', () => {
      env.initGit();
      env.enter();
      
      fs.mkdirSync('.proletariat');
      
      // Write corrupt JSON
      fs.writeFileSync('.proletariat/repo.json', '{ invalid json }');
      
      expect(() => {
        env.prlt('list');
      }).toThrow(/JSON/);
      
      // Write partially valid config (missing required fields)
      fs.writeFileSync('.proletariat/repo.json', JSON.stringify({
        version: '3.0.0'
        // Missing required fields
      }));
      
      expect(() => {
        env.prlt('list');
      }).toThrow();
      
      env.leave();
    });
  });

  describe('Data Preservation Tests', () => {
    it('should never lose agent data during upgrade', () => {
      env.initGit();
      env.enter();
      
      // Create v1 config with agents
      fs.mkdirSync('.proletariat');
      const originalAgents = ['bezos', 'musk', 'gates', 'jobs'];
      fs.writeFileSync('.proletariat/config.json', JSON.stringify({
        version: '1.0.0',
        projectName: 'preserve-test',
        theme: 'billionaires',
        agents: originalAgents
      }));
      
      // Upgrade
      env.prlt('upgrade');
      
      // All agents should be preserved
      const newConfig = JSON.parse(env.readFile('.proletariat/repo.json'));
      expect(newConfig.agents).toEqual(originalAgents);
      
      env.leave();
    });

    it('should preserve custom workspace paths', () => {
      env.initGit();
      env.enter();
      
      const customPath = '/tmp/custom-workspaces';
      
      // Create v2 config with custom workspace
      fs.mkdirSync('.proletariat');
      fs.writeFileSync('.proletariat/config.json', JSON.stringify({
        version: '2.0.0',
        projectName: 'custom-path-project',
        themeName: 'billionaires',
        theme: { name: 'billionaires' },
        agents: ['bezos'],
        workspaceRoot: customPath
      }));
      
      // Upgrade
      env.prlt('upgrade');
      
      // Custom path should be preserved
      const newConfig = JSON.parse(env.readFile('.proletariat/repo.json'));
      expect(newConfig.workspaceRoot).toBe(customPath);
      
      env.leave();
    });

    it('should create backup before any destructive upgrade', () => {
      env.initGit();
      env.enter();
      
      // Create original config
      fs.mkdirSync('.proletariat');
      const originalConfig = {
        version: '1.0.0',
        projectName: 'backup-test',
        theme: 'billionaires',
        agents: ['bezos'],
        customField: 'should-be-backed-up'
      };
      fs.writeFileSync('.proletariat/config.json', JSON.stringify(originalConfig, null, 2));
      
      // Upgrade
      env.prlt('upgrade');
      
      // Backup should exist
      expect(env.exists('.proletariat/config.json.backup')).toBe(true);
      
      // Backup should contain original data
      const backup = JSON.parse(env.readFile('.proletariat/config.json.backup'));
      expect(backup.customField).toBe('should-be-backed-up');
      expect(backup.version).toBe('1.0.0');
      
      env.leave();
    });
  });

  describe('Feature Detection', () => {
    it('should detect available features based on version', () => {
      env.initGit();
      env.enter();
      
      // V1 doesn't support HQ mode
      fs.mkdirSync('.proletariat');
      fs.writeFileSync('.proletariat/config.json', JSON.stringify({
        version: '1.0.0',
        projectName: 'v1-project',
        theme: 'billionaires',
        agents: []
      }));
      
      // HQ commands should fail or prompt upgrade
      expect(() => {
        env.prlt('repo add test-repo');
      }).toThrow(/HQ|upgrade/i);
      
      env.leave();
    });

    it('should provide clear upgrade prompts for new features', () => {
      env.initGit();
      env.enter();
      
      // Old version config
      fs.mkdirSync('.proletariat');
      fs.writeFileSync('.proletariat/config.json', JSON.stringify({
        version: '2.0.0',
        projectName: 'needs-upgrade',
        themeName: 'billionaires',
        theme: { name: 'billionaires' },
        agents: []
      }));
      
      // Try to use v3 feature (PMO)
      expect(() => {
        env.prlt('ticket create');
      }).toThrow(/upgrade|not available/i);
      
      env.leave();
    });
  });

  describe('Version-Specific Command Behavior', () => {
    it('should handle theme commands across versions', () => {
      const configs = [
        {
          version: '1.0.0',
          content: {
            version: '1.0.0',
            projectName: 'v1-test',
            theme: 'billionaires',
            agents: []
          }
        },
        {
          version: '2.0.0',
          content: {
            version: '2.0.0',
            projectName: 'v2-test',
            themeName: 'billionaires',
            theme: { name: 'billionaires' },
            agents: []
          }
        },
        {
          version: '3.0.0',
          content: {
            version: '3.0.0',
            type: 'simple',
            projectName: 'v3-test',
            theme: 'billionaires',
            agents: []
          }
        }
      ];

      configs.forEach(({ version, content }) => {
        // Fresh environment for each version
        const vEnv = new TestEnvironment(`version-${version}`);
        vEnv.initGit();
        vEnv.enter();
        
        fs.mkdirSync('.proletariat');
        const configFile = version === '3.0.0' ? 'repo.json' : 'config.json';
        fs.writeFileSync(`.proletariat/${configFile}`, JSON.stringify(content, null, 2));
        
        // Theme commands should work for all versions
        const output = vEnv.prlt('list');
        expect(output).toContain('bezos'); // All versions should list billionaire agents
        
        vEnv.leave();
        vEnv.cleanup();
      });
    });
  });
});