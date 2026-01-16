import { Args, Flags } from '@oclif/core';
import * as path from 'node:path';
import inquirer from 'inquirer';
import { colors } from '../../lib/colors.js';
import { getWorkspaceInfo } from '../../lib/agents/commands.js';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  outputErrorAsJson,
  createMetadata,
  buildPromptConfig,
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
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
    'no-interactive': Flags.boolean({
      description: 'Alias for --json flag',
      default: false,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(Visit);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('agent visit', flags));
        this.exit(1);
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

    // Interactive mode if no agent specified
    if (!agentName) {
      // In JSON mode, output agent selection prompt
      if (jsonMode) {
        const agentChoices = workspaceInfo.agents.map((agent: any) => ({ name: agent.name, value: agent.name }));
        outputPromptAsJson(
          buildPromptConfig('list', 'name', 'Select agent to visit:', agentChoices),
          createMetadata('agent visit', flags)
        );
        return;
      }

      const { selected } = await inquirer.prompt([
        {
          type: 'list',
          name: 'selected',
          message: 'Select agent to visit:',
          choices: workspaceInfo.agents.map(agent => ({
            name: agent.name,
            value: agent.name
          }))
        }
      ]);
      agentName = selected;
    }

    // Validate agent exists
    const agent = workspaceInfo.agents.find(a => a.name === agentName);
    if (!agent) {
      return handleError('AGENT_NOT_FOUND', `Agent "${agentName}" not found. Available agents: ${workspaceInfo.agents.map(a => a.name).join(', ')}`);
    }

    // Calculate path to agent directory
    const agentDir = path.join(workspaceInfo.agentsPath, agentName!);
    const relativePath = path.relative(process.cwd(), agentDir);

    // Display navigation command
    this.log(colors.primary(`🤖 Visiting agent: ${agentName}`));
    this.log(colors.command(`cd ${relativePath}`));
    this.log('');
    this.log(colors.textSecondary('Note: Due to shell limitations, you need to run this command manually.'));
  }
}