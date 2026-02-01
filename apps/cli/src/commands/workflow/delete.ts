import { Args, Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';

export default class WorkflowDelete extends PMOCommand {
  static description = 'Delete a custom workflow';

  static examples = [
    '<%= config.bin %> <%= command.id %> my-workflow',
    '<%= config.bin %> <%= command.id %> my-workflow --force  # Skip confirmation',
    '<%= config.bin %> <%= command.id %>  # Interactive selection',
  ];

  static args = {
    id: Args.string({
      description: 'Workflow ID to delete - prompts with dropdown if not provided',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    force: Flags.boolean({
      char: 'f',
      description: 'Skip confirmation prompt',
      default: false,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(WorkflowDelete);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('workflow delete', flags));
        this.exit(1);
      }
      this.error(message);
    };

    // Agent mode config for prompts
    const agentConfig = jsonMode ? { flags, commandName: 'workflow delete' } : null;

    // Get workflow ID - prompt if not provided
    let workflowId = args.id;

    if (!workflowId) {
      // Only show custom workflows (built-in cannot be deleted)
      const workflows = await this.storage.listWorkflows({ isBuiltin: false });
      if (workflows.length === 0) {
        return handleError('NO_CUSTOM_WORKFLOWS', 'No custom workflows found to delete.');
      }

      // Use selectFromList for workflow selection (handles JSON mode automatically)
      const selected = await this.selectFromList({
        message: 'Select workflow to delete:',
        items: workflows,
        getName: (w) => w.name,
        getValue: (w) => w.id,
        getCommand: (w) => `prlt workflow delete ${w.id} --json`,
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

    // Cannot delete built-in workflows
    if (workflow.isBuiltin) {
      return handleError('CANNOT_DELETE_BUILTIN', `Cannot delete built-in workflow: ${workflow.name}`);
    }

    // Check if workflow is in use by any projects
    const projects = await this.storage.listProjects();
    const usingProjects = projects.filter(p => p.workflowId === workflowId);
    if (usingProjects.length > 0) {
      const projectNames = usingProjects.map(p => p.name).join(', ');
      return handleError(
        'WORKFLOW_IN_USE',
        `Cannot delete workflow "${workflow.name}" - it is used by ${usingProjects.length} project(s): ${projectNames}`
      );
    }

    // Confirm deletion unless --force
    if (!flags.force) {
      const statuses = await this.storage.listStatuses(workflowId!);

      this.log(styles.warning(`\nWorkflow "${workflow.name}" has ${statuses.length} status(es).`));
      this.log(styles.warning('This action cannot be undone.'));
      this.log('');

      // Use agentPrompt for confirmation (handles JSON mode automatically)
      const { confirm } = await this.agentPrompt<{ confirm: boolean }>([{
        type: 'list',
        name: 'confirm',
        message: `Delete workflow "${workflow.name}"?`,
        choices: [
          { name: 'No', value: false, command: '' },
          { name: 'Yes, delete', value: true, command: `prlt workflow delete ${workflowId} --force --json` },
        ],
      }], agentConfig);

      if (!confirm) {
        this.log(styles.muted('Cancelled'));
        return;
      }
    }

    // Delete the workflow
    await this.storage.deleteWorkflow(workflowId!);

    this.log(styles.success(`\nDeleted workflow "${styles.emphasis(workflow.name)}"`));
  }
}
