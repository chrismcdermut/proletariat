import { Args, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  outputErrorAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../lib/prompt-json.js';

export default class WorkflowView extends PMOCommand {
  static description = 'View details of a workflow';

  static examples = [
    '<%= config.bin %> <%= command.id %> default',
    '<%= config.bin %> <%= command.id %>  # Interactive selection',
    '<%= config.bin %> <%= command.id %> --json',
  ];

  static args = {
    id: Args.string({
      description: 'Workflow ID - prompts with dropdown if not provided',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    json: Flags.boolean({
      description: 'Output as JSON',
      default: false,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(WorkflowView);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('workflow view', flags));
        this.exit(1);
      }
      this.error(message);
    };

    // Get workflow ID - prompt if not provided
    let workflowId = args.id;

    if (!workflowId) {
      const workflows = await this.storage.listWorkflows();
      if (workflows.length === 0) {
        return handleError('NO_WORKFLOWS', 'No workflows found.');
      }

      // In JSON mode, output workflow selection prompt
      if (jsonMode) {
        const workflowChoices = workflows.map(w => ({
          name: `${w.name}${w.isBuiltin ? ' (built-in)' : ''}`,
          value: w.id,
        }));
        outputPromptAsJson(
          buildPromptConfig('list', 'id', 'Select workflow to view:', workflowChoices),
          createMetadata('workflow view', flags)
        );
        return;
      }

      const { selectedId } = await inquirer.prompt([{
        type: 'list',
        name: 'selectedId',
        message: 'Select workflow to view:',
        choices: workflows.map(w => ({
          name: `${w.name}${w.isBuiltin ? ' (built-in)' : ''}`,
          value: w.id,
        })),
      }]);
      workflowId = selectedId;
    }

    // Get workflow details
    const workflow = await this.storage.getWorkflow(workflowId!);
    if (!workflow) {
      return handleError('WORKFLOW_NOT_FOUND', `Workflow not found: ${workflowId}`);
    }

    // Get workflow statuses
    const statuses = await this.storage.listStatuses(workflowId!);

    if (flags.json) {
      this.log(JSON.stringify({ workflow, statuses }, null, 2));
      return;
    }

    this.log(`\n${styles.emphasis('Workflow:')} ${workflow.name}`);
    this.log('═'.repeat(60));
    this.log(styles.muted(`  ID: ${workflow.id}`));
    if (workflow.description) {
      this.log(styles.muted(`  Description: ${workflow.description}`));
    }
    this.log(styles.muted(`  Type: ${workflow.isBuiltin ? 'Built-in' : 'Custom'}`));
    this.log(styles.muted(`  Created: ${workflow.createdAt.toLocaleDateString()}`));

    if (statuses.length > 0) {
      this.log(`\n${styles.emphasis('Statuses:')}`);
      this.log('─'.repeat(40));

      // Group by category
      const byCategory = new Map<string, typeof statuses>();
      for (const status of statuses) {
        const existing = byCategory.get(status.category) || [];
        existing.push(status);
        byCategory.set(status.category, existing);
      }

      const categoryOrder = ['backlog', 'unstarted', 'started', 'completed', 'canceled'];
      for (const category of categoryOrder) {
        const categoryStatuses = byCategory.get(category);
        if (categoryStatuses && categoryStatuses.length > 0) {
          this.log(`\n  ${styles.emphasis(category.toUpperCase())}`);
          for (const status of categoryStatuses.sort((a, b) => a.position - b.position)) {
            const defaultBadge = status.isDefault ? styles.muted(' (default)') : '';
            this.log(`    • ${status.name}${defaultBadge}`);
          }
        }
      }
    } else {
      this.log(styles.muted('\nNo statuses defined.'));
    }

    this.log('');
  }
}
