import { Args, Command, Flags } from '@oclif/core';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { colors } from '../../lib/colors.js';
import { getWorkspaceInfo } from '../../lib/agents/commands.js';

const execAsync = promisify(exec);

export default class AgentRebuild extends Command {
  static description = 'Rebuild a specific agent devcontainer image';

  static examples = [
    '<%= config.bin %> <%= command.id %> altman',
    '<%= config.bin %> <%= command.id %> altman --no-cache',
  ];

  static args = {
    name: Args.string({
      description: 'Agent name to rebuild',
      required: true,
    }),
  };

  static flags = {
    'no-cache': Flags.boolean({
      description: 'Build without using cache',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(AgentRebuild);
    const agentName = args.name;

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

      const { stdout, stderr } = await execAsync(buildCommand.join(' '));

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
}
