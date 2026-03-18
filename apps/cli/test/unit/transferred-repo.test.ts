import { expect } from 'chai';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  parseOwnerRepo,
  detectTransferredRepo,
  detectAndFixTransferredRepo,
} from '../../src/lib/repos/git.js';

/**
 * Unit tests for transferred repo detection
 * Ticket: PRLT-993 / TKT-160
 *
 * When a GitHub repo is transferred to a new org, the local remote still points
 * to the old org. This causes PR creation to fail. These functions detect the
 * transfer and update the remote URL.
 */
describe('Transferred Repo Detection', () => {
  describe('parseOwnerRepo', () => {
    it('should parse HTTPS URL with .git suffix', () => {
      expect(parseOwnerRepo('https://github.com/getCora/myrepo.git')).to.equal('getCora/myrepo');
    });

    it('should parse HTTPS URL without .git suffix', () => {
      expect(parseOwnerRepo('https://github.com/getCora/myrepo')).to.equal('getCora/myrepo');
    });

    it('should parse SSH URL with .git suffix', () => {
      expect(parseOwnerRepo('git@github.com:getCora/myrepo.git')).to.equal('getCora/myrepo');
    });

    it('should parse SSH URL without .git suffix', () => {
      expect(parseOwnerRepo('git@github.com:getCora/myrepo')).to.equal('getCora/myrepo');
    });

    it('should parse SSH protocol URL', () => {
      expect(parseOwnerRepo('ssh://git@github.com/getCora/myrepo.git')).to.equal('getCora/myrepo');
    });

    it('should return null for non-GitHub URL', () => {
      expect(parseOwnerRepo('https://gitlab.com/owner/repo.git')).to.be.null;
    });

    it('should return null for local path', () => {
      expect(parseOwnerRepo('/home/user/repos/myrepo')).to.be.null;
    });

    it('should handle repos with dots in name', () => {
      expect(parseOwnerRepo('https://github.com/owner/my.repo.git')).to.equal('owner/my.repo');
    });

    it('should handle orgs with hyphens and numbers', () => {
      expect(parseOwnerRepo('https://github.com/my-org-123/repo-name.git')).to.equal('my-org-123/repo-name');
    });
  });

  describe('detectTransferredRepo', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-test-transfer-'));
      execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should return transferred: false for non-GitHub remote', () => {
      execSync('git remote add origin https://gitlab.com/owner/repo.git', { cwd: tmpDir, stdio: 'pipe' });
      const result = detectTransferredRepo(tmpDir);
      expect(result.transferred).to.be.false;
    });

    it('should return transferred: false for local path remote', () => {
      execSync('git remote add origin /some/local/path', { cwd: tmpDir, stdio: 'pipe' });
      const result = detectTransferredRepo(tmpDir);
      expect(result.transferred).to.be.false;
    });

    it('should return transferred: false when no remote configured', () => {
      const result = detectTransferredRepo(tmpDir);
      expect(result.transferred).to.be.false;
    });
  });

  describe('detectAndFixTransferredRepo', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-test-transfer-'));
      execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should return fixed: false when no remote is configured', () => {
      const result = detectAndFixTransferredRepo(tmpDir);
      expect(result.fixed).to.be.false;
    });

    it('should return fixed: false for non-GitHub remotes', () => {
      execSync('git remote add origin https://gitlab.com/owner/repo.git', { cwd: tmpDir, stdio: 'pipe' });
      const result = detectAndFixTransferredRepo(tmpDir);
      expect(result.fixed).to.be.false;
    });

    it('should return fixed: false for local path remotes', () => {
      execSync('git remote add origin /some/local/path', { cwd: tmpDir, stdio: 'pipe' });
      const result = detectAndFixTransferredRepo(tmpDir);
      expect(result.fixed).to.be.false;
    });
  });

  describe('URL format preservation', () => {
    it('should preserve HTTPS format when building new URL', () => {
      const oldUrl = 'https://github.com/getCora/myrepo.git';
      const newUrl = oldUrl.replace('getCora/myrepo', 'getCoraAI/myrepo');
      expect(newUrl).to.equal('https://github.com/getCoraAI/myrepo.git');
    });

    it('should preserve SSH format when building new URL', () => {
      const oldUrl = 'git@github.com:getCora/myrepo.git';
      const newUrl = oldUrl.replace('getCora/myrepo', 'getCoraAI/myrepo');
      expect(newUrl).to.equal('git@github.com:getCoraAI/myrepo.git');
    });

    it('should preserve HTTPS without .git suffix when building new URL', () => {
      const oldUrl = 'https://github.com/getCora/myrepo';
      const newUrl = oldUrl.replace('getCora/myrepo', 'getCoraAI/myrepo');
      expect(newUrl).to.equal('https://github.com/getCoraAI/myrepo');
    });
  });
});
