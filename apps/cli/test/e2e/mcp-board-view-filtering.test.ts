/**
 * E2E tests for board_view MCP tool filtering and compact format (TKT-1115)
 *
 * Tests: summary mode, column filtering, compact default format,
 * exclude-done by default, pagination (limit/offset).
 */

import { expect } from 'chai';
import { execSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import {
  createTestEnvironment,
  cleanupTestEnvironment,
  setupProductionSchema,
  createHQConfig,
  createPMODirectories,
  createTestProject,
  createTestTicket,
  TestEnvironment,
  getIsolatedEnv,
} from './test-helpers.js';

// MCP protocol messages
const INIT_MSG = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test', version: '1.0.0' },
  },
});

const INITIALIZED_MSG = JSON.stringify({
  jsonrpc: '2.0',
  id: 2,
  method: 'notifications/initialized',
  params: {},
});

interface McpResponse {
  result?: {
    content?: Array<{ type: string; text: string }>;
    tools?: Array<{ name: string; description: string; inputSchema: unknown }>;
    protocolVersion?: string;
    serverInfo?: { name: string; version: string };
    capabilities?: unknown;
  };
  error?: { code: number; message: string };
  jsonrpc: string;
  id: number;
}

interface ToolResult {
  success: boolean;
  [key: string]: unknown;
}

describe('board_view filtering and compact format (TKT-1115)', function (this: Mocha.Suite) {
  this.timeout(30000);

  let env: TestEnvironment;
  let db: Database.Database;
  let projectId: string;
  const cliDir = path.join(__dirname, '../..');
  const binPath = path.join(cliDir, 'bin/run.js');

  function mcpCall(messages: string[]): McpResponse {
    const input = messages.join('\n');
    const isolatedEnv = getIsolatedEnv('production');
    isolatedEnv.PRLT_HQ_PATH = env.testDir;
    isolatedEnv.PRLT_TEST_ENV = 'true';

    try {
      const output = execSync(`echo '${input}' | node ${binPath} mcp-server 2>&1`, {
        encoding: 'utf-8',
        cwd: cliDir,
        env: isolatedEnv,
        maxBuffer: 10 * 1024 * 1024,
        timeout: 10000,
      });

      const lines = output.trim().split('\n');
      const lastLine = lines[lines.length - 1];
      return JSON.parse(lastLine) as McpResponse;
    } catch (error: unknown) {
      const e = error as { stdout?: string; stderr?: string; message?: string };
      const output = e.stdout || e.stderr || '';
      const lines = output.trim().split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          return JSON.parse(lines[i]) as McpResponse;
        } catch {
          // continue
        }
      }
      throw new Error(`MCP call failed: ${e.message}`);
    }
  }

  function callTool(name: string, args: Record<string, unknown> = {}): ToolResult {
    const toolMsg = JSON.stringify({
      jsonrpc: '2.0',
      id: 100,
      method: 'tools/call',
      params: { name, arguments: args },
    });

    let response: McpResponse;
    try {
      response = mcpCall([INIT_MSG, INITIALIZED_MSG, toolMsg]);
    } catch {
      // MCP-level failures (e.g., schema validation rejections) crash before JSON response
      return { success: false, error: 'MCP call failed' };
    }

    if (response.error) {
      return { success: false, error: response.error.message };
    }

    if (response.result?.content?.[0]?.text) {
      const text = response.result.content[0].text;
      try {
        return JSON.parse(text) as ToolResult;
      } catch {
        // Non-JSON text content (e.g., MCP validation error messages)
        return { success: false, error: text };
      }
    }

    return { success: false, error: 'No content in response' };
  }

  beforeEach(() => {
    env = createTestEnvironment('mcp-board-filter-');
    createHQConfig(env.proletariatDir, { hasPmo: true });
    createPMODirectories(env.pmoPath);
    db = setupProductionSchema(env.dbPath, env.pmoPath);
    projectId = createTestProject(db, { id: 'board-filter-test', name: 'Board Filter Test' });

    // Create tickets in different statuses:
    // default-backlog (category: backlog)
    createTestTicket(db, projectId, { id: 'TKT-BF-001', title: 'Backlog ticket 1', statusId: 'default-backlog', priority: 'P1', category: 'bug' });
    createTestTicket(db, projectId, { id: 'TKT-BF-002', title: 'Backlog ticket 2', statusId: 'default-backlog', priority: 'P2', category: 'feature' });
    createTestTicket(db, projectId, { id: 'TKT-BF-003', title: 'Backlog ticket 3', statusId: 'default-backlog', priority: 'P3', category: 'feature' });

    // default-in-progress (category: started)
    createTestTicket(db, projectId, { id: 'TKT-BF-004', title: 'In progress ticket', statusId: 'default-in-progress', priority: 'P1', category: 'bug' });

    // default-review (category: started)
    createTestTicket(db, projectId, { id: 'TKT-BF-005', title: 'Review ticket', statusId: 'default-review', priority: 'P2', category: 'feature' });

    // default-done (category: completed) — should be excluded by default
    createTestTicket(db, projectId, { id: 'TKT-BF-006', title: 'Done ticket 1', statusId: 'default-done', priority: 'P3', category: 'feature' });
    createTestTicket(db, projectId, { id: 'TKT-BF-007', title: 'Done ticket 2', statusId: 'default-done', priority: 'P2', category: 'bug' });
  });

  afterEach(() => {
    if (db) db.close();
    cleanupTestEnvironment(env);
  });

  // ===========================================================================
  // COMPACT FORMAT (DEFAULT)
  // ===========================================================================

  describe('compact format (default)', () => {
    it('should return compact ticket objects without full-detail fields', () => {
      const result = callTool('board_view', { project: projectId });
      expect(result.success).to.be.true;
      const board = result.board as any;
      const colWithTickets = board.columns.find((c: any) => c.tickets.length > 0);
      expect(colWithTickets).to.exist;
      const ticket = colWithTickets.tickets[0];

      // Should have compact fields
      expect(ticket).to.have.property('id');
      expect(ticket).to.have.property('title');
      expect(ticket).to.have.property('priority');
      expect(ticket).to.have.property('category');
      expect(ticket).to.have.property('statusName');

      // Should NOT have full-detail fields
      expect(ticket).to.not.have.property('description');
      expect(ticket).to.not.have.property('labels');
      expect(ticket).to.not.have.property('subtasks');
      expect(ticket).to.not.have.property('metadata');
      expect(ticket).to.not.have.property('acceptanceCriteria');
      expect(ticket).to.not.have.property('statusCategory');
      expect(ticket).to.not.have.property('branch');
      expect(ticket).to.not.have.property('owner');
      expect(ticket).to.not.have.property('position');

      // Compact format should only have the 6 compact keys (assignee may be omitted when null)
      const keys = Object.keys(ticket);
      const allowedKeys = new Set(['assignee', 'category', 'id', 'priority', 'statusName', 'title']);
      for (const key of keys) {
        expect(allowedKeys.has(key), `unexpected key '${key}' in compact ticket`).to.be.true;
      }
    });

    it('should include ticketCount per column', () => {
      const result = callTool('board_view', { project: projectId });
      expect(result.success).to.be.true;
      const board = result.board as any;
      for (const col of board.columns) {
        expect(col).to.have.property('ticketCount');
        expect(col.ticketCount).to.equal(col.tickets.length);
      }
    });
  });

  // ===========================================================================
  // EXCLUDE DONE BY DEFAULT
  // ===========================================================================

  describe('exclude done by default', () => {
    it('should not include completed columns by default', () => {
      const result = callTool('board_view', { project: projectId });
      expect(result.success).to.be.true;
      const board = result.board as any;
      const columnNames = board.columns.map((c: any) => c.name);

      // "Done" column (category: completed) should be excluded
      expect(columnNames).to.not.include('Done');

      // Other columns should be present
      expect(columnNames).to.include('Backlog');
    });

    it('should not include done tickets in any column by default', () => {
      const result = callTool('board_view', { project: projectId });
      expect(result.success).to.be.true;
      const board = result.board as any;
      const allTicketIds = board.columns.flatMap((c: any) => c.tickets.map((t: any) => t.id));

      expect(allTicketIds).to.not.include('TKT-BF-006');
      expect(allTicketIds).to.not.include('TKT-BF-007');
    });

    it('should include completed columns when include_done is true', () => {
      const result = callTool('board_view', { project: projectId, include_done: true });
      expect(result.success).to.be.true;
      const board = result.board as any;
      const columnNames = board.columns.map((c: any) => c.name);

      expect(columnNames).to.include('Done');
    });

    it('should include done tickets when include_done is true', () => {
      const result = callTool('board_view', { project: projectId, include_done: true });
      expect(result.success).to.be.true;
      const board = result.board as any;
      const allTicketIds = board.columns.flatMap((c: any) => c.tickets.map((t: any) => t.id));

      expect(allTicketIds).to.include('TKT-BF-006');
      expect(allTicketIds).to.include('TKT-BF-007');
    });
  });

  // ===========================================================================
  // SUMMARY MODE
  // ===========================================================================

  describe('summary mode', () => {
    it('should return only column names and ticket counts when summary is true', () => {
      const result = callTool('board_view', { project: projectId, summary: true });
      expect(result.success).to.be.true;
      const board = result.board as any;

      expect(board).to.have.property('totalTickets');
      expect(board.columns).to.be.an('array');

      for (const col of board.columns) {
        expect(col).to.have.property('name');
        expect(col).to.have.property('position');
        expect(col).to.have.property('ticketCount');
        // Should NOT have tickets array
        expect(col).to.not.have.property('tickets');
      }
    });

    it('should report correct totalTickets excluding done', () => {
      const result = callTool('board_view', { project: projectId, summary: true });
      expect(result.success).to.be.true;
      const board = result.board as any;

      // 5 non-done tickets: 3 backlog + 1 in-progress + 1 review
      expect(board.totalTickets).to.equal(5);
    });

    it('should include done tickets in totalTickets when include_done is true', () => {
      const result = callTool('board_view', { project: projectId, summary: true, include_done: true });
      expect(result.success).to.be.true;
      const board = result.board as any;

      // All 7 tickets
      expect(board.totalTickets).to.equal(7);
    });

    it('should exclude done columns from summary by default', () => {
      const result = callTool('board_view', { project: projectId, summary: true });
      expect(result.success).to.be.true;
      const board = result.board as any;
      const columnNames = board.columns.map((c: any) => c.name);

      expect(columnNames).to.not.include('Done');
    });
  });

  // ===========================================================================
  // COLUMN FILTERING
  // ===========================================================================

  describe('column filtering', () => {
    it('should filter to a specific column by name', () => {
      const result = callTool('board_view', { project: projectId, column: 'In Progress' });
      expect(result.success).to.be.true;
      const board = result.board as any;

      expect(board.columns).to.have.length(1);
      expect(board.columns[0].name).to.equal('In Progress');
    });

    it('should use case-insensitive partial match', () => {
      const result = callTool('board_view', { project: projectId, column: 'progress' });
      expect(result.success).to.be.true;
      const board = result.board as any;

      expect(board.columns).to.have.length(1);
      expect(board.columns[0].name).to.equal('In Progress');
    });

    it('should return empty columns array when no column matches', () => {
      const result = callTool('board_view', { project: projectId, column: 'nonexistent' });
      expect(result.success).to.be.true;
      const board = result.board as any;

      expect(board.columns).to.have.length(0);
    });

    it('should work with summary mode', () => {
      const result = callTool('board_view', { project: projectId, column: 'Backlog', summary: true });
      expect(result.success).to.be.true;
      const board = result.board as any;

      expect(board.columns).to.have.length(1);
      expect(board.columns[0].name).to.equal('Backlog');
      expect(board.columns[0].ticketCount).to.equal(3);
      expect(board.totalTickets).to.equal(3);
    });

    it('should allow filtering to done column with include_done', () => {
      const result = callTool('board_view', { project: projectId, column: 'Done', include_done: true });
      expect(result.success).to.be.true;
      const board = result.board as any;

      expect(board.columns).to.have.length(1);
      expect(board.columns[0].name).to.equal('Done');
      expect(board.columns[0].ticketCount).to.equal(2);
    });
  });

  // ===========================================================================
  // PAGINATION (LIMIT / OFFSET)
  // ===========================================================================

  describe('pagination (limit/offset)', () => {
    it('should limit tickets per column', () => {
      const result = callTool('board_view', { project: projectId, column: 'Backlog', limit: 2 });
      expect(result.success).to.be.true;
      const board = result.board as any;
      const backlog = board.columns[0];

      expect(backlog.ticketCount).to.equal(3); // total count
      expect(backlog.showing).to.equal(2);     // showing limited count
      expect(backlog.tickets).to.have.length(2);
    });

    it('should skip tickets with offset', () => {
      const result = callTool('board_view', { project: projectId, column: 'Backlog', offset: 1 });
      expect(result.success).to.be.true;
      const board = result.board as any;
      const backlog = board.columns[0];

      expect(backlog.ticketCount).to.equal(3);
      expect(backlog.showing).to.equal(2);    // 3 - 1 offset = 2
      expect(backlog.offset).to.equal(1);
      expect(backlog.tickets).to.have.length(2);
    });

    it('should combine limit and offset', () => {
      const result = callTool('board_view', { project: projectId, column: 'Backlog', limit: 1, offset: 1 });
      expect(result.success).to.be.true;
      const board = result.board as any;
      const backlog = board.columns[0];

      expect(backlog.ticketCount).to.equal(3);
      expect(backlog.showing).to.equal(1);
      expect(backlog.offset).to.equal(1);
      expect(backlog.tickets).to.have.length(1);
    });

    it('should return empty tickets when offset exceeds count', () => {
      const result = callTool('board_view', { project: projectId, column: 'Backlog', offset: 100 });
      expect(result.success).to.be.true;
      const board = result.board as any;
      const backlog = board.columns[0];

      expect(backlog.ticketCount).to.equal(3);
      expect(backlog.showing).to.equal(0);
      expect(backlog.tickets).to.have.length(0);
    });

    it('should handle limit of 0 by returning no tickets', () => {
      const result = callTool('board_view', { project: projectId, column: 'Backlog', limit: 0 });
      expect(result.success).to.be.true;
      const board = result.board as any;
      const backlog = board.columns[0];

      expect(backlog.ticketCount).to.equal(3);
      expect(backlog.showing).to.equal(0);
      expect(backlog.tickets).to.have.length(0);
    });

    it('should not include showing/offset metadata when no pagination params used', () => {
      const result = callTool('board_view', { project: projectId, column: 'Backlog' });
      expect(result.success).to.be.true;
      const board = result.board as any;
      const backlog = board.columns[0];

      expect(backlog).to.not.have.property('showing');
      expect(backlog).to.not.have.property('offset');
    });
  });

  // ===========================================================================
  // INPUT VALIDATION
  // ===========================================================================

  describe('input validation', () => {
    it('should reject negative limit', () => {
      const result = callTool('board_view', { project: projectId, limit: -1 });
      expect(result.success).to.be.false;
    });

    it('should reject negative offset', () => {
      const result = callTool('board_view', { project: projectId, offset: -5 });
      expect(result.success).to.be.false;
    });

    it('should reject fractional limit', () => {
      const result = callTool('board_view', { project: projectId, limit: 1.5 });
      expect(result.success).to.be.false;
    });

    it('should reject fractional offset', () => {
      const result = callTool('board_view', { project: projectId, offset: 0.5 });
      expect(result.success).to.be.false;
    });
  });
});
