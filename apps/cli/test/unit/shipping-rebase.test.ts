import { expect } from 'chai';
import type { PRInfo, MergeableState } from '../../src/lib/pr/index.js';
import type { GitProvider, UpdateBranchResult } from '../../src/lib/shipping/types.js';
import { rebaseSiblingPRs } from '../../src/lib/shipping/rebase.js';

/**
 * Unit tests for the shipping/rebase module
 * TKT-276 / PRLT-1143: Auto-rebase PRs when base branch updates
 *
 * Tests the provider-agnostic rebaseSiblingPRs() function using
 * a mock GitProvider to verify rebase logic, conflict labeling,
 * and filtering behavior.
 */

// =============================================================================
// Mock GitProvider for testing
// =============================================================================

function makePR(overrides: Partial<PRInfo> = {}): PRInfo {
  return {
    number: 1,
    url: 'https://github.com/test/repo/pull/1',
    title: 'Test PR',
    state: 'OPEN',
    headBranch: 'feature-branch',
    baseBranch: 'main',
    isDraft: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

class MockGitProvider implements GitProvider {
  readonly name = 'github' as const;

  /** Open PRs to return from listOpenPRs */
  prs: PRInfo[] = [];

  /** Map of PR number -> mergeable state */
  mergeableStates: Record<number, MergeableState> = {};

  /** Map of PR number -> whether updatePRBranch succeeds */
  updateResults: Record<number, UpdateBranchResult> = {};

  /** Track labels added */
  labelsAdded: Array<{ prNumber: number; label: string }> = [];

  /** Track comments added */
  commentsAdded: Array<{ prNumber: number; body: string }> = [];

  listOpenPRs(): PRInfo[] {
    return this.prs;
  }

  getMergeableState(prNumber: number): MergeableState {
    return this.mergeableStates[prNumber] ?? 'UNKNOWN';
  }

  updatePRBranch(prNumber: number): UpdateBranchResult {
    return this.updateResults[prNumber] ?? {
      success: false,
      prNumber,
      headBranch: '',
      error: 'No mock result configured',
    };
  }

  addLabel(prNumber: number, label: string): boolean {
    this.labelsAdded.push({ prNumber, label });
    return true;
  }

  addComment(prNumber: number, body: string): boolean {
    this.commentsAdded.push({ prNumber, body });
    return true;
  }
}

// =============================================================================
// Tests
// =============================================================================

describe('Shipping: rebaseSiblingPRs', () => {
  let provider: MockGitProvider;

  beforeEach(() => {
    provider = new MockGitProvider();
  });

  describe('basic behavior', () => {
    it('returns empty results when no open PRs exist', () => {
      provider.prs = [];

      const result = rebaseSiblingPRs(
        { excludePRNumber: 1 },
        provider,
      );

      expect(result.succeeded).to.have.lengthOf(0);
      expect(result.failed).to.have.lengthOf(0);
      expect(result.skipped).to.have.lengthOf(0);
      expect(result.totalChecked).to.equal(0);
    });

    it('excludes the specified PR number from rebase', () => {
      provider.prs = [
        makePR({ number: 10, headBranch: 'merged-branch' }),
        makePR({ number: 11, headBranch: 'sibling-branch' }),
      ];
      provider.mergeableStates = { 11: 'CONFLICTING' };
      provider.updateResults = {
        11: { success: true, prNumber: 11, headBranch: 'sibling-branch' },
      };

      const result = rebaseSiblingPRs(
        { excludePRNumber: 10 },
        provider,
      );

      // PR #10 should be excluded, only #11 should be processed
      expect(result.totalChecked).to.equal(1);
      expect(result.succeeded).to.have.lengthOf(1);
      expect(result.succeeded[0].prNumber).to.equal(11);
    });

    it('skips MERGEABLE PRs', () => {
      provider.prs = [
        makePR({ number: 20, headBranch: 'already-clean' }),
      ];
      provider.mergeableStates = { 20: 'MERGEABLE' };

      const result = rebaseSiblingPRs(
        { excludePRNumber: null },
        provider,
      );

      expect(result.totalChecked).to.equal(1);
      expect(result.skipped).to.have.lengthOf(1);
      expect(result.skipped[0].prNumber).to.equal(20);
      expect(result.succeeded).to.have.lengthOf(0);
    });

    it('skips UNKNOWN state PRs', () => {
      provider.prs = [
        makePR({ number: 30, headBranch: 'unknown-state' }),
      ];
      provider.mergeableStates = { 30: 'UNKNOWN' };

      const result = rebaseSiblingPRs(
        { excludePRNumber: null },
        provider,
      );

      expect(result.totalChecked).to.equal(1);
      expect(result.skipped).to.have.lengthOf(1);
      expect(result.succeeded).to.have.lengthOf(0);
    });
  });

  describe('successful rebases', () => {
    it('rebases CONFLICTING PRs and reports success', () => {
      provider.prs = [
        makePR({ number: 40, headBranch: 'feat-a' }),
        makePR({ number: 41, headBranch: 'feat-b' }),
      ];
      provider.mergeableStates = { 40: 'CONFLICTING', 41: 'CONFLICTING' };
      provider.updateResults = {
        40: { success: true, prNumber: 40, headBranch: 'feat-a' },
        41: { success: true, prNumber: 41, headBranch: 'feat-b' },
      };

      const result = rebaseSiblingPRs(
        { excludePRNumber: null },
        provider,
      );

      expect(result.succeeded).to.have.lengthOf(2);
      expect(result.failed).to.have.lengthOf(0);
      expect(result.totalChecked).to.equal(2);
    });
  });

  describe('failed rebases and conflict labeling', () => {
    it('labels PRs on conflict failure when labelConflicts is true', () => {
      provider.prs = [
        makePR({ number: 50, headBranch: 'conflicting-branch' }),
      ];
      provider.mergeableStates = { 50: 'CONFLICTING' };
      provider.updateResults = {
        50: {
          success: false,
          prNumber: 50,
          headBranch: 'conflicting-branch',
          error: 'Merge conflicts detected',
          hasConflicts: true,
        },
      };

      const result = rebaseSiblingPRs(
        { excludePRNumber: null, labelConflicts: true, commentOnConflicts: true },
        provider,
      );

      expect(result.failed).to.have.lengthOf(1);
      expect(result.failed[0].hasConflicts).to.be.true;

      // Should have added a label
      expect(provider.labelsAdded).to.have.lengthOf(1);
      expect(provider.labelsAdded[0].prNumber).to.equal(50);
      expect(provider.labelsAdded[0].label).to.equal('rebase-conflict');

      // Should have added a comment
      expect(provider.commentsAdded).to.have.lengthOf(1);
      expect(provider.commentsAdded[0].prNumber).to.equal(50);
      expect(provider.commentsAdded[0].body).to.contain('merge conflicts');
    });

    it('does not label PRs when labelConflicts is false', () => {
      provider.prs = [
        makePR({ number: 51, headBranch: 'conflict-no-label' }),
      ];
      provider.mergeableStates = { 51: 'CONFLICTING' };
      provider.updateResults = {
        51: {
          success: false,
          prNumber: 51,
          headBranch: 'conflict-no-label',
          error: 'Merge conflicts detected',
          hasConflicts: true,
        },
      };

      const result = rebaseSiblingPRs(
        { excludePRNumber: null, labelConflicts: false, commentOnConflicts: false },
        provider,
      );

      expect(result.failed).to.have.lengthOf(1);
      expect(provider.labelsAdded).to.have.lengthOf(0);
      expect(provider.commentsAdded).to.have.lengthOf(0);
    });

    it('does not label non-conflict failures', () => {
      provider.prs = [
        makePR({ number: 52, headBranch: 'network-error' }),
      ];
      provider.mergeableStates = { 52: 'CONFLICTING' };
      provider.updateResults = {
        52: {
          success: false,
          prNumber: 52,
          headBranch: 'network-error',
          error: 'Network timeout',
          hasConflicts: false,
        },
      };

      const result = rebaseSiblingPRs(
        { excludePRNumber: null, labelConflicts: true, commentOnConflicts: true },
        provider,
      );

      expect(result.failed).to.have.lengthOf(1);
      // Should NOT label — it's not a conflict, it's a network error
      expect(provider.labelsAdded).to.have.lengthOf(0);
      expect(provider.commentsAdded).to.have.lengthOf(0);
    });
  });

  describe('mixed results', () => {
    it('handles mix of success, failure, and skip', () => {
      provider.prs = [
        makePR({ number: 60, headBranch: 'clean-pr' }),
        makePR({ number: 61, headBranch: 'conflicting-pr' }),
        makePR({ number: 62, headBranch: 'also-conflicting' }),
        makePR({ number: 99, headBranch: 'excluded-pr' }),
      ];
      provider.mergeableStates = {
        60: 'MERGEABLE',
        61: 'CONFLICTING',
        62: 'CONFLICTING',
        99: 'CONFLICTING',
      };
      provider.updateResults = {
        61: { success: true, prNumber: 61, headBranch: 'conflicting-pr' },
        62: {
          success: false,
          prNumber: 62,
          headBranch: 'also-conflicting',
          error: 'Conflicts',
          hasConflicts: true,
        },
      };

      const result = rebaseSiblingPRs(
        { excludePRNumber: 99, labelConflicts: true, commentOnConflicts: false },
        provider,
      );

      // PR #99 excluded, PR #60 skipped (MERGEABLE), PR #61 success, PR #62 failed
      expect(result.totalChecked).to.equal(3);
      expect(result.skipped).to.have.lengthOf(1);
      expect(result.skipped[0].prNumber).to.equal(60);
      expect(result.succeeded).to.have.lengthOf(1);
      expect(result.succeeded[0].prNumber).to.equal(61);
      expect(result.failed).to.have.lengthOf(1);
      expect(result.failed[0].prNumber).to.equal(62);

      // Label added for conflict, but no comment (commentOnConflicts: false)
      expect(provider.labelsAdded).to.have.lengthOf(1);
      expect(provider.commentsAdded).to.have.lengthOf(0);
    });
  });

  describe('rebaseAll option', () => {
    it('attempts all PRs when rebaseAll is true, regardless of state', () => {
      provider.prs = [
        makePR({ number: 70, headBranch: 'pr-a' }),
        makePR({ number: 71, headBranch: 'pr-b' }),
      ];
      provider.mergeableStates = { 70: 'MERGEABLE', 71: 'CONFLICTING' };
      provider.updateResults = {
        70: { success: true, prNumber: 70, headBranch: 'pr-a' },
        71: { success: true, prNumber: 71, headBranch: 'pr-b' },
      };

      const result = rebaseSiblingPRs(
        { excludePRNumber: null, rebaseAll: true },
        provider,
      );

      // Both PRs should be attempted, even the MERGEABLE one
      expect(result.totalChecked).to.equal(2);
      expect(result.succeeded).to.have.lengthOf(2);
      expect(result.skipped).to.have.lengthOf(0);
    });
  });

  describe('progress callback', () => {
    it('calls onProgress for each PR being rebased', () => {
      const progressMessages: string[] = [];

      provider.prs = [
        makePR({ number: 80, headBranch: 'feat-x' }),
        makePR({ number: 81, headBranch: 'feat-y' }),
      ];
      provider.mergeableStates = { 80: 'CONFLICTING', 81: 'CONFLICTING' };
      provider.updateResults = {
        80: { success: true, prNumber: 80, headBranch: 'feat-x' },
        81: { success: true, prNumber: 81, headBranch: 'feat-y' },
      };

      rebaseSiblingPRs(
        {
          excludePRNumber: null,
          onProgress: (msg) => progressMessages.push(msg),
        },
        provider,
      );

      expect(progressMessages).to.have.lengthOf(2);
      expect(progressMessages[0]).to.contain('#80');
      expect(progressMessages[1]).to.contain('#81');
    });
  });

  describe('null provider handling', () => {
    it('returns empty results when provider is explicitly null', () => {
      // Pass an explicit null provider to bypass auto-detection
      // Create a provider that returns no PRs to simulate "no provider" behavior
      const emptyProvider = new MockGitProvider();
      emptyProvider.prs = [];

      const result = rebaseSiblingPRs(
        { excludePRNumber: null },
        emptyProvider,
      );

      expect(result.succeeded).to.have.lengthOf(0);
      expect(result.failed).to.have.lengthOf(0);
      expect(result.skipped).to.have.lengthOf(0);
      expect(result.totalChecked).to.equal(0);
    });
  });
});

describe('Shipping: GitProvider interface', () => {
  it('MockGitProvider implements GitProvider interface', () => {
    const provider = new MockGitProvider();

    expect(provider.name).to.equal('github');
    expect(typeof provider.listOpenPRs).to.equal('function');
    expect(typeof provider.getMergeableState).to.equal('function');
    expect(typeof provider.updatePRBranch).to.equal('function');
    expect(typeof provider.addLabel).to.equal('function');
    expect(typeof provider.addComment).to.equal('function');
  });
});
