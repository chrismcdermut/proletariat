import { Args, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { colors, format } from '../../lib/colors.js';
import {
  getWorkspaceInfo,
  removeAgentsFromWorkspace,
  formatAgentList
} from '../../lib/agents/commands.js';
import { PromptCommand } from '../../lib/prompt-command.js'
import { machineOutputFlags } from '../../lib/pmo/index.js'
import {
  shouldOutputJson,
  outputPromptAsJson,
  outputErrorAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../lib/prompt-json.js';

export default class Remove extends PromptCommand {
  static description = 'Remove an agent from the workspace';

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
    ...machineOutputFlags,
    force: Flags.boolean({
      char: 'f',
      description: 'Skip confirmation prompt (for non-interactive use)',
      default: false,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Remove);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): void => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('agent remove', flags));
        return
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
      // Group agents by type
      const staffAgents = workspaceInfo.agents.filter(a => a.type === 'persistent');
      const tempAgents = workspaceInfo.agents.filter(a => a.type === 'ephemeral');

      // Build choices with command field for JSON mode
      const agentChoices: Array<{ name: string; value: string; command?: string }> = [];

      for (const agent of staffAgents) {
        agentChoices.push({ name: `👔 ${agent.name}`, value: agent.name, command: `prlt agent remove ${agent.name} --machine` });
      }

      for (const agent of tempAgents) {
        agentChoices.push({ name: `⏱️  ${agent.name}`, value: agent.name, command: `prlt agent remove ${agent.name} --machine` });
      }

      agentChoices.push({ name: 'Cancel', value: 'cancel' });

      const selectMessage = 'Select agent to remove:';

      // In JSON mode, output agent selection prompt
      if (jsonMode) {
        outputPromptAsJson(
          buildPromptConfig('list', 'name', selectMessage, agentChoices),
          createMetadata('agent remove', flags)
        );
        return;
      }

      const { selected } = await this.prompt<{ selected: string }>([
        {
          type: 'list',
          name: 'selected',
          message: selectMessage,
          choices: [
            ...agentChoices.slice(0, -1),
            new inquirer.Separator(),
            { name: '❌ ' + agentChoices[agentChoices.length - 1].name, value: agentChoices[agentChoices.length - 1].value }
          ]
        }
      ], null);

      if (selected === 'cancel') {
        this.log(colors.textMuted('Operation cancelled.'));
        return;
      }

      agentName = selected;
    }

    // Validate agent exists
    const agent = workspaceInfo.agents.find((a) => a.name === agentName);
    if (!agent) {
      return handleError('AGENT_NOT_FOUND', `Agent "${agentName}" not found. Available: ${formatAgentList(workspaceInfo.agents)}`);
    }

    const agentsToRemove = [agentName!];

    // Skip confirmation if --force flag is passed
    if (!flags.force) {
      // Build choices once, use for both JSON and interactive modes
      const confirmChoices = [
        { name: 'No, cancel', value: 'false' },
        { name: 'Yes, remove agent', value: 'true' },
      ];
      const confirmMessage = `Are you sure you want to remove agent "${agentName!}"? This will delete its worktree.`;

      // Confirm removal
      // In JSON mode, output confirmation prompt
      if (jsonMode) {
        outputPromptAsJson(
          buildPromptConfig('list', 'confirmed', confirmMessage, confirmChoices),
          createMetadata('agent remove', flags)
        );
        return;
      }

      const { confirm } = await this.prompt<{ confirm: boolean }>([
        {
          type: 'list',
          name: 'confirm',
          message: confirmMessage,
          choices: [
            { name: '❌ ' + confirmChoices[0].name, value: false },
            { name: '⚠️  ' + confirmChoices[1].name, value: true }
          ],
          default: 0 // Default to "No, cancel"
        }
      ], null);

      if (!confirm) {
        this.log(colors.textMuted('Removal cancelled.'));
        return;
      }
    }

    // Remove agents
    this.log(colors.primary(`Removing agent "${agentName!}"...`));

    const { removed, failed } = await removeAgentsFromWorkspace(workspaceInfo, agentsToRemove);

    // Show results for each agent
    for (const name of agentsToRemove) {
      if (removed.includes(name)) {
        this.log(format.success(`Agent ${name} removed`));
      } else if (failed.includes(name)) {
        this.log(format.error(`Failed to remove agent ${name}`));
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
