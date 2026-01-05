import { Command } from '@oclif/core';

export default class Template extends Command {
  static description = 'Alias for "status template" - manage workflow status templates';

  static aliases = ['templates'];

  static hidden = true;  // Hide from help since it's an alias

  static examples = [
    '<%= config.bin %> status template',
  ];

  async run(): Promise<void> {
    // Redirect to the new location
    this.log('Note: "prlt template" has moved to "prlt status template"');
    await this.config.runCommand('status:template', []);
  }
}
