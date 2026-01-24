import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  getMachineConfigDir,
  getMachineConfigPath,
  normalizePath,
  readMachineConfig,
  writeMachineConfig,
  registerWorkspace,
  unregisterWorkspace,
  getRegisteredWorkspaces,
  getActiveWorkspace,
  setActiveWorkspace,
  findWorkspacesByName,
  findWorkspaceByPath,
  isWorkspaceRegistered,
  getWorkspaceNameFromPath,
  hasDuplicateNames,
  MachineConfig,
} from '../../src/lib/machine-config.js';

describe('Machine Config', () => {
  let testDir: string;
  let originalHome: string | undefined;
  let testWorkspaceDir: string;

  beforeEach(() => {
    // Create a temp directory for testing
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'machine-config-test-'));

    // Save original HOME and override it
    originalHome = process.env.HOME;
    process.env.HOME = testDir;

    // Create a test workspace directory structure
    testWorkspaceDir = path.join(testDir, 'test-workspace');
    fs.mkdirSync(path.join(testWorkspaceDir, '.proletariat'), { recursive: true });
    fs.writeFileSync(
      path.join(testWorkspaceDir, '.proletariat', 'config.json'),
      JSON.stringify({ version: '1.0.0', type: 'hq', name: 'test-workspace' })
    );
  });

  afterEach(() => {
    // Restore original HOME
    if (originalHome) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }

    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('getMachineConfigDir', () => {
    it('returns ~/.proletariat path', () => {
      const configDir = getMachineConfigDir();
      expect(configDir).to.equal(path.join(testDir, '.proletariat'));
    });
  });

  describe('getMachineConfigPath', () => {
    it('returns ~/.proletariat/config.json path', () => {
      const configPath = getMachineConfigPath();
      expect(configPath).to.equal(path.join(testDir, '.proletariat', 'config.json'));
    });
  });

  describe('normalizePath', () => {
    it('expands ~ to home directory', () => {
      const result = normalizePath('~/projects/test');
      expect(result).to.equal(path.join(testDir, 'projects', 'test'));
    });

    it('resolves relative paths', () => {
      const originalCwd = process.cwd();
      process.chdir(testDir);
      try {
        const result = normalizePath('./relative/path');
        expect(result).to.equal(path.join(testDir, 'relative', 'path'));
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('removes trailing slashes', () => {
      const result = normalizePath(testDir + '/');
      expect(result.endsWith('/')).to.be.false;
    });
  });

  describe('readMachineConfig', () => {
    it('returns default config when file does not exist', () => {
      const config = readMachineConfig();
      expect(config.version).to.equal('1.0.0');
      expect(config.headquarters).to.deep.equal([]);
      expect(config.activeWorkspace).to.be.null;
    });

    it('reads existing config file', () => {
      const configDir = getMachineConfigDir();
      fs.mkdirSync(configDir, { recursive: true });

      const testConfig: MachineConfig = {
        type: 'machine',
        version: '1.0.0',
        organizations: [],
        headquarters: [
          { name: 'test', path: '/path/to/test', registeredAt: '2024-01-01T00:00:00.000Z' },
        ],
        activeHeadquarters: '/path/to/test',
        activeOrganization: null,
      };

      fs.writeFileSync(getMachineConfigPath(), JSON.stringify(testConfig));

      const config = readMachineConfig();
      expect(config.headquarters).to.have.length(1);
      expect(config.headquarters[0].name).to.equal('test');
      expect(config.activeHeadquarters).to.equal('/path/to/test');
    });

    it('returns default config when file is invalid JSON', () => {
      const configDir = getMachineConfigDir();
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(getMachineConfigPath(), 'invalid json');

      const config = readMachineConfig();
      expect(config.headquarters).to.deep.equal([]);
    });
  });

  describe('writeMachineConfig', () => {
    it('creates config directory if it does not exist', () => {
      const testConfig: MachineConfig = {
        type: 'machine',
        version: '1.0.0',
        organizations: [],
        headquarters: [],
        activeHeadquarters: null,
        activeOrganization: null,
      };

      writeMachineConfig(testConfig);

      expect(fs.existsSync(getMachineConfigPath())).to.be.true;
    });

    it('writes config atomically', () => {
      const testConfig: MachineConfig = {
        type: 'machine',
        version: '1.0.0',
        organizations: [],
        headquarters: [
          { name: 'test', path: '/path/to/test', registeredAt: '2024-01-01T00:00:00.000Z' },
        ],
        activeHeadquarters: '/path/to/test',
        activeOrganization: null,
      };

      writeMachineConfig(testConfig);

      const written = JSON.parse(fs.readFileSync(getMachineConfigPath(), 'utf-8'));
      expect(written.headquarters).to.have.length(1);
      expect(written.activeHeadquarters).to.equal('/path/to/test');
    });
  });

  describe('registerWorkspace', () => {
    it('registers a new workspace', () => {
      const entry = registerWorkspace(testWorkspaceDir, 'my-workspace');

      expect(entry.name).to.equal('my-workspace');
      expect(entry.path).to.equal(testWorkspaceDir);
      expect(entry.registeredAt).to.be.a('string');

      const config = readMachineConfig();
      expect(config.headquarters).to.have.length(1);
    });

    it('sets as active workspace when none exists', () => {
      registerWorkspace(testWorkspaceDir);

      const config = readMachineConfig();
      expect(config.activeWorkspace).to.equal(testWorkspaceDir);
    });

    it('updates existing entry instead of creating duplicate', () => {
      registerWorkspace(testWorkspaceDir, 'old-name');
      registerWorkspace(testWorkspaceDir, 'new-name');

      const config = readMachineConfig();
      expect(config.headquarters).to.have.length(1);
      expect(config.headquarters[0].name).to.equal('new-name');
    });

    it('uses directory basename as default name', () => {
      const entry = registerWorkspace(testWorkspaceDir);
      expect(entry.name).to.equal('test-workspace');
    });
  });

  describe('unregisterWorkspace', () => {
    it('removes workspace by path', () => {
      registerWorkspace(testWorkspaceDir);
      const removed = unregisterWorkspace(testWorkspaceDir);

      expect(removed).to.be.true;
      expect(getRegisteredWorkspaces()).to.have.length(0);
    });

    it('removes workspace by name', () => {
      registerWorkspace(testWorkspaceDir, 'test-workspace');
      const removed = unregisterWorkspace('test-workspace');

      expect(removed).to.be.true;
      expect(getRegisteredWorkspaces()).to.have.length(0);
    });

    it('clears active workspace if removed', () => {
      registerWorkspace(testWorkspaceDir);
      unregisterWorkspace(testWorkspaceDir);

      const config = readMachineConfig();
      expect(config.activeWorkspace).to.be.null;
    });

    it('returns false if workspace not found', () => {
      const removed = unregisterWorkspace('/nonexistent/path');
      expect(removed).to.be.false;
    });
  });

  describe('getRegisteredWorkspaces', () => {
    it('returns empty array when no workspaces registered', () => {
      const workspaces = getRegisteredWorkspaces();
      expect(workspaces).to.deep.equal([]);
    });

    it('returns all registered workspaces', () => {
      const ws2Dir = path.join(testDir, 'workspace2');
      fs.mkdirSync(path.join(ws2Dir, '.proletariat'), { recursive: true });
      fs.writeFileSync(
        path.join(ws2Dir, '.proletariat', 'config.json'),
        JSON.stringify({ version: '1.0.0', type: 'hq', name: 'workspace2' })
      );

      registerWorkspace(testWorkspaceDir, 'ws1');
      registerWorkspace(ws2Dir, 'ws2');

      const workspaces = getRegisteredWorkspaces();
      expect(workspaces).to.have.length(2);
    });
  });

  describe('getActiveWorkspace', () => {
    it('returns null when no active workspace', () => {
      const active = getActiveWorkspace();
      expect(active).to.be.null;
    });

    it('returns active workspace path', () => {
      registerWorkspace(testWorkspaceDir);
      const active = getActiveWorkspace();
      expect(active).to.equal(testWorkspaceDir);
    });
  });

  describe('setActiveWorkspace', () => {
    it('sets active workspace by path', () => {
      registerWorkspace(testWorkspaceDir, 'test', false);
      setActiveWorkspace(testWorkspaceDir);

      const active = getActiveWorkspace();
      expect(active).to.equal(testWorkspaceDir);
    });

    it('sets active workspace by name', () => {
      registerWorkspace(testWorkspaceDir, 'my-workspace', false);
      setActiveWorkspace('my-workspace');

      const active = getActiveWorkspace();
      expect(active).to.equal(testWorkspaceDir);
    });

    it('throws error if workspace not found', () => {
      expect(() => setActiveWorkspace('/nonexistent')).to.throw('Workspace not found');
    });

    it('throws error if path no longer exists', () => {
      registerWorkspace(testWorkspaceDir, 'test', false);
      fs.rmSync(testWorkspaceDir, { recursive: true, force: true });

      expect(() => setActiveWorkspace(testWorkspaceDir)).to.throw('path no longer exists');
    });

    it('throws error for ambiguous name', () => {
      const ws2Dir = path.join(testDir, 'workspace2');
      fs.mkdirSync(path.join(ws2Dir, '.proletariat'), { recursive: true });
      fs.writeFileSync(
        path.join(ws2Dir, '.proletariat', 'config.json'),
        JSON.stringify({ version: '1.0.0', type: 'hq', name: 'duplicate' })
      );

      registerWorkspace(testWorkspaceDir, 'duplicate', false);
      registerWorkspace(ws2Dir, 'duplicate', false);

      expect(() => setActiveWorkspace('duplicate')).to.throw('Multiple workspaces found');
    });
  });

  describe('findWorkspacesByName', () => {
    it('finds workspaces by name (case-insensitive)', () => {
      registerWorkspace(testWorkspaceDir, 'MyWorkspace');
      const found = findWorkspacesByName('myworkspace');
      expect(found).to.have.length(1);
      expect(found[0].name).to.equal('MyWorkspace');
    });

    it('returns empty array if not found', () => {
      const found = findWorkspacesByName('nonexistent');
      expect(found).to.deep.equal([]);
    });
  });

  describe('findWorkspaceByPath', () => {
    it('finds workspace by path', () => {
      registerWorkspace(testWorkspaceDir, 'test');
      const found = findWorkspaceByPath(testWorkspaceDir);
      expect(found).to.not.be.null;
      expect(found!.name).to.equal('test');
    });

    it('returns null if not found', () => {
      const found = findWorkspaceByPath('/nonexistent');
      expect(found).to.be.null;
    });
  });

  describe('isWorkspaceRegistered', () => {
    it('returns true for registered workspace', () => {
      registerWorkspace(testWorkspaceDir);
      expect(isWorkspaceRegistered(testWorkspaceDir)).to.be.true;
    });

    it('returns false for unregistered workspace', () => {
      expect(isWorkspaceRegistered('/nonexistent')).to.be.false;
    });
  });

  describe('getWorkspaceNameFromPath', () => {
    it('reads name from workspace config', () => {
      const name = getWorkspaceNameFromPath(testWorkspaceDir);
      expect(name).to.equal('test-workspace');
    });

    it('falls back to directory basename', () => {
      const noConfigDir = path.join(testDir, 'no-config');
      fs.mkdirSync(noConfigDir, { recursive: true });

      const name = getWorkspaceNameFromPath(noConfigDir);
      expect(name).to.equal('no-config');
    });
  });

  describe('hasDuplicateNames', () => {
    it('returns empty array when no duplicates', () => {
      registerWorkspace(testWorkspaceDir, 'unique1');
      const duplicates = hasDuplicateNames();
      expect(duplicates).to.deep.equal([]);
    });

    it('detects duplicate names', () => {
      const ws2Dir = path.join(testDir, 'workspace2');
      fs.mkdirSync(path.join(ws2Dir, '.proletariat'), { recursive: true });
      fs.writeFileSync(
        path.join(ws2Dir, '.proletariat', 'config.json'),
        JSON.stringify({ version: '1.0.0', type: 'hq', name: 'duplicate' })
      );

      registerWorkspace(testWorkspaceDir, 'duplicate', false);
      registerWorkspace(ws2Dir, 'duplicate', false);

      const duplicates = hasDuplicateNames();
      expect(duplicates).to.have.length(1);
      expect(duplicates[0].name).to.equal('duplicate');
      expect(duplicates[0].paths).to.have.length(2);
    });
  });
});
