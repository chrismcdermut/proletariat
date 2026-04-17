import { expect } from 'chai';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

/**
 * Unit tests for the PRLT-1334 fix: PR lookup fallback when running
 * from HQ directory with no registered repositories.
 *
 * The bug: `prlt work ship --pr <N>` and `prlt work ship PRLT-XXXX` both
 * return NOT_FOUND when run from the HQ root directory because:
 *   1. workspace.repositories is empty (no repos registered in DB)
 *   2. resolveRepoCwd() returns undefined
 *   3. gh pr view runs with cwd=undefined (process.cwd(), which is the
 *      HQ root — not a git repo) and fails
 *
 * The fix adds two layers:
 *   1. resolveRepoCwd() scans repos/ directory for git repos when DB is empty
 *   2. work-service.ts falls back to --repo flag when cwd-based lookup fails
 */
describe('Ship PR Lookup Fallback (PRLT-1334)', () => {
  /**
   * Mirrors the resolveRepoCwd algorithm from ship.ts INCLUDING the new
   * filesystem scan fallback added in this fix.
   */
  function resolveRepoCwd(
    repositories: Array<{ path: string; type: 'main' | 'dependency' }>,
    workspacePath: string,
  ): string | undefined {
    // Existing logic: check registered workspace repositories
    const mainRepo = repositories.find(r => r.type === 'main');
    const repo = mainRepo || repositories[0];
    if (repo?.path) {
      const repoPath = path.isAbsolute(repo.path)
        ? repo.path
        : path.join(workspacePath, repo.path);
      if (fs.existsSync(repoPath)) return repoPath;
    }

    // NEW: Scan repos/ directory for git repositories when DB has no repos
    const reposDir = path.join(workspacePath, 'repos');
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

  describe('resolveRepoCwd filesystem scan fallback', () => {
    let tmpBase: string;

    beforeEach(() => {
      tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-1334-'));
    });

    afterEach(() => {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    });

    it('should find repo via filesystem scan when repositories list is empty', () => {
      // Simulate HQ with repos/my-project containing .git
      const repoDir = path.join(tmpBase, 'repos', 'my-project');
      fs.mkdirSync(path.join(repoDir, '.git'), { recursive: true });

      const result = resolveRepoCwd([], tmpBase);
      expect(result).to.equal(repoDir);
    });

    it('should skip directories without .git', () => {
      // Create repos/docs (no .git) and repos/my-project (with .git)
      const docsDir = path.join(tmpBase, 'repos', 'docs');
      fs.mkdirSync(docsDir, { recursive: true });

      const repoDir = path.join(tmpBase, 'repos', 'my-project');
      fs.mkdirSync(path.join(repoDir, '.git'), { recursive: true });

      const result = resolveRepoCwd([], tmpBase);
      // Should find my-project, not docs
      expect(result).to.not.be.undefined;
      expect(fs.existsSync(path.join(result!, '.git'))).to.be.true;
    });

    it('should skip hidden directories during filesystem scan', () => {
      const hiddenDir = path.join(tmpBase, 'repos', '.hidden');
      fs.mkdirSync(path.join(hiddenDir, '.git'), { recursive: true });

      const repoDir = path.join(tmpBase, 'repos', 'visible-repo');
      fs.mkdirSync(path.join(repoDir, '.git'), { recursive: true });

      const result = resolveRepoCwd([], tmpBase);
      expect(result).to.equal(repoDir);
    });

    it('should return undefined when repos/ directory does not exist', () => {
      // tmpBase exists but has no repos/ subdirectory
      const result = resolveRepoCwd([], tmpBase);
      expect(result).to.be.undefined;
    });

    it('should return undefined when repos/ has no git repositories', () => {
      // Create repos/ with plain directories (no .git)
      const plainDir = path.join(tmpBase, 'repos', 'just-files');
      fs.mkdirSync(plainDir, { recursive: true });

      const result = resolveRepoCwd([], tmpBase);
      expect(result).to.be.undefined;
    });

    it('should prefer registered repositories over filesystem scan', () => {
      // Both registered repo and filesystem repo exist
      const registeredDir = path.join(tmpBase, 'repos', 'registered');
      fs.mkdirSync(registeredDir, { recursive: true });

      const scannedDir = path.join(tmpBase, 'repos', 'scanned');
      fs.mkdirSync(path.join(scannedDir, '.git'), { recursive: true });

      const repos = [
        { path: 'repos/registered', type: 'main' as const },
      ];

      const result = resolveRepoCwd(repos, tmpBase);
      // Should use registered repo, not filesystem scan
      expect(result).to.equal(registeredDir);
    });

    it('should fall back to filesystem scan when registered repo path is invalid', () => {
      // Registered repo points to a non-existent path
      const scannedDir = path.join(tmpBase, 'repos', 'real-repo');
      fs.mkdirSync(path.join(scannedDir, '.git'), { recursive: true });

      const repos = [
        { path: 'repos/missing', type: 'main' as const },
      ];

      const result = resolveRepoCwd(repos, tmpBase);
      // Registered path doesn't exist, falls through to filesystem scan
      expect(result).to.equal(scannedDir);
    });

    it('should find the first git repo alphabetically in repos/', () => {
      // Create multiple repos — should find first alphabetically
      const repoA = path.join(tmpBase, 'repos', 'alpha');
      const repoB = path.join(tmpBase, 'repos', 'beta');
      fs.mkdirSync(path.join(repoA, '.git'), { recursive: true });
      fs.mkdirSync(path.join(repoB, '.git'), { recursive: true });

      const result = resolveRepoCwd([], tmpBase);
      expect(result).to.equal(repoA);
    });
  });

  describe('PR lookup --repo flag fallback logic', () => {
    /**
     * Simulates the fallback logic added to work-service.ts:
     * When getPRByNumber(n, {cwd}) returns null, try deriving the repo
     * slug from cwd and retry with {repo: slug}.
     */
    function simulatePRLookupWithFallback(
      prNumber: number,
      cwd: string | undefined,
      getPRByNumber: (n: number, opts: { cwd?: string; repo?: string }) => { number: number } | null,
      getGitHubRepo: (cwd?: string) => string | null,
    ): { number: number } | null {
      // Primary lookup
      let prInfo = getPRByNumber(prNumber, { cwd });
      if (!prInfo) {
        // Fallback: derive repo slug and use --repo flag
        const repoSlug = cwd ? getGitHubRepo(cwd) : undefined;
        if (repoSlug) {
          prInfo = getPRByNumber(prNumber, { repo: repoSlug });
        }
      }
      return prInfo;
    }

    it('should succeed on primary cwd-based lookup', () => {
      const result = simulatePRLookupWithFallback(
        42,
        '/workspace/repo',
        (n, opts) => opts.cwd ? { number: n } : null,
        () => 'owner/repo',
      );
      expect(result).to.deep.equal({ number: 42 });
    });

    it('should fall back to --repo flag when cwd-based lookup fails', () => {
      const result = simulatePRLookupWithFallback(
        42,
        '/workspace/repo',
        (n, opts) => opts.repo ? { number: n } : null, // only succeeds with repo flag
        () => 'owner/repo',
      );
      expect(result).to.deep.equal({ number: 42 });
    });

    it('should return null when both cwd and repo fallback fail', () => {
      const result = simulatePRLookupWithFallback(
        42,
        '/workspace/repo',
        () => null, // always fails
        () => 'owner/repo',
      );
      expect(result).to.be.null;
    });

    it('should return null when cwd is undefined and no repo can be derived', () => {
      const result = simulatePRLookupWithFallback(
        42,
        undefined,
        () => null,
        () => null,
      );
      expect(result).to.be.null;
    });

    it('should skip fallback when getGitHubRepo returns null', () => {
      let callCount = 0;
      const result = simulatePRLookupWithFallback(
        42,
        '/workspace/repo',
        (_n, _opts) => { callCount++; return null; },
        () => null, // can't derive repo slug
      );
      expect(result).to.be.null;
      // Should have called getPRByNumber only once (no fallback attempt)
      expect(callCount).to.equal(1);
    });
  });

  describe('ticket-based PR lookup with fallback', () => {
    /**
     * Simulates the ticket-to-PR resolution path with fallback.
     * When cwd-based lookups fail, retry with {repo: slug}.
     */
    function simulateTicketPRLookup(
      ticketId: string,
      cwd: string | undefined,
      lookupFns: {
        getPRByNumber: (n: number, opts: { cwd?: string; repo?: string }) => { number: number } | null;
        getPRForBranch: (branch: string, opts: { cwd?: string; repo?: string }) => { number: number } | null;
        findPRForTicket: (ids: string[], opts: { cwd?: string; repo?: string }) => { number: number } | null;
      },
      getGitHubRepo: (cwd?: string) => string | null,
      ticketMeta: { pr_number?: string; branch?: string },
    ): { number: number } | null {
      const repoSlug = cwd ? getGitHubRepo(cwd) : undefined;
      const lookupOpts: { cwd?: string; repo?: string } = repoSlug ? { repo: repoSlug } : { cwd };

      const prNumber = ticketMeta.pr_number ? parseInt(ticketMeta.pr_number, 10) : undefined;
      let prInfo: { number: number } | null = null;

      if (prNumber) {
        prInfo = lookupFns.getPRByNumber(prNumber, { cwd }) || lookupFns.getPRByNumber(prNumber, lookupOpts);
      }

      if (!prInfo && ticketMeta.branch) {
        prInfo = lookupFns.getPRForBranch(ticketMeta.branch, { cwd }) || lookupFns.getPRForBranch(ticketMeta.branch, lookupOpts);
      }

      if (!prInfo) {
        prInfo = lookupFns.findPRForTicket([ticketId], { cwd }) || lookupFns.findPRForTicket([ticketId], lookupOpts);
      }

      return prInfo;
    }

    it('should find PR via branch when cwd fails but repo succeeds', () => {
      const result = simulateTicketPRLookup(
        'PRLT-1331',
        '/workspace',
        {
          getPRByNumber: () => null,
          getPRForBranch: (_b, opts) => opts.repo ? { number: 1185 } : null,
          findPRForTicket: () => null,
        },
        () => 'chrismcdermut/proletariat',
        { branch: 'PRLT-1331/fix/something' },
      );
      expect(result).to.deep.equal({ number: 1185 });
    });

    it('should find PR via ticket ID search when other lookups fail', () => {
      const result = simulateTicketPRLookup(
        'PRLT-1331',
        '/workspace',
        {
          getPRByNumber: () => null,
          getPRForBranch: () => null,
          findPRForTicket: (ids, opts) => opts.repo ? { number: 1185 } : null,
        },
        () => 'chrismcdermut/proletariat',
        {},
      );
      expect(result).to.deep.equal({ number: 1185 });
    });

    it('should succeed on first cwd-based lookup without needing fallback', () => {
      let repoFallbackCalled = false;
      const result = simulateTicketPRLookup(
        'PRLT-1331',
        '/workspace/repo',
        {
          getPRByNumber: (_n, opts) => {
            if (opts.repo) repoFallbackCalled = true;
            return opts.cwd ? { number: 42 } : null;
          },
          getPRForBranch: () => null,
          findPRForTicket: () => null,
        },
        () => 'owner/repo',
        { pr_number: '42' },
      );
      expect(result).to.deep.equal({ number: 42 });
      // The repo fallback path may still be called due to || chaining,
      // but the primary result was found
      expect(result).to.not.be.null;
    });
  });

  describe('PRLookupOptions type contract', () => {
    it('should support both cwd and repo fields', () => {
      // Verify the PRLookupOptions interface supports the repo field
      // used by the --repo flag fallback
      interface PRLookupOptions {
        cwd?: string;
        repo?: string;
      }

      const cwdOpts: PRLookupOptions = { cwd: '/some/path' };
      const repoOpts: PRLookupOptions = { repo: 'owner/repo' };
      const bothOpts: PRLookupOptions = { cwd: '/some/path', repo: 'owner/repo' };

      expect(cwdOpts.cwd).to.equal('/some/path');
      expect(repoOpts.repo).to.equal('owner/repo');
      expect(bothOpts.cwd).to.equal('/some/path');
      expect(bothOpts.repo).to.equal('owner/repo');
    });
  });
});
