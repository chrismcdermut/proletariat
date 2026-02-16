import TemplateCreate from '../../template/create.js';

export default class PhaseTemplateCreate extends TemplateCreate {
  static description = 'Create a phase template from current workspace phases';
  static args = TemplateCreate.args;
  static flags = TemplateCreate.flags;
  static examples = TemplateCreate.examples;

  async run(): Promise<void> {
    const argv = this.argv as string[];
    if (!argv.includes('--type') && !argv.includes('-t')) {
      argv.push('--type', 'phase');
    }
    return super.run();
  }
}
