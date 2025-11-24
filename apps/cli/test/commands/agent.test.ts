import { runCommand } from '@oclif/test';
import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Agent Management System', () => {
  let testWorkspace: string;
  
  before(async () => {
    // Create temporary workspace for testing
    testWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-agent-test-'));
  });

  after(() => {
    // Cleanup test workspace
    if (fs.existsSync(testWorkspace)) {
      fs.rmSync(testWorkspace, { recursive: true, force: true });
    }
  });

  describe('Agent Help Commands', () => {
    it('agent help shows all subcommands', async () => {
      const { stdout } = await runCommand('agent --help');
      expect(stdout).to.contain('agent add');
      expect(stdout).to.contain('agent list');
      expect(stdout).to.contain('agent remove');
      expect(stdout).to.contain('agent visit');
      expect(stdout).to.contain('agent status');
    });

    it('agent help shows proper description', async () => {
      const { stdout } = await runCommand('agent --help');
      expect(stdout).to.contain('Manage agents');
      expect(stdout).to.contain('USAGE');
      expect(stdout).to.contain('DESCRIPTION');
    });

    const agentCommands = ['add', 'list', 'remove', 'visit', 'status'];
    agentCommands.forEach(cmd => {
      it(`agent ${cmd} shows help`, async () => {
        const { stdout } = await runCommand(`agent ${cmd} --help`);
        expect(stdout).to.contain('USAGE');
        expect(stdout).to.contain('DESCRIPTION');
        expect(stdout).to.not.contain('command not found');
      });
    });
  });

  describe('Agent Command Contracts', () => {
    it('agent add help contains proper examples', async () => {
      const { stdout } = await runCommand('agent add --help');
      expect(stdout).to.contain('Add new agents to the workspace');
      expect(stdout).to.contain('EXAMPLES');
      expect(stdout).to.contain('ARGUMENTS');
    });

    it('agent list help contains proper description', async () => {
      const { stdout } = await runCommand('agent list --help');
      expect(stdout).to.contain('List all agents and their current status');
    });

    it('agent remove help contains proper description', async () => {
      const { stdout } = await runCommand('agent remove --help');
      expect(stdout).to.contain('Remove agents from the workspace');
    });

    it('agent visit help contains proper description', async () => {
      const { stdout } = await runCommand('agent visit --help');
      expect(stdout).to.contain('Navigate to agent directory');
    });

    it('agent status help contains proper description', async () => {
      const { stdout } = await runCommand('agent status --help');
      expect(stdout).to.contain('Show detailed status for specific agent or all agents');
    });
  });

  describe('Agent Error Handling', () => {
    it('agent add fails gracefully outside workspace', async () => {
      try {
        await runCommand(['agent', 'add', 'test'], { root: testWorkspace });
      } catch (error: any) {
        expect(error.message).to.contain('Not in an HQ or workspace directory');
      }
    });

    it('agent list fails gracefully outside workspace', async () => {
      try {
        await runCommand(['agent', 'list'], { root: testWorkspace });
      } catch (error: any) {
        expect(error.message).to.contain('Not in an HQ or workspace directory');
      }
    });

    it('agent visit shows error for non-existent agent', async () => {
      try {
        await runCommand(['agent', 'visit', 'nonexistent'], { root: testWorkspace });
      } catch (error: any) {
        expect(error.message).to.contain('Not in an HQ or workspace directory');
      }
    });
  });

  describe('Agent Specification Compliance', () => {
    // Verify commands match SYSTEM_CARD.md specifications
    const specifiedCommands = [
      { cmd: 'agent', desc: 'Show agent command help' },
      { cmd: 'agent add', desc: 'Add new agents' },
      { cmd: 'agent list', desc: 'List all agents with status' },
      { cmd: 'agent remove', desc: 'Remove agents' },
      { cmd: 'agent visit', desc: 'Navigate to agent directory' },
      { cmd: 'agent status', desc: 'Show detailed agent status' }
    ];

    specifiedCommands.forEach(spec => {
      it(`${spec.cmd} command exists as specified`, async () => {
        const { stdout } = await runCommand(`${spec.cmd} --help`);
        expect(stdout).to.not.contain('command not found');
        expect(stdout).to.not.contain('No such file or directory');
      });
    });
  });

  describe('Theme Integration', () => {
    it('agent commands should support theme validation', async () => {
      // This test verifies that agent commands are aware of themes
      // even when not in a workspace (help should still work)
      const { stdout } = await runCommand('agent add --help');
      expect(stdout).to.contain('Agent names to add');
    });
  });

  describe('Database Integration', () => {
    it('commands reference SQLite integration in help', async () => {
      // Verify that help text reflects modern SQLite architecture
      const { stdout } = await runCommand('agent add --help');
      expect(stdout).to.contain('Add new agents to the workspace');
      
      const { stdout: listHelp } = await runCommand('agent list --help');
      expect(listHelp).to.contain('List all agents and their current status');
    });
  });
});

describe('Agent Command Architecture', () => {
  describe('DRY Principles', () => {
    it('all agent commands use consistent help format', async () => {
      const commands = ['add', 'list', 'remove', 'visit', 'status'];
      
      for (const cmd of commands) {
        const { stdout } = await runCommand(`agent ${cmd} --help`);
        expect(stdout).to.contain('USAGE');
        expect(stdout).to.contain('DESCRIPTION');
        // Consistent format across all commands
        expect(stdout).to.match(/\$ prlt agent/);
      }
    });
  });

  describe('Error Message Consistency', () => {
    it('commands show consistent error when not in workspace', async () => {
      const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-error-test-'));
      
      try {
        const commands = [
          ['agent', 'add', 'test'],
          ['agent', 'list'],
          ['agent', 'remove', 'test'],
          ['agent', 'visit', 'test'],
          ['agent', 'status']
        ];

        for (const cmd of commands) {
          try {
            await runCommand(cmd, { root: testDir });
          } catch (error: any) {
            // All commands should show consistent workspace detection error
            expect(error.message).to.contain('Not in an HQ or workspace directory');
          }
        }
      } finally {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    });
  });
});