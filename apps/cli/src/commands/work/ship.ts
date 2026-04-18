import { Args, Flags } from '@oclif/core';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { PMOCommand, pmoBaseFlags, autoExportToBoard } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { getWorkspaceInfo } from '../../lib/agents/commands.js';
import { ExecutionStorage } from '../../lib/execution/storage.js';
import {
  requireGhCli,
} from '../../lib/pr/index.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  outputSuccessAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';
import { openWorkspaceDatabase } from '../../lib/database/index.js';
import { WorkService, ServiceError } from '../../services/index.js';
import type { ProviderStorage } from '../../lib/providers/types.js';

export default class WorkShip extends PMOCommand {
  static description = 'Ship work: rebase, merge PR, and move ticket to Done';

  static examples = [
    '<%= config.bin %> <%= command.id %> TKT-001',
    '<%= config.bin %> <%= command.id %> PRLT-1092',
    '<%= config.bin %> <%= command.id %> --pr 929',
    '<%= config.bin %> <%= command.id %> TKT-001 --dry-run',
    '<%= config.bin %> <%= command.id %> TKT-001 --wait',
    '<%= config.bin %> <%= command.id %> TKT-001 --when-green',
    '<%= config.bin %> <%= command.id %> --when-green --pr 990',
    '<%= config.bin %> <%= command.id %> --when-green --all',
    '<%= config.bin %> <%= command.id %> TKT-001 --no-rebase',
    '<%= config.bin %> <%= command.id %> TKT-001 --no-rebase-siblings',
  ];

  static args = {
    ticketId: Args.string({
      description: 'Ticket ID - prompts with dropdown if not provided',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    pr: Flags.integer({
      description: 'PR number to merge (alternative to ticket ID lookup)',
      required: false,
    }),
    method: Flags.string({
      description: 'Merge method',
      options: ['merge', 'squash', 'rebase'],
      default: 'squash',
    }),
    wait: Flags.boolean({
      description: 'Wait for CI to go green before merging',
      default: false,
    }),
    'when-green': Flags.boolean({
      description: 'Watch CI and auto-merge when all checks pass. Rebases if behind main.',
      default: false,
    }),
    all: Flags.boolean({
      description: 'Ship all currently-green PRs (use with --when-green to watch all)',
      default: false,
    }),
    'no-rebase': Flags.boolean({
      description: 'Fail on conflicts instead of auto-rebasing',
      default: false,
    }),
    'dry-run': Flags.boolean({
      description: 'Show what would happen without doing it',
      default: false,
    }),
    'delete-branch': Flags.boolean({
      description: 'Delete remote branch after merging',
      default: true,
      allowNo: true,
    }),
    admin: Flags.boolean({
      description: 'Use admin privileges to bypass branch protections',
      default: false,
    }),
    'rebase-siblings': Flags.boolean({
      description: 'After merging, rebase other open PRs that become conflicting',
      default: true,
      allowNo: true,
    }),
    'no-transition': Flags.boolean({
      description: 'Skip board state transition (still merges PR)',
      default: false,
    }),
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(WorkShip);
    const projectId = (flags as { project?: string }).project;
    const jsonMode = shouldOutputJson(flags);

    const handleError = (code: string, message: string): void => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('work ship', flags));
        return;
      }
      this.error(message);
    };

    // Pre-flight: gh CLI
    if (!requireGhCli(handleError)) return;

    let workspaceInfo;
    try {
      workspaceInfo = getWorkspaceInfo();
    } catch {
      return handleError('NOT_IN_WORKSPACE', 'Not in a workspace. Run "prlt new" first.');
    }

    const db = openWorkspaceDatabase(workspaceInfo.path);

    try {
      const cwd = this.resolveRepoCwd(workspaceInfo, new ExecutionStorage(db));
      const workService = new WorkService(
        db,
        this.storage as unknown as ProviderStorage & { listTickets: any; updateTicket: any },
        (tid, pid) => this.resolveTicketProvider(tid, pid),
        { info: (msg) => { if (!jsonMode) this.log(styles.muted(`   ${msg}`)) }, warn: (msg) => this.warn(msg) },
      );

      // --- Batch mode ---
      if (flags.all) {
        const result = await workService.shipAll({
          method: flags.method as 'merge' | 'squash' | 'rebase',
          whenGreen: flags['when-green'],
          deleteBranch: flags['delete-branch'],
          rebaseSiblings: flags['rebase-siblings'],
          cwd,
        });

        if (jsonMode) {
          outputSuccessAsJson(result as unknown as Record<string, unknown>, createMetadata('work ship', flags));
        } else {
          this.log(styles.success(`Done: ${result.shipped.length} shipped, ${result.skipped.length} skipped, ${result.failed.length} failed`));
        }
        return;
      }

      // --- Resolve ticket ID (interactive if needed) ---
      let ticketId = args.ticketId;
      if (!ticketId && !flags.pr) {
        const allTickets = await this.storage.listTickets(projectId);
        const shippable = allTickets.filter(t =>
          t.statusCategory === 'started' ||
          (t.statusName && (
            t.statusName.toLowerCase().includes('progress') ||
            t.statusName.toLowerCase().includes('review')
          ))
        );

        if (shippable.length === 0) {
          db.close();
          if (jsonMode) {
            outputErrorAsJson('NO_SHIPPABLE_WORK', 'No in-progress or in-review work found.', createMetadata('work ship', flags));
            return;
          }
          this.log(styles.info('No in-progress or in-review work found.'));
          return;
        }

        const selected = await this.selectFromList({
          message: 'Select work to ship:',
          items: shippable,
          getName: (t) => `${t.id} - ${t.title} (${t.statusName})`,
          getValue: (t) => t.id,
          getCommand: (t) => `prlt work ship ${t.id} --json`,
          jsonMode: jsonMode ? { flags, commandName: 'work ship' } : null,
        });

        if (!selected) { db.close(); return; }
        ticketId = selected;
      }

      // --- Call service ---
      const result = await workService.shipWork({
        ticketId,
        prNumber: flags.pr,
        method: flags.method as 'merge' | 'squash' | 'rebase',
        wait: flags.wait,
        whenGreen: flags['when-green'],
        dryRun: flags['dry-run'],
        deleteBranch: flags['delete-branch'],
        admin: flags.admin,
        rebaseSiblings: flags['rebase-siblings'],
        noTransition: flags['no-transition'],
        noRebase: flags['no-rebase'],
        cwd,
      });

      // Auto-export board after successful ship
      if (result.success && result.ticket) {
        await autoExportToBoard(this.pmoPath, this.storage);
      }

      // --- Output ---
      if (flags['dry-run'] && result.dryRunDetails) {
        this.outputDryRun(result, flags);
      } else if (jsonMode) {
        outputSuccessAsJson({
          shipped: true,
          alreadyMerged: result.alreadyMerged,
          prNumber: result.pr?.number,
          prTitle: result.pr?.title,
          method: result.method,
          ticketId: result.ticket?.id ?? null,
          ticketMovedToDone: !!result.newState,
          newState: result.newState ?? null,
          siblingsRebased: result.siblingsRebased,
          siblingCount: result.siblingCount,
        }, createMetadata('work ship', flags));
      } else {
        this.outputHuman(result);
      }
    } catch (error) {
      if (error instanceof ServiceError) {
        return handleError(error.code, error.message);
      }
      throw error;
    } finally {
      db.close();
    }
  }

  private outputDryRun(result: any, _flags: Record<string, unknown>): void {
    const d = result.dryRunDetails!;
    this.log('');
    this.log(styles.info('Dry run — no changes will be made:'));
    this.log(styles.muted(`   PR:        #${d.pr?.number} — ${d.pr?.title}`));
    this.log(styles.muted(`   CI:        ${d.ciStatus}`));
    this.log(styles.muted(`   Conflicts: ${d.hasConflicts ? 'Yes' : 'None'}`));
    this.log(styles.muted(`   Actions:`));
    for (const action of d.actions) {
      this.log(styles.muted(`     - ${action}`));
    }
  }

  private outputHuman(result: any): void {
    this.log('');
    if (result.alreadyMerged) {
      this.log(styles.success(`Synced: ${result.ticket?.id ?? `PR #${result.pr?.number}`} (PR already merged)`));
    } else {
      this.log(styles.success(`Shipped: ${result.ticket?.id ?? `PR #${result.pr?.number}`}`));
    }
    this.log(styles.muted(`   PR:     #${result.pr?.number} — ${result.pr?.title}`));
    if (!result.alreadyMerged) {
      this.log(styles.muted(`   Method: ${result.method}`));
    }
    if (result.newState && result.ticket) {
      this.log(styles.muted(`   Ticket: ${result.ticket.id} → ${result.newState}`));
    }
    if (result.siblingsRebased) {
      this.log(styles.muted(`   Sibling rebases: ${result.siblingCount}`));
    }
  }

  /**
   * Resolve a repo-level cwd for gh CLI commands.
   */
  private resolveRepoCwd(
    workspaceInfo: ReturnType<typeof getWorkspaceInfo>,
    _executionStorage: ExecutionStorage,
  ): string | undefined {
    // In devcontainer, find repo directories
    if (process.env.DEVCONTAINER === 'true') {
      try {
        const entries = fs.readdirSync('/workspace', { withFileTypes: true });
        const repoDirs = entries.filter(e =>
          e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules'
        );
        if (repoDirs.length > 0) {
          return path.join('/workspace', repoDirs[0].name);
        }
      } catch {
        // Fall through
      }
    }

    // Fall back to workspace repositories
    const mainRepo = workspaceInfo.repositories.find(r => r.type === 'main');
    const repo = mainRepo || workspaceInfo.repositories[0];
    if (repo?.path) {
      const repoPath = path.isAbsolute(repo.path)
        ? repo.path
        : path.join(workspaceInfo.path, repo.path);
      if (fs.existsSync(repoPath)) return repoPath;
    }

    // Scan repos/ directory for git repositories when DB has no repos registered.
    // This handles the case where agents create PRs from worktrees but the
    // workspace repositories table is empty (PRLT-1334).
    const reposDir = path.join(workspaceInfo.path, 'repos');
    if (fs.existsSync(reposDir)) {
      try {
        const entries = fs.readdirSync(reposDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && !entry.name.startsWith('.')) {
            const candidatePath = path.join(reposDir, entry.name);
            if (fs.existsSync(path.join(candidatePath, '.git'))) {
              return candidatePath;
            }
          }
        }
      } catch {
        // Fall through
      }
    }

    return undefined;
  }
}
