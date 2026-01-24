import { Flags, Args } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';

export default class WorkflowSwitch extends PMOCommand {
  static description = 'Switch a project to use a different workflow';

  static examples = [
    '<%= config.bin %> <%= command.id %> kanban',
    '<%= config.bin %> <%= command.id %> linear --project my-project',
    '<%= config.bin %> <%= command.id %> --force  # Skip confirmation',
  ];

  static args = {
    workflow: Args.string({
      description: 'Workflow ID to switch to',
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

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(WorkflowSwitch);
    const projectId = await this.requireProject();

    // Get workflow - prompt for selection if not provided
    let workflowId = args.workflow;
    if (!workflowId) {
      const workflows = await this.storage.listWorkflows();
      if (workflows.length === 0) {
        this.error('No workflows found.\nCreate one with: prlt workflow create "Workflow Name"');
      }

      const { selectedWorkflow } = await inquirer.prompt([{
        type: 'list',
        name: 'selectedWorkflow',
        message: 'Select a workflow:',
        choices: workflows.map(w => ({
          name: `${w.name}${w.description ? ` - ${w.description}` : ''}`,
          value: w.id,
        })),
      }]);
      workflowId = selectedWorkflow;
    }

    // Verify workflow exists
    const workflow = await this.storage.getWorkflow(workflowId!);
    if (!workflow) {
      this.error(`Workflow not found: ${workflowId}\nRun 'prlt workflow list' to see available workflows.`);
    }

    // Get current project info
    const project = await this.storage.getProject(projectId);
    const currentWorkflowId = project?.workflowId;

    // Check if already using this workflow
    if (currentWorkflowId === workflowId) {
      this.log(styles.muted(`Project is already using workflow "${workflow.name}".`));
      return;
    }

    // Get tickets that will be affected
    const tickets = await this.storage.listTickets(projectId);

    if (tickets.length > 0 && !flags.force) {
      const projectName = await this.getProjectName(projectId);
      this.log(styles.warning(`\nProject "${projectName}" has ${tickets.length} ticket(s).`));
      this.log(styles.warning('Tickets will be mapped to matching status categories in the new workflow.'));
      this.log('');

      const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
        {
          type: 'list',
          name: 'confirm',
          message: `Switch to workflow "${workflow.name}"?`,
          choices: [
            { name: 'No', value: false },
            { name: 'Yes, switch workflow', value: true },
          ],
        },
      ]);

      if (!confirm) {
        this.log(styles.muted('Cancelled'));
        return;
      }
    }

    // Get new workflow statuses
    const newStatuses = await this.storage.listStatuses(workflowId!);

    // Build category -> status mapping for the new workflow
    const categoryToStatus: Record<string, { id: string; name: string }> = {};
    for (const status of newStatuses) {
      if (!categoryToStatus[status.category]) {
        categoryToStatus[status.category] = { id: status.id, name: status.name };
      }
    }

    // Find default status
    const defaultStatus = newStatuses.find(s => s.isDefault) || newStatuses[0];

    // Update project workflow_id
    await this.storage.updateProject(projectId, { workflowId: workflowId! });

    // Migrate tickets to new statuses - sequential for data integrity
    let migratedCount = 0;
    for (const ticket of tickets) {
      // Get old status category
      const oldCategory = ticket.statusCategory || 'backlog';

      // Find matching status in new workflow, or use default
      const newStatus = categoryToStatus[oldCategory] ||
        (defaultStatus ? { id: defaultStatus.id, name: defaultStatus.name } : null);

      if (newStatus) {
        // eslint-disable-next-line no-await-in-loop
        await this.storage.moveTicket(projectId, ticket.id, newStatus.name);
        migratedCount++;
      }
    }

    const projectName = await this.getProjectName(projectId);
    this.log(styles.success(`\nSwitched project "${projectName}" to workflow "${styles.emphasis(workflow.name)}"`));
    if (migratedCount > 0) {
      this.log(styles.muted(`Migrated ${migratedCount} ticket(s) to matching statuses.`));
    }
    this.log('');
    this.log(styles.muted(`View statuses: prlt status list`));
  }
}
