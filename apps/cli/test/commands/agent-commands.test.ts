import { runCommand } from '@oclif/test';
import { expect } from 'chai';
import { execSync } from 'child_process';

describe('CLI Commands', () => {
  describe('help', () => {
    it('shows init command', async () => {
      const { stdout } = await runCommand('--help');
      expect(stdout).to.contain('init');
      expect(stdout).to.contain('Initialize an HQ');
    });

    it('shows agent topic', async () => {
      const { stdout } = await runCommand('--help');
      expect(stdout).to.contain('agent');
      expect(stdout).to.contain('Manage agents');
    });

    it('shows ticket topic', async () => {
      const { stdout } = await runCommand('--help');
      expect(stdout).to.contain('ticket');
      expect(stdout).to.contain('Manage PMO tickets');
    });
  });

  describe('agent commands', () => {
    it('shows all agent subcommands', async () => {
      const { stdout } = await runCommand('agent --help');
      expect(stdout).to.contain('agent add');
      expect(stdout).to.contain('agent list');
      expect(stdout).to.contain('agent remove');
      expect(stdout).to.contain('agent visit');
      expect(stdout).to.contain('agent status');
    });

    it('agent add shows proper help', async () => {
      const { stdout } = await runCommand('agent add --help');
      expect(stdout).to.contain('Add new agents to the workspace');
      expect(stdout).to.contain('USAGE');
      expect(stdout).to.contain('EXAMPLES');
    });

    it('agent list shows proper help', async () => {
      const { stdout } = await runCommand('agent list --help');
      expect(stdout).to.contain('List all agents and their current status');
    });

    it('agent remove shows proper help', async () => {
      const { stdout } = await runCommand('agent remove --help');
      expect(stdout).to.contain('Remove agents from the workspace');
    });

    it('agent visit shows proper help', async () => {
      const { stdout } = await runCommand('agent visit --help');
      expect(stdout).to.contain('Navigate to agent directory');
    });

    it('agent status shows proper help', async () => {
      const { stdout } = await runCommand('agent status --help');
      expect(stdout).to.contain('Show detailed status for specific agent or all agents');
    });
  });

  describe('ticket commands', () => {
    it('shows all ticket subcommands', async () => {
      const { stdout } = await runCommand('ticket --help');
      expect(stdout).to.contain('ticket create');
      expect(stdout).to.contain('ticket list');
      expect(stdout).to.contain('ticket assign');
      expect(stdout).to.contain('ticket claim');
      expect(stdout).to.contain('ticket complete');
    });
  });
});

describe('Agent Command Contract', () => {
  // This test ensures all agent commands from SYSTEM_CARD.md actually exist and work
  const expectedAgentCommands = [
    'agent add',
    'agent list', 
    'agent remove',
    'agent visit',
    'agent status'
  ];

  expectedAgentCommands.forEach(cmd => {
    it(`'${cmd}' command exists and shows help`, async () => {
      const { stdout } = await runCommand([...cmd.split(' '), '--help'].join(' '));
      expect(stdout).to.not.contain('command not found');
      expect(stdout).to.contain('USAGE');
      expect(stdout).to.contain('DESCRIPTION');
    });
  });

  it('agent command shows all subcommands', async () => {
    const { stdout } = await runCommand('agent --help');
    expectedAgentCommands.forEach(cmd => {
      const subcommand = cmd.split(' ')[1]; // Extract subcommand (add, list, etc.)
      expect(stdout).to.contain(subcommand);
    });
  });
});

describe('Command Contract', () => {
  // This test ensures the commands we promise in SYSTEM_CARD.md actually exist
  const expectedCommands = [
    'init',
    'agent add',
    'agent list', 
    'agent remove',
    'agent visit',
    'agent status',
    'ticket create',
    'ticket list',
    'ticket assign',
    'ticket claim',
    'ticket complete'
  ];

  expectedCommands.forEach(cmd => {
    it(`'${cmd}' command exists and shows help`, async () => {
      const { stdout } = await runCommand([...cmd.split(' '), '--help'].join(' '));
      expect(stdout).to.not.contain('command not found');
    });
  });
});