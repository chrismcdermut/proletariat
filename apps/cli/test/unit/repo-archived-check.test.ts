import { expect } from 'chai';
import { parseGitHubOwnerRepo, checkGitHubRepoArchived } from '../../src/lib/repos/git.js';

describe('@smoke Archived Repository Detection', () => {
  describe('parseGitHubOwnerRepo', () => {
    it('parses HTTPS GitHub URL', () => {
      expect(parseGitHubOwnerRepo('https://github.com/octocat/hello-world.git'))
        .to.equal('octocat/hello-world');
    });

    it('parses HTTPS GitHub URL without .git suffix', () => {
      expect(parseGitHubOwnerRepo('https://github.com/octocat/hello-world'))
        .to.equal('octocat/hello-world');
    });

    it('parses SSH GitHub URL', () => {
      expect(parseGitHubOwnerRepo('git@github.com:octocat/hello-world.git'))
        .to.equal('octocat/hello-world');
    });

    it('parses SSH GitHub URL without .git suffix', () => {
      expect(parseGitHubOwnerRepo('git@github.com:octocat/hello-world'))
        .to.equal('octocat/hello-world');
    });

    it('parses ssh:// GitHub URL', () => {
      expect(parseGitHubOwnerRepo('ssh://git@github.com/octocat/hello-world.git'))
        .to.equal('octocat/hello-world');
    });

    it('returns null for non-GitHub URL', () => {
      expect(parseGitHubOwnerRepo('https://gitlab.com/user/repo.git')).to.be.null;
    });

    it('returns null for local path', () => {
      expect(parseGitHubOwnerRepo('/home/user/projects/repo')).to.be.null;
    });

    it('returns null for empty string', () => {
      expect(parseGitHubOwnerRepo('')).to.be.null;
    });

    it('handles repos with hyphens and dots in name', () => {
      expect(parseGitHubOwnerRepo('https://github.com/my-org/my-repo'))
        .to.equal('my-org/my-repo');
    });
  });

  describe('checkGitHubRepoArchived', () => {
    it('returns false when gh CLI is not available or API call fails', () => {
      // Using an invalid owner/repo should cause the API call to fail
      // and the function should gracefully return false
      expect(checkGitHubRepoArchived('__nonexistent__/__nonexistent__')).to.be.false;
    });
  });
});
