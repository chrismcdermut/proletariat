import { Args, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import type { StateCategory } from '../../lib/pmo/types.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  createMetadata,
  buildFormPromptConfig,
  FormField,
} from '../../lib/prompt-json.js';

export default class WorkflowCreate extends PMOCommand {
  static description = 'Create a new custom workflow';

  static examples = [
    '<%= config.bin %> <%= command.id %> "My Workflow"',
    '<%= config.bin %> <%= command.id %> "Sprint Board" --description "Agile sprint workflow"',
    '<%= config.bin %> <%= command.id %> "Simple" --statuses "Todo,In Progress,Done"',
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
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(WorkflowCreate);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Get workflow name
    let name = args.name;

    if (!name) {
      const fields: FormField[] = [
        { type: 'input', name: 'name', message: 'Workflow name:' },
        { type: 'input', name: 'description', message: 'Description (optional):', default: flags.description },
      ];

      if (jsonMode) {
        outputPromptAsJson(
          buildFormPromptConfig(fields),
          createMetadata('workflow create', flags)
        );
        return;
      }

      const answers = await inquirer.prompt<{ name: string; description?: string }>([
        {
          type: 'input',
          name: 'name',
          message: 'Workflow name:',
          validate: (input: string) => input.length > 0 || 'Name is required',
        },
        {
          type: 'input',
          name: 'description',
          message: 'Description (optional):',
        },
      ]);
      name = answers.name;
      if (answers.description) {
        flags.description = answers.description;
      }
    }

    // Create the workflow
    const workflow = await this.storage.createWorkflow({
      name: name!,
      description: flags.description,
    });

    // If statuses were provided, add them
    if (flags.statuses) {
      const statusNames = flags.statuses.split(',').map(s => s.trim()).filter(s => s);
      const defaultCategories = ['backlog', 'unstarted', 'started', 'started', 'completed'];

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
