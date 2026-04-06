import { Args } from '@oclif/core';
import { PromptCommand } from '../../lib/prompt-command.js'
import { machineOutputFlags } from '../../lib/pmo/index.js'
import { styles, divider } from '../../lib/styles.js';
import {
  requireGhCli,
  getPRByNumber,
  getPRForBranch,
  getCurrentBranch,
  listOpenPRs,
  getPRChecks,
} from '../../lib/pr/index.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  outputSuccessAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';
import { FlagResolver } from '../../lib/flags/index.js';

export default class PRChecks extends PromptCommand {
  static description = 'Show CI check status for a pull request';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> 123',
    '<%= config.bin %> <%= command.id %> --json',
  ];

  static args = {
    prNumber: Args.integer({
      description: 'PR number (defaults to PR for current branch)',
      required: false,
    }),
  };

  static flags = {
    ...machineOutputFlags,
  };

  // Flag to track if PMO is available
  private hasPMO = true;

  async init(): Promise<void> {
    try {
      await super.init();
    } catch {
      this.hasPMO = false;
    }
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(PRChecks);

    const jsonMode = shouldOutputJson(flags);

    const handleError = (code: string, message: string): void => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('pr checks', flags));
        return
      }
      this.error(message);
    };

    // Check gh CLI (differentiated not-installed vs not-authenticated)
    if (!requireGhCli(handleError)) return;

    let prNumber = args.prNumber;

    // If no PR number, try to detect from current branch
    if (!prNumber) {
      const currentBranch = getCurrentBranch();
      if (currentBranch) {
        const branchPR = getPRForBranch(currentBranch);
        if (branchPR) {
          prNumber = branchPR.number;
        }
      }
    }

    // Still no PR number - prompt for selection
    if (!prNumber) {
      const openPRs = listOpenPRs();

      if (openPRs.length === 0) {
        return handleError('NO_OPEN_PRS', 'No open pull requests found.');
      }

      const resolver = new FlagResolver<{ pr?: string }>({
        commandName: 'pr checks',
        baseCommand: 'prlt pr checks',
        jsonMode,
        flags: {},
      });

      resolver.addPrompt({
        flagName: 'pr',
        type: 'list',
        message: 'Select PR to view checks:',
        choices: () => openPRs.map(pr => ({
          name: `#${pr.number} - ${pr.title} (${pr.headBranch})`,
          value: String(pr.number),
        })),
      });

      const resolved = await resolver.resolve();
      prNumber = parseInt(resolved.pr!, 10);
    }

    // Verify PR exists
    const prInfo = getPRByNumber(prNumber);
    if (!prInfo) {
      return handleError('PR_NOT_FOUND', `PR #${prNumber} not found.`);
    }

    // Get checks
    const checks = getPRChecks(prNumber);

    if (jsonMode) {
      outputSuccessAsJson(
        {
          prNumber,
          title: prInfo.title,
          url: prInfo.url,
          checks: checks.map(c => ({
            name: c.name,
            status: c.status,
            conclusion: c.conclusion,
            url: c.url,
          })),
          summary: {
            total: checks.length,
            passing: checks.filter(c => c.conclusion === 'SUCCESS').length,
            failing: checks.filter(c => c.conclusion === 'FAILURE').length,
            pending: checks.filter(c => c.status === 'IN_PROGRESS' || c.status === 'QUEUED').length,
          },
        },
        createMetadata('pr checks', flags)
      );
      return;
    }

    // Interactive output
    this.log('');
    this.log(styles.header(`CI Checks: PR #${prNumber}`));
    this.log(styles.muted(`   ${prInfo.title}`));
    this.log(styles.muted(`   ${prInfo.url}`));
    this.log(divider(60));

    if (checks.length === 0) {
      this.log(styles.muted('   No CI checks found for this PR.'));
      return;
    }

    for (const check of checks) {
      const icon = this.getCheckIcon(check.status, check.conclusion);
      const statusText = check.conclusion || check.status;
      this.log(`${icon} ${check.name} ${styles.muted(`(${statusText})`)}`);
    }

    this.log('');
    this.log(divider(60));

    const passing = checks.filter(c => c.conclusion === 'SUCCESS').length;
    const failing = checks.filter(c => c.conclusion === 'FAILURE').length;
    const pending = checks.filter(c => c.status === 'IN_PROGRESS' || c.status === 'QUEUED').length;

    const parts: string[] = [];
    parts.push(`Total: ${checks.length}`);
    if (passing > 0) parts.push(styles.success(`Passing: ${passing}`));
    if (failing > 0) parts.push(styles.error(`Failing: ${failing}`));
    if (pending > 0) parts.push(styles.warning(`Pending: ${pending}`));

    this.log(parts.join(' | '));
  }

  private getCheckIcon(status: string, conclusion: string): string {
    if (conclusion === 'SUCCESS') return styles.success('✓');
    if (conclusion === 'FAILURE') return styles.error('✗');
    if (conclusion === 'CANCELLED' || conclusion === 'SKIPPED') return styles.muted('○');
    if (status === 'IN_PROGRESS' || status === 'QUEUED') return styles.warning('●');
    return styles.muted('?');
  }
}
