import TemplateApply from '../../template/apply.js';

export default class PhaseTemplateApply extends TemplateApply {
  static description = 'Apply a phase template to the workspace';
  static args = TemplateApply.args;
  static flags = TemplateApply.flags;
  static examples = TemplateApply.examples;

  async run(): Promise<void> {
    const argv = this.argv as string[];
    if (!argv.includes('--type') && !argv.includes('-t')) {
      argv.push('--type', 'phase');
    }
    return super.run();
  }
}
