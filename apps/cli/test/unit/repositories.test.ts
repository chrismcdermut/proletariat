/**
 * Tests for the repository layer (PRLT-1303).
 *
 * Verifies that all 6 repositories work correctly with Drizzle ORM
 * against an in-memory SQLite database.
 */

import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from '../../src/lib/database/drizzle-schema.js'
import { configureConnection } from '../../src/lib/database/db-safety.js'
import { PMO_SCHEMA_SQL } from '../../src/lib/pmo/schema.js'
import { CREATE_TABLES_SQL } from '../../src/lib/database/workspace-schema.js'
import {
  createRepositories,
  type Repositories,
  AgentRepository,
  SessionRepository,
  WorkflowRepository,
  ProjectRepository,
  PRRepository,
  TicketRepository,
} from '../../src/lib/database/repositories/index.js'
import type { DrizzleDB } from '../../src/lib/database/drizzle.js'

// =============================================================================
// Test Helpers
// =============================================================================

interface TestContext {
  db: Database.Database
  drizzle: DrizzleDB
  repos: Repositories
  tmpDir: string
}

function createTestContext(): TestContext {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-test-'))
  const dbPath = path.join(tmpDir, 'test.db')
  const db = new Database(dbPath)
  configureConnection(db)

  // Create core workspace tables (agents, worktrees, themes, etc.)
  db.exec(CREATE_TABLES_SQL)

  // Create PMO tables (projects, actions, workflow rules, agent_work, etc.)
  db.exec(PMO_SCHEMA_SQL)

  // Ensure agent_work has gc_cleaned_at column (added via migration, not in legacy SQL)
  try {
    db.exec('ALTER TABLE agent_work ADD COLUMN gc_cleaned_at TEXT')
  } catch {
    // Column may already exist
  }

  const drizzleDb = drizzle(db, { schema })
  const repos = createRepositories(drizzleDb)

  return { db, drizzle: drizzleDb, repos, tmpDir }
}

function cleanup(ctx: TestContext): void {
  ctx.db.close()
  if (fs.existsSync(ctx.tmpDir)) {
    fs.rmSync(ctx.tmpDir, { recursive: true, force: true })
  }
}

// =============================================================================
// createRepositories
// =============================================================================

describe('createRepositories', () => {
  let ctx: TestContext

  beforeEach(() => { ctx = createTestContext() })
  afterEach(() => cleanup(ctx))

  it('returns all 6 repository instances', () => {
    expect(ctx.repos.agents).to.be.instanceOf(AgentRepository)
    expect(ctx.repos.sessions).to.be.instanceOf(SessionRepository)
    expect(ctx.repos.workflows).to.be.instanceOf(WorkflowRepository)
    expect(ctx.repos.projects).to.be.instanceOf(ProjectRepository)
    expect(ctx.repos.prs).to.be.instanceOf(PRRepository)
    expect(ctx.repos.tickets).to.be.instanceOf(TicketRepository)
  })
})

// =============================================================================
// AgentRepository
// =============================================================================

describe('AgentRepository', () => {
  let ctx: TestContext

  beforeEach(() => { ctx = createTestContext() })
  afterEach(() => cleanup(ctx))

  it('creates and retrieves an agent', () => {
    const agent = ctx.repos.agents.create({
      name: 'test-agent',
      type: 'persistent',
      worktreePath: 'agents/staff/test-agent',
    })

    expect(agent.name).to.equal('test-agent')
    expect(agent.type).to.equal('persistent')
    expect(agent.status).to.equal('active')
    expect(agent.worktreePath).to.equal('agents/staff/test-agent')

    const found = ctx.repos.agents.findByName('test-agent')
    expect(found).to.not.be.null
    expect(found!.name).to.equal('test-agent')
  })

  it('returns null for non-existent agent', () => {
    const found = ctx.repos.agents.findByName('no-such-agent')
    expect(found).to.be.null
  })

  it('lists agents with default active filter', () => {
    ctx.repos.agents.create({ name: 'a1', type: 'persistent' })
    ctx.repos.agents.create({ name: 'a2', type: 'ephemeral' })
    ctx.repos.agents.updateStatus('a2', 'completed')

    const active = ctx.repos.agents.list()
    expect(active).to.have.length(1)
    expect(active[0].name).to.equal('a1')
  })

  it('lists all agents including cleaned up', () => {
    ctx.repos.agents.create({ name: 'a1', type: 'persistent' })
    ctx.repos.agents.create({ name: 'a2', type: 'ephemeral' })
    ctx.repos.agents.updateStatus('a2', 'completed')

    const all = ctx.repos.agents.list({ includeCleanedUp: true })
    expect(all).to.have.length(2)
  })

  it('filters by type', () => {
    ctx.repos.agents.create({ name: 'a1', type: 'persistent' })
    ctx.repos.agents.create({ name: 'a2', type: 'ephemeral' })

    const ephemeral = ctx.repos.agents.list({ type: 'ephemeral' })
    expect(ephemeral).to.have.length(1)
    expect(ephemeral[0].type).to.equal('ephemeral')
  })

  it('upserts an agent', () => {
    ctx.repos.agents.create({ name: 'a1', type: 'persistent', worktreePath: 'old/path' })
    ctx.repos.agents.upsert({ name: 'a1', type: 'persistent', worktreePath: 'new/path' })

    const agent = ctx.repos.agents.findByName('a1')
    expect(agent!.worktreePath).to.equal('new/path')
  })

  it('updates status with cleanedAt', () => {
    ctx.repos.agents.create({ name: 'a1', type: 'persistent' })
    ctx.repos.agents.updateStatus('a1', 'completed')

    const agent = ctx.repos.agents.findByName('a1')
    expect(agent!.status).to.equal('completed')
    expect(agent!.cleanedAt).to.not.be.null
  })

  it('reactivates agent by setting status to active', () => {
    ctx.repos.agents.create({ name: 'a1', type: 'persistent' })
    ctx.repos.agents.updateStatus('a1', 'completed')
    ctx.repos.agents.updateStatus('a1', 'active')

    const agent = ctx.repos.agents.findByName('a1')
    expect(agent!.status).to.equal('active')
    expect(agent!.cleanedAt).to.be.null
  })

  it('removes agent and its worktrees', () => {
    // Insert a repository record to satisfy FK constraint on agent_worktrees
    ctx.db.exec(`INSERT INTO repositories (name, path, added_at) VALUES ('repo1', '/tmp/repo1', '${new Date().toISOString()}')`)

    ctx.repos.agents.create({ name: 'a1', type: 'persistent' })
    ctx.repos.agents.upsertWorktree({
      agentName: 'a1',
      repoName: 'repo1',
      worktreePath: 'agents/staff/a1/repo1',
      branch: 'agent-a1',
    })

    ctx.repos.agents.remove('a1')

    expect(ctx.repos.agents.findByName('a1')).to.be.null
    expect(ctx.repos.agents.listWorktrees('a1')).to.have.length(0)
  })

  it('upserts and queries worktrees', () => {
    // Insert a repository record to satisfy FK constraint on agent_worktrees
    ctx.db.exec(`INSERT INTO repositories (name, path, added_at) VALUES ('repo1', '/tmp/repo1', '${new Date().toISOString()}')`)

    ctx.repos.agents.create({ name: 'a1', type: 'persistent' })
    ctx.repos.agents.upsertWorktree({
      agentName: 'a1',
      repoName: 'repo1',
      worktreePath: 'agents/staff/a1/repo1',
      branch: 'agent-a1',
    })

    const worktrees = ctx.repos.agents.listWorktrees('a1')
    expect(worktrees).to.have.length(1)
    expect(worktrees[0].branch).to.equal('agent-a1')

    const byBranch = ctx.repos.agents.findWorktreesByBranch('agent-a1')
    expect(byBranch).to.have.length(1)

    const byRepo = ctx.repos.agents.getWorktreesForRepo('repo1')
    expect(byRepo).to.have.length(1)
  })

  it('finds agent case-insensitively', () => {
    ctx.repos.agents.create({ name: 'MyAgent', type: 'persistent' })

    const found = ctx.repos.agents.findByNameCaseInsensitive('myagent')
    expect(found).to.not.be.null
    expect(found!.name).to.equal('MyAgent')
  })
})

// =============================================================================
// SessionRepository
// =============================================================================

describe('SessionRepository', () => {
  let ctx: TestContext

  beforeEach(() => { ctx = createTestContext() })
  afterEach(() => cleanup(ctx))

  it('creates and retrieves an execution', () => {
    const exec = ctx.repos.sessions.create({
      id: 'WORK-TEST0001',
      ticketId: 'TKT-1',
      agentName: 'agent-1',
      executor: 'claude',
    })

    expect(exec.id).to.equal('WORK-TEST0001')
    expect(exec.status).to.equal('starting')
    expect(exec.agentName).to.equal('agent-1')

    const found = ctx.repos.sessions.findById('WORK-TEST0001')
    expect(found).to.not.be.null
    expect(found!.ticketId).to.equal('TKT-1')
  })

  it('updates execution status', () => {
    ctx.repos.sessions.create({
      id: 'WORK-TEST0002',
      ticketId: 'TKT-2',
      agentName: 'agent-1',
      executor: 'claude',
    })

    ctx.repos.sessions.updateStatus('WORK-TEST0002', 'running')
    let exec = ctx.repos.sessions.findById('WORK-TEST0002')
    expect(exec!.status).to.equal('running')

    ctx.repos.sessions.updateStatus('WORK-TEST0002', 'completed', 0)
    exec = ctx.repos.sessions.findById('WORK-TEST0002')
    expect(exec!.status).to.equal('completed')
    expect(exec!.exitCode).to.equal(0)
    expect(exec!.completedAt).to.not.be.null
  })

  it('updates status with error message', () => {
    ctx.repos.sessions.create({
      id: 'WORK-ERR001',
      ticketId: 'TKT-3',
      agentName: 'agent-1',
      executor: 'claude',
    })

    ctx.repos.sessions.updateStatus('WORK-ERR001', 'failed', 1, 'Something broke')
    const exec = ctx.repos.sessions.findById('WORK-ERR001')
    expect(exec!.status).to.equal('failed')
    expect(exec!.exitCode).to.equal(1)
    expect(exec!.errorMessage).to.equal('Something broke')
  })

  it('finds running execution by ticket', () => {
    ctx.repos.sessions.create({
      id: 'WORK-RUN001',
      ticketId: 'TKT-5',
      agentName: 'agent-1',
      executor: 'claude',
    })
    ctx.repos.sessions.updateStatus('WORK-RUN001', 'running')

    const found = ctx.repos.sessions.findRunningByTicket('TKT-5')
    expect(found).to.not.be.null
    expect(found!.id).to.equal('WORK-RUN001')
  })

  it('finds running executions by agent', () => {
    ctx.repos.sessions.create({
      id: 'WORK-A001',
      ticketId: 'TKT-10',
      agentName: 'busy-agent',
      executor: 'claude',
    })
    ctx.repos.sessions.updateStatus('WORK-A001', 'running')

    const running = ctx.repos.sessions.findRunningByAgent('busy-agent')
    expect(running).to.have.length(1)
  })

  it('lists active executions', () => {
    ctx.repos.sessions.create({
      id: 'WORK-ACT01',
      ticketId: 'TKT-20',
      agentName: 'agent-1',
      executor: 'claude',
    })
    ctx.repos.sessions.create({
      id: 'WORK-ACT02',
      ticketId: 'TKT-21',
      agentName: 'agent-2',
      executor: 'claude',
    })
    ctx.repos.sessions.updateStatus('WORK-ACT02', 'completed')

    const active = ctx.repos.sessions.listActive()
    expect(active).to.have.length(1)
    expect(active[0].id).to.equal('WORK-ACT01')
  })

  it('checks agent availability', () => {
    expect(ctx.repos.sessions.isAgentAvailable('agent-1')).to.be.true

    ctx.repos.sessions.create({
      id: 'WORK-BUSY01',
      ticketId: 'TKT-30',
      agentName: 'agent-1',
      executor: 'claude',
    })
    ctx.repos.sessions.updateStatus('WORK-BUSY01', 'running')

    expect(ctx.repos.sessions.isAgentAvailable('agent-1')).to.be.false
  })

  it('updates process info', () => {
    ctx.repos.sessions.create({
      id: 'WORK-PROC01',
      ticketId: 'TKT-40',
      agentName: 'agent-1',
      executor: 'claude',
    })

    ctx.repos.sessions.updateProcessInfo('WORK-PROC01', {
      pid: '12345',
      sessionId: 'tmux-session',
    })

    const exec = ctx.repos.sessions.findById('WORK-PROC01')
    expect(exec!.pid).to.equal('12345')
    expect(exec!.sessionId).to.equal('tmux-session')
  })

  it('removes execution', () => {
    ctx.repos.sessions.create({
      id: 'WORK-DEL01',
      ticketId: 'TKT-50',
      agentName: 'agent-1',
      executor: 'claude',
    })

    ctx.repos.sessions.remove('WORK-DEL01')
    expect(ctx.repos.sessions.findById('WORK-DEL01')).to.be.null
  })

  it('counts agent executions', () => {
    ctx.repos.sessions.create({ id: 'W1', ticketId: 'T1', agentName: 'a1', executor: 'claude' })
    ctx.repos.sessions.create({ id: 'W2', ticketId: 'T2', agentName: 'a1', executor: 'claude' })
    ctx.repos.sessions.create({ id: 'W3', ticketId: 'T3', agentName: 'a2', executor: 'claude' })

    expect(ctx.repos.sessions.getAgentExecutionCount('a1')).to.equal(2)
    expect(ctx.repos.sessions.getAgentExecutionCount('a2')).to.equal(1)
  })

  it('lists with filters', () => {
    ctx.repos.sessions.create({ id: 'W1', ticketId: 'T1', agentName: 'a1', executor: 'claude' })
    ctx.repos.sessions.create({ id: 'W2', ticketId: 'T2', agentName: 'a2', executor: 'claude' })
    ctx.repos.sessions.updateStatus('W1', 'running')

    const byStatus = ctx.repos.sessions.list({ status: 'running' })
    expect(byStatus).to.have.length(1)
    expect(byStatus[0].id).to.equal('W1')

    const byAgent = ctx.repos.sessions.list({ agentName: 'a2' })
    expect(byAgent).to.have.length(1)
    expect(byAgent[0].id).to.equal('W2')
  })
})

// =============================================================================
// WorkflowRepository
// =============================================================================

describe('WorkflowRepository', () => {
  let ctx: TestContext

  beforeEach(() => { ctx = createTestContext() })
  afterEach(() => cleanup(ctx))

  describe('Actions', () => {
    it('creates and retrieves an action', () => {
      const action = ctx.repos.workflows.createAction({
        name: 'Implement',
        prompt: 'Implement the ticket',
      })

      expect(action.id).to.equal('implement')
      expect(action.name).to.equal('Implement')
      expect(action.modifiesCode).to.be.true

      const found = ctx.repos.workflows.findActionById('implement')
      expect(found).to.not.be.null
      expect(found!.name).to.equal('Implement')
    })

    it('updates an action', () => {
      ctx.repos.workflows.createAction({
        name: 'MyAction',
        prompt: 'Do thing',
      })

      const updated = ctx.repos.workflows.updateAction('myaction', {
        description: 'Updated description',
        modifiesCode: false,
      })

      expect(updated.description).to.equal('Updated description')
      expect(updated.modifiesCode).to.be.false
    })

    it('deletes an action', () => {
      ctx.repos.workflows.createAction({ name: 'ToDelete', prompt: 'x' })
      ctx.repos.workflows.deleteAction('todelete')
      expect(ctx.repos.workflows.findActionById('todelete')).to.be.null
    })

    it('lists actions with filter', () => {
      ctx.repos.workflows.createAction({ name: 'A1', prompt: 'p1', isBuiltin: true })
      ctx.repos.workflows.createAction({ name: 'A2', prompt: 'p2', isBuiltin: false })

      const builtins = ctx.repos.workflows.listActions({ isBuiltin: true })
      expect(builtins).to.have.length(1)
      expect(builtins[0].name).to.equal('A1')
    })

    it('lists actions with search', () => {
      ctx.repos.workflows.createAction({ name: 'Deploy Action', prompt: 'deploy', description: 'Deploys code' })
      ctx.repos.workflows.createAction({ name: 'Test Action', prompt: 'test', description: 'Runs tests' })

      const results = ctx.repos.workflows.listActions({ search: 'deploy' })
      expect(results).to.have.length(1)
      expect(results[0].name).to.equal('Deploy Action')
    })

    it('gets suggested action for intent', () => {
      ctx.repos.workflows.createAction({
        name: 'Implement',
        prompt: 'Do it',
        fromIntent: 'ready',
        isDefault: true,
      })

      const suggested = ctx.repos.workflows.getSuggestedAction('ready')
      expect(suggested).to.not.be.null
      expect(suggested!.name).to.equal('Implement')
    })
  })

  describe('Workflow Rules', () => {
    it('creates and retrieves a rule', () => {
      ctx.repos.workflows.createAction({ name: 'act1', prompt: 'p' })

      const rule = ctx.repos.workflows.createWorkflowRule({
        toIntent: 'in-progress',
        actionId: 'act1',
        trigger: 'on_enter',
      })

      expect(rule.toIntent).to.equal('in-progress')
      expect(rule.actionId).to.equal('act1')
      expect(rule.enabled).to.be.true

      const found = ctx.repos.workflows.findWorkflowRuleById(rule.id)
      expect(found).to.not.be.null
    })

    it('updates a rule', () => {
      ctx.repos.workflows.createAction({ name: 'act1', prompt: 'p' })
      const rule = ctx.repos.workflows.createWorkflowRule({
        toIntent: 'in-progress',
        actionId: 'act1',
      })

      const updated = ctx.repos.workflows.updateWorkflowRule(rule.id, {
        enabled: false,
        trigger: 'on_enter',
      })

      expect(updated.enabled).to.be.false
      expect(updated.trigger).to.equal('on_enter')
    })

    it('deletes a rule', () => {
      ctx.repos.workflows.createAction({ name: 'act2', prompt: 'p' })
      const rule = ctx.repos.workflows.createWorkflowRule({
        toIntent: 'done',
        actionId: 'act2',
      })

      ctx.repos.workflows.deleteWorkflowRule(rule.id)
      expect(ctx.repos.workflows.findWorkflowRuleById(rule.id)).to.be.null
    })

    it('gets rules for intent', () => {
      ctx.repos.workflows.createAction({ name: 'act1', prompt: 'p' })
      ctx.repos.workflows.createWorkflowRule({
        toIntent: 'review',
        actionId: 'act1',
        trigger: 'on_enter',
      })
      ctx.repos.workflows.createWorkflowRule({
        toIntent: 'done',
        actionId: 'act1',
        trigger: 'on_enter',
      })

      const reviewRules = ctx.repos.workflows.getWorkflowRulesForIntent('review')
      expect(reviewRules).to.have.length(1)
      expect(reviewRules[0].toIntent).to.equal('review')
    })

    it('lists rules with filters', () => {
      ctx.repos.workflows.createAction({ name: 'act1', prompt: 'p' })
      ctx.repos.workflows.createWorkflowRule({
        toIntent: 'review',
        actionId: 'act1',
        trigger: 'on_enter',
        enabled: true,
      })
      ctx.repos.workflows.createWorkflowRule({
        toIntent: 'done',
        actionId: 'act1',
        trigger: 'manual',
        enabled: false,
      })

      const enabled = ctx.repos.workflows.listWorkflowRules({ enabled: true })
      expect(enabled).to.have.length(1)

      const onEnter = ctx.repos.workflows.listWorkflowRules({ trigger: 'on_enter' })
      expect(onEnter).to.have.length(1)
    })
  })

  describe('Work Hooks', () => {
    it('lists work hooks', () => {
      const hooks = ctx.repos.workflows.listWorkHooks()
      // May have built-in hooks from PMO_SCHEMA_SQL seeding
      expect(hooks).to.be.an('array')
    })
  })
})

// =============================================================================
// ProjectRepository
// =============================================================================

describe('ProjectRepository', () => {
  let ctx: TestContext

  beforeEach(() => { ctx = createTestContext() })
  afterEach(() => cleanup(ctx))

  it('creates and retrieves a project', () => {
    const project = ctx.repos.projects.create({
      id: 'proj-1',
      name: 'Test Project',
      description: 'A test project',
    })

    expect(project.id).to.equal('proj-1')
    expect(project.name).to.equal('Test Project')

    const found = ctx.repos.projects.findById('proj-1')
    expect(found).to.not.be.null
    expect(found!.description).to.equal('A test project')
  })

  it('finds by name', () => {
    ctx.repos.projects.create({ id: 'p1', name: 'My Project' })

    const found = ctx.repos.projects.findByName('my project')
    expect(found).to.not.be.null
    expect(found!.id).to.equal('p1')
  })

  it('resolves project by ID or name', () => {
    ctx.repos.projects.create({ id: 'p1', name: 'Resolve Me' })

    expect(ctx.repos.projects.resolve('p1')).to.not.be.null
    expect(ctx.repos.projects.resolve('Resolve Me')).to.not.be.null
    expect(ctx.repos.projects.resolve('resolve me')).to.not.be.null
    expect(ctx.repos.projects.resolve('nonexistent')).to.be.null
  })

  it('updates a project', () => {
    ctx.repos.projects.create({ id: 'p1', name: 'Old Name' })

    const updated = ctx.repos.projects.update('p1', {
      name: 'New Name',
      description: 'Updated',
    })

    expect(updated.name).to.equal('New Name')
    expect(updated.description).to.equal('Updated')
  })

  it('archives and unarchives', () => {
    ctx.repos.projects.create({ id: 'p1', name: 'Project' })

    ctx.repos.projects.update('p1', { isArchived: true })
    let p = ctx.repos.projects.findById('p1')
    expect(p!.isArchived).to.be.true

    ctx.repos.projects.update('p1', { isArchived: false })
    p = ctx.repos.projects.findById('p1')
    expect(p!.isArchived).to.be.false
  })

  it('lists with filters', () => {
    ctx.repos.projects.create({ id: 'p1', name: 'Active' })
    ctx.repos.projects.create({ id: 'p2', name: 'Archived' })
    ctx.repos.projects.update('p2', { isArchived: true })

    const active = ctx.repos.projects.list({ isArchived: false })
    expect(active).to.have.length(1)
    expect(active[0].name).to.equal('Active')

    const archived = ctx.repos.projects.list({ isArchived: true })
    expect(archived).to.have.length(1)
    expect(archived[0].name).to.equal('Archived')
  })

  it('lists with search', () => {
    ctx.repos.projects.create({ id: 'p1', name: 'Frontend App' })
    ctx.repos.projects.create({ id: 'p2', name: 'Backend API' })

    const results = ctx.repos.projects.list({ search: 'frontend' })
    expect(results).to.have.length(1)
    expect(results[0].name).to.equal('Frontend App')
  })

  it('removes a project', () => {
    ctx.repos.projects.create({ id: 'p1', name: 'ToDelete' })
    ctx.repos.projects.remove('p1')
    expect(ctx.repos.projects.findById('p1')).to.be.null
  })

  describe('Settings', () => {
    it('gets and sets settings', () => {
      expect(ctx.repos.projects.getSetting('key1')).to.be.null

      ctx.repos.projects.setSetting('key1', 'value1')
      expect(ctx.repos.projects.getSetting('key1')).to.equal('value1')

      ctx.repos.projects.setSetting('key1', 'updated')
      expect(ctx.repos.projects.getSetting('key1')).to.equal('updated')
    })

    it('deletes settings', () => {
      ctx.repos.projects.setSetting('key1', 'value1')
      ctx.repos.projects.deleteSetting('key1')
      expect(ctx.repos.projects.getSetting('key1')).to.be.null
    })
  })
})

// =============================================================================
// PRRepository
// =============================================================================

describe('PRRepository', () => {
  let ctx: TestContext

  beforeEach(() => { ctx = createTestContext() })
  afterEach(() => cleanup(ctx))

  it('upserts and retrieves execution mapping', () => {
    const mapping = ctx.repos.prs.upsertMapping({
      provider: 'linear',
      externalId: 'issue-123',
      externalKey: 'PRLT-123',
      canonicalUrl: 'https://linear.app/issue/PRLT-123',
    })

    expect(mapping.provider).to.equal('linear')
    expect(mapping.externalKey).to.equal('PRLT-123')

    const found = ctx.repos.prs.findByExternalId('linear', 'issue-123')
    expect(found).to.not.be.null
    expect(found!.externalKey).to.equal('PRLT-123')
  })

  it('finds by external key', () => {
    ctx.repos.prs.upsertMapping({
      provider: 'linear',
      externalId: 'id-456',
      externalKey: 'PRLT-456',
    })

    const found = ctx.repos.prs.findByExternalKey('linear', 'PRLT-456')
    expect(found).to.not.be.null
    expect(found!.externalId).to.equal('id-456')
  })

  it('links and queries executions', () => {
    ctx.repos.prs.upsertMapping({
      provider: 'linear',
      externalId: 'id-789',
    })

    ctx.repos.prs.linkExecution('linear', 'id-789', 'WORK-001')
    ctx.repos.prs.linkExecution('linear', 'id-789', 'WORK-002')

    const ids = ctx.repos.prs.getExecutionIds('linear', 'id-789')
    expect(ids).to.include('WORK-001')
    expect(ids).to.include('WORK-002')
  })

  it('links and queries PRs', () => {
    ctx.repos.prs.upsertMapping({
      provider: 'linear',
      externalId: 'id-101',
    })

    ctx.repos.prs.linkPr('linear', 'id-101', 'https://github.com/repo/pull/1')
    ctx.repos.prs.linkPr('linear', 'id-101', 'https://github.com/repo/pull/2')

    const urls = ctx.repos.prs.getPrUrls('linear', 'id-101')
    expect(urls).to.have.length(2)
    expect(urls).to.include('https://github.com/repo/pull/1')
  })

  it('finds mappings by execution ID', () => {
    ctx.repos.prs.upsertMapping({
      provider: 'linear',
      externalId: 'id-202',
      externalKey: 'PRLT-202',
    })
    ctx.repos.prs.linkExecution('linear', 'id-202', 'WORK-X01')

    const mappings = ctx.repos.prs.findMappingsByExecutionId('WORK-X01')
    expect(mappings).to.have.length(1)
    expect(mappings[0].externalKey).to.equal('PRLT-202')
  })

  it('handles duplicate link insertions gracefully', () => {
    ctx.repos.prs.upsertMapping({
      provider: 'linear',
      externalId: 'id-303',
    })

    // Should not throw on duplicate
    ctx.repos.prs.linkExecution('linear', 'id-303', 'WORK-DUP')
    ctx.repos.prs.linkExecution('linear', 'id-303', 'WORK-DUP')

    const ids = ctx.repos.prs.getExecutionIds('linear', 'id-303')
    expect(ids).to.have.length(1)
  })
})

// =============================================================================
// TicketRepository
// =============================================================================

describe('TicketRepository', () => {
  let ctx: TestContext

  beforeEach(() => { ctx = createTestContext() })
  afterEach(() => cleanup(ctx))

  describe('Ticket Refs', () => {
    it('upserts and retrieves a ticket ref', () => {
      const ref = ctx.repos.tickets.upsertRef({
        id: 'TKT-1',
        title: 'Fix bug',
        provider: 'linear',
        externalKey: 'PRLT-1',
        status: 'in-progress',
      })

      expect(ref.id).to.equal('TKT-1')
      expect(ref.title).to.equal('Fix bug')
      expect(ref.provider).to.equal('linear')

      const found = ctx.repos.tickets.findRefById('TKT-1')
      expect(found).to.not.be.null
      expect(found!.externalKey).to.equal('PRLT-1')
    })

    it('finds ref by external key', () => {
      ctx.repos.tickets.upsertRef({
        id: 'TKT-2',
        title: 'Feature',
        provider: 'linear',
        externalKey: 'PRLT-2',
      })

      const found = ctx.repos.tickets.findRefByExternalKey('linear', 'PRLT-2')
      expect(found).to.not.be.null
      expect(found!.id).to.equal('TKT-2')
    })

    it('lists refs with filters', () => {
      ctx.repos.tickets.upsertRef({ id: 'T1', title: 'A', status: 'open', provider: 'linear' })
      ctx.repos.tickets.upsertRef({ id: 'T2', title: 'B', status: 'closed', provider: 'linear' })

      const open = ctx.repos.tickets.listRefs({ status: 'open' })
      expect(open).to.have.length(1)
      expect(open[0].id).to.equal('T1')
    })

    it('removes a ref', () => {
      ctx.repos.tickets.upsertRef({ id: 'T-DEL', title: 'Delete me' })
      ctx.repos.tickets.removeRef('T-DEL')
      expect(ctx.repos.tickets.findRefById('T-DEL')).to.be.null
    })
  })

  describe('Ticket Metadata', () => {
    it('gets and sets metadata', () => {
      expect(ctx.repos.tickets.getMetadata('TKT-1', 'notes')).to.be.null

      ctx.repos.tickets.setMetadata('TKT-1', 'notes', 'some notes')
      expect(ctx.repos.tickets.getMetadata('TKT-1', 'notes')).to.equal('some notes')

      ctx.repos.tickets.setMetadata('TKT-1', 'notes', 'updated')
      expect(ctx.repos.tickets.getMetadata('TKT-1', 'notes')).to.equal('updated')
    })

    it('gets all metadata for a ticket', () => {
      ctx.repos.tickets.setMetadata('TKT-1', 'key1', 'val1')
      ctx.repos.tickets.setMetadata('TKT-1', 'key2', 'val2')

      const all = ctx.repos.tickets.getAllMetadata('TKT-1')
      expect(all).to.have.length(2)
    })

    it('deletes metadata', () => {
      ctx.repos.tickets.setMetadata('TKT-1', 'key1', 'val1')
      ctx.repos.tickets.deleteMetadata('TKT-1', 'key1')
      expect(ctx.repos.tickets.getMetadata('TKT-1', 'key1')).to.be.null
    })
  })

  describe('Ticket Templates', () => {
    it('creates and retrieves a template', () => {
      const template = ctx.repos.tickets.createTemplate({
        name: 'Bug Report',
        description: 'Template for bugs',
        defaultPriority: 'P1',
        defaultCategory: 'bug',
      })

      expect(template.id).to.equal('bug-report')
      expect(template.name).to.equal('Bug Report')
      expect(template.defaultPriority).to.equal('P1')

      const found = ctx.repos.tickets.findTemplateById('bug-report')
      expect(found).to.not.be.null
      expect(found!.defaultCategory).to.equal('bug')
    })

    it('updates a template', () => {
      ctx.repos.tickets.createTemplate({
        name: 'Feature',
        description: 'Feature template',
      })

      const updated = ctx.repos.tickets.updateTemplate('feature', {
        description: 'Updated',
        defaultPriority: 'P2',
      })

      expect(updated.description).to.equal('Updated')
      expect(updated.defaultPriority).to.equal('P2')
    })

    it('deletes a template', () => {
      ctx.repos.tickets.createTemplate({ name: 'ToDelete' })
      ctx.repos.tickets.deleteTemplate('todelete')
      expect(ctx.repos.tickets.findTemplateById('todelete')).to.be.null
    })

    it('lists templates', () => {
      ctx.repos.tickets.createTemplate({ name: 'T1', isBuiltin: true })
      ctx.repos.tickets.createTemplate({ name: 'T2', isBuiltin: false })

      const all = ctx.repos.tickets.listTemplates()
      expect(all.length).to.be.greaterThanOrEqual(2)

      const builtins = ctx.repos.tickets.listTemplates({ isBuiltin: true })
      expect(builtins.every(t => t.isBuiltin)).to.be.true
    })
  })
})

// =============================================================================
// Injectable Repositories (Constructor Injection)
// =============================================================================

describe('Repository Injectable Pattern', () => {
  let ctx: TestContext

  beforeEach(() => { ctx = createTestContext() })
  afterEach(() => cleanup(ctx))

  it('repositories can be constructed independently with custom context', () => {
    const customCtx = { drizzle: ctx.drizzle }

    const agents = new AgentRepository(customCtx)
    const sessions = new SessionRepository(customCtx)
    const workflows = new WorkflowRepository(customCtx)
    const projects = new ProjectRepository(customCtx)
    const prs = new PRRepository(customCtx)
    const tickets = new TicketRepository(customCtx)

    // All should work independently
    agents.create({ name: 'test', type: 'persistent' })
    expect(agents.findByName('test')).to.not.be.null

    projects.create({ id: 'p1', name: 'Project' })
    expect(projects.findById('p1')).to.not.be.null

    // Verify they share the same DB connection
    sessions.create({ id: 'W1', ticketId: 'T1', agentName: 'test', executor: 'claude' })
    expect(sessions.findById('W1')).to.not.be.null
  })
})
