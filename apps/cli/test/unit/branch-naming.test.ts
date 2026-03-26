import { expect } from 'chai';
import { generateBranchName, getBranchType, CATEGORY_TO_BRANCH_TYPE } from '../../src/lib/execution/types.js';
import { validateBranchName } from '../../src/lib/branch/index.js';
import { getTicketExternalMetadata, resolveExternalTicketId } from '../../src/lib/external-issues/utils.js';

describe('@smoke Branch Naming', () => {
  describe('generateBranchName', () => {
    it('generates branch with ticket ID, type, and slug only', () => {
      const branch = generateBranchName('TKT-001', 'Implement authentication');
      expect(branch).to.equal('TKT-001/feat/implement-authentica');
    });

    it('includes category-based branch type', () => {
      const branch = generateBranchName('TKT-002', 'Fix login bug', 'bug');
      expect(branch).to.equal('TKT-002/fix/fix-login-bug');
    });

    it('truncates long titles to 20 characters', () => {
      const longTitle = 'This is a very long ticket title that should be truncated';
      const branch = generateBranchName('TKT-003', longTitle);
      // Slug should be max 20 chars
      const parts = branch.split('/');
      const slug = parts[2]; // TKT-003/feat/slug
      expect(slug.length).to.be.at.most(20);
    });

    it('removes special characters from title', () => {
      const branch = generateBranchName('TKT-004', 'Fix bug #123 (urgent!)');
      expect(branch).to.equal('TKT-004/feat/fix-bug-123-urgent');
    });

    it('does not include owner or agent in branch name', () => {
      const branch = generateBranchName('TKT-001', 'Test');
      const parts = branch.split('/');
      expect(parts).to.have.length(3);
      expect(parts[0]).to.equal('TKT-001');
      expect(parts[1]).to.equal('feat');
      expect(parts[2]).to.equal('test');
    });

    it('defaults to feat branch type when no category', () => {
      const branch = generateBranchName('TKT-001', 'New feature');
      expect(branch).to.match(/^TKT-001\/feat\//);
    });

    it('removes trailing hyphens from slug', () => {
      const branch = generateBranchName('TKT-001', 'Test - title');
      expect(branch).not.to.match(/-$/);
    });

    it('places ticket ID first for easy filtering', () => {
      const branch = generateBranchName('TKT-054', 'Update branch naming', 'chore');
      expect(branch).to.match(/^TKT-054\//);
      expect(branch).to.equal('TKT-054/chore/update-branch-naming');
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

  describe('validateBranchName', () => {
    it('validates new 3-part ticket format: ticketId/type/description', () => {
      const result = validateBranchName('PRLT-1137/feat/fix-main-branch-ci');
      expect(result.valid).to.be.true;
      expect(result.parts?.ticketId).to.equal('PRLT-1137');
      expect(result.parts?.type).to.equal('feat');
      expect(result.parts?.description).to.equal('fix-main-branch-ci');
    });

    it('still accepts old 5-part format for backward compat', () => {
      const result = validateBranchName('TKT-001/feat/chris/altman/add-feature');
      expect(result.valid).to.be.true;
      expect(result.parts?.ticketId).to.equal('TKT-001');
      expect(result.parts?.type).to.equal('feat');
      expect(result.parts?.owner).to.equal('chris');
      expect(result.parts?.agent).to.equal('altman');
      expect(result.parts?.description).to.equal('add-feature');
    });

    it('still accepts old 4-part format for backward compat', () => {
      const result = validateBranchName('TKT-001/feat/chris/add-feature');
      expect(result.valid).to.be.true;
      expect(result.parts?.ticketId).to.equal('TKT-001');
      expect(result.parts?.owner).to.equal('chris');
    });

    it('should detect ticket ID in owner position and give helpful error', () => {
      const result = validateBranchName('feat/TKT-001/test');
      expect(result.valid).to.be.false;
      expect(result.error).to.include('looks like a ticket ID');
      expect(result.error).to.include('owner position');
      expect(result.error).to.include('first segment');
    });

    it('should detect ticket ID in description position (2-part branch)', () => {
      const result = validateBranchName('feat/PROJ-123');
      expect(result.valid).to.be.false;
      expect(result.error).to.include('looks like a ticket ID');
      expect(result.error).to.include('first segment');
    });

    it('should detect ticket ID in description position (3-part branch)', () => {
      const result = validateBranchName('feat/chris/TKT-456');
      expect(result.valid).to.be.false;
      expect(result.error).to.include('looks like a ticket ID');
      expect(result.error).to.include('description position');
      expect(result.error).to.include('first segment');
    });

    it('should still show kebab-case error for non-ticket-ID values', () => {
      const result = validateBranchName('feat/chris/AddLogin');
      expect(result.valid).to.be.false;
      expect(result.error).to.include('kebab-case');
      expect(result.error).not.to.include('ticket ID');
    });

    it('should still show kebab-case error for owner when not ticket ID', () => {
      const result = validateBranchName('feat/ChrisDoe/test');
      expect(result.valid).to.be.false;
      expect(result.error).to.include('Owner name must be kebab-case');
      expect(result.error).not.to.include('ticket ID');
    });

    it('should validate correct ticket-first format', () => {
      const result = validateBranchName('TKT-001/feat/test');
      expect(result.valid).to.be.true;
      expect(result.parts?.ticketId).to.equal('TKT-001');
      expect(result.parts?.type).to.equal('feat');
      expect(result.parts?.description).to.equal('test');
    });

    it('should validate correct legacy format', () => {
      const result = validateBranchName('feat/chris/add-feature');
      expect(result.valid).to.be.true;
      expect(result.parts?.type).to.equal('feat');
      expect(result.parts?.owner).to.equal('chris');
      expect(result.parts?.description).to.equal('add-feature');
    });
  });

  // PRLT-1065: Branch naming should use external provider key instead of internal TKT ID
  describe('resolveExternalTicketId', () => {
    it('returns external key when ticket has external_key metadata', () => {
      const ticket = {
        id: 'TKT-226',
        metadata: { external_key: 'PRLT-1062', external_source: 'linear' },
      };
      expect(resolveExternalTicketId(ticket)).to.equal('PRLT-1062');
    });

    it('falls back to ticket.id when no external_key', () => {
      const ticket = { id: 'TKT-226', metadata: {} };
      expect(resolveExternalTicketId(ticket)).to.equal('TKT-226');
    });

    it('falls back to ticket.id when metadata is null', () => {
      const ticket = { id: 'TKT-226', metadata: null };
      expect(resolveExternalTicketId(ticket)).to.equal('TKT-226');
    });

    it('falls back to ticket.id when metadata is undefined', () => {
      const ticket = { id: 'TKT-226' };
      expect(resolveExternalTicketId(ticket)).to.equal('TKT-226');
    });

    it('uses external key for branch naming instead of TKT ID', () => {
      const ticket = {
        id: 'TKT-226',
        metadata: { external_key: 'PRLT-1062', external_source: 'linear' },
      };
      const branchTicketId = resolveExternalTicketId(ticket);
      const branch = generateBranchName(branchTicketId, 'Fix login bug', 'bug');
      expect(branch).to.match(/^PRLT-1062\//);
      expect(branch).to.not.include('TKT-226');
      expect(branch).to.equal('PRLT-1062/fix/fix-login-bug');
    });
  });

  describe('getTicketExternalMetadata', () => {
    it('extracts all external metadata fields', () => {
      const ticket = {
        id: 'TKT-001',
        metadata: {
          external_source: 'linear',
          external_key: 'PRLT-1065',
          external_id: 'abc-123',
          external_url: 'https://linear.app/test',
        },
      };
      const meta = getTicketExternalMetadata(ticket);
      expect(meta.source).to.equal('linear');
      expect(meta.key).to.equal('PRLT-1065');
      expect(meta.id).to.equal('abc-123');
      expect(meta.url).to.equal('https://linear.app/test');
    });

    it('returns undefined for missing fields', () => {
      const ticket = { id: 'TKT-001', metadata: {} };
      const meta = getTicketExternalMetadata(ticket);
      expect(meta.source).to.be.undefined;
      expect(meta.key).to.be.undefined;
      expect(meta.id).to.be.undefined;
      expect(meta.url).to.be.undefined;
    });

    it('handles null metadata gracefully', () => {
      const ticket = { id: 'TKT-001', metadata: null };
      const meta = getTicketExternalMetadata(ticket);
      expect(meta.key).to.be.undefined;
    });
  });
});
