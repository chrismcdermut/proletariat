import { expect } from 'chai';
import { generateBranchName, getBranchType, CATEGORY_TO_BRANCH_TYPE } from '../../src/lib/execution/types.js';

describe('Branch Naming', () => {
  describe('generateBranchName', () => {
    it('generates branch with coder name and ticket info', () => {
      const branch = generateBranchName('TKT-001', 'Implement authentication', 'chris');
      expect(branch).to.equal('feat/chris/TKT-001-implement-authentication');
    });

    it('includes category-based branch type', () => {
      const branch = generateBranchName('TKT-002', 'Fix login bug', 'chris', 'bug');
      expect(branch).to.equal('fix/chris/TKT-002-fix-login-bug');
    });

    it('truncates long titles to 30 characters', () => {
      const longTitle = 'This is a very long ticket title that should be truncated';
      const branch = generateBranchName('TKT-003', longTitle, 'chris');
      // Slug should be max 30 chars
      const slug = branch.split('/')[2].replace('TKT-003-', '');
      expect(slug.length).to.be.at.most(30);
    });

    it('removes special characters from title', () => {
      const branch = generateBranchName('TKT-004', 'Fix bug #123 (urgent!)', 'chris');
      expect(branch).to.equal('feat/chris/TKT-004-fix-bug-123-urgent');
    });

    it('handles various coder name formats', () => {
      expect(generateBranchName('TKT-001', 'Test', 'chris')).to.include('/chris/');
      expect(generateBranchName('TKT-001', 'Test', 'chris-m')).to.include('/chris-m/');
      expect(generateBranchName('TKT-001', 'Test', 'team-alpha')).to.include('/team-alpha/');
    });

    it('defaults to feat branch type when no category', () => {
      const branch = generateBranchName('TKT-001', 'New feature', 'chris');
      expect(branch).to.match(/^feat\//);
    });

    it('removes trailing hyphens from slug', () => {
      const branch = generateBranchName('TKT-001', 'Test - title', 'chris');
      expect(branch).not.to.match(/-$/);
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
      expect(getBranchType(undefined)).to.equal('feat');
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
