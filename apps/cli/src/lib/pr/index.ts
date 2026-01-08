/**
 * PR Utilities
 *
 * Utilities for creating and managing GitHub pull requests.
 * Uses the `gh` CLI for GitHub operations.
 */

import { execSync, spawnSync } from 'node:child_process';

// =============================================================================
// Types
// =============================================================================

export interface PRInfo {
  number: number;
  url: string;
  title: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  headBranch: string;
  baseBranch: string;
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePROptions {
  title: string;
  body?: string;
  base?: string;
  draft?: boolean;
  cwd?: string;
}

export interface CreatePRResult {
  success: boolean;
  url?: string;
  number?: number;
  error?: string;
}

// =============================================================================
// GitHub CLI Detection
// =============================================================================

/**
 * Check if `gh` CLI is installed.
 */
export function isGHInstalled(): boolean {
  try {
    execSync('gh --version', { stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if `gh` is authenticated.
 */
export function isGHAuthenticated(): boolean {
  try {
    execSync('gh auth status', { stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the authenticated GitHub username.
 */
export function getGHUsername(): string | null {
  try {
    const result = execSync('gh api user -q .login', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return result || null;
  } catch {
    return null;
  }
}

/**
 * Check if GH_TOKEN or GITHUB_TOKEN is set in environment.
 */
export function isGHTokenInEnv(): boolean {
  return !!(process.env.GH_TOKEN || process.env.GITHUB_TOKEN);
}

// =============================================================================
// Git Remote Detection
// =============================================================================

/**
 * Get the GitHub repository from git remote.
 * Returns format: owner/repo
 */
export function getGitHubRepo(cwd?: string): string | null {
  try {
    const remoteUrl = execSync('git remote get-url origin', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    // Parse GitHub URL formats:
    // https://github.com/owner/repo.git
    // git@github.com:owner/repo.git
    // ssh://git@github.com/owner/repo.git
    const httpsMatch = remoteUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)(\.git)?$/);
    const sshMatch = remoteUrl.match(/git@github\.com:([^/]+)\/([^/.]+)(\.git)?$/);

    const match = httpsMatch || sshMatch;
    if (match) {
      return `${match[1]}/${match[2]}`;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Get the default base branch (main or master).
 */
export function getDefaultBaseBranch(cwd?: string): string {
  try {
    // Check if 'main' exists
    execSync('git rev-parse --verify main', {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return 'main';
  } catch {
    // Fall back to 'master'
    try {
      execSync('git rev-parse --verify master', {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return 'master';
    } catch {
      return 'main'; // Default to main even if not found
    }
  }
}

/**
 * Get the current branch name.
 */
export function getCurrentBranch(cwd?: string): string | null {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Check if the current branch has been pushed to remote.
 */
export function hasBranchBeenPushed(branch: string, cwd?: string): boolean {
  try {
    execSync(`git rev-parse --verify origin/${branch}`, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Push the current branch to origin.
 */
export function pushBranch(branch: string, cwd?: string): boolean {
  try {
    execSync(`git push -u origin ${branch}`, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if there are unpushed commits.
 */
export function hasUnpushedCommits(branch: string, cwd?: string): boolean {
  try {
    const result = execSync(`git log origin/${branch}..HEAD --oneline`, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return result.length > 0;
  } catch {
    // If origin/branch doesn't exist, all commits are unpushed
    return true;
  }
}

/**
 * Get the commit log between base and head.
 */
export function getCommitLog(base: string, cwd?: string): string[] {
  try {
    const output = execSync(`git log ${base}..HEAD --oneline`, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return output ? output.split('\n') : [];
  } catch {
    return [];
  }
}

// =============================================================================
// PR Operations
// =============================================================================

/**
 * Create a GitHub pull request using `gh` CLI.
 */
export function createPR(options: CreatePROptions): CreatePRResult {
  const { title, body, base, draft, cwd } = options;

  const args = ['pr', 'create', '--title', title];

  if (body) {
    args.push('--body', body);
  }

  if (base) {
    args.push('--base', base);
  }

  if (draft) {
    args.push('--draft');
  }

  try {
    const result = spawnSync('gh', args, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (result.status !== 0) {
      return {
        success: false,
        error: result.stderr || 'Failed to create PR',
      };
    }

    // Parse the PR URL from stdout
    const url = result.stdout.trim();
    const prMatch = url.match(/\/pull\/(\d+)/);
    const number = prMatch ? parseInt(prMatch[1], 10) : undefined;

    return {
      success: true,
      url,
      number,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get PR info for a branch.
 */
export function getPRForBranch(branch: string, cwd?: string): PRInfo | null {
  try {
    const result = execSync(`gh pr view ${branch} --json number,url,title,state,headRefName,baseRefName,isDraft,createdAt,updatedAt`, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const data = JSON.parse(result);
    return {
      number: data.number,
      url: data.url,
      title: data.title,
      state: data.state,
      headBranch: data.headRefName,
      baseBranch: data.baseRefName,
      isDraft: data.isDraft,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    };
  } catch {
    return null;
  }
}

/**
 * Get PR info by number.
 */
export function getPRByNumber(prNumber: number, cwd?: string): PRInfo | null {
  try {
    const result = execSync(`gh pr view ${prNumber} --json number,url,title,state,headRefName,baseRefName,isDraft,createdAt,updatedAt`, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const data = JSON.parse(result);
    return {
      number: data.number,
      url: data.url,
      title: data.title,
      state: data.state,
      headBranch: data.headRefName,
      baseBranch: data.baseRefName,
      isDraft: data.isDraft,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    };
  } catch {
    return null;
  }
}

/**
 * List open PRs for the current repo.
 */
export function listOpenPRs(cwd?: string): PRInfo[] {
  try {
    const result = execSync('gh pr list --json number,url,title,state,headRefName,baseRefName,isDraft,createdAt,updatedAt', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const data = JSON.parse(result) as Array<{
      number: number;
      url: string;
      title: string;
      state: 'OPEN' | 'CLOSED' | 'MERGED';
      headRefName: string;
      baseRefName: string;
      isDraft: boolean;
      createdAt: string;
      updatedAt: string;
    }>;

    return data.map(pr => ({
      number: pr.number,
      url: pr.url,
      title: pr.title,
      state: pr.state,
      headBranch: pr.headRefName,
      baseBranch: pr.baseRefName,
      isDraft: pr.isDraft,
      createdAt: pr.createdAt,
      updatedAt: pr.updatedAt,
    }));
  } catch {
    return [];
  }
}

// =============================================================================
// PR Title Generation
// =============================================================================

/**
 * Generate PR title from ticket info.
 */
export function generatePRTitle(ticketId: string, ticketTitle: string): string {
  return `${ticketId}: ${ticketTitle}`;
}

/**
 * Generate PR body from ticket info.
 */
export function generatePRBody(options: {
  ticketId: string;
  ticketTitle: string;
  ticketDescription?: string;
  commits?: string[];
}): string {
  const { ticketId, ticketTitle, ticketDescription, commits } = options;

  const lines: string[] = [];

  lines.push('## Summary');
  lines.push('');
  lines.push(`Resolves ${ticketId}: ${ticketTitle}`);
  lines.push('');

  if (ticketDescription) {
    lines.push('## Description');
    lines.push('');
    lines.push(ticketDescription);
    lines.push('');
  }

  if (commits && commits.length > 0) {
    lines.push('## Changes');
    lines.push('');
    for (const commit of commits) {
      lines.push(`- ${commit}`);
    }
    lines.push('');
  }

  lines.push('## Test Plan');
  lines.push('');
  lines.push('- [ ] Tests pass locally');
  lines.push('- [ ] Manual testing completed');
  lines.push('');

  return lines.join('\n');
}

// =============================================================================
// PR Feedback/Reviews
// =============================================================================

/**
 * Comment on a PR (either review comment or general comment).
 */
export interface PRComment {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  path?: string;      // File path (for review comments)
  line?: number;      // Line number (for review comments)
  diffHunk?: string;  // Code context (for review comments)
}

/**
 * Review on a PR.
 */
export interface PRReview {
  id: string;
  author: string;
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'PENDING' | 'DISMISSED';
  body: string;
  createdAt: string;
  comments: PRComment[];
}

/**
 * Full feedback for a PR (reviews + comments).
 */
export interface PRFeedback {
  prNumber: number;
  prUrl: string;
  prTitle: string;
  reviews: PRReview[];
  comments: PRComment[];
  reviewDecision?: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
}

/**
 * Get PR feedback (reviews and comments) by PR URL or number.
 */
export function getPRFeedback(prUrlOrNumber: string | number, cwd?: string): PRFeedback | null {
  try {
    const result = execSync(
      `gh pr view ${prUrlOrNumber} --json number,url,title,reviews,comments,reviewDecision`,
      {
        cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );

    const data = JSON.parse(result);

    // Parse reviews
    const reviews: PRReview[] = (data.reviews || []).map((review: {
      id: string;
      author: { login: string };
      state: string;
      body: string;
      createdAt: string;
      comments?: Array<{
        id: string;
        author: { login: string };
        body: string;
        createdAt: string;
        path?: string;
        line?: number;
        diffHunk?: string;
      }>;
    }) => ({
      id: review.id,
      author: review.author?.login || 'unknown',
      state: review.state,
      body: review.body || '',
      createdAt: review.createdAt,
      comments: (review.comments || []).map(c => ({
        id: c.id,
        author: c.author?.login || 'unknown',
        body: c.body,
        createdAt: c.createdAt,
        path: c.path,
        line: c.line,
        diffHunk: c.diffHunk,
      })),
    }));

    // Parse general comments (not part of reviews)
    const comments: PRComment[] = (data.comments || []).map((comment: {
      id: string;
      author: { login: string };
      body: string;
      createdAt: string;
    }) => ({
      id: comment.id,
      author: comment.author?.login || 'unknown',
      body: comment.body,
      createdAt: comment.createdAt,
    }));

    return {
      prNumber: data.number,
      prUrl: data.url,
      prTitle: data.title,
      reviews,
      comments,
      reviewDecision: data.reviewDecision,
    };
  } catch {
    return null;
  }
}

/**
 * Check if a PR has pending feedback that needs addressing.
 */
export function hasPendingFeedback(feedback: PRFeedback): boolean {
  // Check for "changes requested" reviews
  const hasChangesRequested = feedback.reviews.some(r => r.state === 'CHANGES_REQUESTED');
  if (hasChangesRequested) return true;

  // Check review decision
  if (feedback.reviewDecision === 'CHANGES_REQUESTED') return true;

  // Check for unresolved comments (any review comments or general comments)
  const hasReviewComments = feedback.reviews.some(r => r.comments.length > 0);
  const hasGeneralComments = feedback.comments.length > 0;

  return hasReviewComments || hasGeneralComments;
}

/**
 * Format PR feedback as markdown for agent prompt.
 */
export function formatPRFeedbackForPrompt(feedback: PRFeedback): string {
  const lines: string[] = [];

  lines.push(`## PR Feedback to Address`);
  lines.push('');
  lines.push(`**PR:** ${feedback.prTitle} (#${feedback.prNumber})`);
  lines.push(`**URL:** ${feedback.prUrl}`);

  if (feedback.reviewDecision) {
    const decisionEmoji = feedback.reviewDecision === 'APPROVED' ? '✅' :
                          feedback.reviewDecision === 'CHANGES_REQUESTED' ? '❌' : '⏳';
    lines.push(`**Status:** ${decisionEmoji} ${feedback.reviewDecision}`);
  }
  lines.push('');

  // Add reviews with comments
  const reviewsWithFeedback = feedback.reviews.filter(r =>
    r.state === 'CHANGES_REQUESTED' || r.body || r.comments.length > 0
  );

  if (reviewsWithFeedback.length > 0) {
    lines.push('### Reviews');
    lines.push('');

    for (const review of reviewsWithFeedback) {
      const stateEmoji = review.state === 'APPROVED' ? '✅' :
                         review.state === 'CHANGES_REQUESTED' ? '❌' : '💬';
      lines.push(`#### ${stateEmoji} ${review.author} (${review.state})`);

      if (review.body) {
        lines.push('');
        lines.push(review.body);
      }

      if (review.comments.length > 0) {
        lines.push('');
        lines.push('**Comments:**');
        for (const comment of review.comments) {
          lines.push('');
          if (comment.path) {
            lines.push(`📄 **${comment.path}**${comment.line ? `:${comment.line}` : ''}`);
            if (comment.diffHunk) {
              lines.push('```diff');
              lines.push(comment.diffHunk);
              lines.push('```');
            }
          }
          lines.push(`> ${comment.body.replace(/\n/g, '\n> ')}`);
        }
      }
      lines.push('');
    }
  }

  // Add general comments
  if (feedback.comments.length > 0) {
    lines.push('### General Comments');
    lines.push('');
    for (const comment of feedback.comments) {
      lines.push(`**${comment.author}:**`);
      lines.push(`> ${comment.body.replace(/\n/g, '\n> ')}`);
      lines.push('');
    }
  }

  lines.push('---');
  lines.push('');
  lines.push('Please address the feedback above. After making changes, commit and push.');

  return lines.join('\n');
}
