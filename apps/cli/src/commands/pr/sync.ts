import { Flags } from '@oclif/core';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import {
  PMOCommand,
  pmoBaseFlags,
} from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { getWorkspaceInfo } from '../../lib/agents/commands.js';
import {
  isGHInstalled,
  isGHAuthenticated,
} from '../../lib/pr/index.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  outputSuccessAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';
import { syncMergedPRs, recordAutoSync } from '../../lib/pr/sync-merged.js';

export default class PRSync extends PMOCommand {
  static description = 'Check GitHub for merged PRs and auto-move linked tickets to Done';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --dry',
    '<%= config.bin %> <%= command.id %> --json',
  ];

  static flags = {
    ...pmoBaseFlags,
    dry: Flags.boolean({
      description: 'Show what would be synced without making changes',
      default: false,
    }),
  };

  async execute(): Promise<void> {
    const { flags } = await this.parse(PRSync);

    const jsonMode = shouldOutputJson(flags);

    const handleError = (code: string, message: string): void => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('pr sync', flags));
        return;
      }
      this.error(message);
    };

    // Check gh CLI
    if (!isGHInstalled()) {
      return handleError('GH_NOT_INSTALLED', 'GitHub CLI (gh) is not installed. Install it from https://cli.github.com/');
    }

    if (!isGHAuthenticated()) {
      return handleError('GH_NOT_AUTHENTICATED', 'GitHub CLI is not authenticated. Run "gh auth login" first.');
    }

    // Get workspace info for database access
    let workspaceInfo;
    try {
      workspaceInfo = getWorkspaceInfo();
    } catch {
      return handleError('NOT_IN_WORKSPACE', 'Not in a workspace. Run "prlt new" first.');
    }

    const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db');
    const db = new Database(dbPath);

    try {
      const result = await syncMergedPRs(this.storage, db, {
        dryRun: flags.dry,
        resolveProvider: (ticketId, projectId) =>
          this.resolveTicketProvider(ticketId, projectId),
      });

      // Record that we ran (resets the auto-sync debounce timer)
      if (!flags.dry) {
        recordAutoSync(db);
      }

      if (jsonMode) {
        outputSuccessAsJson(
          {
            synced: result.synced,
            errors: result.errors,
            dryRun: flags.dry,
          },
          createMetadata('pr sync', flags)
        );
        return;
      }

      if (result.synced.length === 0 && result.errors.length === 0) {
        this.log(styles.muted('No merged PRs to sync.'));
      } else {
        if (result.synced.length > 0) {
          for (const item of result.synced) {
            if (flags.dry) {
              this.log(styles.muted(`   Would move ${item.ticketId} (${item.title}) to Done — PR #${item.prNumber} merged`));
            } else {
              this.log(styles.success(`   ${item.ticketId} → Done (PR #${item.prNumber} merged)`));
            }
          }
          this.log('');
          this.log(styles.success(`${flags.dry ? 'Would sync' : 'Synced'} ${result.synced.length} ticket${result.synced.length === 1 ? '' : 's'}`));
        }
        if (result.errors.length > 0) {
          this.log(styles.error(`${result.errors.length} error${result.errors.length === 1 ? '' : 's'}`));
          for (const err of result.errors) {
            this.log(styles.muted(`   ${err.ticketId}: ${err.error}`));
          }
        }
      }
    } finally {
      db.close();
    }
  }
}
