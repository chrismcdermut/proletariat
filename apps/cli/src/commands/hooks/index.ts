import { Command } from '@oclif/core';

export default class HooksIndex extends Command {
  static description = 'Manage event-based hooks for automation';

  static examples = [
    '<%= config.bin %> hooks list',
    '<%= config.bin %> hooks test ticket.moved --to-column Ready',
    '<%= config.bin %> hooks init',
  ];

  async run(): Promise<void> {
    this.log('Available hooks commands:');
    this.log('');
    this.log('  hooks list     - List all registered hooks');
    this.log('  hooks test     - Test a hook by simulating an event');
    this.log('  hooks init     - Create a hooks.yaml template');
    this.log('  hooks enable   - Enable a hook');
    this.log('  hooks disable  - Disable a hook');
    this.log('');
    this.log('Run "prlt hooks --help" for more information on a command.');
  }
}
