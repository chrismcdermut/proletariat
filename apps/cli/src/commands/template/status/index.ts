import { Command } from '@oclif/core';

export default class TemplateStatus extends Command {
  static description = 'Alias for "status template" - manage workflow status templates';

  static aliases = ['template:statuses'];

  static examples = [
    '<%= config.bin %> status template',
  ];

  async run(): Promise<void> {
    await this.config.runCommand('status:template', []);
  }
}
