import { runCommand } from '@oclif/test';
import { expect } from 'chai';
import { execSync } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Root directory for the CLI - needed for @oclif/test to find commands
const root = path.resolve(__dirname, '../..');

describe('CLI Commands', () => {
  describe('help', () => {
    it('shows init command', async () => {
      const { stdout } = await runCommand(['--help'], { root });
      expect(stdout).to.contain('init');
      expect(stdout).to.contain('Initialize an HQ');
    });

    it('shows agent topic', async () => {
      const { stdout } = await runCommand(['--help'], { root });
      expect(stdout).to.contain('agent');
    });

    it('shows ticket topic', async () => {
      const { stdout } = await runCommand(['--help'], { root });
      expect(stdout).to.contain('ticket');
    });
  });

  describe('agent commands', () => {
    it('shows agent subcommands', async () => {
      const { stdout } = await runCommand(['agent', '--help'], { root });
      // Test actual existing commands
      expect(stdout).to.contain('agent remove');
      expect(stdout).to.contain('agent visit');
      expect(stdout).to.contain('agent status');
      expect(stdout).to.contain('agent shell');
    });

    it('agent remove shows proper help', async () => {
      const { stdout } = await runCommand(['agent', 'remove', '--help'], { root });
      expect(stdout).to.contain('Remove');
      expect(stdout).to.contain('USAGE');
    });

    it('agent visit shows proper help', async () => {
      const { stdout } = await runCommand(['agent', 'visit', '--help'], { root });
      expect(stdout).to.contain('Navigate to agent directory');
    });

    it('agent status shows proper help', async () => {
      const { stdout } = await runCommand(['agent', 'status', '--help'], { root });
      expect(stdout).to.contain('Show detailed status');
    });

    it('agent shell shows proper help', async () => {
      const { stdout } = await runCommand(['agent', 'shell', '--help'], { root });
      expect(stdout).to.contain('shell');
      expect(stdout).to.contain('USAGE');
    });
  });

  describe('ticket commands', () => {
    it('shows ticket subcommands', async () => {
      const { stdout } = await runCommand(['ticket', '--help'], { root });
      expect(stdout).to.contain('ticket create');
      expect(stdout).to.contain('ticket list');
    });
  });
});

describe('Agent Command Contract', () => {
  // Test actual existing agent commands
  const expectedAgentCommands = [
    'agent remove',
    'agent visit',
    'agent status',
    'agent shell',
    'agent login',
    'agent rebuild',
    'agent restart'
  ];

  expectedAgentCommands.forEach(cmd => {
    it(`'${cmd}' command exists and shows help`, async () => {
      const { stdout } = await runCommand([...cmd.split(' '), '--help'], { root });
      expect(stdout).to.not.contain('not found');
      expect(stdout).to.contain('USAGE');
    });
  });

  it('agent command shows all subcommands', async () => {
    const { stdout } = await runCommand(['agent', '--help'], { root });
    // Test that key subcommands appear in help
    expect(stdout).to.contain('remove');
    expect(stdout).to.contain('visit');
    expect(stdout).to.contain('status');
  });
});

describe('Command Contract', () => {
  // Test commands that actually exist
  const expectedCommands = [
    'init',
    'agent remove',
    'agent visit',
    'agent status',
    'ticket create',
    'ticket list'
  ];

  expectedCommands.forEach(cmd => {
    it(`'${cmd}' command exists and shows help`, async () => {
      const { stdout } = await runCommand([...cmd.split(' '), '--help'], { root });
      expect(stdout).to.not.contain('not found');
    });
  });
});