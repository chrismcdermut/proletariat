import { Args, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { colors, format } from '../../lib/colors.js';
import {
  getWorkspaceInfo,
  removeAgentsFromWorkspace
} from '../../lib/agents/commands.js';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  outputErrorAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../lib/prompt-json.js';

export default class Remove extends PMOCommand {
  static description = 'Remove a specific agent from the workspace';

  static examples = [
    '<%= config.bin %> <%= command.id %> camry',
    '<%= config.bin %> <%= command.id %>',
  ];

  static args = {
    name: Args.string({
      description: 'Agent name to remove',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    json: Flags.boolean({ description: 'Output prompt configuration as JSON (for AI agents/scripts)', default: false }),
    'no-interactive': Flags.boolean({ description: 'Alias for --json flag', default: false }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(Remove);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('agent remove', flags));
        this.exit(1);
      }
      this.error(message);
    };

    // Get workspace information
    const workspaceInfo = getWorkspaceInfo();

    if (workspaceInfo.agents.length === 0) {
      if (jsonMode) {
        outputErrorAsJson('NO_AGENTS', 'No agents to remove.', createMetadata('agent remove', flags));
        return;
      }
      this.log(colors.warning('No agents to remove.'));
      return;
    }

    let agentName = args.name;

    // Interactive mode if no agent specified
    if (!agentName) {
      // In JSON mode, output agent selection prompt
      if (jsonMode) {
        const agentChoices = [
          ...workspaceInfo.agents.map((agent: any) => ({ name: agent.name, value: agent.name })),
          { name: 'Cancel', value: 'cancel' },
        ];
        outputPromptAsJson(
          buildPromptConfig('list', 'name', 'Select agent to remove:', agentChoices),
          createMetadata('agent remove', flags)
        );
        return;
      }

      const choices = [
        ...workspaceInfo.agents.map((agent: any) => ({
          name: agent.name,
          value: agent.name
        })),
        new inquirer.Separator(),
        { name: '❌ Cancel', value: 'cancel' }
      ];

      const { selected } = await inquirer.prompt([
        {
          type: 'list',
          name: 'selected',
          message: 'Select agent to remove:',
          choices
        }
      ]);

      if (selected === 'cancel') {
        this.log(colors.textMuted('Operation cancelled.'));
        return;
      }

      agentName = selected;
    }

    // Validate agent exists
    const agent = workspaceInfo.agents.find((a: any) => a.name === agentName);
    if (!agent) {
      return handleError('AGENT_NOT_FOUND', `Agent "${agentName}" not found. Available agents: ${workspaceInfo.agents.map((a: any) => a.name).join(', ')}`);
    }

    const agentsToRemove = [agentName!];

    // Confirm removal
    // In JSON mode, output confirmation prompt
    if (jsonMode) {
      const confirmChoices = [
        { name: 'No, cancel', value: 'false' },
        { name: 'Yes, remove agent', value: 'true' },
      ];
      outputPromptAsJson(
        buildPromptConfig('list', 'confirmed', `Are you sure you want to remove agent "${agentName!}"? This will delete its worktree.`, confirmChoices),
        createMetadata('agent remove', flags)
      );
      return;
    }

    const { confirm } = await inquirer.prompt([
      {
        type: 'list',
        name: 'confirm',
        message: `Are you sure you want to remove agent "${agentName!}"? This will delete its worktree.`,
        choices: [
          { name: '❌ No, cancel', value: false },
          { name: '⚠️  Yes, remove agent', value: true }
        ],
        default: 0 // Default to "No, cancel"
      }
    ]);

    if (!confirm) {
      this.log(colors.textMuted('Removal cancelled.'));
      return;
    }

    // Remove agents
    this.log(colors.primary(`Removing agent "${agentName!}"...`));

    const { removed, failed } = await removeAgentsFromWorkspace(workspaceInfo, agentsToRemove);

    // Show results for each agent
    for (const agentName of agentsToRemove) {
      if (removed.includes(agentName)) {
        this.log(format.success(`Agent ${agentName} removed`));
      } else if (failed.includes(agentName)) {
        this.log(format.error(`Failed to remove agent ${agentName}`));
      }
    }

    // Summary
    if (removed.length > 0) {
      this.log(format.success(`\nSuccessfully removed ${removed.length} agent(s): ${removed.join(', ')}`));
    }
    if (failed.length > 0) {
      this.log(format.error(`\nFailed to remove ${failed.length} agent(s): ${failed.join(', ')}`));
    }
  }
}