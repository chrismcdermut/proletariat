import { Flags } from '@oclif/core';
import { colors, format } from '../../lib/colors.js';
import { getWorkspaceInfo } from '../../lib/agents/commands.js';
import { PromptCommand } from '../../lib/prompt-command.js'
import { machineOutputFlags } from '../../lib/pmo/index.js'
import {
  pruneAgentRecords,
  RECYCLABLE_STATUSES,
} from '../../lib/database/index.js';
import {
  shouldOutputJson,
  outputSuccessAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';

export default class GC extends PromptCommand {
  static description = 'Garbage collect stale agent records from the database';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --days 7',
    '<%= config.bin %> <%= command.id %> --dry-run',
    '<%= config.bin %> <%= command.id %> --all',
  ];

  static flags = {
    ...machineOutputFlags,
    days: Flags.integer({
      char: 'd',
      description: 'Only prune records older than this many days',
      default: 30,
    }),
    'dry-run': Flags.boolean({
      description: 'Show what would be pruned without actually deleting',
      default: false,
    }),
    all: Flags.boolean({
      description: 'Prune all terminal-state records regardless of age',
      default: false,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(GC);
    const jsonMode = shouldOutputJson(flags);

    const workspaceInfo = getWorkspaceInfo();
    const dryRun = flags['dry-run'];
    const days = flags.all ? 0 : flags.days;

    const result = pruneAgentRecords(workspaceInfo.path, {
      olderThanDays: days,
      statuses: [...RECYCLABLE_STATUSES],
      dryRun,
    });

    if (jsonMode) {
      outputSuccessAsJson(
        {
          message: result.pruned.length === 0
            ? 'No stale agent records to prune'
            : `${dryRun ? 'Would prune' : 'Pruned'} ${result.pruned.length} agent record(s)`,
          pruned: result.pruned.map(a => ({
            name: a.name,
            type: a.type,
            status: a.status,
            created_at: a.created_at,
            cleaned_at: a.cleaned_at,
          })),
          dryRun,
        },
        createMetadata('agent gc', flags),
      );
      return;
    }

    if (result.pruned.length === 0) {
      this.log(colors.textMuted(`No stale agent records to prune (threshold: ${days} days).`));
      return;
    }

    this.log(format.success(
      `${dryRun ? 'Would prune' : 'Pruned'} ${result.pruned.length} agent record(s)${dryRun ? ' (dry run)' : ''}:`
    ));

    for (const agent of result.pruned) {
      const age = Math.floor(
        (Date.now() - new Date(agent.created_at).getTime()) / (1000 * 60 * 60 * 24)
      );
      this.log(colors.textMuted(
        `  ${agent.name} [${agent.type}] status=${agent.status} age=${age}d`
      ));
    }

    if (!dryRun) {
      this.log(colors.textMuted('\nAgent names have been freed for reuse.'));
    }
  }
}
