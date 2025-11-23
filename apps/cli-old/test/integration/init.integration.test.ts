/**
 * Integration tests for `prlt init` command
 * Tests actual command execution end-to-end
 */

import { TestEnvironment } from '../helpers/test-environment';

describe('prlt init - Integration Tests', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = new TestEnvironment('init-test');
  });

  afterEach(() => {
    env.cleanup();
  });

  describe('Simple Mode Initialization', () => {
    it('should initialize a simple workspace with billionaires theme', () => {
      env.initGit();
      env.enter();
      
      // Run init command with theme flag
      const output = env.prlt('init --theme=billionaires');
      
      // Verify output
      expect(output).toContain('Billionaires');
      
      // Verify config file created
      expect(env.exists('.proletariat/repo.json')).toBe(true);
      
      // Verify config content
      const config = JSON.parse(env.readFile('.proletariat/repo.json'));
      expect(config.type).toBe('simple');
      expect(config.theme).toBe('billionaires');
      expect(config.agents).toEqual([]);
      
      env.leave();
    });

    it('should initialize with cars theme', () => {
      env.initGit();
      env.enter();
      
      const output = env.prlt('init --theme=toyotas');
      
      expect(output).toContain('Toyota');
      
      const config = JSON.parse(env.readFile('.proletariat/repo.json'));
      expect(config.theme).toBe('toyotas');
      
      env.leave();
    });

    it('should initialize with companies theme', () => {
      env.initGit();
      env.enter();
      
      const output = env.prlt('init --theme=companies');
      
      expect(output).toContain('Companies');
      
      const config = JSON.parse(env.readFile('.proletariat/repo.json'));
      expect(config.theme).toBe('companies');
      
      env.leave();
    });

    it('should fail if not in a git repository', () => {
      env.enter();
      
      expect(() => {
        env.prlt('init --theme=billionaires');
      }).toThrow('Not in a git repository');
      
      env.leave();
    });

    it('should warn if already initialized', () => {
      env.initGit();
      env.setupSimpleRepo('test-project');
      env.enter();
      
      const output = env.prlt('init --theme=billionaires');
      
      expect(output).toContain('already initialized');
      
      env.leave();
    });
  });

  describe('HQ Mode Initialization', () => {
    it('should create HQ directory structure', () => {
      env.initGit();
      env.enter();
      
      const output = env.prlt('init --hq TestCompany --theme=billionaires');
      
      // Verify output
      expect(output).toContain('TestCompany');
      expect(output).toContain('HQ');
      
      // Verify HQ structure created
      expect(env.exists('../TestCompany')).toBe(true);
      expect(env.exists('../TestCompany/.proletariat/config.json')).toBe(true);
      expect(env.exists('../TestCompany/repos')).toBe(true);
      expect(env.exists('../TestCompany/.proletariat/agents/staff')).toBe(true);
      expect(env.exists('../TestCompany/pmo')).toBe(true);
      
      // Verify HQ config
      const config = JSON.parse(env.readFile('../TestCompany/.proletariat/config.json'));
      expect(config.type).toBe('hq');
      expect(config.name).toBe('TestCompany');
      expect(config.theme).toBe('billionaires');
      expect(config.repos).toEqual([]);
      expect(config.agents).toEqual([]);
      
      env.leave();
    });

    it('should join existing HQ', () => {
      env.initGit();
      
      // Create existing HQ
      env.setupHQ('ExistingHQ');
      
      // Create new repo
      const repoPath = path.join(env.dir, 'new-repo');
      fs.mkdirSync(repoPath);
      execSync('git init', { cwd: repoPath, stdio: 'pipe' });
      
      // Join HQ from new repo
      process.chdir(repoPath);
      const output = env.exec(`node ${path.join(env.dir, '..', 'dist', 'bin', 'prlt.js')} init --hq ExistingHQ`);
      
      expect(output).toContain('Joined existing HQ');
      expect(fs.existsSync(path.join(env.dir, 'ExistingHQ', 'repos', 'new-repo'))).toBe(true);
      
      process.chdir(env.originalCwd);
    });

    it('should initialize HQ with custom workspace root', () => {
      env.initGit();
      env.enter();
      
      const customPath = path.join(env.dir, 'custom-workspaces');
      const output = env.prlt(`init --hq MyHQ --workspace-root ${customPath} --theme=billionaires`);
      
      expect(output).toContain('MyHQ');
      expect(env.exists(customPath)).toBe(true);
      
      env.leave();
    });

    it('should prompt to clone repo into HQ if git remote exists', () => {
      env.initGit();
      env.enter();
      
      // Add a fake remote
      env.exec('git remote add origin https://github.com/test/repo.git');
      
      // Should offer to clone (we'll decline in non-interactive test)
      const output = env.prlt('init --hq TestHQ --theme=billionaires --no-clone');
      
      expect(output).toContain('TestHQ');
      // Repo should not be in HQ since we used --no-clone
      expect(env.exists('../TestHQ/repos/repo')).toBe(false);
      
      env.leave();
    });
  });

  describe('Theme Selection', () => {
    it('should accept valid theme names', () => {
      env.initGit();
      env.enter();
      
      const themes = ['billionaires', 'toyotas', 'companies'];
      
      for (const theme of themes) {
        // Clean up previous init
        if (env.exists('.proletariat')) {
          fs.rmSync(path.join(env.dir, '.proletariat'), { recursive: true });
        }
        
        const output = env.prlt(`init --theme=${theme}`);
        expect(output).not.toContain('Invalid theme');
        
        const config = JSON.parse(env.readFile('.proletariat/repo.json'));
        expect(config.theme).toBe(theme);
      }
      
      env.leave();
    });

    it('should reject invalid theme names', () => {
      env.initGit();
      env.enter();
      
      expect(() => {
        env.prlt('init --theme=invalid-theme');
      }).toThrow();
      
      env.leave();
    });
  });

  describe('Workspace Layout Options', () => {
    it('should create sibling layout by default', () => {
      env.initGit();
      env.enter();
      
      env.prlt('init --theme=billionaires');
      
      const config = JSON.parse(env.readFile('.proletariat/repo.json'));
      expect(config.workspaceRoot).toContain('-staff');
      
      env.leave();
    });

    it('should allow custom workspace root', () => {
      env.initGit();
      env.enter();
      
      const customPath = '/tmp/my-workspaces';
      env.prlt(`init --theme=billionaires --workspace-root ${customPath}`);
      
      const config = JSON.parse(env.readFile('.proletariat/repo.json'));
      expect(config.workspaceRoot).toBe(customPath);
      
      env.leave();
    });
  });

  describe('PMO Initialization', () => {
    it('should initialize PMO when creating HQ', () => {
      env.initGit();
      env.enter();
      
      env.prlt('init --hq TestHQ --theme=billionaires');
      
      // Verify PMO structure
      expect(env.exists('../TestHQ/pmo')).toBe(true);
      expect(env.exists('../TestHQ/pmo/README.md')).toBe(true);
      expect(env.exists('../TestHQ/pmo/KANBAN.md')).toBe(true);
      expect(env.exists('../TestHQ/pmo/tickets.json')).toBe(true);
      
      env.leave();
    });

    it('should not initialize PMO for simple mode', () => {
      env.initGit();
      env.enter();
      
      env.prlt('init --theme=billionaires');
      
      expect(env.exists('pmo')).toBe(false);
      
      env.leave();
    });
  });

  describe('Error Scenarios', () => {
    it('should handle missing git repository', () => {
      env.enter();
      
      expect(() => {
        env.prlt('init');
      }).toThrow('Not in a git repository');
      
      env.leave();
    });

    it('should handle permission errors gracefully', () => {
      env.initGit();
      env.enter();
      
      // Create read-only directory
      const roPath = path.join(env.dir, 'readonly');
      fs.mkdirSync(roPath);
      fs.chmodSync(roPath, 0o444);
      
      expect(() => {
        env.prlt(`init --workspace-root ${roPath}/workspaces --theme=billionaires`);
      }).toThrow();
      
      // Cleanup
      fs.chmodSync(roPath, 0o755);
      
      env.leave();
    });

    it('should handle existing config migration', () => {
      env.initGit();
      env.enter();
      
      // Create old format config
      fs.mkdirSync('.proletariat');
      fs.writeFileSync('.proletariat/config.json', JSON.stringify({
        projectName: 'old-project',
        theme: 'billionaires',
        agents: ['bezos'],
        version: '1.0.0'
      }));
      
      const output = env.prlt('init --theme=billionaires');
      
      expect(output).toContain('already initialized');
      
      env.leave();
    });
  });
});