/**
 * Tests for Drizzle ORM-backed PMO storage modules (PRLT-1302).
 *
 * Verifies that ActionStorage, WorkflowRuleStorage, and TemplateStorage
 * work correctly with Drizzle queries instead of raw SQL.
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
import { ActionStorage } from '../../src/lib/pmo/storage/actions.js'
import { WorkflowRuleStorage } from '../../src/lib/pmo/storage/workflow-rules.js'
import { TemplateStorage } from '../../src/lib/pmo/storage/templates.js'
import type { StorageContext } from '../../src/lib/pmo/storage/types.js'
import { BetterSqlite3Driver } from '../../src/lib/database/driver.js'

function createTestContext(): { ctx: StorageContext; db: Database.Database; tmpDir: string } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drizzle-pmo-test-'))
  const dbPath = path.join(tmpDir, 'test.db')
  const db = new Database(dbPath)
  configureConnection(db)

  // Create tables using legacy SQL (for test setup only)
  db.exec(PMO_SCHEMA_SQL)

  const drizzleDb = drizzle(db, { schema })
  const driver = new BetterSqlite3Driver(db)

  const ctx: StorageContext = {
    db,
    driver,
    drizzle: drizzleDb,
    updateBoardTimestamp: () => {},
  }

  return { ctx, db, tmpDir }
}

function cleanup(ctx: { db: Database.Database; tmpDir: string }): void {
  ctx.db.close()
  if (fs.existsSync(ctx.tmpDir)) {
    fs.rmSync(ctx.tmpDir, { recursive: true, force: true })
  }
}

describe('Drizzle PMO Storage — ActionStorage', () => {
  let ctx: StorageContext
  let testCtx: { db: Database.Database; tmpDir: string }
  let storage: ActionStorage

  beforeEach(() => {
    const result = createTestContext()
    ctx = result.ctx
    testCtx = result
    storage = new ActionStorage(ctx)
  })

  afterEach(() => cleanup(testCtx))

  it('creates and retrieves an action', async () => {
    const action = await storage.createAction({
      name: 'Test Action',
      prompt: 'Do the thing',
      description: 'A test action',
    })

    expect(action.id).to.equal('test-action')
    expect(action.name).to.equal('Test Action')
    expect(action.prompt).to.equal('Do the thing')
    expect(action.modifiesCode).to.be.true

    const retrieved = await storage.getAction('test-action')
    expect(retrieved).to.not.be.null
    expect(retrieved!.name).to.equal('Test Action')
  })

  it('returns null for non-existent action', async () => {
    const result = await storage.getAction('nope')
    expect(result).to.be.null
  })

  it('lists all actions', async () => {
    await storage.createAction({ name: 'Alpha', prompt: 'p1' })
    await storage.createAction({ name: 'Beta', prompt: 'p2' })

    const actions = await storage.listActions()
    expect(actions.length).to.be.at.least(2)
    const names = actions.map(a => a.name)
    expect(names).to.include('Alpha')
    expect(names).to.include('Beta')
  })

  it('filters actions by search', async () => {
    await storage.createAction({ name: 'Deploy Script', prompt: 'deploy stuff' })
    await storage.createAction({ name: 'Test Runner', prompt: 'run tests' })

    const results = await storage.listActions({ search: 'Deploy' })
    expect(results.length).to.equal(1)
    expect(results[0].name).to.equal('Deploy Script')
  })

  it('updates an action', async () => {
    await storage.createAction({ name: 'Updateable', prompt: 'original' })

    const updated = await storage.updateAction('updateable', {
      prompt: 'updated prompt',
      description: 'now has desc',
    })

    expect(updated.prompt).to.equal('updated prompt')
    expect(updated.description).to.equal('now has desc')
  })

  it('prevents duplicate action names', async () => {
    await storage.createAction({ name: 'Unique', prompt: 'p' })

    try {
      await storage.createAction({ name: 'Unique', prompt: 'p2' })
      expect.fail('should have thrown')
    } catch (err: any) {
      expect(err.message).to.include('already exists')
    }
  })

  it('deletes an action', async () => {
    await storage.createAction({ name: 'Deleteable', prompt: 'p' })
    await storage.deleteAction('deleteable')

    const result = await storage.getAction('deleteable')
    expect(result).to.be.null
  })

  it('prevents deleting builtin actions', async () => {
    await storage.createAction({
      name: 'Builtin Action',
      prompt: 'p',
      isBuiltin: true,
    })

    try {
      await storage.deleteAction('builtin-action')
      expect.fail('should have thrown')
    } catch (err: any) {
      expect(err.message).to.include('built-in')
    }
  })

  it('handles fromIntent and toIntent', async () => {
    const action = await storage.createAction({
      name: 'Intent Action',
      prompt: 'p',
      fromIntent: 'ready',
      toIntent: 'started',
    })

    expect(action.fromIntent).to.equal('ready')
    expect(action.toIntent).to.equal('started')
  })

  it('gets suggested action for intent', async () => {
    await storage.createAction({
      name: 'Default Impl',
      prompt: 'p',
      fromIntent: 'ready',
      isDefault: true,
    })

    const suggested = await storage.getSuggestedAction('ready')
    expect(suggested).to.not.be.null
    expect(suggested!.name).to.equal('Default Impl')
  })

  it('gets action by from intent', async () => {
    await storage.createAction({
      name: 'Intent Fire',
      prompt: 'p',
      fromIntent: 'backlog',
      isDefault: true,
    })

    const result = await storage.getActionByFromIntent('backlog')
    expect(result).to.not.be.null
    expect(result!.name).to.equal('Intent Fire')
  })

  it('handles networkAllowlist and reviewGate', async () => {
    const action = await storage.createAction({
      name: 'Full Action',
      prompt: 'p',
      reviewGate: 'required',
      networkAllowlist: ['github.com', 'api.example.com'],
    })

    expect(action.reviewGate).to.equal('required')
    expect(action.networkAllowlist).to.deep.equal(['github.com', 'api.example.com'])

    const retrieved = await storage.getAction('full-action')
    expect(retrieved!.reviewGate).to.equal('required')
    expect(retrieved!.networkAllowlist).to.deep.equal(['github.com', 'api.example.com'])
  })
})

describe('Drizzle PMO Storage — WorkflowRuleStorage', () => {
  let ctx: StorageContext
  let testCtx: { db: Database.Database; tmpDir: string }
  let actionStorage: ActionStorage
  let ruleStorage: WorkflowRuleStorage

  beforeEach(async () => {
    const result = createTestContext()
    ctx = result.ctx
    testCtx = result
    actionStorage = new ActionStorage(ctx)
    ruleStorage = new WorkflowRuleStorage(ctx)

    // Create a prerequisite action
    await actionStorage.createAction({
      name: 'Test Implement',
      prompt: 'implement the thing',
    })
  })

  afterEach(() => cleanup(testCtx))

  it('creates and retrieves a workflow rule', async () => {
    const rule = await ruleStorage.createWorkflowRule({
      toIntent: 'ready',
      actionId: 'test-implement',
    })

    expect(rule.id).to.be.a('string')
    expect(rule.toIntent).to.equal('ready')
    expect(rule.actionId).to.equal('test-implement')
    expect(rule.trigger).to.equal('manual')
    expect(rule.enabled).to.be.true

    const retrieved = await ruleStorage.getWorkflowRule(rule.id)
    expect(retrieved).to.not.be.null
    expect(retrieved!.toIntent).to.equal('ready')
  })

  it('returns null for non-existent rule', async () => {
    const result = await ruleStorage.getWorkflowRule('nope')
    expect(result).to.be.null
  })

  it('lists workflow rules', async () => {
    await ruleStorage.createWorkflowRule({
      id: 'rule-1',
      toIntent: 'ready',
      actionId: 'test-implement',
    })
    await ruleStorage.createWorkflowRule({
      id: 'rule-2',
      toIntent: 'started',
      actionId: 'test-implement',
    })

    const rules = await ruleStorage.listWorkflowRules()
    expect(rules.length).to.be.at.least(2)
  })

  it('filters rules by toIntent', async () => {
    await ruleStorage.createWorkflowRule({
      id: 'filter-rule-1',
      toIntent: 'ready',
      actionId: 'test-implement',
    })
    await ruleStorage.createWorkflowRule({
      id: 'filter-rule-2',
      toIntent: 'started',
      actionId: 'test-implement',
    })

    const results = await ruleStorage.listWorkflowRules({ toIntent: 'ready' })
    const toIntents = results.map(r => r.toIntent)
    expect(toIntents).to.include('ready')
    expect(toIntents).to.not.include('started')
  })

  it('updates a workflow rule', async () => {
    const rule = await ruleStorage.createWorkflowRule({
      id: 'update-rule',
      toIntent: 'ready',
      actionId: 'test-implement',
    })

    const updated = await ruleStorage.updateWorkflowRule(rule.id, {
      trigger: 'on_enter',
    })

    expect(updated.trigger).to.equal('on_enter')
  })

  it('deletes a workflow rule', async () => {
    const rule = await ruleStorage.createWorkflowRule({
      id: 'delete-rule',
      toIntent: 'ready',
      actionId: 'test-implement',
    })

    await ruleStorage.deleteWorkflowRule(rule.id)
    const result = await ruleStorage.getWorkflowRule(rule.id)
    expect(result).to.be.null
  })

  it('validates action exists before creating rule', async () => {
    try {
      await ruleStorage.createWorkflowRule({
        toIntent: 'ready',
        actionId: 'nonexistent',
      })
      expect.fail('should have thrown')
    } catch (err: any) {
      expect(err.message).to.include('not found')
    }
  })

  it('gets enabled rules for intent', async () => {
    await ruleStorage.createWorkflowRule({
      id: 'intent-rule-1',
      toIntent: 'ready',
      actionId: 'test-implement',
      enabled: true,
    })
    await ruleStorage.createWorkflowRule({
      id: 'intent-rule-2',
      toIntent: 'ready',
      actionId: 'test-implement',
      enabled: false,
    })

    const rules = await ruleStorage.getWorkflowRulesForIntent('ready')
    expect(rules.length).to.equal(1)
    expect(rules[0].enabled).to.be.true
  })
})

describe('Drizzle PMO Storage — TemplateStorage', () => {
  let ctx: StorageContext
  let testCtx: { db: Database.Database; tmpDir: string }
  let storage: TemplateStorage

  beforeEach(() => {
    const result = createTestContext()
    ctx = result.ctx
    testCtx = result
    storage = new TemplateStorage(ctx)
  })

  afterEach(() => cleanup(testCtx))

  it('creates and retrieves a template', async () => {
    const template = await storage.createTicketTemplate({
      name: 'Bug Report',
      description: 'Template for bugs',
      defaultPriority: 'P1',
      defaultCategory: 'bug',
    })

    expect(template.id).to.equal('bug-report')
    expect(template.name).to.equal('Bug Report')
    expect(template.defaultPriority).to.equal('P1')

    const retrieved = await storage.getTicketTemplate('bug-report')
    expect(retrieved).to.not.be.null
    expect(retrieved!.name).to.equal('Bug Report')
  })

  it('returns null for non-existent template', async () => {
    const result = await storage.getTicketTemplate('nope')
    expect(result).to.be.null
  })

  it('lists templates', async () => {
    await storage.createTicketTemplate({ name: 'Template A' })
    await storage.createTicketTemplate({ name: 'Template B' })

    const templates = await storage.listTicketTemplates()
    expect(templates.length).to.be.at.least(2)
  })

  it('filters templates by search', async () => {
    await storage.createTicketTemplate({ name: 'Bug Tracker', description: 'bugs' })
    await storage.createTicketTemplate({ name: 'Feature Req', description: 'features' })

    const results = await storage.listTicketTemplates({ search: 'Bug' })
    expect(results.length).to.equal(1)
    expect(results[0].name).to.equal('Bug Tracker')
  })

  it('prevents duplicate template names', async () => {
    await storage.createTicketTemplate({ name: 'Duplicate' })

    try {
      await storage.createTicketTemplate({ name: 'Duplicate' })
      expect.fail('should have thrown')
    } catch (err: any) {
      expect(err.message).to.include('already exists')
    }
  })

  it('updates a template', async () => {
    await storage.createTicketTemplate({ name: 'Updatable' })

    const updated = await storage.updateTicketTemplate('updatable', {
      description: 'now has description',
      defaultPriority: 'P0',
    })

    expect(updated.description).to.equal('now has description')
    expect(updated.defaultPriority).to.equal('P0')
  })

  it('deletes a template', async () => {
    await storage.createTicketTemplate({ name: 'Deletable' })
    await storage.deleteTicketTemplate('deletable')

    const result = await storage.getTicketTemplate('deletable')
    expect(result).to.be.null
  })

  it('handles labels and subtasks as JSON', async () => {
    const template = await storage.createTicketTemplate({
      name: 'With JSON',
      defaultLabels: ['bug', 'critical'],
      suggestedSubtasks: [{ title: 'Reproduce' }, { title: 'Fix' }],
    })

    expect(template.defaultLabels).to.deep.equal(['bug', 'critical'])
    expect(template.suggestedSubtasks).to.deep.equal([
      { title: 'Reproduce' },
      { title: 'Fix' },
    ])

    const retrieved = await storage.getTicketTemplate('with-json')
    expect(retrieved!.defaultLabels).to.deep.equal(['bug', 'critical'])
    expect(retrieved!.suggestedSubtasks).to.deep.equal([
      { title: 'Reproduce' },
      { title: 'Fix' },
    ])
  })

  it('prevents modifying builtin templates', async () => {
    // Insert a builtin template directly via Drizzle
    ctx.drizzle
      .insert(schema.pmoTicketTemplates)
      .values({
        id: 'builtin-test',
        name: 'Builtin Template',
        isBuiltin: true,
        defaultLabels: '[]',
        suggestedSubtasks: '[]',
        createdAt: new Date().toISOString(),
      })
      .run()

    try {
      await storage.updateTicketTemplate('builtin-test', { name: 'Changed' })
      expect.fail('should have thrown')
    } catch (err: any) {
      expect(err.message).to.include('built-in')
    }
  })
})
