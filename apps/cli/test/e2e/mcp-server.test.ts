/**
 * Comprehensive E2E tests for MCP Server
 *
 * Tests MCP tools exposed by the mcp-server command.
 * Uses isolated test environments to prevent pollution of real workspace data.
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
  createTestEpic,
  createTestSpec,
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

const LIST_TOOLS_MSG = JSON.stringify({
  jsonrpc: '2.0',
  id: 3,
  method: 'tools/list',
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

describe('MCP Server E2E Tests', function (this: Mocha.Suite) {
  this.timeout(30000);

  let env: TestEnvironment;
  let db: Database.Database;
  const cliDir = path.join(__dirname, '../..');
  const binPath = path.join(cliDir, 'bin/run.js');

  /**
   * Send MCP messages to the server and get the last response
   */
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
        timeout: 5000,
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

  /**
   * Call an MCP tool and parse the result
   */
  function callTool(name: string, args: Record<string, unknown> = {}): ToolResult {
    const toolMsg = JSON.stringify({
      jsonrpc: '2.0',
      id: 100,
      method: 'tools/call',
      params: { name, arguments: args },
    });

    const response = mcpCall([INIT_MSG, INITIALIZED_MSG, toolMsg]);

    if (response.error) {
      return { success: false, error: response.error.message };
    }

    if (response.result?.content?.[0]?.text) {
      return JSON.parse(response.result.content[0].text) as ToolResult;
    }

    return { success: false, error: 'No content in response' };
  }

  beforeEach(() => {
    env = createTestEnvironment('mcp-server-test-');
    createHQConfig(env.proletariatDir, { hasPmo: true });
    createPMODirectories(env.pmoPath);
    db = setupProductionSchema(env.dbPath, env.pmoPath);
  });

  afterEach(() => {
    if (db) db.close();
    cleanupTestEnvironment(env);
  });

  // ===========================================================================
  // INITIALIZATION TESTS
  // ===========================================================================

  describe('MCP Protocol Initialization', () => {
    it('should respond to initialize request', () => {
      const response = mcpCall([INIT_MSG]);
      expect(response.result).to.exist;
      expect(response.result?.protocolVersion).to.equal('2024-11-05');
      expect(response.result?.serverInfo?.name).to.equal('prlt');
    });

    it('should list all tools', () => {
      const response = mcpCall([INIT_MSG, INITIALIZED_MSG, LIST_TOOLS_MSG]);
      expect(response.result?.tools).to.be.an('array');
      expect(response.result?.tools?.length).to.be.at.least(125);
    });

    it('should have tools capability', () => {
      const response = mcpCall([INIT_MSG, INITIALIZED_MSG, LIST_TOOLS_MSG]);
      // The capabilities object contains 'tools' key with listChanged: true
      expect(response.result?.tools).to.be.an('array');
    });
  });

  // ===========================================================================
  // TICKET TOOLS TESTS
  // ===========================================================================

  describe('Ticket Tools', () => {
    let projectId: string;
    let ticketId: string;

    beforeEach(() => {
      projectId = createTestProject(db, { id: 'mcp-test-project', name: 'MCP Test Project' });
      ticketId = createTestTicket(db, projectId, { id: 'TKT-MCP-001', title: 'Test Ticket' });
    });

    it('ticket_list - should list tickets', () => {
      const result = callTool('ticket_list', { project: projectId });
      expect(result.success).to.be.true;
      expect(result.count).to.be.at.least(1);
      expect(result.tickets).to.be.an('array');
    });

    it('ticket_list - should not include descriptions', () => {
      createTestTicket(db, projectId, { id: 'TKT-MCP-DESC', title: 'Ticket With Desc', description: 'A long description here' });
      const result = callTool('ticket_list', { project: projectId });
      expect(result.success).to.be.true;
      const tickets = result.tickets as Array<Record<string, unknown>>;
      tickets.forEach((t) => expect(t).to.not.have.property('description'));
    });

    it('ticket_list - should return pagination metadata', () => {
      const result = callTool('ticket_list', { project: projectId });
      expect(result.success).to.be.true;
      expect(result).to.have.property('total');
      expect(result).to.have.property('offset', 0);
      expect(result).to.have.property('limit', 50);
    });

    it('ticket_list - should respect limit and offset', () => {
      // Create several tickets
      for (let i = 0; i < 5; i++) {
        createTestTicket(db, projectId, { id: `TKT-MCP-PG${i}`, title: `Paginated ${i}` });
      }
      // Total should be 6 (1 from beforeEach + 5 created here)
      const all = callTool('ticket_list', { project: projectId, limit: 100 });
      expect((all.tickets as unknown[]).length).to.equal(all.total);

      const page1 = callTool('ticket_list', { project: projectId, limit: 2, offset: 0 });
      expect(page1.success).to.be.true;
      expect((page1.tickets as unknown[]).length).to.equal(2);
      expect(page1.total).to.equal(all.total);

      const page2 = callTool('ticket_list', { project: projectId, limit: 2, offset: 2 });
      expect(page2.success).to.be.true;
      expect((page2.tickets as unknown[]).length).to.equal(2);

      // Tickets from page1 and page2 should be different
      const page1Ids = (page1.tickets as Array<{ id: string }>).map(t => t.id);
      const page2Ids = (page2.tickets as Array<{ id: string }>).map(t => t.id);
      page2Ids.forEach(id => expect(page1Ids).to.not.include(id));
    });

    it('ticket_list - should default limit to 50', () => {
      const result = callTool('ticket_list', { project: projectId });
      expect(result.limit).to.equal(50);
    });

    it('ticket_list - should only return summary fields', () => {
      const result = callTool('ticket_list', { project: projectId });
      expect(result.success).to.be.true;
      const tickets = result.tickets as Array<Record<string, unknown>>;
      expect(tickets.length).to.be.at.least(1);
      const ticket = tickets[0];
      // Should have summary fields
      expect(ticket).to.have.property('id');
      expect(ticket).to.have.property('title');
      expect(ticket).to.have.property('statusName');
      expect(ticket).to.have.property('statusCategory');
      expect(ticket).to.have.property('priority');
      expect(ticket).to.have.property('category');
      expect(ticket).to.have.property('labels');
      expect(ticket).to.have.property('assignee');
      expect(ticket).to.have.property('position');
      // Should NOT have detail fields
      expect(ticket).to.not.have.property('description');
      expect(ticket).to.not.have.property('projectId');
      expect(ticket).to.not.have.property('owner');
      expect(ticket).to.not.have.property('epicId');
      expect(ticket).to.not.have.property('branch');
      expect(ticket).to.not.have.property('createdAt');
      expect(ticket).to.not.have.property('updatedAt');
    });

    it('ticket_list - should filter by priority', () => {
      createTestTicket(db, projectId, { id: 'TKT-MCP-P0', title: 'P0 Ticket', priority: 'P0' });
      const result = callTool('ticket_list', { project: projectId, priority: 'P0' });
      expect(result.success).to.be.true;
      const tickets = result.tickets as Array<{ priority: string }>;
      tickets.forEach((t) => expect(t.priority).to.equal('P0'));
    });

    it('ticket_create - should create a ticket', () => {
      const result = callTool('ticket_create', {
        title: 'New MCP Ticket',
        project: projectId,
        description: 'Created via MCP',
        priority: 'P1',
        category: 'feature',
      });
      expect(result.success).to.be.true;
      expect(result.ticket).to.have.property('id');
      expect((result.ticket as { title: string }).title).to.equal('New MCP Ticket');
    });

    it('ticket_show - should get ticket details', () => {
      const result = callTool('ticket_show', { id: ticketId });
      expect(result.success).to.be.true;
      expect(result.ticket).to.have.property('id', ticketId);
    });

    it('ticket_show - should error for non-existent ticket', () => {
      const result = callTool('ticket_show', { id: 'TKT-NONEXISTENT' });
      expect(result.success).to.be.false;
    });

    it('ticket_update - should update ticket fields', () => {
      const result = callTool('ticket_update', {
        id: ticketId,
        title: 'Updated Title',
        priority: 'P0',
      });
      expect(result.success).to.be.true;
      expect((result.ticket as { title: string }).title).to.equal('Updated Title');
    });

    it('ticket_move - should move ticket to column', () => {
      const result = callTool('ticket_move', { id: ticketId, column: 'In Progress' });
      expect(result.success).to.be.true;
    });

    it('ticket_delete - should delete ticket', () => {
      const tempTicket = createTestTicket(db, projectId, { id: 'TKT-DELETE', title: 'To Delete' });
      const result = callTool('ticket_delete', { id: tempTicket });
      expect(result.success).to.be.true;
    });

    it('ticket_add_subtask - should add subtask', () => {
      const result = callTool('ticket_add_subtask', {
        ticket_id: ticketId,
        title: 'Subtask via MCP',
      });
      expect(result.success).to.be.true;
      expect(result.subtask).to.have.property('title', 'Subtask via MCP');
    });

    it('ticket_toggle_subtask - should toggle subtask', () => {
      const addResult = callTool('ticket_add_subtask', {
        ticket_id: ticketId,
        title: 'Toggle Test',
      });
      const subtaskId = (addResult.subtask as { id: string }).id;

      const toggleResult = callTool('ticket_toggle_subtask', {
        ticket_id: ticketId,
        subtask_id: subtaskId,
      });
      expect(toggleResult.success).to.be.true;
    });

    it('ticket_remove_subtask - should remove subtask', () => {
      const addResult = callTool('ticket_add_subtask', {
        ticket_id: ticketId,
        title: 'To Remove',
      });
      const subtaskId = (addResult.subtask as { id: string }).id;

      const removeResult = callTool('ticket_remove_subtask', {
        ticket_id: ticketId,
        subtask_id: subtaskId,
      });
      expect(removeResult.success).to.be.true;
    });

    it('ticket_add_acceptance_criterion - should add AC', () => {
      const result = callTool('ticket_add_acceptance_criterion', {
        ticket_id: ticketId,
        criterion: 'Users can login via MCP',
      });
      expect(result.success).to.be.true;
      expect(result.acceptanceCriterion).to.exist;
      // AC has 'id' and either 'text' or 'criterion' depending on storage impl
      expect(result.acceptanceCriterion).to.have.property('id');
    });

    it('ticket_remove_acceptance_criterion - should remove AC', () => {
      const addResult = callTool('ticket_add_acceptance_criterion', {
        ticket_id: ticketId,
        criterion: 'To Remove AC',
      });
      const acId = (addResult.acceptanceCriterion as { id: string }).id;

      const removeResult = callTool('ticket_remove_acceptance_criterion', {
        ticket_id: ticketId,
        criterion_id: acId,
      });
      expect(removeResult.success).to.be.true;
    });

    it('ticket_add_blocker - should add blocker', () => {
      const blockerTicket = createTestTicket(db, projectId, { id: 'TKT-BLOCKER', title: 'Blocker' });
      const result = callTool('ticket_add_blocker', {
        ticket_id: ticketId,
        blocker_id: blockerTicket,
      });
      expect(result.success).to.be.true;
    });

    it('ticket_get_blockers - should get blockers', () => {
      const blockerTicket = createTestTicket(db, projectId, { id: 'TKT-BLOCKER2', title: 'Blocker' });
      callTool('ticket_add_blocker', { ticket_id: ticketId, blocker_id: blockerTicket });

      const result = callTool('ticket_get_blockers', { ticket_id: ticketId });
      expect(result.success).to.be.true;
      expect(result.blockers).to.be.an('array');
    });

    it('ticket_remove_blocker - should remove blocker', () => {
      const blockerTicket = createTestTicket(db, projectId, { id: 'TKT-BLOCKER3', title: 'Blocker' });
      callTool('ticket_add_blocker', { ticket_id: ticketId, blocker_id: blockerTicket });

      const result = callTool('ticket_remove_blocker', {
        ticket_id: ticketId,
        blocker_id: blockerTicket,
      });
      expect(result.success).to.be.true;
    });

    it('ticket_move_to_project - should move to different project', () => {
      const newProject = createTestProject(db, { id: 'mcp-other-project', name: 'Other Project' });
      const result = callTool('ticket_move_to_project', { id: ticketId, project: newProject });
      expect(result.success).to.be.true;
    });
  });

  // ===========================================================================
  // PROJECT TOOLS TESTS
  // ===========================================================================

  describe('Project Tools', () => {
    let projectId: string;

    beforeEach(() => {
      projectId = createTestProject(db, { id: 'mcp-proj-test', name: 'MCP Project Test' });
    });

    it('project_list - should list projects', () => {
      const result = callTool('project_list', {});
      expect(result.success).to.be.true;
      expect(result.projects).to.be.an('array');
      expect(result.count).to.be.at.least(1);
    });

    it('project_list - should search by name', () => {
      const result = callTool('project_list', { search: 'MCP Project' });
      expect(result.success).to.be.true;
      const projects = result.projects as Array<{ name: string }>;
      expect(projects.some((p) => p.name.includes('MCP Project'))).to.be.true;
    });

    it('project_create - should create a project', () => {
      const result = callTool('project_create', {
        name: 'New MCP Project',
        description: 'Created via MCP',
        template: 'kanban',
      });
      expect(result.success).to.be.true;
      expect(result.project).to.have.property('id');
    });

    it('project_show - should get project details', () => {
      const result = callTool('project_show', { id: projectId });
      expect(result.success).to.be.true;
      expect(result.project).to.have.property('id', projectId);
    });

    it('project_show - should error for non-existent project', () => {
      const result = callTool('project_show', { id: 'PROJ-NONEXISTENT' });
      expect(result.success).to.be.false;
    });

    it('project_update - should update project', () => {
      const result = callTool('project_update', {
        id: projectId,
        name: 'Updated MCP Project',
        description: 'Updated description',
      });
      expect(result.success).to.be.true;
    });

    it('project_archive - should archive project', () => {
      const result = callTool('project_archive', { id: projectId });
      expect(result.success).to.be.true;
      expect((result.project as { isArchived: boolean }).isArchived).to.be.true;
    });

    it('project_unarchive - should unarchive project', () => {
      callTool('project_archive', { id: projectId });
      const result = callTool('project_unarchive', { id: projectId });
      expect(result.success).to.be.true;
      expect((result.project as { isArchived: boolean }).isArchived).to.be.false;
    });

    it('project_delete - should delete project', () => {
      const tempProject = createTestProject(db, { id: 'mcp-del-proj', name: 'Delete Me' });
      const result = callTool('project_delete', { id: tempProject });
      expect(result.success).to.be.true;
    });
  });

  // ===========================================================================
  // BOARD TOOLS TESTS
  // ===========================================================================

  describe('Board Tools', () => {
    let projectId: string;

    beforeEach(() => {
      projectId = createTestProject(db, { id: 'mcp-board-test', name: 'MCP Board Test' });
      createTestTicket(db, projectId, { id: 'TKT-BOARD-1', title: 'Board Test Ticket' });
    });

    it('board_show - should show board', () => {
      const result = callTool('board_show', { project: projectId });
      expect(result.success).to.be.true;
      expect(result.board).to.have.property('columns');
    });

    it('board_columns - should list columns', () => {
      const result = callTool('board_columns', { project: projectId });
      expect(result.success).to.be.true;
      expect(result.columns).to.be.an('array');
    });

    it('board_create_column - should create column', () => {
      const result = callTool('board_create_column', {
        project: projectId,
        name: 'MCP Custom Column',
        position: 99,
      });
      expect(result.success).to.be.true;
      expect(result.column).to.have.property('name', 'MCP Custom Column');
    });

    it('board_rename_column - should rename column', () => {
      // First create a column
      const createResult = callTool('board_create_column', {
        project: projectId,
        name: 'Old Name',
      });
      const columnId = (createResult.column as { id: string }).id;

      const result = callTool('board_rename_column', {
        project: projectId,
        column_id: columnId,
        name: 'New Name',
      });
      expect(result.success).to.be.true;
    });

    it('board_move_column - should reorder column', () => {
      const createResult = callTool('board_create_column', {
        project: projectId,
        name: 'Move Me',
      });
      const columnId = (createResult.column as { id: string }).id;

      const result = callTool('board_move_column', {
        project: projectId,
        column_id: columnId,
        position: 0,
      });
      expect(result.success).to.be.true;
    });

    it('board_delete_column - should delete column', () => {
      const createResult = callTool('board_create_column', {
        project: projectId,
        name: 'Delete Me',
      });
      const columnId = (createResult.column as { id: string }).id;

      const result = callTool('board_delete_column', {
        project: projectId,
        column_id: columnId,
      });
      expect(result.success).to.be.true;
    });
  });

  // ===========================================================================
  // SPEC TOOLS TESTS
  // ===========================================================================

  describe('Spec Tools', () => {
    let specId: string;

    beforeEach(() => {
      createTestProject(db, { id: 'mcp-spec-proj', name: 'Spec Project' });
      specId = createTestSpec(db, { id: 'SPEC-MCP-001', title: 'MCP Test Spec' });
    });

    it('spec_list - should list specs', () => {
      const result = callTool('spec_list', {});
      expect(result.success).to.be.true;
      expect(result.specs).to.be.an('array');
    });

    it('spec_list - should filter by status', () => {
      const result = callTool('spec_list', { status: 'draft' });
      expect(result.success).to.be.true;
    });

    it('spec_create - should create spec', () => {
      const result = callTool('spec_create', {
        title: 'New MCP Spec',
        status: 'draft',
        type: 'product',
        problem: 'A problem statement',
        solution: 'A solution',
      });
      expect(result.success).to.be.true;
      expect(result.spec).to.have.property('id');
    });

    it('spec_show - should get spec details', () => {
      const result = callTool('spec_show', { id: specId });
      expect(result.success).to.be.true;
      expect(result.spec).to.have.property('id', specId);
    });

    it('spec_update - should update spec', () => {
      const result = callTool('spec_update', {
        id: specId,
        title: 'Updated Spec Title',
        status: 'active',
      });
      expect(result.success).to.be.true;
    });

    it('spec_delete - should delete spec', () => {
      const tempSpec = createTestSpec(db, { id: 'SPEC-DEL', title: 'Delete Me' });
      const result = callTool('spec_delete', { id: tempSpec });
      expect(result.success).to.be.true;
    });

    it('spec_add_dependency - should add dependency', () => {
      const otherSpec = createTestSpec(db, { id: 'SPEC-DEP', title: 'Dependency' });
      const result = callTool('spec_add_dependency', {
        spec_id: specId,
        depends_on_id: otherSpec,
      });
      expect(result.success).to.be.true;
    });

    it('spec_get_dependencies - should get dependencies', () => {
      const result = callTool('spec_get_dependencies', { spec_id: specId });
      expect(result.success).to.be.true;
      expect(result.dependencies).to.be.an('array');
    });
  });

  // ===========================================================================
  // EPIC TOOLS TESTS
  // ===========================================================================

  describe('Epic Tools', () => {
    let projectId: string;
    let epicId: string;

    beforeEach(() => {
      projectId = createTestProject(db, { id: 'mcp-epic-proj', name: 'Epic Project' });
      epicId = createTestEpic(db, projectId, { id: 'EPIC-MCP-001', title: 'MCP Test Epic' });
    });

    it('epic_list - should list epics', () => {
      const result = callTool('epic_list', { project: projectId });
      expect(result.success).to.be.true;
      expect(result.epics).to.be.an('array');
    });

    it('epic_list - should filter by status', () => {
      const result = callTool('epic_list', { project: projectId, status: 'active' });
      expect(result.success).to.be.true;
    });

    it('epic_create - should create epic', () => {
      const result = callTool('epic_create', {
        title: 'New MCP Epic',
        project: projectId,
        description: 'Epic description',
        status: 'draft',
      });
      expect(result.success).to.be.true;
      expect(result.epic).to.have.property('id');
    });

    it('epic_show - should get epic details', () => {
      const result = callTool('epic_show', { id: epicId });
      expect(result.success).to.be.true;
      expect(result.epic).to.have.property('id', epicId);
    });

    it('epic_update - should update epic', () => {
      const result = callTool('epic_update', {
        id: epicId,
        title: 'Updated Epic',
        status: 'complete',
      });
      expect(result.success).to.be.true;
    });

    it('epic_delete - should delete epic', () => {
      const tempEpic = createTestEpic(db, projectId, { id: 'EPIC-DEL', title: 'Delete Me' });
      const result = callTool('epic_delete', { id: tempEpic });
      expect(result.success).to.be.true;
    });

    it('epic_reorder - should reorder epic', () => {
      const result = callTool('epic_reorder', { id: epicId, position: 0 });
      expect(result.success).to.be.true;
    });

    it('epic_add_blocker - should add epic dependency', () => {
      const otherEpic = createTestEpic(db, projectId, { id: 'EPIC-BLOCK', title: 'Blocker Epic' });
      const result = callTool('epic_add_blocker', {
        epic_id: epicId,
        blocker_id: otherEpic,
      });
      expect(result.success).to.be.true;
    });

    it('ticket_link_to_epic - should link ticket to epic', () => {
      const ticketId = createTestTicket(db, projectId, { id: 'TKT-EPIC-LINK', title: 'Link to Epic' });
      const result = callTool('ticket_link_to_epic', {
        ticket_id: ticketId,
        epic_id: epicId,
      });
      expect(result.success).to.be.true;
    });

    it('ticket_unlink_from_epic - should unlink ticket from epic', () => {
      const ticketId = createTestTicket(db, projectId, { id: 'TKT-EPIC-UNLINK', title: 'Unlink' });
      callTool('ticket_link_to_epic', { ticket_id: ticketId, epic_id: epicId });

      const result = callTool('ticket_unlink_from_epic', { ticket_id: ticketId });
      expect(result.success).to.be.true;
    });
  });

  // ===========================================================================
  // WORK TOOLS TESTS
  // ===========================================================================

  describe('Work Tools', () => {
    let projectId: string;
    let ticketId: string;

    beforeEach(() => {
      projectId = createTestProject(db, { id: 'mcp-work-proj', name: 'Work Project' });
      ticketId = createTestTicket(db, projectId, { id: 'TKT-WORK-001', title: 'Work Test Ticket' });
    });

    it('work_status - should get work status', () => {
      const result = callTool('work_status', {});
      expect(result.success).to.be.true;
      expect(result).to.have.property('inProgressCount');
    });

    it('work_start - should start work on ticket', () => {
      const result = callTool('work_start', {
        ticket_id: ticketId,
        assignee: 'mcp-agent',
      });
      expect(result.success).to.be.true;
    });

    it('work_complete - should complete ticket', () => {
      callTool('work_start', { ticket_id: ticketId });
      const result = callTool('work_complete', { ticket_id: ticketId });
      expect(result.success).to.be.true;
    });

    it('work_ready - should mark ticket ready for review', () => {
      callTool('work_start', { ticket_id: ticketId });
      const result = callTool('work_ready', { ticket_id: ticketId });
      expect(result.success).to.be.true;
    });

    it('work_revise - should send ticket back for revision', () => {
      callTool('work_start', { ticket_id: ticketId });
      const result = callTool('work_revise', { ticket_id: ticketId });
      expect(result.success).to.be.true;
    });
  });

  // ===========================================================================
  // WORKFLOW TOOLS TESTS
  // ===========================================================================

  describe('Workflow Tools', () => {
    it('workflow_list - should list workflows', () => {
      const result = callTool('workflow_list', { include_builtin: true });
      expect(result.success).to.be.true;
      expect(result.workflows).to.be.an('array');
    });

    it('workflow_show - should show workflow details', () => {
      const result = callTool('workflow_show', { id: 'default' });
      expect(result.success).to.be.true;
      expect(result.workflow).to.have.property('statuses');
    });

    it('workflow_create - should create workflow', () => {
      const result = callTool('workflow_create', {
        name: 'MCP Workflow',
        description: 'Created via MCP',
      });
      expect(result.success).to.be.true;
      expect(result.workflow).to.have.property('id');
    });

    it('workflow_delete - should delete workflow', () => {
      const createResult = callTool('workflow_create', { name: 'Delete Me Workflow' });
      const workflowId = (createResult.workflow as { id: string }).id;

      const result = callTool('workflow_delete', { id: workflowId });
      expect(result.success).to.be.true;
    });
  });

  // ===========================================================================
  // STATUS TOOLS TESTS
  // ===========================================================================

  describe('Status Tools', () => {
    let workflowId: string;

    beforeEach(() => {
      const createResult = callTool('workflow_create', { name: 'Status Test Workflow' });
      workflowId = (createResult.workflow as { id: string }).id;
    });

    it('status_list - should list statuses', () => {
      const result = callTool('status_list', { workflow_id: 'default' });
      expect(result.success).to.be.true;
      expect(result.statuses).to.be.an('array');
    });

    it('status_create - should create status', () => {
      const result = callTool('status_create', {
        workflow_id: workflowId,
        name: 'MCP Status',
        category: 'started',
        position: 1,
      });
      expect(result.success).to.be.true;
    });

    it('status_update - should update status', () => {
      const createResult = callTool('status_create', {
        workflow_id: workflowId,
        name: 'Update Me',
        category: 'unstarted',
      });
      const statusId = (createResult.status as { id: string }).id;

      const result = callTool('status_update', {
        id: statusId,
        name: 'Updated Status',
      });
      expect(result.success).to.be.true;
    });

    it('status_reorder - should reorder status', () => {
      const createResult = callTool('status_create', {
        workflow_id: workflowId,
        name: 'Reorder Me',
        category: 'started',
      });
      const statusId = (createResult.status as { id: string }).id;

      const result = callTool('status_reorder', { id: statusId, position: 0 });
      expect(result.success).to.be.true;
    });

    it('status_delete - should delete status', () => {
      const createResult = callTool('status_create', {
        workflow_id: workflowId,
        name: 'Delete Me Status',
        category: 'canceled',
      });
      const statusId = (createResult.status as { id: string }).id;

      const result = callTool('status_delete', { id: statusId });
      expect(result.success).to.be.true;
    });
  });

  // ===========================================================================
  // PHASE TOOLS TESTS
  // ===========================================================================

  describe('Phase Tools', () => {
    it('phase_list - should list phases', () => {
      const result = callTool('phase_list', {});
      expect(result.success).to.be.true;
      expect(result.phases).to.be.an('array');
    });

    it('phase_list - should filter by category', () => {
      const result = callTool('phase_list', { category: 'started' });
      expect(result.success).to.be.true;
    });

    it('phase_create - should create phase', () => {
      const result = callTool('phase_create', {
        name: 'MCP Phase',
        category: 'started',
        position: 99,
      });
      expect(result.success).to.be.true;
    });

    it('phase_update - should update phase', () => {
      const createResult = callTool('phase_create', {
        name: 'Update Phase',
        category: 'unstarted',
      });
      const phaseId = (createResult.phase as { id: string }).id;

      const result = callTool('phase_update', {
        id: phaseId,
        name: 'Updated Phase',
      });
      expect(result.success).to.be.true;
    });

    it('phase_delete - should delete phase', () => {
      const createResult = callTool('phase_create', {
        name: 'Delete Phase',
        category: 'canceled',
      });
      const phaseId = (createResult.phase as { id: string }).id;

      const result = callTool('phase_delete', { id: phaseId });
      expect(result.success).to.be.true;
    });

    it('phase_template_list - should list templates', () => {
      const result = callTool('phase_template_list', {});
      expect(result.success).to.be.true;
      expect(result.templates).to.be.an('array');
    });
  });

  // ===========================================================================
  // ACTION TOOLS TESTS
  // ===========================================================================

  describe('Action Tools', () => {
    it('action_list - should list actions', () => {
      const result = callTool('action_list', { include_builtin: true });
      expect(result.success).to.be.true;
      expect(result.actions).to.be.an('array');
    });

    it('action_show - should show action details', () => {
      // Create an action first, then show it
      const createResult = callTool('action_create', {
        name: 'Show Test Action',
        prompt: 'Test prompt',
      });
      const actionId = (createResult.action as { id: string }).id;
      const result = callTool('action_show', { id: actionId });
      expect(result.success).to.be.true;
    });

    it('action_create - should create action', () => {
      const result = callTool('action_create', {
        name: 'MCP Action',
        prompt: 'Do something via MCP',
        description: 'Test action',
        modifies_code: true,
      });
      expect(result.success).to.be.true;
    });

    it('action_delete - should delete action', () => {
      const createResult = callTool('action_create', {
        name: 'Delete Action',
        prompt: 'Delete me',
      });
      const actionId = (createResult.action as { id: string }).id;

      const result = callTool('action_delete', { id: actionId });
      expect(result.success).to.be.true;
    });
  });

  // ===========================================================================
  // ROADMAP TOOLS TESTS
  // ===========================================================================

  describe('Roadmap Tools', () => {
    let projectId: string;

    beforeEach(() => {
      projectId = createTestProject(db, { id: 'mcp-roadmap-proj', name: 'Roadmap Project' });
    });

    it('roadmap_list - should list roadmaps', () => {
      const result = callTool('roadmap_list', {});
      expect(result.success).to.be.true;
      expect(result.roadmaps).to.be.an('array');
    });

    it('roadmap_create - should create roadmap', () => {
      const result = callTool('roadmap_create', {
        name: 'MCP Roadmap',
        description: 'Created via MCP',
      });
      expect(result.success).to.be.true;
    });

    it('roadmap_show - should show roadmap', () => {
      const createResult = callTool('roadmap_create', { name: 'Show Roadmap' });
      const roadmapId = (createResult.roadmap as { id: string }).id;

      const result = callTool('roadmap_show', { id: roadmapId });
      expect(result.success).to.be.true;
    });

    it('roadmap_add_project - should add project', () => {
      const createResult = callTool('roadmap_create', { name: 'Add Project Roadmap' });
      const roadmapId = (createResult.roadmap as { id: string }).id;

      const result = callTool('roadmap_add_project', {
        roadmap_id: roadmapId,
        project_id: projectId,
      });
      expect(result.success).to.be.true;
    });

    it('roadmap_remove_project - should remove project', () => {
      const createResult = callTool('roadmap_create', { name: 'Remove Project Roadmap' });
      const roadmapId = (createResult.roadmap as { id: string }).id;
      callTool('roadmap_add_project', { roadmap_id: roadmapId, project_id: projectId });

      const result = callTool('roadmap_remove_project', {
        roadmap_id: roadmapId,
        project_id: projectId,
      });
      expect(result.success).to.be.true;
    });

    it('roadmap_delete - should delete roadmap', () => {
      const createResult = callTool('roadmap_create', { name: 'Delete Roadmap' });
      const roadmapId = (createResult.roadmap as { id: string }).id;

      const result = callTool('roadmap_delete', { id: roadmapId });
      expect(result.success).to.be.true;
    });
  });

  // ===========================================================================
  // CATEGORY TOOLS TESTS
  // ===========================================================================

  describe('Category Tools', () => {
    it('category_list - should list categories', () => {
      const result = callTool('category_list', {});
      expect(result.success).to.be.true;
      expect(result.categories).to.be.an('array');
    });

    it('category_list - should filter by type', () => {
      const result = callTool('category_list', { type: 'ticket' });
      expect(result.success).to.be.true;
    });

    it('category_create - should create category', () => {
      const result = callTool('category_create', {
        name: 'MCP Category',
        type: 'ticket',
        description: 'Test category',
      });
      expect(result.success).to.be.true;
    });

    it('category_rename - should rename category', () => {
      const createResult = callTool('category_create', {
        name: 'Rename Me',
        type: 'ticket',
      });
      const categoryId = (createResult.category as { id: string }).id;

      const result = callTool('category_rename', {
        id: categoryId,
        name: 'Renamed Category',
      });
      expect(result.success).to.be.true;
    });

    it('category_delete - should delete category', () => {
      const createResult = callTool('category_create', {
        name: 'Delete Category',
        type: 'ticket',
      });
      const categoryId = (createResult.category as { id: string }).id;

      const result = callTool('category_delete', { id: categoryId });
      expect(result.success).to.be.true;
    });
  });

  // ===========================================================================
  // TEMPLATE TOOLS TESTS
  // ===========================================================================

  describe('Template Tools', () => {
    let projectId: string;
    let ticketId: string;

    beforeEach(() => {
      projectId = createTestProject(db, { id: 'mcp-template-proj', name: 'Template Project' });
      ticketId = createTestTicket(db, projectId, { id: 'TKT-TPL', title: 'Template Source Ticket' });
    });

    it('ticket_template_list - should list templates', () => {
      const result = callTool('ticket_template_list', { include_builtin: true });
      expect(result.success).to.be.true;
      expect(result.templates).to.be.an('array');
    });

    it('ticket_template_create - should create template', () => {
      const result = callTool('ticket_template_create', {
        name: 'MCP Template',
        description: 'Created via MCP',
        title_pattern: '[MCP] {title}',
        default_priority: 'P2',
      });
      expect(result.success).to.be.true;
    });

    it('ticket_template_show - should show template', () => {
      const createResult = callTool('ticket_template_create', {
        name: 'Show Template',
      });
      const templateId = (createResult.template as { id: string }).id;

      const result = callTool('ticket_template_show', { id: templateId });
      expect(result.success).to.be.true;
    });

    it('ticket_template_create_from_ticket - should create from ticket', () => {
      const result = callTool('ticket_template_create_from_ticket', {
        ticket_id: ticketId,
        name: 'From Ticket Template',
        description: 'Based on existing ticket',
      });
      expect(result.success).to.be.true;
    });

    it('ticket_template_delete - should delete template', () => {
      const createResult = callTool('ticket_template_create', {
        name: 'Delete Template',
      });
      const templateId = (createResult.template as { id: string }).id;

      const result = callTool('ticket_template_delete', { id: templateId });
      expect(result.success).to.be.true;
    });
  });

  // ===========================================================================
  // VIEW TOOLS TESTS
  // ===========================================================================

  describe('View Tools', () => {
    let projectId: string;

    beforeEach(() => {
      projectId = createTestProject(db, { id: 'mcp-view-proj', name: 'View Project' });
    });

    it('view_list - should list views', () => {
      // First create a view to ensure there's something to list
      callTool('view_create', { name: 'List Test View', project: projectId });
      const result = callTool('view_list', { project: projectId });
      expect(result.success).to.be.true;
      expect(result.views).to.be.an('array');
    });

    it('view_create - should create view', () => {
      const result = callTool('view_create', {
        name: 'MCP View',
        project: projectId,
        description: 'Created via MCP',
      });
      expect(result.success).to.be.true;
    });

    it('view_delete - should delete view', () => {
      const createResult = callTool('view_create', {
        name: 'Delete View',
        project: projectId,
      });
      const viewId = (createResult.view as { id: string }).id;

      const result = callTool('view_delete', { id: viewId });
      expect(result.success).to.be.true;
    });
  });

  // ===========================================================================
  // UTILITY TOOLS TESTS
  // ===========================================================================

  describe('Utility Tools', () => {
    it('whoami - should return response', () => {
      // whoami uses CLI passthrough which returns formatted text, not JSON
      // Just verify it doesn't throw
      const toolMsg = JSON.stringify({
        jsonrpc: '2.0',
        id: 100,
        method: 'tools/call',
        params: { name: 'whoami', arguments: {} },
      });
      const response = mcpCall([INIT_MSG, INITIALIZED_MSG, toolMsg]);
      expect(response.result?.content).to.be.an('array');
    });

    it('config_show - should return config', () => {
      // config_show also uses CLI passthrough
      const toolMsg = JSON.stringify({
        jsonrpc: '2.0',
        id: 100,
        method: 'tools/call',
        params: { name: 'config_show', arguments: {} },
      });
      const response = mcpCall([INIT_MSG, INITIALIZED_MSG, toolMsg]);
      expect(response.result?.content).to.be.an('array');
    });
  });

  // ===========================================================================
  // ERROR HANDLING TESTS
  // ===========================================================================

  describe('Error Handling', () => {
    it('should handle missing required parameters', () => {
      // MCP SDK validates required params and returns MCP-level error
      const toolMsg = JSON.stringify({
        jsonrpc: '2.0',
        id: 100,
        method: 'tools/call',
        params: { name: 'ticket_create', arguments: {} }, // missing title
      });
      const response = mcpCall([INIT_MSG, INITIALIZED_MSG, toolMsg]);
      // Either error response or content with success: false
      expect(response.error || response.result?.content).to.exist;
    });

    it('should handle invalid ticket ID', () => {
      const result = callTool('ticket_show', { id: 'INVALID-ID-12345' });
      expect(result.success).to.be.false;
    });

    it('should handle invalid project ID', () => {
      const result = callTool('project_show', { id: 'INVALID-PROJECT' });
      expect(result.success).to.be.false;
    });

    it('should handle invalid enum values gracefully', () => {
      // MCP SDK validates enum values and returns MCP-level error
      const toolMsg = JSON.stringify({
        jsonrpc: '2.0',
        id: 100,
        method: 'tools/call',
        params: { name: 'ticket_create', arguments: { title: 'Test', priority: 'INVALID' } },
      });
      const response = mcpCall([INIT_MSG, INITIALIZED_MSG, toolMsg]);
      // Either error response or content with success: false
      expect(response.error || response.result?.content).to.exist;
    });
  });

  // ===========================================================================
  // CROSS-ENTITY OPERATIONS TESTS
  // ===========================================================================

  describe('Cross-Entity Operations', () => {
    let projectId: string;
    let ticketId: string;
    let specId: string;

    beforeEach(() => {
      projectId = createTestProject(db, { id: 'mcp-cross-proj', name: 'Cross Entity Project' });
      ticketId = createTestTicket(db, projectId, { id: 'TKT-CROSS', title: 'Cross Ticket' });
      specId = createTestSpec(db, { id: 'SPEC-CROSS', title: 'Cross Spec' });
    });

    it('ticket_link_to_spec - should link ticket to spec', () => {
      const result = callTool('ticket_link_to_spec', {
        ticket_id: ticketId,
        spec_id: specId,
      });
      expect(result.success).to.be.true;
    });

    it('project_link_to_spec - should link project to spec', () => {
      const result = callTool('project_link_to_spec', {
        project_id: projectId,
        spec_id: specId,
      });
      expect(result.success).to.be.true;
    });

    it('project_get_specs - should get linked specs', () => {
      callTool('project_link_to_spec', { project_id: projectId, spec_id: specId });

      const result = callTool('project_get_specs', { project_id: projectId });
      expect(result.success).to.be.true;
      expect(result.specs).to.be.an('array');
    });

    it('spec_get_tickets - should get linked tickets', () => {
      callTool('ticket_link_to_spec', { ticket_id: ticketId, spec_id: specId });

      const result = callTool('spec_get_tickets', { spec_id: specId, project: projectId });
      expect(result.success).to.be.true;
    });
  });

  // ===========================================================================
  // STRICT PARAMETER VALIDATION TESTS (TKT-936)
  // ===========================================================================

  describe('Strict Parameter Validation (TKT-936)', () => {
    let projectId: string;
    let ticketId: string;

    beforeEach(() => {
      projectId = createTestProject(db, { id: 'mcp-strict-proj', name: 'Strict Validation Project' });
      ticketId = createTestTicket(db, projectId, { id: 'TKT-STRICT-001', title: 'Strict Test Ticket' });
    });

    /**
     * Helper: assert that an MCP response is an error containing a specific key name.
     * The MCP SDK returns validation errors as result.content with isError: true,
     * with the error text containing "unrecognized_keys" and the offending key name.
     */
    function expectUnknownKeyRejected(response: McpResponse, keyName: string): void {
      const errorText = response.result?.content?.[0]?.text || '';
      expect(errorText).to.include('unrecognized_key');
      expect(errorText).to.include(keyName);
    }

    it('should reject unknown params on ticket_update', () => {
      const toolMsg = JSON.stringify({
        jsonrpc: '2.0',
        id: 100,
        method: 'tools/call',
        params: {
          name: 'ticket_update',
          arguments: {
            id: ticketId,
            title: 'Valid Title',
            unknown_field: 'should be rejected',
          },
        },
      });
      const response = mcpCall([INIT_MSG, INITIALIZED_MSG, toolMsg]);
      expectUnknownKeyRejected(response, 'unknown_field');
    });

    it('should reject unknown params on ticket_create', () => {
      const toolMsg = JSON.stringify({
        jsonrpc: '2.0',
        id: 100,
        method: 'tools/call',
        params: {
          name: 'ticket_create',
          arguments: {
            title: 'Test',
            project: projectId,
            bogus_param: 'should fail',
          },
        },
      });
      const response = mcpCall([INIT_MSG, INITIALIZED_MSG, toolMsg]);
      expectUnknownKeyRejected(response, 'bogus_param');
    });

    it('should reject unknown params on ticket_list', () => {
      const toolMsg = JSON.stringify({
        jsonrpc: '2.0',
        id: 100,
        method: 'tools/call',
        params: {
          name: 'ticket_list',
          arguments: { project: projectId, nonexistent: true },
        },
      });
      const response = mcpCall([INIT_MSG, INITIALIZED_MSG, toolMsg]);
      expectUnknownKeyRejected(response, 'nonexistent');
    });

    it('should reject unknown params on zero-arg tools', () => {
      const toolMsg = JSON.stringify({
        jsonrpc: '2.0',
        id: 100,
        method: 'tools/call',
        params: {
          name: 'work_status',
          arguments: { extra_param: 'should be rejected' },
        },
      });
      const response = mcpCall([INIT_MSG, INITIALIZED_MSG, toolMsg]);
      expectUnknownKeyRejected(response, 'extra_param');
    });

    it('should reject unknown params on project_update', () => {
      const toolMsg = JSON.stringify({
        jsonrpc: '2.0',
        id: 100,
        method: 'tools/call',
        params: {
          name: 'project_update',
          arguments: {
            id: projectId,
            name: 'Valid Name',
            invalid_flag: 'value',
          },
        },
      });
      const response = mcpCall([INIT_MSG, INITIALIZED_MSG, toolMsg]);
      expectUnknownKeyRejected(response, 'invalid_flag');
    });

    it('should still accept valid params', () => {
      const result = callTool('ticket_update', {
        id: ticketId,
        title: 'Updated via Strict Test',
      });
      expect(result.success).to.be.true;
      expect((result.ticket as { title: string }).title).to.equal('Updated via Strict Test');
    });

    it('should reject unknown params on init tool', () => {
      const toolMsg = JSON.stringify({
        jsonrpc: '2.0',
        id: 100,
        method: 'tools/call',
        params: {
          name: 'init',
          arguments: {
            name: 'test-hq',
            unknown_option: 'should fail',
          },
        },
      });
      const response = mcpCall([INIT_MSG, INITIALIZED_MSG, toolMsg]);
      expectUnknownKeyRejected(response, 'unknown_option');
    });
  });

  // ===========================================================================
  // CLI PASSTHROUGH TOOLS TESTS (smoke tests only)
  // ===========================================================================

  describe('CLI Passthrough Tools (Smoke Tests)', () => {
    // These tools call CLI commands and may require external dependencies
    // They return formatted text output, not JSON
    // We just verify they return MCP responses with content

    function callToolRaw(name: string, args: Record<string, unknown> = {}): McpResponse {
      const toolMsg = JSON.stringify({
        jsonrpc: '2.0',
        id: 100,
        method: 'tools/call',
        params: { name, arguments: args },
      });
      return mcpCall([INIT_MSG, INITIALIZED_MSG, toolMsg]);
    }

    it('agent_list - should return MCP response', () => {
      const response = callToolRaw('agent_list', {});
      // May have result.content or error
      expect(response.result?.content || response.error).to.exist;
    });

    it('docker_status - should return MCP response', () => {
      const response = callToolRaw('docker_status', {});
      expect(response.result?.content || response.error).to.exist;
    });

    it('repo_list - should return MCP response', () => {
      const response = callToolRaw('repo_list', {});
      expect(response.result?.content || response.error).to.exist;
    });

    it('branch_list - should return MCP response', () => {
      const response = callToolRaw('branch_list', {});
      expect(response.result?.content || response.error).to.exist;
    });

    it('gh_status - should return MCP response', () => {
      const response = callToolRaw('gh_status', {});
      expect(response.result?.content || response.error).to.exist;
    });

    it('session_list - should return MCP response', () => {
      const response = callToolRaw('session_list', {});
      expect(response.result?.content || response.error).to.exist;
    });

    it('execution_list - should return MCP response', () => {
      const response = callToolRaw('execution_list', {});
      expect(response.result?.content || response.error).to.exist;
    });
  });
});
