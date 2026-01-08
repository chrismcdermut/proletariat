import { Command } from '@oclif/core';

export default class TemplatePhase extends Command {
  static description = 'Alias for "phase template" - manage project phase templates';

  static aliases = ['template:phases'];

  static examples = [
    '<%= config.bin %> phase template',
  ];

  async run(): Promise<void> {
    await this.config.runCommand('phase:template', []);
  }
}
