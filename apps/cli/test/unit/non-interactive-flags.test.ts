/**
 * Unit tests for non-interactive flag parsing (PRLT-1309).
 *
 * Tests the --set flag parsing for project configure workflow,
 * and the --status filter for ticket delete.
 */

import { expect } from 'chai';

/**
 * Valid workflow intent keys (mirrors WORKFLOW_INTENTS in configure.ts).
 */
const VALID_SET_KEYS = new Set(['planned', 'in_progress', 'review', 'done', 'backlog']);

/**
 * Parse a --set flag value into a key-value pair.
 * Returns { key, value } or { error } if invalid.
 *
 * Note: does NOT validate against board columns — the user/agent provides exact values.
 * Board column validation was removed in PRLT-1309 because board data
 * is provider-managed and may not be available locally.
 */
function parseSetFlag(
  pair: string,
  validKeys: Set<string>,
): { key: string; value: string } | { error: string; code: string } {
  const eqIndex = pair.indexOf('=');
  if (eqIndex === -1) {
    return { error: `Invalid --set format: "${pair}". Expected key=value`, code: 'INVALID_SET_FORMAT' };
  }

  const key = pair.substring(0, eqIndex);
  const value = pair.substring(eqIndex + 1);

  if (!validKeys.has(key)) {
    return { error: `Invalid workflow key: "${key}"`, code: 'INVALID_SET_KEY' };
  }

  if (!value) {
    return { error: `Empty value for key "${key}"`, code: 'EMPTY_SET_VALUE' };
  }

  return { key, value };
}

/**
 * Filter tickets by status name (case-insensitive).
 */
function filterByStatus<T extends { statusName?: string }>(tickets: T[], statusFilter: string): T[] {
  const statusLower = statusFilter.toLowerCase();
  return tickets.filter((t) => (t.statusName ?? '').toLowerCase() === statusLower);
}

describe('Non-interactive flag parsing (PRLT-1309)', () => {
  describe('--set flag parsing', () => {
    it('should parse valid key=value pairs', () => {
      const result = parseSetFlag('planned=Backlog', VALID_SET_KEYS);
      expect(result).to.deep.equal({ key: 'planned', value: 'Backlog' });
    });

    it('should accept any column name value', () => {
      const result = parseSetFlag('done=Shipped', VALID_SET_KEYS);
      expect(result).to.deep.equal({ key: 'done', value: 'Shipped' });
    });

    it('should handle values with = in them', () => {
      // First = is the delimiter; everything after is the value
      const result = parseSetFlag('planned=Backlog=Extra', VALID_SET_KEYS);
      expect(result).to.deep.equal({ key: 'planned', value: 'Backlog=Extra' });
    });

    it('should reject pairs without = separator', () => {
      const result = parseSetFlag('planned', VALID_SET_KEYS);
      expect(result).to.have.property('code', 'INVALID_SET_FORMAT');
    });

    it('should reject invalid keys', () => {
      const result = parseSetFlag('invalid_key=Backlog', VALID_SET_KEYS);
      expect(result).to.have.property('code', 'INVALID_SET_KEY');
    });

    it('should reject empty values', () => {
      const result = parseSetFlag('planned=', VALID_SET_KEYS);
      expect(result).to.have.property('code', 'EMPTY_SET_VALUE');
    });

    it('should accept all valid workflow keys', () => {
      for (const key of VALID_SET_KEYS) {
        const result = parseSetFlag(`${key}=Todo`, VALID_SET_KEYS);
        expect(result).to.have.property('key', key);
      }
    });
  });

  describe('--status filter', () => {
    const tickets = [
      { id: 'TKT-001', statusName: 'Backlog' },
      { id: 'TKT-002', statusName: 'Backlog' },
      { id: 'TKT-003', statusName: 'In Progress' },
      { id: 'TKT-004', statusName: 'Done' },
      { id: 'TKT-005', statusName: undefined },
    ];

    it('should filter tickets by exact status (case-insensitive)', () => {
      const result = filterByStatus(tickets, 'backlog');
      expect(result).to.have.length(2);
      expect(result.map((t) => t.id)).to.deep.equal(['TKT-001', 'TKT-002']);
    });

    it('should match status case-insensitively', () => {
      const result = filterByStatus(tickets, 'IN PROGRESS');
      expect(result).to.have.length(1);
      expect(result[0].id).to.equal('TKT-003');
    });

    it('should return empty array when no tickets match', () => {
      const result = filterByStatus(tickets, 'Review');
      expect(result).to.have.length(0);
    });

    it('should handle tickets with undefined statusName', () => {
      const result = filterByStatus(tickets, 'Backlog');
      // TKT-005 has undefined statusName, should not match
      expect(result.map((t) => t.id)).to.not.include('TKT-005');
    });
  });
});
