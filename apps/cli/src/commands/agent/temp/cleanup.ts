import { Args, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { colors, format } from '../../../lib/colors.js';
import {
  getWorkspaceInfo,
  cleanupAgent,
  getCleanableAgents,
  getAgentTmuxSessions,
  CleanupResult
} from '../../../lib/agents/commands.js';
import { PMOCommand, pmoBaseFlags } from '../../../lib/pmo/index.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  outputErrorAsJson,
  outputSuccessAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../../lib/prompt-json.js';

export default class Cleanup extends PMOCommand {
  static description = 'Clean up agent resources (containers, directories, tmux sessions)';

  static examples = [
    '<%= config.bin %> <%= command.id %> bold-bezos-1',
    '<%= config.bin %> <%= command.id %> --temp',
    '<%= config.bin %> <%= command.id %> --temp --dry-run',
    '<%= config.bin %> <%= command.id %> --all',
    '<%= config.bin %> <%= command.id %> --json',
  ];

  static args = {
    name: Args.string({
      description: 'Agent name to clean up',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    temp: Flags.boolean({
      description: 'Clean up all ephemeral agents with no running work',
      default: false,
    }),
    all: Flags.boolean({
      description: 'Clean up ALL ephemeral agents (including those with running work)',
      default: false,
    }),
    'dry-run': Flags.boolean({
      description: 'Show what would be cleaned without actually doing it',
      default: false,
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Skip confirmation prompt',
      default: false,
    }),
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
    const { args, flags } = await this.parse(Cleanup);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('agent cleanup', flags));
        this.exit(1);
      }
      this.error(message);
    };

    // Get workspace information
    const workspaceInfo = getWorkspaceInfo();

    const dryRun = flags['dry-run'];
    const force = flags.force;

    // Determine which agents to clean up
    let agentsToCleanup: string[] = [];

    if (args.name) {
      // Single agent specified
      const agent = workspaceInfo.agents.find(a => a.name === args.name);
      if (!agent) {
        return handleError('AGENT_NOT_FOUND', `Agent "${args.name}" not found.`);
      }
      if (agent.status === 'cleaned') {
        if (jsonMode) {
          outputErrorAsJson('ALREADY_CLEANED', `Agent "${args.name}" has already been cleaned up.`, createMetadata('agent cleanup', flags));
          return;
        }
        this.log(colors.warning(`Agent "${args.name}" has already been cleaned up.`));
        return;
      }
      agentsToCleanup = [args.name];
    } else if (flags.all) {
      // All ephemeral agents (even running ones)
      const allEphemeral = workspaceInfo.agents.filter(
        a => a.type === 'ephemeral' && a.status === 'active'
      );
      if (allEphemeral.length === 0) {
        if (jsonMode) {
          outputErrorAsJson('NO_AGENTS', 'No ephemeral agents to clean up.', createMetadata('agent cleanup', flags));
          return;
        }
        this.log(colors.textMuted('No ephemeral agents to clean up.'));
        return;
      }
      agentsToCleanup = allEphemeral.map(a => a.name);
    } else if (flags.temp) {
      // Only ephemeral agents with no running work
      const cleanable = getCleanableAgents(workspaceInfo, true);
      if (cleanable.length === 0) {
        if (jsonMode) {
          outputErrorAsJson('NO_AGENTS', 'No ephemeral agents available for cleanup (all may have running work).', createMetadata('agent cleanup', flags));
          return;
        }
        this.log(colors.textMuted('No ephemeral agents available for cleanup (all may have running work).'));
        return;
      }
      agentsToCleanup = cleanable.map(a => a.name);
    } else {
      // Interactive mode - show list of cleanable agents
      const allAgents = workspaceInfo.agents.filter(a => a.status === 'active');
      if (allAgents.length === 0) {
        if (jsonMode) {
          outputErrorAsJson('NO_AGENTS', 'No agents to clean up.', createMetadata('agent cleanup', flags));
          return;
        }
        this.log(colors.textMuted('No agents to clean up.'));
        return;
      }

      // Build choices with status info
      const choices = allAgents.map(agent => {
        const sessions = getAgentTmuxSessions(agent.name);
        const hasRunningWork = sessions.length > 0;
        const typeLabel = agent.type === 'ephemeral' ? '[temp]' : '[staff]';
        const statusLabel = hasRunningWork ? ' (running)' : '';
        return {
          name: `${agent.name} ${typeLabel}${statusLabel}`,
          value: agent.name,
          disabled: hasRunningWork,
        };
      });

      choices.push({ name: 'Cancel', value: 'cancel', disabled: false });
      const selectMessage = 'Select agents to clean up:';

      // In JSON mode, output agent selection prompt
      if (jsonMode) {
        outputPromptAsJson(
          buildPromptConfig('checkbox', 'agents', selectMessage, choices),
          createMetadata('agent cleanup', flags)
        );
        return;
      }

      const { selected } = await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'selected',
          message: selectMessage,
          choices: choices.map(c => ({
            ...c,
            disabled: c.disabled ? 'has running work' : false,
          })),
        },
      ]);

      if (selected.length === 0 || selected.includes('cancel')) {
        this.log(colors.textMuted('Operation cancelled.'));
        return;
      }

      agentsToCleanup = selected.filter((s: string) => s !== 'cancel');
    }

    if (agentsToCleanup.length === 0) {
      if (jsonMode) {
        outputErrorAsJson('NO_SELECTION', 'No agents selected for cleanup.', createMetadata('agent cleanup', flags));
        return;
      }
      this.log(colors.textMuted('No agents selected for cleanup.'));
      return;
    }

    // Build confirmation choices
    const confirmChoices = [
      { name: 'No, cancel', value: 'false' },
      { name: 'Yes, clean up', value: 'true' },
    ];
    const confirmMessage = `Clean up ${agentsToCleanup.length} agent(s)? This will remove directories, containers, and tmux sessions.`;

    // Confirm unless forced or dry-run
    if (!force && !dryRun) {
      // In JSON mode, output confirmation prompt with context
      if (jsonMode) {
        const promptConfig = buildPromptConfig('list', 'confirmed', confirmMessage, confirmChoices);
        // Add context about what will be cleaned
        (promptConfig as any).context = { agentsToCleanup };
        outputPromptAsJson(promptConfig, createMetadata('agent cleanup', flags));
        return;
      }

      // Show what will be cleaned
      this.log(colors.primary(`\nAgents to clean up:`));
      for (const name of agentsToCleanup) {
        const agent = workspaceInfo.agents.find(a => a.name === name);
        const typeLabel = agent?.type === 'ephemeral' ? '[temp]' : '[staff]';
        this.log(`  - ${name} ${typeLabel}`);
      }
      this.log('');

      const { confirm } = await inquirer.prompt([
        {
          type: 'list',
          name: 'confirm',
          message: confirmMessage,
          choices: [
            { name: '❌ No, cancel', value: false },
            { name: '✓ Yes, clean up', value: true },
          ],
          default: 0,
        },
      ]);

      if (!confirm) {
        this.log(colors.textMuted('Operation cancelled.'));
        return;
      }
    } else if (!jsonMode) {
      // Show what will be cleaned (for dry-run or force mode)
      this.log(colors.primary(`\n${dryRun ? '[DRY RUN] ' : ''}Agents to clean up:`));
      for (const name of agentsToCleanup) {
        const agent = workspaceInfo.agents.find(a => a.name === name);
        const typeLabel = agent?.type === 'ephemeral' ? '[temp]' : '[staff]';
        this.log(`  - ${name} ${typeLabel}`);
      }
      this.log('');
    }

    // Perform cleanup
    const results: CleanupResult[] = [];
    for (const agentName of agentsToCleanup) {
      if (!jsonMode) {
        this.log(colors.primary(`\nCleaning up: ${agentName}`));
      }

      const result = await cleanupAgent(workspaceInfo, agentName, {
        log: jsonMode ? undefined : (msg) => this.log(colors.textMuted(`  ${msg}`)),
        dryRun,
      });

      results.push(result);
    }

    // JSON mode: output results
    if (jsonMode) {
      outputSuccessAsJson(
        {
          message: `${dryRun ? 'Would clean' : 'Cleaned'} ${results.filter(r => r.success).length} agent(s)`,
          dryRun,
          cleaned: results.filter(r => r.success).map(r => r.agent),
          failed: results.filter(r => !r.success).map(r => r.agent),
          details: results.map(r => ({
            agent: r.agent,
            success: r.success,
            tmuxSessionsKilled: r.tmuxSessionsKilled,
            containersRemoved: r.containersRemoved,
            directoriesRemoved: r.directoriesRemoved,
            errors: r.errors,
          })),
        },
        createMetadata('agent cleanup', flags)
      );
      return;
    }

    // Summary
    this.log(colors.primary('\n--- Summary ---'));

    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    if (successful.length > 0) {
      this.log(format.success(`${dryRun ? 'Would clean' : 'Cleaned'} ${successful.length} agent(s): ${successful.map(r => r.agent).join(', ')}`));
    }

    if (failed.length > 0) {
      this.log(format.error(`Failed to clean ${failed.length} agent(s): ${failed.map(r => r.agent).join(', ')}`));
      for (const result of failed) {
        for (const error of result.errors) {
          this.log(colors.warning(`  - ${result.agent}: ${error}`));
        }
      }
    }

    // Total resources cleaned
    const totalTmux = results.reduce((sum, r) => sum + r.tmuxSessionsKilled.length, 0);
    const totalContainers = results.reduce((sum, r) => sum + r.containersRemoved.length, 0);
    const totalDirs = results.reduce((sum, r) => sum + r.directoriesRemoved.length, 0);

    if (totalTmux > 0 || totalContainers > 0 || totalDirs > 0) {
      this.log(colors.textMuted(`\nResources ${dryRun ? 'that would be ' : ''}cleaned:`));
      if (totalTmux > 0) this.log(colors.textMuted(`  - Tmux sessions: ${totalTmux}`));
      if (totalContainers > 0) this.log(colors.textMuted(`  - Containers: ${totalContainers}`));
      if (totalDirs > 0) this.log(colors.textMuted(`  - Directories: ${totalDirs}`));
    }
  }
}
