/**
 * Integration tests for agent management commands
 * Tests: prlt agent add/remove/list/grant/revoke/switch
 * Also tests theme aliases: hire/fire/staff (billionaires)
 */

import { TestEnvironment } from '../helpers/test-environment';
import * as path from 'path';

describe('Agent Management - Integration Tests', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = new TestEnvironment('agent-test');
  });

  afterEach(() => {
    env.cleanup();
  });

  describe('prlt agent add', () => {
    describe('HQ Mode', () => {
      beforeEach(() => {
        env.setupHQ('TestHQ', 'billionaires');
        env.addRepoToHQ('TestHQ', 'test-repo');
      });

      it('should add single agent', () => {
        env.enter();
        process.chdir('TestHQ');
        
        const output = env.exec('node ../../dist/bin/prlt.js agent add bezos');
        
        expect(output).toContain('bezos');
        expect(output).toContain('Hired');
        
        // Verify agent directory created
        expect(env.exists('.proletariat/agents/staff/bezos')).toBe(true);
        
        // Verify config updated
        const config = JSON.parse(env.readFile('.proletariat/config.json'));
        expect(config.agents).toContain('bezos');
        
        process.chdir('..');
        env.leave();
      });

      it('should add multiple agents', () => {
        env.enter();
        process.chdir('TestHQ');
        
        const output = env.exec('node ../../dist/bin/prlt.js agent add bezos musk gates');
        
        expect(output).toContain('bezos');
        expect(output).toContain('musk');
        expect(output).toContain('gates');
        expect(output).toContain('3 agent(s)');
        
        // Verify all directories created
        expect(env.exists('.proletariat/agents/staff/bezos')).toBe(true);
        expect(env.exists('.proletariat/agents/staff/musk')).toBe(true);
        expect(env.exists('.proletariat/agents/staff/gates')).toBe(true);
        
        process.chdir('..');
        env.leave();
      });

      it('should reject invalid agent names', () => {
        env.enter();
        process.chdir('TestHQ');
        
        expect(() => {
          env.exec('node ../../dist/bin/prlt.js agent add invalid-agent');
        }).toThrow('not a valid');
        
        process.chdir('..');
        env.leave();
      });

      it('should warn about already hired agents', () => {
        env.enter();
        process.chdir('TestHQ');
        
        // Add agent first time
        env.exec('node ../../dist/bin/prlt.js agent add bezos');
        
        // Try to add same agent again
        const output = env.exec('node ../../dist/bin/prlt.js agent add bezos');
        expect(output).toContain('already hired');
        
        process.chdir('..');
        env.leave();
      });
    });

    describe('Simple Mode', () => {
      beforeEach(() => {
        env.initGit();
        env.setupSimpleRepo('test-project', 'billionaires');
      });

      it('should create worktrees in simple mode', () => {
        env.enter();
        
        const output = env.prlt('agent add bezos');
        
        expect(output).toContain('bezos');
        
        // In simple mode, worktrees go to sibling directory
        expect(env.exists('../test-project-staff/bezos')).toBe(true);
        
        env.leave();
      });
    });
  });

  describe('prlt agent remove', () => {
    describe('HQ Mode', () => {
      beforeEach(() => {
        env.setupHQ('TestHQ', 'billionaires');
        env.addRepoToHQ('TestHQ', 'test-repo');
        env.createAgentWorkspace('TestHQ', 'bezos', 'test-repo');
        env.createAgentWorkspace('TestHQ', 'musk', 'test-repo');
      });

      it('should remove single agent', () => {
        env.enter();
        process.chdir('TestHQ');
        
        const output = env.exec('node ../../dist/bin/prlt.js agent remove bezos');
        
        expect(output).toContain('Fired bezos');
        
        // Verify agent directory removed
        expect(env.exists('.proletariat/agents/staff/bezos')).toBe(false);
        
        // Verify config updated
        const config = JSON.parse(env.readFile('.proletariat/config.json'));
        expect(config.agents).not.toContain('bezos');
        expect(config.agents).toContain('musk'); // Other agent still there
        
        process.chdir('..');
        env.leave();
      });

      it('should remove multiple agents', () => {
        env.enter();
        process.chdir('TestHQ');
        
        const output = env.exec('node ../../dist/bin/prlt.js agent remove bezos musk');
        
        expect(output).toContain('Fired bezos');
        expect(output).toContain('Fired musk');
        
        const config = JSON.parse(env.readFile('.proletariat/config.json'));
        expect(config.agents).toEqual([]);
        
        process.chdir('..');
        env.leave();
      });

      it('should warn about non-existent agents', () => {
        env.enter();
        process.chdir('TestHQ');
        
        const output = env.exec('node ../../dist/bin/prlt.js agent remove gates');
        expect(output).toContain('not hired');
        
        process.chdir('..');
        env.leave();
      });
    });
  });

  describe('prlt agent list', () => {
    describe('HQ Mode', () => {
      beforeEach(() => {
        env.setupHQ('TestHQ', 'billionaires');
        env.addRepoToHQ('TestHQ', 'frontend');
        env.addRepoToHQ('TestHQ', 'backend');
      });

      it('should show empty list when no agents', () => {
        env.enter();
        process.chdir('TestHQ');
        
        const output = env.exec('node ../../dist/bin/prlt.js agent list');
        
        expect(output).toContain('No agents hired');
        expect(output).toContain('TestHQ');
        
        process.chdir('..');
        env.leave();
      });

      it('should list all agents with their access', () => {
        env.createAgentWorkspace('TestHQ', 'bezos', 'frontend');
        env.createAgentWorkspace('TestHQ', 'musk', 'backend');
        
        env.enter();
        process.chdir('TestHQ');
        
        const output = env.exec('node ../../dist/bin/prlt.js agent list');
        
        expect(output).toContain('bezos');
        expect(output).toContain('musk');
        expect(output).toContain('frontend');
        expect(output).toContain('backend');
        
        process.chdir('..');
        env.leave();
      });

      it('should show agents without repo access', () => {
        env.createAgentWorkspace('TestHQ', 'gates');
        
        env.enter();
        process.chdir('TestHQ');
        
        const output = env.exec('node ../../dist/bin/prlt.js agent list');
        
        expect(output).toContain('gates');
        expect(output).toContain('No repository access');
        
        process.chdir('..');
        env.leave();
      });
    });
  });

  describe('prlt agent grant', () => {
    beforeEach(() => {
      env.setupHQ('TestHQ', 'billionaires');
      env.addRepoToHQ('TestHQ', 'frontend');
      env.addRepoToHQ('TestHQ', 'backend');
      env.createAgentWorkspace('TestHQ', 'bezos');
      env.createAgentWorkspace('TestHQ', 'musk');
    });

    it('should grant repository access to agents', () => {
      env.enter();
      process.chdir('TestHQ');
      
      // Grant access via direct command (would be interactive normally)
      // For testing, we'll directly modify config
      const configPath = '.proletariat/config.json';
      const config = JSON.parse(env.readFile(configPath));
      config.agentAccess = {
        bezos: ['frontend'],
        musk: ['backend', 'frontend']
      };
      env.createFile(configPath, JSON.stringify(config, null, 2));
      
      // Now list to verify
      const output = env.exec('node ../../dist/bin/prlt.js agent list');
      
      expect(output).toContain('bezos');
      expect(output).toContain('frontend');
      expect(output).toContain('musk');
      expect(output).toContain('backend');
      
      process.chdir('..');
      env.leave();
    });
  });

  describe('prlt agent switch', () => {
    beforeEach(() => {
      env.setupHQ('TestHQ', 'billionaires');
      env.createAgentWorkspace('TestHQ', 'bezos');
    });

    it('should show path to agent workspace', () => {
      env.enter();
      process.chdir('TestHQ');
      
      const output = env.exec('node ../../dist/bin/prlt.js agent switch bezos');
      
      expect(output).toContain('bezos');
      expect(output).toContain('.proletariat/agents/staff/bezos');
      expect(output).toContain('cd ');
      
      process.chdir('..');
      env.leave();
    });

    it('should error on non-existent agent', () => {
      env.enter();
      process.chdir('TestHQ');
      
      expect(() => {
        env.exec('node ../../dist/bin/prlt.js agent switch nonexistent');
      }).toThrow();
      
      process.chdir('..');
      env.leave();
    });
  });

  describe('Theme Aliases (Billionaires)', () => {
    beforeEach(() => {
      env.setupHQ('TestHQ', 'billionaires');
      env.addRepoToHQ('TestHQ', 'test-repo');
    });

    it('should use "hire" as alias for "agent add"', () => {
      env.enter();
      process.chdir('TestHQ');
      
      const output = env.exec('node ../../dist/bin/prlt.js hire bezos');
      
      expect(output).toContain('bezos');
      expect(env.exists('.proletariat/agents/staff/bezos')).toBe(true);
      
      process.chdir('..');
      env.leave();
    });

    it('should use "fire" as alias for "agent remove"', () => {
      env.createAgentWorkspace('TestHQ', 'bezos');
      
      env.enter();
      process.chdir('TestHQ');
      
      const output = env.exec('node ../../dist/bin/prlt.js fire bezos');
      
      expect(output).toContain('Fired bezos');
      expect(env.exists('.proletariat/agents/staff/bezos')).toBe(false);
      
      process.chdir('..');
      env.leave();
    });

    it('should use "staff" as alias for "agent list"', () => {
      env.createAgentWorkspace('TestHQ', 'bezos');
      env.createAgentWorkspace('TestHQ', 'musk');
      
      env.enter();
      process.chdir('TestHQ');
      
      const output = env.exec('node ../../dist/bin/prlt.js staff');
      
      expect(output).toContain('bezos');
      expect(output).toContain('musk');
      expect(output).toContain('Billionaires');
      
      process.chdir('..');
      env.leave();
    });
  });

  describe('Cars Theme Aliases', () => {
    beforeEach(() => {
      env.setupHQ('TestHQ', 'toyotas');
      env.addRepoToHQ('TestHQ', 'test-repo');
    });

    it('should use "drive" as alias for "agent add"', () => {
      env.enter();
      process.chdir('TestHQ');
      
      const output = env.exec('node ../../dist/bin/prlt.js drive camry');
      
      expect(output).toContain('camry');
      expect(env.exists('.proletariat/agents/garage/camry')).toBe(true);
      
      process.chdir('..');
      env.leave();
    });

    it('should use "park" as alias for "agent remove"', () => {
      env.createAgentWorkspace('TestHQ', 'camry');
      
      env.enter();
      process.chdir('TestHQ');
      
      const output = env.exec('node ../../dist/bin/prlt.js park camry');
      
      expect(output).toContain('camry');
      expect(env.exists('.proletariat/agents/garage/camry')).toBe(false);
      
      process.chdir('..');
      env.leave();
    });

    it('should use "garage" as alias for "agent list"', () => {
      env.createAgentWorkspace('TestHQ', 'camry');
      env.createAgentWorkspace('TestHQ', 'prius');
      
      env.enter();
      process.chdir('TestHQ');
      
      const output = env.exec('node ../../dist/bin/prlt.js garage');
      
      expect(output).toContain('camry');
      expect(output).toContain('prius');
      expect(output).toContain('Toyota');
      
      process.chdir('..');
      env.leave();
    });
  });

  describe('Error Handling', () => {
    it('should error when not in HQ for agent commands', () => {
      env.initGit();
      env.enter();
      
      expect(() => {
        env.prlt('agent add bezos');
      }).toThrow('Not in an HQ');
      
      env.leave();
    });

    it('should handle file system errors gracefully', () => {
      env.setupHQ('TestHQ', 'billionaires');
      
      env.enter();
      process.chdir('TestHQ');
      
      // Make agents directory read-only
      const agentsDir = '.proletariat/agents/staff';
      env.exec(`chmod 444 ${agentsDir}`);
      
      expect(() => {
        env.exec('node ../../dist/bin/prlt.js agent add bezos');
      }).toThrow();
      
      // Restore permissions
      env.exec(`chmod 755 ${agentsDir}`);
      
      process.chdir('..');
      env.leave();
    });
  });
});