import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { getWorkspaceInfo } from '../../lib/agents/commands.js';
import { discoverAgentsOnDisk } from '../../lib/database/index.js';

export default class Discover extends Command {
  static description = 'Discover agents on disk that are not registered in the database';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --dry-run',
  ];

  static flags = {
    'dry-run': Flags.boolean({
      description: 'Show what would be discovered without making changes',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Discover);

    try {
      const workspaceInfo = getWorkspaceInfo();

      this.log(chalk.bold('\n🔍 Agent Discovery\n'));

      if (flags['dry-run']) {
        this.log(chalk.yellow('Dry run mode - no changes will be made\n'));
      }

      const result = discoverAgentsOnDisk(workspaceInfo.path);

      // Report discovered agents
      if (result.discovered.length > 0) {
        this.log(chalk.green.bold(`✅ Discovered ${result.discovered.length} new agent(s):\n`));
        for (const agent of result.discovered) {
          const typeLabel = agent.type === 'persistent' ? chalk.cyan('[staff]') : chalk.yellow('[temp]');
          this.log(`   ${chalk.bold(agent.name)} ${typeLabel}`);
          this.log(chalk.dim(`      Path: ${agent.path}`));
        }
        this.log('');
      } else {
        this.log(chalk.dim('No new agents discovered on disk.\n'));
      }

      // Report cleaned agents
      if (result.cleaned.length > 0) {
        this.log(chalk.yellow.bold(`🧹 Cleaned up ${result.cleaned.length} missing agent(s):\n`));
        for (const name of result.cleaned) {
          this.log(`   ${chalk.dim(name)} - directory no longer exists`);
        }
        this.log('');
      }

      // Summary
      if (result.discovered.length === 0 && result.cleaned.length === 0) {
        this.log(chalk.green('✓ Database is in sync with disk.\n'));
      } else {
        const total = result.discovered.length + result.cleaned.length;
        this.log(chalk.bold(`Summary: ${total} change(s) made`));
        if (result.discovered.length > 0) {
          this.log(`   Discovered: ${result.discovered.length} agent(s)`);
        }
        if (result.cleaned.length > 0) {
          this.log(`   Cleaned: ${result.cleaned.length} agent(s)`);
        }
        this.log('');
      }

    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error));
    }
  }
}
