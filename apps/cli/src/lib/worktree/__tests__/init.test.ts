import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { initProject } from '../index';

// Mock external dependencies
jest.mock('fs');
jest.mock('child_process');
jest.mock('inquirer');
jest.mock('../../config/index', () => ({
  getProjectRoot: jest.fn(),
  getProjectName: jest.fn(),
  isInitialized: jest.fn(),
  loadConfig: jest.fn(),
  saveConfig: jest.fn(),
  resolveWorkspace: jest.fn(),
}));
jest.mock('../../utils/logger', () => ({
  log: {
    info: jest.fn(),
    success: jest.fn(),
    warning: jest.fn(),
    error: jest.fn(),
    theme: jest.fn(),
  },
  showBanner: jest.fn(),
}));
jest.mock('../../managers/PMOManager', () => ({
  PMOManager: {
    initForHQ: jest.fn(),
  },
}));

describe('initProject', () => {
  let tempDir: string;
  
  beforeEach(() => {
    // Create temp directory for tests
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-test-'));
    
    // Reset all mocks
    jest.clearAllMocks();
    
    // Setup default mock returns
    const config = require('../../config/index');
    config.getProjectRoot.mockReturnValue(tempDir);
    config.getProjectName.mockReturnValue('test-project');
    config.isInitialized.mockReturnValue(false);
    config.resolveWorkspace.mockReturnValue({
      workspaceDir: path.join(tempDir, '.proletariat', 'agents', 'staff'),
      layout: {
        mode: 'hq',
        baseDir: path.join(tempDir, '..', 'test-project-hq'),
        hqName: 'test-project-hq'
      }
    });
    
    // Mock fs.existsSync
    (fs.existsSync as jest.Mock).mockImplementation((path) => false);
    
    // Mock fs.mkdirSync
    (fs.mkdirSync as jest.Mock).mockImplementation(() => {});
    
    // Mock fs.writeFileSync
    (fs.writeFileSync as jest.Mock).mockImplementation(() => {});
    
    // Mock fs.readFileSync for HQ config
    (fs.readFileSync as jest.Mock).mockImplementation((path) => {
      if (path.includes('config.json')) {
        return JSON.stringify({
          version: '3.0.0',
          type: 'hq',
          name: 'test-project-hq',
          theme: 'billionaires',
          themeDirectory: 'staff',
          agents: [],
          repos: [],
          agentRepoMode: 'ask'
        });
      }
      return '';
    });
    
    // Mock execSync
    (execSync as jest.Mock).mockReturnValue('');
  });

  afterEach(() => {
    // Cleanup temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('HQ mode initialization', () => {
    it('should create HQ directory structure', async () => {
      const inquirer = require('inquirer');
      inquirer.prompt.mockResolvedValueOnce({ theme: 'billionaires' })
        .mockResolvedValueOnce({ layoutChoice: 'hq' })
        .mockResolvedValueOnce({ hqName: 'test-hq' })
        .mockResolvedValueOnce({ shouldClone: false });

      await initProject({});

      // Verify HQ directories were created
      expect(fs.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('test-hq'),
        expect.objectContaining({ recursive: true })
      );
      
      // Verify agents directory with theme-specific subdirectory
      expect(fs.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining(path.join('agents', 'staff')),
        expect.objectContaining({ recursive: true })
      );
      
      // Verify repos directory
      expect(fs.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('repos'),
        expect.objectContaining({ recursive: true })
      );
    });

    it('should create HQ config file', async () => {
      const inquirer = require('inquirer');
      inquirer.prompt.mockResolvedValueOnce({ theme: 'billionaires' })
        .mockResolvedValueOnce({ layoutChoice: 'hq' })
        .mockResolvedValueOnce({ hqName: 'test-hq' })
        .mockResolvedValueOnce({ shouldClone: false });

      await initProject({});

      // Verify HQ config was written
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('config.json'),
        expect.stringContaining('"type": "hq"')
      );
    });

    it('should initialize PMO in HQ', async () => {
      const inquirer = require('inquirer');
      const { PMOManager } = require('../../managers/PMOManager');
      
      inquirer.prompt.mockResolvedValueOnce({ theme: 'billionaires' })
        .mockResolvedValueOnce({ layoutChoice: 'hq' })
        .mockResolvedValueOnce({ hqName: 'test-hq' })
        .mockResolvedValueOnce({ shouldClone: false });

      await initProject({});

      expect(PMOManager.initForHQ).toHaveBeenCalledWith(
        expect.stringContaining('test-hq')
      );
    });

    it('should offer to clone repo when git remote exists', async () => {
      const inquirer = require('inquirer');
      
      // Mock git checks
      (execSync as jest.Mock)
        .mockReturnValueOnce('') // git rev-parse (is git repo)
        .mockReturnValueOnce('https://github.com/user/repo.git'); // git remote
      
      inquirer.prompt.mockResolvedValueOnce({ theme: 'billionaires' })
        .mockResolvedValueOnce({ layoutChoice: 'hq' })
        .mockResolvedValueOnce({ hqName: 'test-hq' })
        .mockResolvedValueOnce({ shouldClone: true });

      await initProject({});

      // Verify clone was attempted
      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining('git clone'),
        expect.any(Object)
      );
    });
  });

  describe('Simple mode initialization', () => {
    it('should create simple workspace alongside repo', async () => {
      const inquirer = require('inquirer');
      const config = require('../../config/index');
      
      config.resolveWorkspace.mockReturnValue({
        workspaceDir: path.join(tempDir, '..', 'test-project-staff'),
        layout: {
          mode: 'sibling',
          baseDir: path.join(tempDir, '..', 'test-project-staff')
        }
      });
      
      inquirer.prompt.mockResolvedValueOnce({ theme: 'billionaires' })
        .mockResolvedValueOnce({ layoutChoice: 'sibling' });

      await initProject({});

      // Verify simple workspace was created
      expect(fs.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('test-project-staff'),
        expect.objectContaining({ recursive: true })
      );
      
      // Verify PMO was NOT initialized (only for HQ mode)
      const { PMOManager } = require('../../managers/PMOManager');
      expect(PMOManager.initForHQ).not.toHaveBeenCalled();
    });
  });

  describe('Backwards compatibility', () => {
    it('should detect already initialized project', async () => {
      const config = require('../../config/index');
      const { log } = require('../../utils/logger');
      
      config.isInitialized.mockReturnValue(true);
      config.loadConfig.mockReturnValue({
        projectName: 'existing-project',
        themeName: 'billionaires',
        theme: { name: 'billionaires' }
      });

      await initProject({});

      expect(log.warning).toHaveBeenCalledWith(
        expect.stringContaining('already initialized')
      );
    });
  });

  describe('Error handling', () => {
    it('should handle repos without git remotes gracefully', async () => {
      const inquirer = require('inquirer');
      const { log } = require('../../utils/logger');
      
      // Mock git check to throw (no remote)
      (execSync as jest.Mock)
        .mockReturnValueOnce('') // git rev-parse (is git repo)
        .mockImplementationOnce(() => { throw new Error('No remote'); });
      
      inquirer.prompt.mockResolvedValueOnce({ theme: 'billionaires' })
        .mockResolvedValueOnce({ layoutChoice: 'hq' })
        .mockResolvedValueOnce({ hqName: 'test-hq' })
        .mockResolvedValueOnce({ shouldClone: true });

      await initProject({});

      expect(log.warning).toHaveBeenCalledWith(
        expect.stringContaining('Could not clone')
      );
    });
  });
});