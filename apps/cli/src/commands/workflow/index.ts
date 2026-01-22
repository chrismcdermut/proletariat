import { Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';

export default class Workflow extends PMOCommand {
  static description = 'List all available workflows (alias for workflow list)';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --builtin',
    '<%= config.bin %> <%= command.id %> --json',
  ];

  static flags = {
    ...pmoBaseFlags,
    builtin: Flags.boolean({
      description: 'Show only built-in workflows',
      default: false,
    }),
    custom: Flags.boolean({
      description: 'Show only custom workflows',
      default: false,
    }),
    json: Flags.boolean({
      description: 'Output as JSON',
      default: false,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(Workflow);

    // Build filter
    const filter: { isBuiltin?: boolean } = {};
    if (flags.builtin) filter.isBuiltin = true;
    if (flags.custom) filter.isBuiltin = false;

    const workflows = await this.storage.listWorkflows(
      Object.keys(filter).length > 0 ? filter : undefined
    );

    if (flags.json) {
      this.log(JSON.stringify(workflows, null, 2));
      return;
    }

    if (workflows.length === 0) {
      this.log(styles.muted('\nNo workflows found.'));
      this.log(styles.muted('Create one: prlt workflow create "My Workflow"'));
      return;
    }

    this.log(`\n${styles.emphasis('Workflows')}`);
    this.log('═'.repeat(60));

    // Group by builtin vs custom
    const builtinWorkflows = workflows.filter(w => w.isBuiltin);
    const customWorkflows = workflows.filter(w => !w.isBuiltin);

    if (builtinWorkflows.length > 0 && !flags.custom) {
      this.log(`\n${styles.emphasis('Built-in')}`);
      this.log('─'.repeat(40));
      for (const workflow of builtinWorkflows) {
        this.log(`  ${styles.emphasis(workflow.name)} ${styles.muted(`(${workflow.id})`)}`);
        if (workflow.description) {
          this.log(`    ${styles.muted(workflow.description)}`);
        }
      }
    }

    if (customWorkflows.length > 0 && !flags.builtin) {
      this.log(`\n${styles.emphasis('Custom')}`);
      this.log('─'.repeat(40));
      for (const workflow of customWorkflows) {
        this.log(`  ${styles.emphasis(workflow.name)} ${styles.muted(`(${workflow.id})`)}`);
        if (workflow.description) {
          this.log(`    ${styles.muted(workflow.description)}`);
        }
      }
    }

    this.log('');
    this.log(styles.muted('View details: prlt workflow view <id>'));
  }
}
