import { Args, Flags } from '@oclif/core';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { colors } from '../../lib/colors.js';
import { getWorkspaceInfo } from '../../lib/agents/commands.js';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { isDockerRunning } from '../../lib/execution/runners.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';

const execAsync = promisify(exec);

export default class AgentRebuild extends PMOCommand {
  static description = 'Rebuild a specific agent devcontainer image';

  static examples = [
    '<%= config.bin %> <%= command.id %> altman',
    '<%= config.bin %> <%= command.id %> altman --no-cache',
    '<%= config.bin %> <%= command.id %>  # Interactive selection',
    '<%= config.bin %> <%= command.id %> --json  # JSON mode for AI agents',
  ];

  static args = {
    name: Args.string({
      description: 'Agent name to rebuild',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
    'no-cache': Flags.boolean({
      description: 'Build without using cache',
      default: false,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(AgentRebuild);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Check Docker is running
    if (!isDockerRunning()) {
      if (jsonMode) {
        outputErrorAsJson('DOCKER_NOT_RUNNING', 'Docker is not running. Please start Docker Desktop and try again.', createMetadata('agent rebuild', flags));
        this.exit(1);
      }
      this.error('Docker is not running. Please start Docker Desktop and try again.');
    }

    let agentName = args.name;

    // If no agent name provided, prompt for selection
    if (!agentName) {
      const agents = this.getAvailableAgents();

      if (agents.length === 0) {
        if (jsonMode) {
          outputErrorAsJson('NO_AGENTS', 'No agents found.', createMetadata('agent rebuild', flags));
          return;
        }
        this.log(colors.warning('No agents found.'));
        return;
      }

      const selected = await this.selectFromList({
        message: 'Select agent to rebuild:',
        items: agents,
        getName: (a) => a.name,
        getValue: (a) => a.name,
        getCommand: (a) => `prlt agent rebuild ${a.name} --json`,
        jsonMode: jsonMode ? { flags, commandName: 'agent rebuild' } : null,
      });

      if (!selected) {
        return;
      }
      agentName = selected;
    }

    // Get workspace info
    const workspaceInfo = getWorkspaceInfo();
    if (!workspaceInfo) {
      this.error('Not in a proletariat workspace. Run `prlt init` first.');
    }

    this.log(colors.primary(`🔨 Rebuilding agent: ${agentName}\n`));

    const agentsPath = path.join(workspaceInfo.path, 'agents', 'staff');
    const agentDir = path.join(agentsPath, agentName);

    try {
      this.log(colors.textSecondary('  Building devcontainer...'));

      const buildCommand = [
        'devcontainer',
        'build',
        '--workspace-folder',
        agentDir,
      ];

      if (flags['no-cache']) {
        buildCommand.push('--no-cache');
      }

      const { stderr } = await execAsync(buildCommand.join(' '));

      if (stderr && !stderr.includes('WARNING')) {
        this.log(colors.textMuted(`  ${stderr.trim()}`));
      }

      this.log('');
      this.log(colors.success(`✓ Agent ${agentName} rebuild complete`));
      this.log(colors.textMuted('Use `prlt agent restart` to apply changes to running container'));
    } catch (error) {
      this.error(`Failed to rebuild agent ${agentName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private getAvailableAgents(): Array<{ name: string; type: 'staff' | 'temp' }> {
    const workspaceInfo = getWorkspaceInfo();
    if (!workspaceInfo) {
      return [];
    }

    const agents: Array<{ name: string; type: 'staff' | 'temp' }> = [];
    const agentsPath = path.join(workspaceInfo.path, 'agents');

    // Check staff agents
    const staffPath = path.join(agentsPath, 'staff');
    if (fs.existsSync(staffPath)) {
      const staffAgents = fs.readdirSync(staffPath, { withFileTypes: true })
        .filter(d => d.isDirectory() && !d.name.startsWith('.'))
        .map(d => ({ name: d.name, type: 'staff' as const }));
      agents.push(...staffAgents);
    }

    // Check temp agents
    const tempPath = path.join(agentsPath, 'temp');
    if (fs.existsSync(tempPath)) {
      const tempAgents = fs.readdirSync(tempPath, { withFileTypes: true })
        .filter(d => d.isDirectory() && !d.name.startsWith('.'))
        .map(d => ({ name: d.name, type: 'temp' as const }));
      agents.push(...tempAgents);
    }

    return agents;
  }
}
