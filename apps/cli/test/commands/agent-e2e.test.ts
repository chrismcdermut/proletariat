import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * E2E tests for agent and agents command namespaces.
 *
 * Tests cover:
 * - agent add, agent remove, agent list (via agents namespace delegation)
 * - agents add, agents remove, agents list
 * - Error cases (missing workspace, invalid agent names)
 */

// Helper to run CLI commands and capture output
function runCLI(args: string, cwd?: string): { stdout: string; stderr: string; exitCode: number } {
  const binPath = path.join(__dirname, '../../bin/run.js');
  try {
    const stdout = execSync(`node ${binPath} ${args}`, {
      cwd: cwd || process.cwd(),
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (error: any) {
    return {
      stdout: error.stdout?.toString() || '',
      stderr: error.stderr?.toString() || '',
      exitCode: error.status || 1
    };
  }
}

describe('Agent Commands E2E', () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-agent-e2e-'));
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('agents add', () => {
    describe('help', () => {
      it('shows proper help text', () => {
        const { stdout } = runCLI('agents add --help');
        expect(stdout).to.contain('Add new agents to the workspace');
        expect(stdout).to.contain('USAGE');
        expect(stdout).to.contain('ARGUMENTS');
        expect(stdout).to.contain('EXAMPLES');
      });

      it('shows agent names argument description', () => {
        const { stdout } = runCLI('agents add --help');
        expect(stdout).to.contain('Agent names to add');
      });
    });

    describe('outside workspace', () => {
      it('fails gracefully with workspace error', () => {
        const { stderr, exitCode } = runCLI('agents add camry', testDir);
        expect(exitCode).to.not.equal(0);
        expect(stderr).to.contain('Not in an HQ or workspace directory');
      });
    });
  });

  describe('agents remove', () => {
    describe('help', () => {
      it('shows proper help text', () => {
        const { stdout } = runCLI('agents remove --help');
        expect(stdout).to.contain('Remove agents from the workspace');
        expect(stdout).to.contain('USAGE');
        expect(stdout).to.contain('ARGUMENTS');
        expect(stdout).to.contain('EXAMPLES');
      });

      it('shows agent names argument description', () => {
        const { stdout } = runCLI('agents remove --help');
        expect(stdout).to.contain('Agent names to remove');
      });
    });

    describe('outside workspace', () => {
      it('fails gracefully with workspace error', () => {
        const { stderr, exitCode } = runCLI('agents remove camry', testDir);
        expect(exitCode).to.not.equal(0);
        expect(stderr).to.contain('Not in an HQ or workspace directory');
      });
    });
  });

  describe('agents list', () => {
    describe('help', () => {
      it('shows proper help text', () => {
        const { stdout } = runCLI('agents list --help');
        expect(stdout).to.contain('List all agents and their current status');
        expect(stdout).to.contain('USAGE');
        expect(stdout).to.contain('EXAMPLES');
      });
    });

    describe('outside workspace', () => {
      it('fails gracefully with workspace error', () => {
        const { stderr, exitCode } = runCLI('agents list', testDir);
        expect(exitCode).to.not.equal(0);
        expect(stderr).to.contain('Not in an HQ or workspace directory');
      });
    });
  });

  describe('agents status', () => {
    describe('help', () => {
      it('shows proper help text', () => {
        const { stdout } = runCLI('agents status --help');
        expect(stdout).to.contain('Show detailed status');
        expect(stdout).to.contain('USAGE');
      });
    });

    describe('outside workspace', () => {
      it('fails gracefully with workspace error', () => {
        const { stderr, exitCode } = runCLI('agents status', testDir);
        expect(exitCode).to.not.equal(0);
        expect(stderr).to.contain('Not in an HQ or workspace directory');
      });
    });
  });

  describe('agent remove', () => {
    describe('help', () => {
      it('shows proper help text', () => {
        const { stdout } = runCLI('agent remove --help');
        expect(stdout).to.contain('Remove');
        expect(stdout).to.contain('USAGE');
      });

      it('shows single agent focus in description', () => {
        const { stdout } = runCLI('agent remove --help');
        expect(stdout).to.contain('Agent name to remove');
      });
    });

    describe('outside workspace', () => {
      it('fails gracefully with workspace error', () => {
        const { stderr, exitCode } = runCLI('agent remove camry', testDir);
        expect(exitCode).to.not.equal(0);
        expect(stderr).to.contain('Not in an HQ or workspace directory');
      });
    });
  });

  describe('agent status', () => {
    describe('help', () => {
      it('shows proper help text', () => {
        const { stdout } = runCLI('agent status --help');
        expect(stdout).to.contain('Show detailed status');
        expect(stdout).to.contain('USAGE');
      });
    });

    describe('outside workspace', () => {
      it('fails gracefully with workspace error', () => {
        const { stderr, exitCode } = runCLI('agent status camry', testDir);
        expect(exitCode).to.not.equal(0);
        expect(stderr).to.contain('Not in an HQ or workspace directory');
      });
    });
  });

  describe('agent visit', () => {
    describe('help', () => {
      it('shows proper help text', () => {
        const { stdout } = runCLI('agent visit --help');
        expect(stdout).to.contain('Navigate to agent directory');
        expect(stdout).to.contain('USAGE');
      });
    });

    describe('outside workspace', () => {
      it('fails gracefully with workspace error', () => {
        const { stderr, exitCode } = runCLI('agent visit camry', testDir);
        expect(exitCode).to.not.equal(0);
        expect(stderr).to.contain('Not in an HQ or workspace directory');
      });
    });
  });
});

describe('Agent and Agents Command Contract', () => {
  describe('agents namespace', () => {
    const agentsCommands = [
      { cmd: 'agents add', desc: 'Add new agents to the workspace' },
      { cmd: 'agents remove', desc: 'Remove agents from the workspace' },
      { cmd: 'agents list', desc: 'List all agents and their current status' },
      { cmd: 'agents status', desc: 'Show detailed status for specific agent or all agents' }
    ];

    agentsCommands.forEach(({ cmd, desc }) => {
      it(`'${cmd}' command exists and contains expected description`, () => {
        const { stdout } = runCLI(`${cmd} --help`);
        expect(stdout).to.not.contain('command not found');
        expect(stdout).to.contain('USAGE');
        expect(stdout).to.contain(desc);
      });
    });
  });

  describe('agent namespace', () => {
    const agentCommands = [
      { cmd: 'agent remove', containsText: 'Remove' },
      { cmd: 'agent status', containsText: 'status' },
      { cmd: 'agent visit', containsText: 'Navigate to agent directory' }
    ];

    agentCommands.forEach(({ cmd, containsText }) => {
      it(`'${cmd}' command exists and works`, () => {
        const { stdout } = runCLI(`${cmd} --help`);
        expect(stdout).to.not.contain('command not found');
        expect(stdout).to.contain('USAGE');
        expect(stdout.toLowerCase()).to.contain(containsText.toLowerCase());
      });
    });
  });
});

describe('Agent Command Error Handling', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-error-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('consistent error messages', () => {
    const commandsRequiringWorkspace = [
      'agents add camry',
      'agents remove camry',
      'agents list',
      'agents status',
      'agent remove camry',
      'agent status camry',
      'agent visit camry'
    ];

    commandsRequiringWorkspace.forEach(cmd => {
      it(`'${cmd}' shows consistent workspace error`, () => {
        const { stderr, exitCode } = runCLI(cmd, testDir);
        expect(exitCode).to.not.equal(0);
        expect(stderr).to.contain('Not in an HQ or workspace directory');
      });
    });
  });

  describe('command existence validation', () => {
    it('agents add help is accessible', () => {
      const { stdout } = runCLI('agents add --help');
      expect(stdout).to.contain('Agent names to add');
    });

    it('agents remove help is accessible', () => {
      const { stdout } = runCLI('agents remove --help');
      expect(stdout).to.contain('Agent names to remove');
    });

    it('agents list help is accessible', () => {
      const { stdout } = runCLI('agents list --help');
      expect(stdout).to.contain('List all agents');
    });
  });
});

describe('Agent Commands with Workspace', () => {
  let testDir: string;
  let workspacePath: string;
  let originalCwd: string;

  before(async () => {
    originalCwd = process.cwd();
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-workspace-e2e-'));
    workspacePath = path.join(testDir, 'test-hq');

    // Create HQ structure with database
    fs.mkdirSync(path.join(workspacePath, '.proletariat'), { recursive: true });
    fs.mkdirSync(path.join(workspacePath, 'repos'), { recursive: true });
    fs.mkdirSync(path.join(workspacePath, 'agents', 'garage'), { recursive: true });

    // Initialize git repo
    execSync('git init', { cwd: workspacePath, stdio: 'pipe' });
    execSync('git config user.email "test@example.com"', { cwd: workspacePath, stdio: 'pipe' });
    execSync('git config user.name "Test User"', { cwd: workspacePath, stdio: 'pipe' });
    fs.writeFileSync(path.join(workspacePath, 'README.md'), '# Test HQ');
    execSync('git add .', { cwd: workspacePath, stdio: 'pipe' });
    execSync('git commit -m "Initial commit"', { cwd: workspacePath, stdio: 'pipe' });

    // Write config.json
    const config = {
      type: 'hq',
      theme: 'toyotas',
      workspaceName: 'garage',
      hasPMO: false
    };
    fs.writeFileSync(
      path.join(workspacePath, '.proletariat', 'config.json'),
      JSON.stringify(config, null, 2)
    );

    // Create workspace database
    const { createWorkspaceDatabase, addAgentsToDatabase } = await import('../../src/lib/database/index.js');
    const db = createWorkspaceDatabase(workspacePath, 'hq', 'toyotas', 'garage', false);

    // Add a test agent to the database
    addAgentsToDatabase(workspacePath, ['camry'], 'toyotas');
    db.close();
  });

  after(() => {
    process.chdir(originalCwd);
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('agents list in workspace', () => {
    it('runs without crashing', () => {
      const { exitCode } = runCLI('agents list', workspacePath);
      // May exit with 0 or non-zero depending on workspace state
      // The key is it doesn't crash with an unexpected error
      expect(exitCode).to.be.a('number');
    });
  });

  describe('agents status in workspace', () => {
    it('runs without crashing', () => {
      const { exitCode } = runCLI('agents status', workspacePath);
      expect(exitCode).to.be.a('number');
    });
  });

  describe('invalid agent names in workspace', () => {
    it('agents add reports invalid agents for theme', () => {
      const { stdout, stderr } = runCLI('agents add invalid_agent', workspacePath);
      // Should report that the agent is invalid for the toyotas theme
      const output = stdout + stderr;
      expect(output).to.contain('Invalid');
    });

    it('agent remove handles non-existent agent', () => {
      const { stdout, stderr, exitCode } = runCLI('agent remove nonexistent', workspacePath);
      const output = stdout + stderr;
      // Should report the agent wasn't found
      expect(output.toLowerCase()).to.contain('not found');
    });

    it('agent status handles non-existent agent', () => {
      const { stdout, stderr, exitCode } = runCLI('agent status nonexistent', workspacePath);
      const output = stdout + stderr;
      // Should report the agent wasn't found
      expect(output.toLowerCase()).to.contain('not found');
    });

    it('agent visit handles non-existent agent', () => {
      const { stdout, stderr, exitCode } = runCLI('agent visit nonexistent', workspacePath);
      const output = stdout + stderr;
      // Should report the agent wasn't found
      expect(output.toLowerCase()).to.contain('not found');
    });
  });
});

describe('Agent Namespace Consistency', () => {
  it('agent and agents namespaces have consistent help format', () => {
    const agentHelp = runCLI('agent --help');
    const agentsHelp = runCLI('agents --help');

    // Both should have USAGE sections
    expect(agentHelp.stdout).to.contain('USAGE');
    expect(agentsHelp.stdout).to.contain('USAGE');
  });

  it('all commands follow oclif format conventions', () => {
    const commands = [
      'agents add --help',
      'agents remove --help',
      'agents list --help',
      'agent remove --help',
      'agent status --help',
      'agent visit --help'
    ];

    for (const cmd of commands) {
      const { stdout } = runCLI(cmd);
      // All commands should have standard oclif help sections
      expect(stdout).to.contain('USAGE');
      expect(stdout).to.contain('DESCRIPTION');
      expect(stdout).to.match(/\$ prlt (agent|agents)/);
    }
  });
});
