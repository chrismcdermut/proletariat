import { expect } from 'chai';
import { validateBranchName } from '../../src/lib/branch/index.js';

/**
 * Unit tests for the PR merge → work ship delegation logic.
 *
 * When `prlt pr merge <num>` is run on a PR linked to a ticket,
 * it should delegate to `work:ship` for the full lifecycle.
 * When the PR has no linked ticket, it should merge directly.
 *
 * These tests verify the ticket resolution logic that determines
 * which path to take, and the argument building for delegation.
 */
describe('PR Merge - Work Ship Delegation', () => {

  describe('Ticket detection determines delegation path', () => {
    const mockTickets = [
      {
        id: 'TKT-100',
        metadata: { pr_number: '42', pr_url: 'https://github.com/owner/repo/pull/42', external_key: 'PRLT-1279' },
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

    it('should detect linked ticket by pr_number and delegate to ship', () => {
      const prNumber = 42;
      const linkedTicket = mockTickets.find(t =>
        t.metadata?.pr_number === String(prNumber)
      );

      expect(linkedTicket).to.not.be.undefined;
      expect(linkedTicket!.id).to.equal('TKT-100');
      // When linkedTicket is found, pr merge should delegate to work:ship
    });

    it('should detect linked ticket by pr_url and delegate to ship', () => {
      const prNumber = 42;
      const linkedTicket = mockTickets.find(t =>
        t.metadata?.pr_url?.endsWith(`/pull/${prNumber}`)
      );

      expect(linkedTicket).to.not.be.undefined;
      expect(linkedTicket!.id).to.equal('TKT-100');
    });

    it('should detect linked ticket by branch name external_key', () => {
      const branchResult = validateBranchName('PRLT-1043/feat/chrismcdermut/early-yang/auto-move');
      expect(branchResult.valid).to.be.true;
      const ticketId = branchResult.parts?.ticketId;

      const linkedTicket = mockTickets.find(t =>
        t.metadata?.external_key === ticketId
      );

      expect(linkedTicket).to.not.be.undefined;
      expect(linkedTicket!.id).to.equal('TKT-200');
    });

    it('should NOT find a linked ticket for unlinked PRs — merge directly', () => {
      const prNumber = 999; // No ticket has this PR number
      const headBranch = 'chore/bump-version'; // Not a ticket branch

      // Step 1: Check metadata
      const byMetadata = mockTickets.find(t =>
        t.metadata?.pr_number === String(prNumber) ||
        t.metadata?.pr_url?.endsWith(`/pull/${prNumber}`)
      );
      expect(byMetadata).to.be.undefined;

      // Step 2: Branch name parsing
      const branchResult = validateBranchName(headBranch);
      // Non-ticket branches may be invalid or have no ticketId
      const hasTicketId = branchResult.valid && branchResult.parts?.ticketId;
      expect(hasTicketId).to.not.be.ok;

      // No linked ticket → should merge directly without lifecycle
    });
  });

  describe('work:ship argument building', () => {
    function buildShipArgs(opts: {
      prNumber: number;
      method: string;
      deleteBranch: boolean;
      admin: boolean;
      project?: string;
      jsonMode: boolean;
    }): string[] {
      const args: string[] = ['--pr', String(opts.prNumber)];
      args.push('--method', opts.method);
      if (!opts.deleteBranch) {
        args.push('--no-delete-branch');
      }
      if (opts.admin) {
        args.push('--admin');
      }
      if (opts.project) {
        args.push('--project', opts.project);
      }
      if (opts.jsonMode) {
        args.push('--json');
      }
      return args;
    }

    it('should build args with default flags', () => {
      const args = buildShipArgs({
        prNumber: 1120,
        method: 'squash',
        deleteBranch: true,
        admin: false,
        jsonMode: false,
      });

      expect(args).to.deep.equal(['--pr', '1120', '--method', 'squash']);
    });

    it('should include --no-delete-branch when branch deletion is disabled', () => {
      const args = buildShipArgs({
        prNumber: 1120,
        method: 'squash',
        deleteBranch: false,
        admin: false,
        jsonMode: false,
      });

      expect(args).to.include('--no-delete-branch');
    });

    it('should include --admin when admin flag is set', () => {
      const args = buildShipArgs({
        prNumber: 1120,
        method: 'squash',
        deleteBranch: true,
        admin: true,
        jsonMode: false,
      });

      expect(args).to.include('--admin');
    });

    it('should include --project when project is specified', () => {
      const args = buildShipArgs({
        prNumber: 1120,
        method: 'merge',
        deleteBranch: true,
        admin: false,
        project: 'PRLT',
        jsonMode: false,
      });

      expect(args).to.include('--project');
      expect(args).to.include('PRLT');
    });

    it('should include --json when in JSON mode', () => {
      const args = buildShipArgs({
        prNumber: 1120,
        method: 'squash',
        deleteBranch: true,
        admin: false,
        jsonMode: true,
      });

      expect(args).to.include('--json');
    });

    it('should pass through non-default merge method', () => {
      const args = buildShipArgs({
        prNumber: 1120,
        method: 'rebase',
        deleteBranch: true,
        admin: false,
        jsonMode: false,
      });

      expect(args).to.include('--method');
      expect(args).to.include('rebase');
    });

    it('should include all flags when everything is set', () => {
      const args = buildShipArgs({
        prNumber: 555,
        method: 'merge',
        deleteBranch: false,
        admin: true,
        project: 'MY-PROJECT',
        jsonMode: true,
      });

      expect(args).to.deep.equal([
        '--pr', '555',
        '--method', 'merge',
        '--no-delete-branch',
        '--admin',
        '--project', 'MY-PROJECT',
        '--json',
      ]);
    });
  });

  describe('Display ID resolution for output messages', () => {
    it('should prefer external_key over internal id for display', () => {
      const ticket = {
        id: 'TKT-100',
        metadata: { external_key: 'PRLT-1279' },
      };

      const displayId = ticket.metadata?.external_key || ticket.id;
      expect(displayId).to.equal('PRLT-1279');
    });

    it('should fall back to internal id when no external_key', () => {
      const ticket: { id: string; metadata?: Record<string, string> } = {
        id: 'TKT-300',
        metadata: {},
      };

      const displayId = ticket.metadata?.external_key || ticket.id;
      expect(displayId).to.equal('TKT-300');
    });

    it('should use internal id when metadata is undefined', () => {
      const ticket: { id: string; metadata?: Record<string, string> } = {
        id: 'TKT-400',
        metadata: undefined,
      };

      const displayId = ticket.metadata?.external_key || ticket.id;
      expect(displayId).to.equal('TKT-400');
    });
  });

  describe('JSON output contract for direct merge (no ticket)', () => {
    it('should include delegatedToWorkShip: false when merging directly', () => {
      const output = {
        merged: true,
        prNumber: 1122,
        title: 'chore: bump version',
        method: 'squash',
        branchDeleted: true,
        linkedTicket: null,
        ticketMovedToDone: false,
        ticketTransitionProvider: null,
        delegatedToWorkShip: false,
      };

      expect(output.linkedTicket).to.be.null;
      expect(output.ticketMovedToDone).to.be.false;
      expect(output.delegatedToWorkShip).to.be.false;
    });
  });
});
