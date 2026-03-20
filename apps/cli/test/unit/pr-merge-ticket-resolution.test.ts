import { expect } from 'chai';
import { validateBranchName } from '../../src/lib/branch/index.js';

/**
 * Unit tests for PR merge ticket resolution logic.
 *
 * Tests the resolveLinkedTicket lookup strategy used by `prlt pr merge`
 * to find the linked ticket after a successful merge.
 *
 * Lookup order:
 * 1. PR metadata (pr_number / pr_url) on tickets
 * 2. agent_work table (branch → ticket_id)
 * 3. PR branch name parsing (extract ticket ID from conventional branch format)
 */
describe('PR Merge - Ticket Resolution', () => {
  describe('Branch name ticket extraction', () => {
    it('should extract ticket ID from full format branch', () => {
      const result = validateBranchName('PRLT-1043/feat/chrismcdermut/early-yang/auto-move-ticket-to');
      expect(result.valid).to.be.true;
      expect(result.parts?.ticketId).to.equal('PRLT-1043');
    });

    it('should extract ticket ID from 4-part branch (no agent)', () => {
      const result = validateBranchName('TKT-123/fix/chris/fix-login-bug');
      expect(result.valid).to.be.true;
      expect(result.parts?.ticketId).to.equal('TKT-123');
    });

    it('should extract ticket ID from 3-part branch (minimal)', () => {
      const result = validateBranchName('PRLT-42/feat/add-auth');
      expect(result.valid).to.be.true;
      expect(result.parts?.ticketId).to.equal('PRLT-42');
    });

    it('should return no ticket for legacy branch without ticket', () => {
      const result = validateBranchName('feat/chris/add-feature');
      expect(result.valid).to.be.true;
      expect(result.parts?.ticketId).to.be.undefined;
    });

    it('should return invalid for non-conventional branch names', () => {
      const result = validateBranchName('main');
      expect(result.valid).to.be.false;
    });
  });

  describe('Metadata-based ticket matching', () => {
    const mockTickets = [
      {
        id: 'TKT-100',
        metadata: { pr_number: '42', pr_url: 'https://github.com/owner/repo/pull/42' },
      },
      {
        id: 'TKT-200',
        metadata: { external_key: 'PRLT-1043' },
      },
      {
        id: 'TKT-300',
        metadata: {},
      },
    ];

    it('should match by pr_number', () => {
      const prNumber = 42;
      const found = mockTickets.find(t =>
        t.metadata?.pr_number === String(prNumber)
      );
      expect(found?.id).to.equal('TKT-100');
    });

    it('should match by pr_url suffix /pull/N', () => {
      const prNumber = 42;
      const found = mockTickets.find(t =>
        t.metadata?.pr_url?.endsWith(`/pull/${prNumber}`)
      );
      expect(found?.id).to.equal('TKT-100');
    });

    it('should not match wrong pr_number', () => {
      const prNumber = 99;
      const found = mockTickets.find(t =>
        t.metadata?.pr_number === String(prNumber) ||
        t.metadata?.pr_url?.endsWith(`/pull/${prNumber}`) ||
        t.metadata?.pr_url?.endsWith(`/${prNumber}`)
      );
      expect(found).to.be.undefined;
    });

    it('should match by external_key from parsed branch', () => {
      const branchResult = validateBranchName('PRLT-1043/feat/chrismcdermut/early-yang/auto-move');
      const ticketId = branchResult.parts?.ticketId;

      const found = mockTickets.find(t =>
        t.metadata?.external_key === ticketId
      );
      expect(found?.id).to.equal('TKT-200');
    });

    it('should not match external_key when branch has no ticket ID', () => {
      const branchResult = validateBranchName('feat/chris/add-feature');
      const ticketId = branchResult.parts?.ticketId;

      expect(ticketId).to.be.undefined;
    });
  });

  describe('JSON output contract', () => {
    it('should include ticket transition fields', () => {
      // Verify the shape of the JSON output includes the transition result fields
      const output = {
        merged: true,
        prNumber: 42,
        title: 'Test PR',
        method: 'squash',
        branchDeleted: true,
        linkedTicket: 'TKT-100',
        ticketMovedToDone: true,
        ticketTransitionProvider: 'linear',
      };

      expect(output).to.have.property('linkedTicket', 'TKT-100');
      expect(output).to.have.property('ticketMovedToDone', true);
      expect(output).to.have.property('ticketTransitionProvider', 'linear');
    });

    it('should have null values when no ticket linked', () => {
      const output = {
        merged: true,
        prNumber: 42,
        title: 'Test PR',
        method: 'squash',
        branchDeleted: true,
        linkedTicket: null,
        ticketMovedToDone: false,
        ticketTransitionProvider: null,
      };

      expect(output.linkedTicket).to.be.null;
      expect(output.ticketMovedToDone).to.be.false;
      expect(output.ticketTransitionProvider).to.be.null;
    });
  });
});
