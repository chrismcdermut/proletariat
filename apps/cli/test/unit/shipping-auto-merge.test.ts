import { expect } from 'chai';
import type { PRCheck, MergePRResult } from '../../src/lib/pr/index.js';
import { watchAndShip, type WatchAndShipDeps } from '../../src/lib/shipping/auto-merge.js';
import type { AutoMergeProvider, AutoMergeResult, WhenGreenOptions } from '../../src/lib/shipping/types.js';

/**
 * Unit tests for the shipping/auto-merge module
 * TKT-278 / PRLT-1144: Auto-merge green PRs when shipping policy allows
 *
 * Tests the watchAndShip() function using injectable dependencies
 * to verify the poll loop logic, rebase handling, auto-merge provider
 * interaction, and error handling.
 */

// =============================================================================
// Mock AutoMergeProvider
// =============================================================================

class MockAutoMergeProvider implements AutoMergeProvider {
  readonly name = 'github' as const;

  enableCalls: Array<{ prNumber: number; method: string }> = [];
  disableCalls: Array<{ prNumber: number }> = [];

  enableResult: AutoMergeResult = { success: true, prNumber: 0 };
  disableResult: AutoMergeResult = { success: true, prNumber: 0 };
  mergedState = false;

  enableAutoMerge(prNumber: number, method: 'merge' | 'squash' | 'rebase'): AutoMergeResult {
    this.enableCalls.push({ prNumber, method });
    return { ...this.enableResult, prNumber };
  }

  disableAutoMerge(prNumber: number): AutoMergeResult {
    this.disableCalls.push({ prNumber });
    return { ...this.disableResult, prNumber };
  }

  isPRMerged(): boolean {
    return this.mergedState;
  }
}

// =============================================================================
// Mock Dependencies
// =============================================================================

function makeCheck(overrides: Partial<PRCheck> = {}): PRCheck {
  return {
    name: 'CI',
    status: 'COMPLETED',
    conclusion: 'SUCCESS',
    url: '',
    ...overrides,
  };
}

interface MockDepsConfig {
  checks?: PRCheck[][];
  mergeResult?: MergePRResult;
  conflicting?: boolean[];
  merged?: boolean[];
  rebaseResult?: { success: boolean; error?: string };
}

function makeMockDeps(config: MockDepsConfig = {}): WatchAndShipDeps {
  let checkCallIndex = 0;
  let conflictCallIndex = 0;
  let mergedCallIndex = 0;

  return {
    getPRChecks: () => {
      const checks = config.checks ?? [[makeCheck()]];
      const result = checks[Math.min(checkCallIndex, checks.length - 1)];
      checkCallIndex++;
      return result;
    },
    mergePR: () => config.mergeResult ?? { success: true },
    checkMergeConflicts: () => {
      const conflicts = config.conflicting ?? [false];
      const result = conflicts[Math.min(conflictCallIndex, conflicts.length - 1)];
      conflictCallIndex++;
      return result;
    },
    isPRMerged: () => {
      const merged = config.merged ?? [false];
      const result = merged[Math.min(mergedCallIndex, merged.length - 1)];
      mergedCallIndex++;
      return result;
    },
    rebaseOntoBase: () => config.rebaseResult ?? { success: true },
    sleep: () => Promise.resolve(), // No-op sleep for fast tests
  };
}

function makeOptions(overrides: Partial<WhenGreenOptions> = {}): WhenGreenOptions {
  return {
    prNumber: 100,
    method: 'squash',
    deleteBranch: true,
    admin: false,
    noRebase: false,
    headBranch: 'feature-branch',
    baseBranch: 'main',
    timeoutMs: 5000,
    pollIntervalMs: 10,
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('Shipping: watchAndShip', () => {
  describe('immediate merge (CI already green)', () => {
    it('merges immediately when all CI checks pass', async () => {
      const deps = makeMockDeps({
        checks: [[makeCheck({ conclusion: 'SUCCESS' })]],
        mergeResult: { success: true },
      });

      const result = await watchAndShip(makeOptions(), null, deps);

      expect(result.merged).to.be.true;
      expect(result.pollCycles).to.equal(1);
      expect(result.rebasePerformed).to.be.false;
    });

    it('merges immediately when no CI checks are configured', async () => {
      const deps = makeMockDeps({
        checks: [[]],
        mergeResult: { success: true },
      });

      const result = await watchAndShip(makeOptions(), null, deps);

      expect(result.merged).to.be.true;
      expect(result.pollCycles).to.equal(1);
    });

    it('handles SKIPPED checks as passing', async () => {
      const deps = makeMockDeps({
        checks: [[
          makeCheck({ name: 'lint', conclusion: 'SUCCESS' }),
          makeCheck({ name: 'optional-check', conclusion: 'SKIPPED' }),
        ]],
      });

      const result = await watchAndShip(makeOptions(), null, deps);

      expect(result.merged).to.be.true;
    });
  });

  describe('polling behavior', () => {
    it('polls until CI completes then merges', async () => {
      const deps = makeMockDeps({
        checks: [
          // First poll: pending
          [makeCheck({ name: 'CI', status: 'IN_PROGRESS', conclusion: '' })],
          // Second poll: still pending
          [makeCheck({ name: 'CI', status: 'IN_PROGRESS', conclusion: '' })],
          // Third poll: passed
          [makeCheck({ name: 'CI', conclusion: 'SUCCESS' })],
        ],
      });

      const result = await watchAndShip(makeOptions(), null, deps);

      expect(result.merged).to.be.true;
      expect(result.pollCycles).to.equal(3);
    });

    it('exits with error when CI fails', async () => {
      const deps = makeMockDeps({
        checks: [[makeCheck({ name: 'tests', conclusion: 'FAILURE' })]],
      });

      const result = await watchAndShip(makeOptions(), null, deps);

      expect(result.merged).to.be.false;
      expect(result.errorCode).to.equal('CI_FAILED');
      expect(result.error).to.contain('tests');
    });

    it('times out when CI never completes', async () => {
      const deps = makeMockDeps({
        checks: [[makeCheck({ name: 'CI', status: 'IN_PROGRESS', conclusion: '' })]],
      });

      const result = await watchAndShip(
        makeOptions({ timeoutMs: 100, pollIntervalMs: 20 }),
        null,
        deps,
      );

      expect(result.merged).to.be.false;
      expect(result.errorCode).to.equal('TIMEOUT');
    });
  });

  describe('rebase handling', () => {
    it('rebases when conflicts detected and retries CI', async () => {
      const deps = makeMockDeps({
        checks: [
          // First poll: green
          [makeCheck({ conclusion: 'SUCCESS' })],
          // After rebase, second poll: pending
          [makeCheck({ status: 'IN_PROGRESS', conclusion: '' })],
          // Third poll: green again
          [makeCheck({ conclusion: 'SUCCESS' })],
        ],
        conflicting: [true, false], // First check: conflicting, after rebase: clean
        rebaseResult: { success: true },
      });

      const result = await watchAndShip(makeOptions(), null, deps);

      expect(result.merged).to.be.true;
      expect(result.rebasePerformed).to.be.true;
    });

    it('fails when rebase fails', async () => {
      const deps = makeMockDeps({
        checks: [[makeCheck({ conclusion: 'SUCCESS' })]],
        conflicting: [true],
        rebaseResult: { success: false, error: 'CONFLICT in file.ts' },
      });

      const result = await watchAndShip(makeOptions(), null, deps);

      expect(result.merged).to.be.false;
      expect(result.errorCode).to.equal('REBASE_FAILED');
      expect(result.error).to.contain('CONFLICT');
    });

    it('fails when --no-rebase is set and conflicts exist', async () => {
      const deps = makeMockDeps({
        checks: [[makeCheck({ conclusion: 'SUCCESS' })]],
        conflicting: [true],
      });

      const result = await watchAndShip(
        makeOptions({ noRebase: true }),
        null,
        deps,
      );

      expect(result.merged).to.be.false;
      expect(result.errorCode).to.equal('MERGE_CONFLICTS');
    });

    it('enforces rebase limit to prevent infinite loops', async () => {
      // Always conflicting, always successful rebase → should hit limit
      const deps = makeMockDeps({
        checks: [[makeCheck({ conclusion: 'SUCCESS' })]],
        conflicting: [true], // Always conflicting
        rebaseResult: { success: true },
      });

      const result = await watchAndShip(
        makeOptions({ timeoutMs: 5000, pollIntervalMs: 10 }),
        null,
        deps,
      );

      expect(result.merged).to.be.false;
      expect(result.errorCode).to.equal('REBASE_LIMIT');
    });
  });

  describe('auto-merge provider', () => {
    it('enables native auto-merge when provider is available', async () => {
      const provider = new MockAutoMergeProvider();
      const deps = makeMockDeps({
        checks: [[makeCheck({ conclusion: 'SUCCESS' })]],
      });

      const result = await watchAndShip(makeOptions(), provider, deps);

      expect(result.merged).to.be.true;
      expect(result.autoMergeEnabled).to.be.true;
      expect(provider.enableCalls).to.have.lengthOf(1);
      expect(provider.enableCalls[0].prNumber).to.equal(100);
      expect(provider.enableCalls[0].method).to.equal('squash');
    });

    it('continues without auto-merge if provider fails', async () => {
      const provider = new MockAutoMergeProvider();
      provider.enableResult = { success: false, prNumber: 100, error: 'auto-merge not enabled in repo' };

      const deps = makeMockDeps({
        checks: [[makeCheck({ conclusion: 'SUCCESS' })]],
      });

      const warnings: string[] = [];
      const result = await watchAndShip(
        makeOptions({ onWarning: (msg) => warnings.push(msg) }),
        provider,
        deps,
      );

      expect(result.merged).to.be.true;
      expect(result.autoMergeEnabled).to.be.false;
      expect(warnings).to.have.lengthOf(1);
      expect(warnings[0]).to.contain('auto-merge not enabled in repo');
    });

    it('disables auto-merge on CI failure', async () => {
      const provider = new MockAutoMergeProvider();
      const deps = makeMockDeps({
        checks: [[makeCheck({ name: 'tests', conclusion: 'FAILURE' })]],
      });

      const result = await watchAndShip(makeOptions(), provider, deps);

      expect(result.merged).to.be.false;
      expect(provider.disableCalls).to.have.lengthOf(1);
      expect(provider.disableCalls[0].prNumber).to.equal(100);
    });

    it('disables auto-merge on unresolvable conflicts', async () => {
      const provider = new MockAutoMergeProvider();
      const deps = makeMockDeps({
        checks: [[makeCheck({ conclusion: 'SUCCESS' })]],
        conflicting: [true],
        rebaseResult: { success: false, error: 'CONFLICT' },
      });

      const result = await watchAndShip(makeOptions(), provider, deps);

      expect(result.merged).to.be.false;
      expect(provider.disableCalls).to.have.lengthOf(1);
    });

    it('detects already-merged PR (by auto-merge or external)', async () => {
      const deps = makeMockDeps({
        merged: [true], // Already merged on first check
      });

      const result = await watchAndShip(makeOptions(), null, deps);

      expect(result.merged).to.be.true;
      expect(result.pollCycles).to.equal(1);
    });
  });

  describe('merge failure handling', () => {
    it('returns error on merge failure', async () => {
      const deps = makeMockDeps({
        checks: [[makeCheck({ conclusion: 'SUCCESS' })]],
        mergeResult: { success: false, error: 'Branch protection rule' },
      });

      const result = await watchAndShip(makeOptions(), null, deps);

      expect(result.merged).to.be.false;
      expect(result.errorCode).to.equal('MERGE_FAILED');
      expect(result.error).to.contain('Branch protection rule');
    });

    it('detects already-merged on merge failure (race condition)', async () => {
      let mergeCallCount = 0;
      let mergedCallCount = 0;

      const deps: WatchAndShipDeps = {
        getPRChecks: () => [makeCheck({ conclusion: 'SUCCESS' })],
        mergePR: () => {
          mergeCallCount++;
          return { success: false, error: 'Pull request already merged' };
        },
        checkMergeConflicts: () => false,
        isPRMerged: () => {
          mergedCallCount++;
          // First call (at start of loop): not merged
          // Second call (after merge failure): merged
          return mergedCallCount >= 2;
        },
        rebaseOntoBase: () => ({ success: true }),
        sleep: () => Promise.resolve(),
      };

      const result = await watchAndShip(makeOptions(), null, deps);

      expect(result.merged).to.be.true;
      expect(mergeCallCount).to.equal(1);
    });
  });

  describe('progress callbacks', () => {
    it('reports progress during polling', async () => {
      const messages: string[] = [];
      const deps = makeMockDeps({
        checks: [
          [makeCheck({ name: 'CI', status: 'IN_PROGRESS', conclusion: '' })],
          [makeCheck({ conclusion: 'SUCCESS' })],
        ],
      });

      await watchAndShip(
        makeOptions({ onProgress: (msg) => messages.push(msg) }),
        null,
        deps,
      );

      expect(messages.some(m => m.includes('Waiting for CI'))).to.be.true;
      expect(messages.some(m => m.includes('CI green'))).to.be.true;
    });

    it('reports auto-merge enabled', async () => {
      const messages: string[] = [];
      const provider = new MockAutoMergeProvider();
      const deps = makeMockDeps({
        checks: [[makeCheck({ conclusion: 'SUCCESS' })]],
      });

      await watchAndShip(
        makeOptions({ onProgress: (msg) => messages.push(msg) }),
        provider,
        deps,
      );

      expect(messages.some(m => m.includes('auto-merge'))).to.be.true;
    });
  });

  describe('timeout with auto-merge safety net', () => {
    it('mentions auto-merge in timeout message when enabled', async () => {
      const provider = new MockAutoMergeProvider();
      const deps = makeMockDeps({
        checks: [[makeCheck({ name: 'CI', status: 'IN_PROGRESS', conclusion: '' })]],
      });

      const result = await watchAndShip(
        makeOptions({ timeoutMs: 100, pollIntervalMs: 20 }),
        provider,
        deps,
      );

      expect(result.merged).to.be.false;
      expect(result.autoMergeEnabled).to.be.true;
      expect(result.error).to.contain('auto-merge is still enabled');
    });

    it('does not mention auto-merge in timeout message when not enabled', async () => {
      const deps = makeMockDeps({
        checks: [[makeCheck({ name: 'CI', status: 'IN_PROGRESS', conclusion: '' })]],
      });

      const result = await watchAndShip(
        makeOptions({ timeoutMs: 100, pollIntervalMs: 20 }),
        null,
        deps,
      );

      expect(result.merged).to.be.false;
      expect(result.error).to.contain('Check manually');
      expect(result.error).to.not.contain('auto-merge');
    });
  });
});

describe('Shipping: AutoMergeProvider interface', () => {
  it('MockAutoMergeProvider implements the interface', () => {
    const provider = new MockAutoMergeProvider();

    expect(provider.name).to.equal('github');
    expect(typeof provider.enableAutoMerge).to.equal('function');
    expect(typeof provider.disableAutoMerge).to.equal('function');
    expect(typeof provider.isPRMerged).to.equal('function');
  });

  it('tracks enable/disable calls', () => {
    const provider = new MockAutoMergeProvider();

    provider.enableAutoMerge(42, 'squash');
    provider.disableAutoMerge(42);

    expect(provider.enableCalls).to.have.lengthOf(1);
    expect(provider.enableCalls[0]).to.deep.equal({ prNumber: 42, method: 'squash' });
    expect(provider.disableCalls).to.have.lengthOf(1);
    expect(provider.disableCalls[0]).to.deep.equal({ prNumber: 42 });
  });
});
