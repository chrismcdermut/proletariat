import TemplateApply from '../../template/apply.js';

export default class TicketTemplateApply extends TemplateApply {
  static description = 'Apply a ticket template to create a new ticket';
  static args = TemplateApply.args;
  static flags = TemplateApply.flags;
  static examples = TemplateApply.examples;

  async run(): Promise<void> {
    const argv = this.argv as string[];
    if (!argv.includes('--type') && !argv.includes('-t')) {
      argv.push('--type', 'ticket');
    }
    return super.run();
  }
}
