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
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
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

    // Get workflow ID - prompt if not provided
    let workflowId = args.id;

    if (!workflowId) {
      // Only show custom workflows (built-in cannot be deleted)
      const workflows = await this.storage.listWorkflows({ isBuiltin: false });
      if (workflows.length === 0) {
        return handleError('NO_CUSTOM_WORKFLOWS', 'No custom workflows found to delete.');
      }

      // In JSON mode, output workflow selection prompt
      if (jsonMode) {
        const workflowChoices = workflows.map(w => ({
          name: w.name,
          value: w.id,
        }));
        outputPromptAsJson(
          buildPromptConfig('list', 'id', 'Select workflow to delete:', workflowChoices),
          createMetadata('workflow delete', flags)
        );
        return;
      }

      const { selectedId } = await inquirer.prompt([{
        type: 'list',
        name: 'selectedId',
        message: 'Select workflow to delete:',
        choices: workflows.map(w => ({
          name: w.name,
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

      // In JSON mode, output confirmation prompt
      if (jsonMode) {
        outputPromptAsJson(
          buildPromptConfig('confirm', 'confirm', `Delete workflow "${workflow.name}" with ${statuses.length} statuses?`),
          createMetadata('workflow delete', flags)
        );
        return;
      }

      this.log(styles.warning(`\nWorkflow "${workflow.name}" has ${statuses.length} status(es).`));
      this.log(styles.warning('This action cannot be undone.'));
      this.log('');

      const { confirm } = await inquirer.prompt([{
        type: 'list',
        name: 'confirm',
        message: `Delete workflow "${workflow.name}"?`,
        choices: [
          { name: 'Yes', value: true },
          { name: 'No', value: false },
        ],
      }]);

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
