import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { getWorkspaceInfo } from '../../lib/agents/commands.js';
import { discoverAgentsOnDisk } from '../../lib/database/index.js';
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';

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
    json: Flags.boolean({
      description: 'Output discovery results as JSON (for AI agents/scripts)',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Discover);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    try {
      const workspaceInfo = getWorkspaceInfo();

      if (!jsonMode) {
        this.log(chalk.bold('\n🔍 Agent Discovery\n'));

        if (flags['dry-run']) {
          this.log(chalk.yellow('Dry run mode - no changes will be made\n'));
        }
      }

      const result = discoverAgentsOnDisk(workspaceInfo.path);

      // JSON mode - output structured result
      if (jsonMode) {
        outputSuccessAsJson({
          discovered: result.discovered.map(agent => ({
            name: agent.name,
            type: agent.type === 'persistent' ? 'staff' : 'temp',
            path: agent.path,
          })),
          cleaned: result.cleaned,
          inSync: result.discovered.length === 0 && result.cleaned.length === 0,
          dryRun: flags['dry-run'],
        }, createMetadata('agent discover', flags));
        return;
      }

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
      if (jsonMode) {
        outputErrorAsJson('DISCOVER_FAILED', error instanceof Error ? error.message : String(error), createMetadata('agent discover', flags));
      }
      this.error(error instanceof Error ? error.message : String(error));
    }
  }
}
