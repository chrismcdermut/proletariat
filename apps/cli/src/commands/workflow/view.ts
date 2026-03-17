import { Args } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';

export default class WorkflowView extends PMOCommand {
  static description = 'View details of a workflow';

  static examples = [
    '<%= config.bin %> <%= command.id %> default',
    '<%= config.bin %> <%= command.id %>  # Interactive selection',
    '<%= config.bin %> <%= command.id %> --machine  # JSON output for AI agents',
  ];

  static args = {
    id: Args.string({
      description: 'Workflow ID - prompts with dropdown if not provided',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(WorkflowView);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): void => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('workflow view', flags));
        return
      }
      this.error(message);
    };

    // Agent mode config for prompts
    const agentConfig = jsonMode ? { flags, commandName: 'workflow view' } : null;

    // Get workflow ID - prompt if not provided
    let workflowId = args.id;

    if (!workflowId) {
      const workflows = await this.storage.listWorkflows();
      if (workflows.length === 0) {
        return handleError('NO_WORKFLOWS', 'No workflows found.');
      }

      // Use selectFromList for workflow selection (handles JSON mode automatically)
      const selected = await this.selectFromList({
        message: 'Select workflow to view:',
        items: workflows,
        getName: (w) => `${w.name}${w.isBuiltin ? ' (built-in)' : ''}`,
        getValue: (w) => w.id,
        getCommand: (w) => `prlt workflow view ${w.id} --json`,
        jsonMode: agentConfig,
      });

      if (!selected) {
        return; // Cancelled or JSON mode (already exited)
      }
      workflowId = selected;
    }

    // Get workflow details
    const workflow = await this.storage.getWorkflow(workflowId!);
    if (!workflow) {
      return handleError('WORKFLOW_NOT_FOUND', `Workflow not found: ${workflowId}`);
    }

    // Get workflow statuses
    const statuses = await this.storage.listStatuses(workflowId!);

    if (jsonMode) {
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
