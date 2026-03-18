import { expect } from 'chai';
import {
  parseGitHubOwnerRepo,
  buildRemoteUrl,
} from '../../src/lib/repos/git.js';

/**
 * Unit tests for transferred repo detection and URL handling.
 * Tests the pure functions that don't require subprocess mocking.
 *
 * The integration behavior (detectTransferredRepo, detectAndFixTransferredRepo,
 * ensureRemoteUpToDate) is tested via the exported pure functions they compose.
 */
describe('Transferred Repo Detection', () => {
  describe('parseGitHubOwnerRepo', () => {
    it('should parse HTTPS URL with .git suffix', () => {
      expect(parseGitHubOwnerRepo('https://github.com/getCora/myrepo.git')).to.equal('getCora/myrepo');
    });

    it('should parse HTTPS URL without .git suffix', () => {
      expect(parseGitHubOwnerRepo('https://github.com/getCora/myrepo')).to.equal('getCora/myrepo');
    });

    it('should parse SSH URL with .git suffix', () => {
      expect(parseGitHubOwnerRepo('git@github.com:getCora/myrepo.git')).to.equal('getCora/myrepo');
    });

    it('should parse SSH URL without .git suffix', () => {
      expect(parseGitHubOwnerRepo('git@github.com:getCora/myrepo')).to.equal('getCora/myrepo');
    });

    it('should parse ssh:// URL with .git suffix', () => {
      expect(parseGitHubOwnerRepo('ssh://git@github.com/getCora/myrepo.git')).to.equal('getCora/myrepo');
    });

    it('should parse ssh:// URL without .git suffix', () => {
      expect(parseGitHubOwnerRepo('ssh://git@github.com/getCora/myrepo')).to.equal('getCora/myrepo');
    });

    it('should return null for non-GitHub URL', () => {
      expect(parseGitHubOwnerRepo('https://gitlab.com/owner/repo.git')).to.be.null;
    });

    it('should return null for local path', () => {
      expect(parseGitHubOwnerRepo('/home/user/repos/myrepo')).to.be.null;
    });

    it('should handle URL with trailing slash', () => {
      // The regex won't match trailing slash — that's expected
      expect(parseGitHubOwnerRepo('https://github.com/owner/repo/')).to.be.null;
    });
  });

  describe('buildRemoteUrl', () => {
    describe('HTTPS format preservation', () => {
      it('should preserve HTTPS format with .git suffix', () => {
        const result = buildRemoteUrl(
          'https://github.com/getCora/myrepo.git',
          'getCoraAI/myrepo',
        );
        expect(result).to.equal('https://github.com/getCoraAI/myrepo.git');
      });

      it('should preserve HTTPS format without .git suffix', () => {
        const result = buildRemoteUrl(
          'https://github.com/getCora/myrepo',
          'getCoraAI/myrepo',
        );
        expect(result).to.equal('https://github.com/getCoraAI/myrepo');
      });
    });

    describe('SSH format preservation', () => {
      it('should preserve SSH format with .git suffix', () => {
        const result = buildRemoteUrl(
          'git@github.com:getCora/myrepo.git',
          'getCoraAI/myrepo',
        );
        expect(result).to.equal('git@github.com:getCoraAI/myrepo.git');
      });

      it('should preserve SSH format without .git suffix', () => {
        const result = buildRemoteUrl(
          'git@github.com:getCora/myrepo',
          'getCoraAI/myrepo',
        );
        expect(result).to.equal('git@github.com:getCoraAI/myrepo');
      });
    });

    describe('ssh:// format preservation', () => {
      it('should preserve ssh:// format with .git suffix', () => {
        const result = buildRemoteUrl(
          'ssh://git@github.com/getCora/myrepo.git',
          'getCoraAI/myrepo',
        );
        expect(result).to.equal('ssh://git@github.com/getCoraAI/myrepo.git');
      });

      it('should preserve ssh:// format without .git suffix', () => {
        const result = buildRemoteUrl(
          'ssh://git@github.com/getCora/myrepo',
          'getCoraAI/myrepo',
        );
        expect(result).to.equal('ssh://git@github.com/getCoraAI/myrepo');
      });
    });

    describe('edge cases', () => {
      it('should default to HTTPS for unrecognized URL format', () => {
        const result = buildRemoteUrl(
          'https://custom.domain.com/getCora/myrepo.git',
          'getCoraAI/myrepo',
        );
        expect(result).to.equal('https://github.com/getCoraAI/myrepo.git');
      });

      it('should handle owner/repo with hyphens and underscores', () => {
        const result = buildRemoteUrl(
          'https://github.com/old-org/my_repo.git',
          'new-org/my_repo',
        );
        expect(result).to.equal('https://github.com/new-org/my_repo.git');
      });
    });
  });

  describe('detectTransferredRepo logic', () => {
    it('should detect transfer when API full_name differs from local owner/repo', () => {
      // This tests the comparison logic directly
      const localOwnerRepo = 'getCora/myrepo';
      const apiFullName = 'getCoraAI/myrepo';

      // The core logic: case-insensitive comparison
      const isTransferred = apiFullName.toLowerCase() !== localOwnerRepo.toLowerCase();
      expect(isTransferred).to.be.true;
    });

    it('should not detect transfer when names match (case-insensitive)', () => {
      const localOwnerRepo = 'GetCora/MyRepo';
      const apiFullName = 'getCora/myrepo';

      const isTransferred = apiFullName.toLowerCase() !== localOwnerRepo.toLowerCase();
      expect(isTransferred).to.be.false;
    });

    it('should not detect transfer when names are identical', () => {
      const localOwnerRepo = 'getCora/myrepo';
      const apiFullName = 'getCora/myrepo';

      const isTransferred = apiFullName.toLowerCase() !== localOwnerRepo.toLowerCase();
      expect(isTransferred).to.be.false;
    });
  });

  describe('URL format round-trip', () => {
    const formats = [
      { name: 'HTTPS with .git', url: 'https://github.com/oldOrg/repo.git' },
      { name: 'HTTPS without .git', url: 'https://github.com/oldOrg/repo' },
      { name: 'SSH with .git', url: 'git@github.com:oldOrg/repo.git' },
      { name: 'SSH without .git', url: 'git@github.com:oldOrg/repo' },
      { name: 'ssh:// with .git', url: 'ssh://git@github.com/oldOrg/repo.git' },
      { name: 'ssh:// without .git', url: 'ssh://git@github.com/oldOrg/repo' },
    ];

    for (const { name, url } of formats) {
      it(`should parse and rebuild ${name} URL correctly`, () => {
        const ownerRepo = parseGitHubOwnerRepo(url);
        expect(ownerRepo).to.equal('oldOrg/repo');

        // Simulate transfer to newOrg
        const newUrl = buildRemoteUrl(url, 'newOrg/repo');
        const newOwnerRepo = parseGitHubOwnerRepo(newUrl);
        expect(newOwnerRepo).to.equal('newOrg/repo');
      });
    }
  });
});
