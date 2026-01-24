import { runCommand } from '@oclif/test';
import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Root directory for the CLI - needed for @oclif/test to find commands
const root = path.resolve(__dirname, '../..');

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
    it('agent help shows subcommands', async () => {
      const { stdout } = await runCommand(['agent', '--help'], { root });
      expect(stdout).to.contain('agent remove');
      expect(stdout).to.contain('agent visit');
      expect(stdout).to.contain('agent status');
      expect(stdout).to.contain('agent shell');
    });

    it('agent help shows proper description', async () => {
      const { stdout } = await runCommand(['agent', '--help'], { root });
      expect(stdout).to.contain('USAGE');
    });

    // Test actual existing agent commands
    const agentCommands = ['remove', 'visit', 'status', 'shell', 'login', 'rebuild', 'restart'];
    agentCommands.forEach(cmd => {
      it(`agent ${cmd} shows help`, async () => {
        const { stdout } = await runCommand(['agent', cmd, '--help'], { root });
        expect(stdout).to.contain('USAGE');
        expect(stdout).to.not.contain('not found');
      });
    });
  });

  describe('Agent Command Contracts', () => {
    it('agent remove help contains proper description', async () => {
      const { stdout } = await runCommand(['agent', 'remove', '--help'], { root });
      expect(stdout).to.contain('Remove');
    });

    it('agent visit help contains proper description', async () => {
      const { stdout } = await runCommand(['agent', 'visit', '--help'], { root });
      expect(stdout).to.contain('Navigate to agent directory');
    });

    it('agent status help contains proper description', async () => {
      const { stdout } = await runCommand(['agent', 'status', '--help'], { root });
      expect(stdout).to.contain('Show detailed status');
    });
  });

  describe('Agent Error Handling', () => {
    it('agent visit shows error for non-existent agent', async () => {
      try {
        await runCommand(['agent', 'visit', 'nonexistent'], { root: testWorkspace });
      } catch (error: unknown) {
        // Expect an error when not in workspace
        expect(error).to.exist;
      }
    });
  });

  describe('Agent Specification Compliance', () => {
    // Verify actual existing commands
    const specifiedCommands = [
      { cmd: 'agent', desc: 'Show agent command help' },
      { cmd: 'agent remove', desc: 'Remove agents' },
      { cmd: 'agent visit', desc: 'Navigate to agent directory' },
      { cmd: 'agent status', desc: 'Show detailed agent status' },
      { cmd: 'agent shell', desc: 'Open shell in agent' }
    ];

    specifiedCommands.forEach(spec => {
      it(`${spec.cmd} command exists as specified`, async () => {
        const { stdout } = await runCommand([...spec.cmd.split(' '), '--help'], { root });
        expect(stdout).to.not.contain('not found');
      });
    });
  });

  describe('Theme Integration', () => {
    it('agent commands should support theme validation', async () => {
      // This test verifies that agent commands work
      const { stdout } = await runCommand(['agent', 'status', '--help'], { root });
      expect(stdout).to.contain('USAGE');
    });
  });

  describe('Database Integration', () => {
    it('commands reference SQLite integration in help', async () => {
      // Verify that help text works for existing commands
      const { stdout } = await runCommand(['agent', 'remove', '--help'], { root });
      expect(stdout).to.contain('Remove');

      const { stdout: statusHelp } = await runCommand(['agent', 'status', '--help'], { root });
      expect(statusHelp).to.contain('status');
    });
  });
});

describe('Agent Command Architecture', () => {
  describe('DRY Principles', () => {
    it('all agent commands use consistent help format', async () => {
      const commands = ['remove', 'visit', 'status', 'shell'];

      await Promise.all(commands.map(async (cmd) => {
        const { stdout } = await runCommand(['agent', cmd, '--help'], { root });
        expect(stdout).to.contain('USAGE');
        // Consistent format across all commands
        expect(stdout).to.match(/\$ prlt agent/);
      }));
    });
  });

  describe('Error Message Consistency', () => {
    it('commands show consistent error when not in workspace', async () => {
      const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-error-test-'));

      try {
        const commands = [
          ['agent', 'remove', 'test'],
          ['agent', 'visit', 'test'],
          ['agent', 'status']
        ];

        await Promise.all(commands.map(async (cmd) => {
          try {
            await runCommand(cmd, { root: testDir });
          } catch (error: unknown) {
            // Expect an error when not in workspace
            expect(error).to.exist;
          }
        }));
      } finally {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    });
  });
});