import { Args } from '@oclif/core';
import * as path from 'node:path';
import { colors } from '../../lib/colors.js';
import { getWorkspaceInfo, formatAgentList, resolveAgentDir } from '../../lib/agents/commands.js';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';

export default class Visit extends PMOCommand {
  static description = 'Navigate to agent directory';

  static examples = [
    '<%= config.bin %> <%= command.id %> camry',
    '<%= config.bin %> <%= command.id %>',
  ];

  static args = {
    name: Args.string({
      description: 'Agent name to visit',
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
    const { args, flags } = await this.parse(Visit);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): void => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('agent visit', flags));
        return
      }
      this.error(message);
    };

    // Get workspace information
    const workspaceInfo = getWorkspaceInfo();

    if (workspaceInfo.agents.length === 0) {
      if (jsonMode) {
        outputErrorAsJson('NO_AGENTS', 'No agents found. Add agents with "prlt agent add"', createMetadata('agent visit', flags));
        return;
      }
      this.log(colors.warning('No agents found. Add agents with "prlt agent add"'));
      return;
    }

    let agentName = args.name;

    // Agent mode config for prompts
    const agentConfig = jsonMode ? { flags, commandName: 'agent visit' } : null;

    // Interactive mode if no agent specified
    if (!agentName) {
      // Group agents by type
      const staffAgents = workspaceInfo.agents.filter(a => a.type === 'persistent');
      const tempAgents = workspaceInfo.agents.filter(a => a.type === 'ephemeral');

      // Build choices with command field for JSON mode
      const choices: Array<{ name: string; value: string; command: string }> = [];

      for (const agent of staffAgents) {
        choices.push({ name: `👔 ${agent.name}`, value: agent.name, command: `prlt agent visit ${agent.name} --machine` });
      }

      for (const agent of tempAgents) {
        choices.push({ name: `⏱️  ${agent.name}`, value: agent.name, command: `prlt agent visit ${agent.name} --machine` });
      }

      const { selected } = await this.prompt<{ selected: string }>([{
        type: 'list',
        name: 'selected',
        message: 'Select agent to visit:',
        choices,
      }], agentConfig);

      agentName = selected;
    }

    // Validate agent exists
    const agent = workspaceInfo.agents.find(a => a.name === agentName);
    if (!agent) {
      return handleError('AGENT_NOT_FOUND', `Agent "${agentName}" not found. Available: ${formatAgentList(workspaceInfo.agents)}`);
    }

    // Calculate path to agent directory
    const agentDir = resolveAgentDir(workspaceInfo, agentName!);
    const relativePath = path.relative(process.cwd(), agentDir);

    // Display navigation command
    this.log(colors.primary(`🤖 Visiting agent: ${agentName}`));
    this.log(colors.command(`cd ${relativePath}`));
    this.log('');
    this.log(colors.textSecondary('Note: Due to shell limitations, you need to run this command manually.'));
  }
}