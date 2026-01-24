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
    yes: Flags.boolean({
      char: 'y',
      description: 'Skip confirmation prompt',
      default: false,
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Force cleanup even if there is uncommitted/unpushed work',
      default: false,
    }),
    push: Flags.boolean({
      description: 'Push unpushed commits before cleanup',
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
    const skipConfirm = flags.yes;
    const forceCleanup = flags.force;
    const pushFirst = flags.push;

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

      // Separate temp and staff agents
      const tempAgents = allAgents.filter(a => a.type === 'ephemeral');
      const staffAgents = allAgents.filter(a => a.type !== 'ephemeral');

      // Build choices with separators
      const choices: Array<{ name: string; value: string; disabled?: boolean | string } | inquirer.Separator> = [];

      // Add "All temp agents" option if there are temp agents
      if (tempAgents.length > 0) {
        const cleanableTempAgents = tempAgents.filter(a => {
          const sessions = getAgentTmuxSessions(a.name);
          return sessions.length === 0;
        });
        if (cleanableTempAgents.length > 0) {
          choices.push({ name: `🧹 All temp agents (${cleanableTempAgents.length} cleanable)`, value: '__all_temp__' });
        }
      }

      choices.push(new inquirer.Separator('── Cancel ──'));
      choices.push({ name: '✗ Cancel', value: '__cancel__' });

      // Add temp agents
      if (tempAgents.length > 0) {
        choices.push(new inquirer.Separator(`── Temp Agents (${tempAgents.length}) ──`));
        for (const agent of tempAgents) {
          const sessions = getAgentTmuxSessions(agent.name);
          const hasRunningWork = sessions.length > 0;
          const statusLabel = hasRunningWork ? ' (running)' : '';
          choices.push({
            name: `${agent.name}${statusLabel}`,
            value: agent.name,
            disabled: hasRunningWork ? 'has running work' : false,
          });
        }
      }

      // Add staff agents
      if (staffAgents.length > 0) {
        choices.push(new inquirer.Separator(`── Staff Agents (${staffAgents.length}) ──`));
        for (const agent of staffAgents) {
          const sessions = getAgentTmuxSessions(agent.name);
          const hasRunningWork = sessions.length > 0;
          const statusLabel = hasRunningWork ? ' (running)' : '';
          choices.push({
            name: `${agent.name}${statusLabel}`,
            value: agent.name,
            disabled: hasRunningWork ? 'has running work' : false,
          });
        }
      }

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
          choices,
        },
      ]);

      if (selected.length === 0 || selected.includes('__cancel__')) {
        this.log(colors.textMuted('Operation cancelled.'));
        return;
      }

      // Handle "All temp agents" selection
      if (selected.includes('__all_temp__')) {
        const cleanableTempAgents = tempAgents.filter(a => {
          const sessions = getAgentTmuxSessions(a.name);
          return sessions.length === 0;
        });
        agentsToCleanup = cleanableTempAgents.map(a => a.name);
      } else {
        agentsToCleanup = selected.filter((s: string) => !s.startsWith('__'));
      }
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

    // Confirm unless --yes or dry-run
    if (!skipConfirm && !dryRun) {
      // In JSON mode, output confirmation prompt with context
      if (jsonMode) {
        const promptConfig = {
          ...buildPromptConfig('list', 'confirmed', confirmMessage, confirmChoices),
          context: { agentsToCleanup },
        };
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

      // eslint-disable-next-line no-await-in-loop -- Sequential cleanup with user interaction
      const result = await cleanupAgent(workspaceInfo, agentName, {
        log: jsonMode ? undefined : (msg) => this.log(colors.textMuted(`  ${msg}`)),
        dryRun,
        force: forceCleanup,
        pushFirst,
      });

      // Handle blocked by git status - offer interactive options
      if (result.blockedByGit && !jsonMode && !forceCleanup && !pushFirst) {
        this.log(colors.warning(`\n⚠️  Agent "${agentName}" has unsaved work:`));

        // Determine what kind of unsaved work exists
        let hasUncommitted = false;
        let hasUnpushed = false;

        if (result.gitStatus) {
          for (const wt of result.gitStatus.worktrees) {
            if (wt.hasUncommittedChanges) {
              hasUncommitted = true;
              this.log(colors.textMuted(`  ${wt.repoName}: ${wt.uncommittedFiles.length} uncommitted file(s)`));
            }
            if (wt.hasUnpushedCommits) {
              hasUnpushed = true;
              this.log(colors.textMuted(`  ${wt.repoName}: ${wt.unpushedCount} unpushed commit(s) on ${wt.branch}`));
            }
          }
        }

        // Build choices based on what's unsaved
        const choices: Array<{ name: string; value: string }> = [];

        if (hasUncommitted && hasUnpushed) {
          // Both uncommitted and unpushed - will commit all and push
          choices.push({ name: '💾 Commit all changes, push, and cleanup', value: 'push' });
        } else if (hasUncommitted) {
          // Only uncommitted - will commit and push
          choices.push({ name: '💾 Commit changes, push, and cleanup', value: 'push' });
        } else if (hasUnpushed) {
          // Only unpushed commits - just push
          choices.push({ name: '⬆️  Push commits and cleanup', value: 'push' });
        }

        choices.push({ name: '🗑️  Force cleanup (discard all changes)', value: 'force' });
        choices.push({ name: '⏭️  Skip this agent', value: 'skip' });

        // In interactive mode, prompt for action
        // eslint-disable-next-line no-await-in-loop -- User interaction per agent
        const { action } = await inquirer.prompt([
          {
            type: 'list',
            name: 'action',
            message: `What would you like to do with ${agentName}?`,
            choices,
          },
        ]);

        if (action === 'skip') {
          this.log(colors.textMuted(`  Skipping ${agentName}`));
          results.push(result);
          continue;
        }

        // Re-run cleanup with the selected option
        // eslint-disable-next-line no-await-in-loop
        const retryResult = await cleanupAgent(workspaceInfo, agentName, {
          log: (msg) => this.log(colors.textMuted(`  ${msg}`)),
          dryRun,
          force: action === 'force',
          pushFirst: action === 'push',
        });
        results.push(retryResult);
        continue;
      }

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
