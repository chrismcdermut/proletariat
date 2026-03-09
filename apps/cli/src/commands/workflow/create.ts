import { Args, Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import type { StateCategory } from '../../lib/pmo/types.js';
import { FlagResolver, shouldOutputJson } from '../../lib/flags/index.js';

export default class WorkflowCreate extends PMOCommand {
  static description = 'Create a new custom workflow';

  static examples = [
    '<%= config.bin %> <%= command.id %> "My Workflow"',
    '<%= config.bin %> <%= command.id %> "Sprint Board" --description "Agile sprint workflow"',
    '<%= config.bin %> <%= command.id %> "Simple" --statuses "Todo,In Progress,Done"',
    '<%= config.bin %> <%= command.id %> --machine  # JSON output for AI agents',
  ];

  static args = {
    name: Args.string({
      description: 'Workflow name',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    description: Flags.string({
      char: 'd',
      description: 'Workflow description',
    }),
    statuses: Flags.string({
      char: 's',
      description: 'Comma-separated list of status names (uses default categories)',
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(WorkflowCreate);
    const jsonMode = shouldOutputJson(flags);

    const resolver = new FlagResolver({
      commandName: 'workflow create',
      baseCommand: 'prlt workflow create',
      jsonMode,
      flags: { ...flags, name: args.name },
      args,
    });

    resolver.addPrompt({
      flagName: 'name',
      type: 'input',
      message: 'Workflow name:',
      validate: (value) => String(value).length > 0 || 'Name is required',
    });

    resolver.addPrompt({
      flagName: 'description',
      type: 'input',
      message: 'Description (optional):',
      when: (ctx) => ctx.flags.name !== undefined,
    });

    const resolved = await resolver.resolve();
    let name = resolved.name as string;
    if (resolved.description) {
      flags.description = resolved.description as string;
    }

    // Create the workflow
    const workflow = await this.storage.createWorkflow({
      name: name!,
      description: flags.description,
    });

    // If statuses were provided, add them sequentially for consistent ordering
    if (flags.statuses) {
      const statusNames = flags.statuses.split(',').map(s => s.trim()).filter(Boolean);

      for (let i = 0; i < statusNames.length; i++) {
        const statusName = statusNames[i];
        // Assign categories based on position: first = backlog, second = unstarted, middle = started, last = completed
        let category: string;
        if (i === 0) {
          category = 'backlog';
        } else if (i === 1) {
          category = 'unstarted';
        } else if (i === statusNames.length - 1) {
          category = 'completed';
        } else {
          category = 'started';
        }

        // eslint-disable-next-line no-await-in-loop
        await this.storage.createStatus(workflow.id, {
          name: statusName,
          category: category as StateCategory,
          position: i,
          isDefault: i === 1, // Second status (unstarted) is default
        });
      }
    }

    // Get the statuses for display
    const statuses = await this.storage.listStatuses(workflow.id);

    this.log(styles.success(`\nCreated workflow "${styles.emphasis(workflow.name)}"`));
    this.log(styles.muted(`  ID: ${workflow.id}`));
    if (workflow.description) {
      this.log(styles.muted(`  Description: ${workflow.description}`));
    }
    if (statuses.length > 0) {
      this.log(styles.muted(`  Statuses: ${statuses.map(s => s.name).join(', ')}`));
    } else {
      this.log(styles.muted('  No statuses yet. Add some with: prlt status create'));
    }
    this.log('');
    this.log(styles.muted(`View workflow: prlt workflow view ${workflow.id}`));
  }
}
