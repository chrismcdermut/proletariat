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

describe('Command Contract', () => {
  // This test ensures the commands we promise in SYSTEM.md actually exist
  const expectedCommands = [
    'init',
    'agent add',
    'agent list', 
    'agent remove',
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