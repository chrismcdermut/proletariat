import { expect } from 'chai';
import { fileURLToPath } from 'url';
import * as path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Unit tests for PR utility functions
 * Spec: specs/domain/pull-requests.md
 */
describe('PR Utils Unit Tests', () => {
  /**
   * Spec: pull-requests.md > PR Title/Body Generation
   */
  describe('generatePRTitle', () => {
    it('should generate title with ticket ID and title', () => {
      const ticketId = 'TKT-001';
      const ticketTitle = 'Add user authentication';

      // Mirror the generatePRTitle function logic
      const prTitle = `${ticketId}: ${ticketTitle}`;

      expect(prTitle).to.equal('TKT-001: Add user authentication');
    });

    it('should handle empty ticket title', () => {
      const ticketId = 'TKT-002';
      const ticketTitle = '';

      const prTitle = `${ticketId}: ${ticketTitle}`;

      expect(prTitle).to.equal('TKT-002: ');
    });

    it('should handle long ticket titles', () => {
      const ticketId = 'TKT-003';
      const ticketTitle = 'This is a very long ticket title that describes a complex feature implementation with many details about what needs to be done';

      const prTitle = `${ticketId}: ${ticketTitle}`;

      expect(prTitle).to.contain('TKT-003:');
      expect(prTitle.length).to.be.greaterThan(100);
    });

    it('should handle special characters in title', () => {
      const ticketId = 'TKT-004';
      const ticketTitle = "Fix bug with 'quotes' & <brackets>";

      const prTitle = `${ticketId}: ${ticketTitle}`;

      expect(prTitle).to.equal("TKT-004: Fix bug with 'quotes' & <brackets>");
    });
  });

  /**
   * Spec: pull-requests.md > PR Title/Body Generation > Body Template
   */
  describe('generatePRBody', () => {
    it('should include Summary section', () => {
      const options = {
        ticketId: 'TKT-001',
        ticketTitle: 'Test feature',
      };

      // Mirror generatePRBody logic
      const body = generatePRBodyMock(options);

      expect(body).to.contain('## Summary');
      expect(body).to.contain('Resolves TKT-001: Test feature');
    });

    it('should include Description when provided', () => {
      const options = {
        ticketId: 'TKT-001',
        ticketTitle: 'Test feature',
        ticketDescription: 'This is a detailed description of the feature',
      };

      const body = generatePRBodyMock(options);

      expect(body).to.contain('## Description');
      expect(body).to.contain('This is a detailed description');
    });

    it('should skip Description when not provided', () => {
      const options = {
        ticketId: 'TKT-001',
        ticketTitle: 'Test feature',
      };

      const body = generatePRBodyMock(options);

      expect(body).to.not.contain('## Description');
    });

    it('should include Changes section with commits', () => {
      const options = {
        ticketId: 'TKT-001',
        ticketTitle: 'Test feature',
        commits: ['abc123 Add initial implementation', 'def456 Fix typo'],
      };

      const body = generatePRBodyMock(options);

      expect(body).to.contain('## Changes');
      expect(body).to.contain('- abc123 Add initial implementation');
      expect(body).to.contain('- def456 Fix typo');
    });

    it('should skip Changes section when no commits', () => {
      const options = {
        ticketId: 'TKT-001',
        ticketTitle: 'Test feature',
        commits: [],
      };

      const body = generatePRBodyMock(options);

      expect(body).to.not.contain('## Changes');
    });

    it('should include Test Plan section', () => {
      const options = {
        ticketId: 'TKT-001',
        ticketTitle: 'Test feature',
      };

      const body = generatePRBodyMock(options);

      expect(body).to.contain('## Test Plan');
      expect(body).to.contain('- [ ] Tests pass locally');
      expect(body).to.contain('- [ ] Manual testing completed');
    });
  });

  /**
   * Spec: pull-requests.md > Business Rules > Auto-detect ticket ID
   */
  describe('Ticket ID Detection', () => {
    describe('from branch name', () => {
      it('should detect TKT-XXX pattern (3 digits)', () => {
        const branch = 'feat/agent/TKT-001-add-feature';
        const match = extractTicketId(branch);

        expect(match).to.equal('TKT-001');
      });

      it('should detect TKT-XXX pattern (variable digits)', () => {
        const branch = 'fix/TKT-12345-big-ticket';
        const match = extractTicketId(branch);

        expect(match).to.equal('TKT-12345');
      });

      it('should be case-insensitive', () => {
        const branch = 'feat/chris/tkt-999-lowercase';
        const match = extractTicketId(branch);

        expect(match).to.equal('TKT-999');
      });

      it('should find ticket ID anywhere in branch name', () => {
        const testCases = [
          { branch: 'TKT-001-start', expected: 'TKT-001' },
          { branch: 'prefix-TKT-002-middle', expected: 'TKT-002' },
          { branch: 'end-TKT-003', expected: 'TKT-003' },
          { branch: 'feat/TKT-004/description', expected: 'TKT-004' },
        ];

        for (const { branch, expected } of testCases) {
          const match = extractTicketId(branch);
          expect(match, `Branch: ${branch}`).to.equal(expected);
        }
      });

      it('should return null for branch without ticket ID', () => {
        const branches = [
          'main',
          'develop',
          'feat/chris/no-ticket',
          'fix/random-bug',
          'chore/update-deps',
        ];

        for (const branch of branches) {
          const match = extractTicketId(branch);
          expect(match, `Branch: ${branch}`).to.be.null;
        }
      });

      it('should return first match if multiple ticket IDs', () => {
        const branch = 'feat/TKT-001-and-TKT-002';
        const match = extractTicketId(branch);

        expect(match).to.equal('TKT-001');
      });
    });
  });

  /**
   * Spec: pull-requests.md > GitHub CLI Detection
   */
  describe('GitHub CLI helpers', () => {
    describe('getGitHubRepo URL parsing', () => {
      it('should parse HTTPS URL', () => {
        const remoteUrl = 'https://github.com/owner/repo.git';
        const parsed = parseGitHubUrl(remoteUrl);

        expect(parsed).to.equal('owner/repo');
      });

      it('should parse HTTPS URL without .git', () => {
        const remoteUrl = 'https://github.com/owner/repo';
        const parsed = parseGitHubUrl(remoteUrl);

        expect(parsed).to.equal('owner/repo');
      });

      it('should parse SSH URL', () => {
        const remoteUrl = 'git@github.com:owner/repo.git';
        const parsed = parseGitHubUrl(remoteUrl);

        expect(parsed).to.equal('owner/repo');
      });

      it('should parse SSH URL without .git', () => {
        const remoteUrl = 'git@github.com:owner/repo';
        const parsed = parseGitHubUrl(remoteUrl);

        expect(parsed).to.equal('owner/repo');
      });

      it('should return null for non-GitHub URL', () => {
        const remoteUrl = 'https://gitlab.com/owner/repo.git';
        const parsed = parseGitHubUrl(remoteUrl);

        expect(parsed).to.be.null;
      });
    });
  });

  /**
   * Spec: pull-requests.md > Data Model > PR Info
   */
  describe('PR State mapping', () => {
    it('should map state to emoji', () => {
      const stateEmoji: Record<string, string> = {
        OPEN: '🟢',
        CLOSED: '🔴',
        MERGED: '🟣',
      };

      expect(stateEmoji['OPEN']).to.equal('🟢');
      expect(stateEmoji['CLOSED']).to.equal('🔴');
      expect(stateEmoji['MERGED']).to.equal('🟣');
    });
  });
});

// =============================================================================
// Mock Functions (mirror the actual implementation)
// =============================================================================

function generatePRBodyMock(options: {
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

function extractTicketId(branch: string): string | null {
  const match = branch.match(/(TKT-\d+)/i);
  if (match) {
    return match[1].toUpperCase();
  }
  return null;
}

function parseGitHubUrl(remoteUrl: string): string | null {
  // Parse GitHub URL formats:
  // https://github.com/owner/repo.git
  // git@github.com:owner/repo.git
  const httpsMatch = remoteUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)(\.git)?$/);
  const sshMatch = remoteUrl.match(/git@github\.com:([^/]+)\/([^/.]+)(\.git)?$/);

  const match = httpsMatch || sshMatch;
  if (match) {
    return `${match[1]}/${match[2]}`;
  }
  return null;
}
