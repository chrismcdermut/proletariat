import { expect } from 'chai';
import { generateBranchName, getBranchType, CATEGORY_TO_BRANCH_TYPE } from '../../src/lib/execution/types.js';

describe('Branch Naming', () => {
  describe('generateBranchName', () => {
    it('generates branch with ticket ID first, then type/owner/agent/slug', () => {
      const branch = generateBranchName('TKT-001', 'Implement authentication', 'chris', 'altman');
      expect(branch).to.equal('TKT-001/feat/chris/altman/implement-authentica');
    });

    it('includes category-based branch type', () => {
      const branch = generateBranchName('TKT-002', 'Fix login bug', 'chris', 'altman', 'bug');
      expect(branch).to.equal('TKT-002/fix/chris/altman/fix-login-bug');
    });

    it('truncates long titles to 20 characters', () => {
      const longTitle = 'This is a very long ticket title that should be truncated';
      const branch = generateBranchName('TKT-003', longTitle, 'chris', 'altman');
      // Slug should be max 20 chars
      const parts = branch.split('/');
      const slug = parts[4]; // TKT-003/feat/chris/altman/slug
      expect(slug.length).to.be.at.most(20);
    });

    it('removes special characters from title', () => {
      const branch = generateBranchName('TKT-004', 'Fix bug #123 (urgent!)', 'chris', 'altman');
      expect(branch).to.equal('TKT-004/feat/chris/altman/fix-bug-123-urgent');
    });

    it('handles various owner name formats', () => {
      expect(generateBranchName('TKT-001', 'Test', 'chris', 'altman')).to.include('/chris/');
      expect(generateBranchName('TKT-001', 'Test', 'chris-m', 'altman')).to.include('/chris-m/');
      expect(generateBranchName('TKT-001', 'Test', 'team-alpha', 'altman')).to.include('/team-alpha/');
    });

    it('handles various agent name formats', () => {
      expect(generateBranchName('TKT-001', 'Test', 'chris', 'altman')).to.include('/altman/');
      expect(generateBranchName('TKT-001', 'Test', 'chris', 'claude-agent')).to.include('/claude-agent/');
      expect(generateBranchName('TKT-001', 'Test', 'chris', 'codex')).to.include('/codex/');
    });

    it('defaults to feat branch type when no category', () => {
      const branch = generateBranchName('TKT-001', 'New feature', 'chris', 'altman');
      expect(branch).to.match(/^TKT-001\/feat\//);
    });

    it('removes trailing hyphens from slug', () => {
      const branch = generateBranchName('TKT-001', 'Test - title', 'chris', 'altman');
      expect(branch).not.to.match(/-$/);
    });

    it('places ticket ID first for easy filtering', () => {
      const branch = generateBranchName('TKT-054', 'Update branch naming', 'chris', 'altman', 'chore');
      expect(branch).to.match(/^TKT-054\//);
      expect(branch).to.equal('TKT-054/chore/chris/altman/update-branch-naming');
    });
  });

  describe('getBranchType', () => {
    it('returns feat for feature category', () => {
      expect(getBranchType('feature')).to.equal('feat');
      expect(getBranchType('feat')).to.equal('feat');
    });

    it('returns fix for bug category', () => {
      expect(getBranchType('bug')).to.equal('fix');
      expect(getBranchType('fix')).to.equal('fix');
      expect(getBranchType('bugfix')).to.equal('fix');
    });

    it('returns rfct for refactor category', () => {
      expect(getBranchType('refactor')).to.equal('rfct');
      expect(getBranchType('cleanup')).to.equal('rfct');
    });

    it('returns docs for documentation category', () => {
      expect(getBranchType('docs')).to.equal('docs');
      expect(getBranchType('documentation')).to.equal('docs');
    });

    it('returns feat for unknown category', () => {
      expect(getBranchType('unknown')).to.equal('feat');
    });

    it('returns feat for undefined category', () => {
      expect(getBranchType()).to.equal('feat');
    });

    it('handles case-insensitive categories', () => {
      expect(getBranchType('FEATURE')).to.equal('feat');
      expect(getBranchType('Bug')).to.equal('fix');
    });
  });

  describe('CATEGORY_TO_BRANCH_TYPE mapping', () => {
    it('covers conventional commit types', () => {
      const conventionalTypes = ['feat', 'fix', 'docs', 'test', 'chore', 'perf', 'ci', 'build', 'rfct'];
      for (const type of conventionalTypes) {
        const hasMapping = Object.values(CATEGORY_TO_BRANCH_TYPE).includes(type);
        expect(hasMapping, `Missing mapping for ${type}`).to.be.true;
      }
    });

    it('covers proletariat extended types', () => {
      const extendedTypes = ['sec', 'db', 'rel'];
      for (const type of extendedTypes) {
        const hasMapping = Object.values(CATEGORY_TO_BRANCH_TYPE).includes(type);
        expect(hasMapping, `Missing mapping for ${type}`).to.be.true;
      }
    });

    it('covers 5Tool founder types', () => {
      const founderTypes = ['ship', 'grow', 'cx', 'strat', 'ops'];
      for (const type of founderTypes) {
        const hasMapping = Object.values(CATEGORY_TO_BRANCH_TYPE).includes(type);
        expect(hasMapping, `Missing mapping for ${type}`).to.be.true;
      }
    });
  });
});
