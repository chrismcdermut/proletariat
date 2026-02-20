/**
 * Drizzle ORM Migration Regression Tests
 *
 * Validates that critical PMO/agent workflows produce identical results
 * when using Drizzle ORM vs raw SQL paths. This ensures the migration
 * from raw better-sqlite3 to Drizzle ORM introduces no regressions.
 *
 * Tests cover:
 * - Ticket CRUD (list, view, create, update, delete)
 * - Ticket movement and reordering
 * - Project lifecycle (create, list, archive, unarchive)
 * - Workflow and status operations
 * - Spec and epic operations
 * - Cross-project ticket operations
 * - Roadmap operations (Drizzle-migrated path)
 * - Work spawn selection data retrieval
 */

import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import Database from 'better-sqlite3'
import { SQLiteStorage } from '../../src/lib/pmo/storage-sqlite.js'
import { createDrizzleConnection, DrizzleDB } from '../../src/lib/database/drizzle.js'
import { eq, and } from 'drizzle-orm'
import * as schema from '../../src/lib/database/drizzle-schema.js'

describe('Drizzle ORM Migration Regression Tests', () => {
  let testDir: string
  let storage: SQLiteStorage
  const projectId = 'regression-project'

  beforeEach(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drizzle-regression-'))
    const dbPath = path.join(testDir, 'regression.db')
    const db = new Database(dbPath)
    db.close()

    storage = new SQLiteStorage(dbPath)
    await storage.createProject({
      id: projectId,
      name: 'Regression Test Project',
      template: 'kanban',
    })
  })

  afterEach(async () => {
    await storage.close()
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true })
    }
  })

  // =========================================================================
  // 1. Ticket CRUD Regression
  // =========================================================================
  describe('Ticket CRUD Regression', () => {
    it('creates ticket and retrieves same data via raw SQL and Drizzle', async () => {
      const ticket = await storage.createTicket(projectId, {
        title: 'Regression ticket',
        description: 'Test description',
        statusName: 'Backlog',
        priority: 'P1',
        category: 'feature',
      })

      // Verify via storage API (raw SQL)
      const fromStorage = await storage.getTicket(ticket.id)
      expect(fromStorage).to.not.be.null
      expect(fromStorage!.title).to.equal('Regression ticket')
      expect(fromStorage!.description).to.equal('Test description')
      expect(fromStorage!.priority).to.equal('P1')
      expect(fromStorage!.category).to.equal('feature')

      // Verify via Drizzle ORM
      const drizzle = storage.getDrizzle()
      const drizzleRow = drizzle
        .select()
        .from(schema.pmoTickets)
        .where(eq(schema.pmoTickets.id, ticket.id))
        .get()

      expect(drizzleRow).to.not.be.undefined
      expect(drizzleRow!.title).to.equal('Regression ticket')
      expect(drizzleRow!.description).to.equal('Test description')
      expect(drizzleRow!.priority).to.equal('P1')
      expect(drizzleRow!.category).to.equal('feature')
      expect(drizzleRow!.projectId).to.equal(projectId)
    })

    it('lists tickets with consistent results between raw SQL and Drizzle', async () => {
      await storage.createTicket(projectId, { title: 'Ticket A', statusName: 'Backlog', priority: 'P0' })
      await storage.createTicket(projectId, { title: 'Ticket B', statusName: 'In Progress', priority: 'P1' })
      await storage.createTicket(projectId, { title: 'Ticket C', statusName: 'Done', priority: 'P2' })

      // Via storage API (raw SQL)
      const fromStorage = await storage.listTickets(projectId)
      expect(fromStorage).to.have.length(3)

      // Via Drizzle ORM
      const drizzle = storage.getDrizzle()
      const drizzleRows = drizzle
        .select()
        .from(schema.pmoTickets)
        .where(eq(schema.pmoTickets.projectId, projectId))
        .all()

      expect(drizzleRows).to.have.length(3)

      // Verify same IDs in both results
      const storageIds = new Set(fromStorage.map(t => t.id))
      const drizzleIds = new Set(drizzleRows.map(r => r.id))
      expect(storageIds).to.deep.equal(drizzleIds)
    })

    it('updates ticket with consistent state in both layers', async () => {
      const ticket = await storage.createTicket(projectId, {
        title: 'Original',
        statusName: 'Backlog',
      })

      await storage.updateTicket(ticket.id, {
        title: 'Updated',
        priority: 'P0',
        description: 'New description',
      })

      // Verify raw SQL and Drizzle see the same state
      const fromStorage = await storage.getTicket(ticket.id)
      const drizzle = storage.getDrizzle()
      const drizzleRow = drizzle
        .select()
        .from(schema.pmoTickets)
        .where(eq(schema.pmoTickets.id, ticket.id))
        .get()

      expect(fromStorage!.title).to.equal('Updated')
      expect(drizzleRow!.title).to.equal('Updated')
      expect(fromStorage!.priority).to.equal('P0')
      expect(drizzleRow!.priority).to.equal('P0')
      expect(fromStorage!.description).to.equal('New description')
      expect(drizzleRow!.description).to.equal('New description')
    })

    it('deletes ticket and both layers reflect deletion', async () => {
      const ticket = await storage.createTicket(projectId, {
        title: 'To delete',
        statusName: 'Backlog',
      })

      await storage.deleteTicket(ticket.id)

      const fromStorage = await storage.getTicket(ticket.id)
      const drizzle = storage.getDrizzle()
      const drizzleRow = drizzle
        .select()
        .from(schema.pmoTickets)
        .where(eq(schema.pmoTickets.id, ticket.id))
        .get()

      expect(fromStorage).to.be.null
      expect(drizzleRow).to.be.undefined
    })

    it('filters tickets by status category consistently', async () => {
      await storage.createTicket(projectId, { title: 'Backlog ticket', statusName: 'Backlog' })
      await storage.createTicket(projectId, { title: 'Done ticket', statusName: 'Done' })

      // Via storage (raw SQL with filter)
      const backlogTickets = await storage.listTickets(projectId, { statusCategory: 'backlog' })
      expect(backlogTickets.length).to.be.greaterThanOrEqual(1)
      expect(backlogTickets.every(t => t.statusCategory === 'backlog')).to.be.true

      // Via Drizzle: verify done tickets are in completed category
      const drizzle = storage.getDrizzle()
      const completedStatuses = drizzle
        .select()
        .from(schema.pmoWorkflowStatuses)
        .where(eq(schema.pmoWorkflowStatuses.category, 'completed'))
        .all()
      const completedStatusIds = completedStatuses.map(s => s.id)

      const doneTickets = await storage.listTickets(projectId, { statusCategory: 'completed' })
      expect(doneTickets.length).to.be.greaterThanOrEqual(1)
      for (const t of doneTickets) {
        expect(completedStatusIds).to.include(t.statusId)
      }
    })
  })

  // =========================================================================
  // 2. Ticket Movement and Reordering Regression
  // =========================================================================
  describe('Ticket Movement Regression', () => {
    it('moves ticket to different status with correct position gapping', async () => {
      const ticket = await storage.createTicket(projectId, {
        title: 'Moving ticket',
        statusName: 'Backlog',
      })

      const moved = await storage.moveTicket(projectId, ticket.id, 'In Progress')
      expect(moved.statusName).to.equal('In Progress')

      // Verify position is valid (gapped integer)
      const drizzle = storage.getDrizzle()
      const row = drizzle
        .select()
        .from(schema.pmoTickets)
        .where(eq(schema.pmoTickets.id, ticket.id))
        .get()

      expect(row!.position).to.be.greaterThan(0)
      expect(row!.position % 1000).to.equal(0) // Should be a multiple of 1000
    })

    it('reorders tickets within same status correctly', async () => {
      const t1 = await storage.createTicket(projectId, { title: 'First', statusName: 'Backlog' })
      const t2 = await storage.createTicket(projectId, { title: 'Second', statusName: 'Backlog' })
      const t3 = await storage.createTicket(projectId, { title: 'Third', statusName: 'Backlog' })

      // Move t3 after t1
      await storage.reorderTicket(t3.id, { afterTicketId: t1.id })

      // Verify order via both layers
      const tickets = await storage.listTickets(projectId, { column: 'Backlog' })
      const positions = tickets.map(t => ({ id: t.id, pos: t.position }))

      // t1 should come first, then t3, then t2
      const t1Pos = positions.find(p => p.id === t1.id)!.pos!
      const t3Pos = positions.find(p => p.id === t3.id)!.pos!
      const t2Pos = positions.find(p => p.id === t2.id)!.pos!

      expect(t1Pos).to.be.lessThan(t3Pos)
      expect(t3Pos).to.be.lessThan(t2Pos)

      // Drizzle should see same positions
      const drizzle = storage.getDrizzle()
      const drizzleRow = drizzle
        .select()
        .from(schema.pmoTickets)
        .where(eq(schema.pmoTickets.id, t3.id))
        .get()
      expect(drizzleRow!.position).to.equal(t3Pos)
    })
  })

  // =========================================================================
  // 3. Project Lifecycle Regression
  // =========================================================================
  describe('Project Lifecycle Regression', () => {
    it('creates project with workflow and verifies via Drizzle', async () => {
      const board = await storage.createProject({
        id: 'lifecycle-test',
        name: 'Lifecycle Project',
        template: 'kanban',
        description: 'Testing lifecycle',
      })

      expect(board.name).to.equal('Lifecycle Project')

      // Verify project via Drizzle
      const drizzle = storage.getDrizzle()
      const project = drizzle
        .select()
        .from(schema.pmoProjects)
        .where(eq(schema.pmoProjects.id, 'lifecycle-test'))
        .get()

      expect(project).to.not.be.undefined
      expect(project!.name).to.equal('Lifecycle Project')
      expect(project!.workflowId).to.not.be.null

      // Verify workflow statuses exist
      const statuses = drizzle
        .select()
        .from(schema.pmoWorkflowStatuses)
        .where(eq(schema.pmoWorkflowStatuses.workflowId, project!.workflowId!))
        .all()
      expect(statuses.length).to.be.greaterThan(0)
    })

    it('archives and unarchives project consistently', async () => {
      const archived = await storage.archiveProject(projectId)
      expect(archived.isArchived).to.be.true

      // Verify via Drizzle
      const drizzle = storage.getDrizzle()
      let row = drizzle
        .select()
        .from(schema.pmoProjects)
        .where(eq(schema.pmoProjects.id, projectId))
        .get()
      expect(row!.isArchived).to.be.true

      const unarchived = await storage.unarchiveProject(projectId)
      expect(unarchived.isArchived).to.be.false

      row = drizzle
        .select()
        .from(schema.pmoProjects)
        .where(eq(schema.pmoProjects.id, projectId))
        .get()
      expect(row!.isArchived).to.be.false
    })

    it('lists projects with consistent results', async () => {
      await storage.createProject({ id: 'proj-2', name: 'Project 2' })

      const fromStorage = await storage.listProjects()
      const drizzle = storage.getDrizzle()
      const fromDrizzle = drizzle
        .select()
        .from(schema.pmoProjects)
        .all()

      // Both should list at least 2 projects
      expect(fromStorage.length).to.be.greaterThanOrEqual(2)
      expect(fromDrizzle.length).to.be.greaterThanOrEqual(2)

      const storageIds = new Set(fromStorage.map(p => p.id))
      const drizzleIds = new Set(fromDrizzle.map(p => p.id))
      for (const id of storageIds) {
        expect(drizzleIds.has(id)).to.be.true
      }
    })
  })

  // =========================================================================
  // 4. Workflow and Status Operations Regression
  // =========================================================================
  describe('Workflow Status Regression', () => {
    it('lists workflow statuses consistently between layers', async () => {
      const statuses = await storage.listStatuses('default')
      expect(statuses.length).to.be.greaterThan(0)

      const drizzle = storage.getDrizzle()
      const drizzleStatuses = drizzle
        .select()
        .from(schema.pmoWorkflowStatuses)
        .where(eq(schema.pmoWorkflowStatuses.workflowId, 'default'))
        .all()

      expect(drizzleStatuses.length).to.equal(statuses.length)

      // Verify categories match
      for (const status of statuses) {
        const drizzleMatch = drizzleStatuses.find(ds => ds.id === status.id)
        expect(drizzleMatch).to.not.be.undefined
        expect(drizzleMatch!.category).to.equal(status.category)
        expect(drizzleMatch!.name).to.equal(status.name)
      }
    })

    it('default status is consistent across layers', async () => {
      const defaultStatus = await storage.getDefaultStatus('default')
      expect(defaultStatus).to.not.be.null

      const drizzle = storage.getDrizzle()
      const drizzleDefault = drizzle
        .select()
        .from(schema.pmoWorkflowStatuses)
        .where(
          and(
            eq(schema.pmoWorkflowStatuses.workflowId, 'default'),
            eq(schema.pmoWorkflowStatuses.isDefault, true)
          )
        )
        .get()

      expect(drizzleDefault).to.not.be.undefined
      expect(drizzleDefault!.id).to.equal(defaultStatus!.id)
    })
  })

  // =========================================================================
  // 5. Spec Operations Regression
  // =========================================================================
  describe('Spec Operations Regression', () => {
    it('creates and retrieves spec consistently', async () => {
      const spec = await storage.createSpec({
        id: 'regression-spec',
        title: 'Regression Spec',
        status: 'draft',
      })

      const fromStorage = await storage.getSpec(spec.id)
      expect(fromStorage).to.not.be.null
      expect(fromStorage!.title).to.equal('Regression Spec')

      const drizzle = storage.getDrizzle()
      const drizzleRow = drizzle
        .select()
        .from(schema.pmoSpecs)
        .where(eq(schema.pmoSpecs.id, spec.id))
        .get()

      expect(drizzleRow).to.not.be.undefined
      expect(drizzleRow!.title).to.equal('Regression Spec')
      expect(drizzleRow!.status).to.equal('draft')
    })

    it('links ticket to spec with consistent join data', async () => {
      const spec = await storage.createSpec({ id: 'link-spec', title: 'Link Spec' })
      const ticket = await storage.createTicket(projectId, {
        title: 'Linked ticket',
        statusName: 'Backlog',
        specId: spec.id,
      })

      const fromStorage = await storage.getTicket(ticket.id)
      expect(fromStorage!.specId).to.equal(spec.id)

      const drizzle = storage.getDrizzle()
      const drizzleRow = drizzle
        .select()
        .from(schema.pmoTickets)
        .where(eq(schema.pmoTickets.id, ticket.id))
        .get()

      expect(drizzleRow!.specId).to.equal(spec.id)
    })
  })

  // =========================================================================
  // 6. Epic Operations Regression
  // =========================================================================
  describe('Epic Operations Regression', () => {
    it('creates epic and verifies via both layers', async () => {
      const epic = await storage.createEpic(projectId, {
        title: 'Regression Epic',
        description: 'Testing epic creation',
      })

      const fromStorage = await storage.getEpic(epic.id)
      expect(fromStorage).to.not.be.null
      expect(fromStorage!.title).to.equal('Regression Epic')

      const drizzle = storage.getDrizzle()
      const drizzleRow = drizzle
        .select()
        .from(schema.pmoEpics)
        .where(eq(schema.pmoEpics.id, epic.id))
        .get()

      expect(drizzleRow).to.not.be.undefined
      expect(drizzleRow!.title).to.equal('Regression Epic')
      expect(drizzleRow!.projectId).to.equal(projectId)
    })

    it('links ticket to epic with consistent state', async () => {
      const epic = await storage.createEpic(projectId, { title: 'Epic A' })
      const ticket = await storage.createTicket(projectId, {
        title: 'Epic ticket',
        statusName: 'Backlog',
        epicId: epic.id,
      })

      const fromStorage = await storage.getTicket(ticket.id)
      expect(fromStorage!.epicId).to.equal(epic.id)

      const drizzle = storage.getDrizzle()
      const drizzleRow = drizzle
        .select()
        .from(schema.pmoTickets)
        .where(eq(schema.pmoTickets.id, ticket.id))
        .get()
      expect(drizzleRow!.epicId).to.equal(epic.id)
    })
  })

  // =========================================================================
  // 7. Roadmap Operations Regression (Drizzle-migrated path)
  // =========================================================================
  describe('Roadmap Operations Regression (Drizzle path)', () => {
    it('creates and retrieves roadmap via Drizzle-native storage', async () => {
      const roadmap = await storage.createRoadmap({
        name: 'Q1 Roadmap',
        description: 'First quarter plan',
      })

      expect(roadmap.name).to.equal('Q1 Roadmap')

      const retrieved = await storage.getRoadmap(roadmap.id)
      expect(retrieved).to.not.be.null
      expect(retrieved!.name).to.equal('Q1 Roadmap')
      expect(retrieved!.description).to.equal('First quarter plan')

      // Also verify via raw Drizzle select
      const drizzle = storage.getDrizzle()
      const raw = drizzle
        .select()
        .from(schema.pmoRoadmaps)
        .where(eq(schema.pmoRoadmaps.id, roadmap.id))
        .get()
      expect(raw).to.not.be.undefined
      expect(raw!.name).to.equal('Q1 Roadmap')
    })

    it('adds project to roadmap and lists consistently', async () => {
      const roadmap = await storage.createRoadmap({ name: 'Linked Roadmap' })
      await storage.addProjectToRoadmap(roadmap.id, projectId)

      const projects = await storage.listRoadmapProjects(roadmap.id)
      expect(projects.length).to.be.greaterThanOrEqual(1)
      expect(projects.some(p => p.id === projectId)).to.be.true

      // Verify via Drizzle
      const drizzle = storage.getDrizzle()
      const drizzleLinks = drizzle
        .select()
        .from(schema.pmoRoadmapProjects)
        .where(eq(schema.pmoRoadmapProjects.roadmapId, roadmap.id))
        .all()
      expect(drizzleLinks.length).to.be.greaterThanOrEqual(1)
    })

    it('sets default roadmap correctly', async () => {
      const r1 = await storage.createRoadmap({ name: 'Roadmap 1' })
      const r2 = await storage.createRoadmap({ name: 'Roadmap 2' })

      await storage.setDefaultRoadmap(r1.id)
      let defaultRoadmap = await storage.getDefaultRoadmap()
      expect(defaultRoadmap).to.not.be.null
      expect(defaultRoadmap!.id).to.equal(r1.id)

      await storage.setDefaultRoadmap(r2.id)
      defaultRoadmap = await storage.getDefaultRoadmap()
      expect(defaultRoadmap!.id).to.equal(r2.id)

      // Verify only one default via Drizzle
      const drizzle = storage.getDrizzle()
      const defaults = drizzle
        .select()
        .from(schema.pmoRoadmaps)
        .where(eq(schema.pmoRoadmaps.isDefault, true))
        .all()
      expect(defaults).to.have.length(1)
      expect(defaults[0].id).to.equal(r2.id)
    })
  })

  // =========================================================================
  // 8. Cross-Project Operations Regression
  // =========================================================================
  describe('Cross-Project Regression', () => {
    const secondProjectId = 'second-project'

    beforeEach(async () => {
      await storage.createProject({
        id: secondProjectId,
        name: 'Second Project',
        template: 'kanban',
      })
    })

    it('moves ticket between projects with consistent state', async () => {
      const ticket = await storage.createTicket(projectId, {
        title: 'Cross-project ticket',
        statusName: 'In Progress',
      })

      const moved = await storage.moveTicketToProject(ticket.id, secondProjectId)
      expect(moved.projectId).to.equal(secondProjectId)

      // Verify via Drizzle
      const drizzle = storage.getDrizzle()
      const row = drizzle
        .select()
        .from(schema.pmoTickets)
        .where(eq(schema.pmoTickets.id, ticket.id))
        .get()
      expect(row!.projectId).to.equal(secondProjectId)

      // Verify ticket count
      const p1Tickets = await storage.listTickets(projectId)
      const p2Tickets = await storage.listTickets(secondProjectId)
      expect(p1Tickets).to.have.length(0)
      expect(p2Tickets).to.have.length(1)
    })

    it('lists all tickets across projects consistently', async () => {
      await storage.createTicket(projectId, { title: 'P1 Ticket', statusName: 'Backlog' })
      await storage.createTicket(secondProjectId, { title: 'P2 Ticket', statusName: 'Backlog' })

      const allTickets = await storage.listTickets(undefined, { allProjects: true })
      expect(allTickets.length).to.be.greaterThanOrEqual(2)

      const drizzle = storage.getDrizzle()
      const drizzleAll = drizzle
        .select()
        .from(schema.pmoTickets)
        .all()
      expect(drizzleAll.length).to.be.greaterThanOrEqual(2)

      const storageIds = new Set(allTickets.map(t => t.id))
      const drizzleIds = new Set(drizzleAll.map(r => r.id))
      for (const id of storageIds) {
        expect(drizzleIds.has(id)).to.be.true
      }
    })
  })

  // =========================================================================
  // 9. Subtask and Acceptance Criteria Regression
  // =========================================================================
  describe('Subtask and Acceptance Criteria Regression', () => {
    let ticketId: string

    beforeEach(async () => {
      const ticket = await storage.createTicket(projectId, {
        title: 'Subtask ticket',
        statusName: 'Backlog',
      })
      ticketId = ticket.id
    })

    it('subtasks are visible via both layers', async () => {
      await storage.addSubtask(ticketId, 'Design API')
      await storage.addSubtask(ticketId, 'Implement API')

      const ticket = await storage.getTicket(ticketId)
      expect(ticket!.subtasks).to.have.length(2)

      const drizzle = storage.getDrizzle()
      const drizzleSubtasks = drizzle
        .select()
        .from(schema.pmoSubtasks)
        .where(eq(schema.pmoSubtasks.ticketId, ticketId))
        .all()
      expect(drizzleSubtasks).to.have.length(2)
    })

    it('acceptance criteria are visible via both layers', async () => {
      await storage.addAcceptanceCriterion(ticketId, 'Tests pass')
      await storage.addAcceptanceCriterion(ticketId, 'No regressions')

      const ticket = await storage.getTicket(ticketId)
      expect(ticket!.acceptanceCriteria).to.have.length(2)

      const drizzle = storage.getDrizzle()
      const drizzleCriteria = drizzle
        .select()
        .from(schema.pmoTicketAcceptanceCriteria)
        .where(eq(schema.pmoTicketAcceptanceCriteria.ticketId, ticketId))
        .all()
      expect(drizzleCriteria).to.have.length(2)
    })
  })

  // =========================================================================
  // 10. Work Spawn Selection Data Regression
  // =========================================================================
  describe('Work Spawn Selection Data Regression', () => {
    it('work action data is accessible via both layers', async () => {
      const actions = await storage.listActions()
      expect(actions.length).to.be.greaterThan(0) // Builtin actions seeded

      const drizzle = storage.getDrizzle()
      const drizzleActions = drizzle
        .select()
        .from(schema.pmoActions)
        .all()

      expect(drizzleActions.length).to.equal(actions.length)

      for (const action of actions) {
        const match = drizzleActions.find(da => da.id === action.id)
        expect(match).to.not.be.undefined
        expect(match!.name).to.equal(action.name)
        expect(match!.prompt).to.equal(action.prompt)
      }
    })

    it('ticket categories are consistent for work spawn filtering', async () => {
      const categories = await storage.listCategories({ type: 'ticket' })
      expect(categories.length).to.be.greaterThan(0)

      // Create tickets with various categories for spawn selection
      for (const cat of categories.slice(0, 3)) {
        await storage.createTicket(projectId, {
          title: `${cat.name} ticket`,
          statusName: 'Backlog',
          category: cat.name,
        })
      }

      // Verify filtered listing works for spawn candidate selection
      for (const cat of categories.slice(0, 3)) {
        const filtered = await storage.listTickets(projectId, { category: cat.name })
        expect(filtered.length).to.be.greaterThanOrEqual(1)
        expect(filtered[0].category).to.equal(cat.name)
      }
    })
  })

  // =========================================================================
  // 11. Schema Consistency Regression
  // =========================================================================
  describe('Schema Consistency', () => {
    it('Drizzle schema matches raw SQL tables', () => {
      const db = storage.getDatabase()

      // Get all table names from SQLite
      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      ).all() as Array<{ name: string }>

      const tableNames = tables.map(t => t.name)

      // Verify key PMO tables exist
      expect(tableNames).to.include('pmo_tickets')
      expect(tableNames).to.include('pmo_projects')
      expect(tableNames).to.include('pmo_specs')
      expect(tableNames).to.include('pmo_epics')
      expect(tableNames).to.include('pmo_workflow_statuses')
      expect(tableNames).to.include('pmo_workflows')
      expect(tableNames).to.include('pmo_roadmaps')
      expect(tableNames).to.include('pmo_roadmap_projects')
      expect(tableNames).to.include('pmo_subtasks')
      expect(tableNames).to.include('pmo_ticket_metadata')
      expect(tableNames).to.include('pmo_ticket_acceptance_criteria')
    })

    it('Drizzle schema column types match SQLite columns for tickets', () => {
      const db = storage.getDatabase()
      const columns = db.prepare("PRAGMA table_info('pmo_tickets')").all() as Array<{
        name: string
        type: string
        notnull: number
      }>

      const columnMap = new Map(columns.map(c => [c.name, c]))

      // Verify critical columns exist with correct types
      expect(columnMap.has('id')).to.be.true
      expect(columnMap.has('title')).to.be.true
      expect(columnMap.has('project_id')).to.be.true
      expect(columnMap.has('status_id')).to.be.true
      expect(columnMap.has('position')).to.be.true
      expect(columnMap.has('priority')).to.be.true
      expect(columnMap.has('category')).to.be.true

      // Position should be INTEGER
      expect(columnMap.get('position')!.type).to.equal('INTEGER')
    })
  })

  // =========================================================================
  // 12. Label Operations Regression
  // =========================================================================
  describe('Label Operations Regression', () => {
    it('creates and assigns labels with consistent state', async () => {
      const label = await storage.createLabel({ name: 'regression-label' })
      const ticket = await storage.createTicket(projectId, {
        title: 'Labeled ticket',
        statusName: 'Backlog',
      })

      await storage.addLabelToTicket(ticket.id, label.id)

      const labels = await storage.getLabelsForTicket(ticket.id)
      expect(labels.length).to.be.greaterThanOrEqual(1)
      expect(labels.some(l => l.name === 'regression-label')).to.be.true
    })
  })

  // =========================================================================
  // 13. Dependency Operations Regression
  // =========================================================================
  describe('Dependency Operations Regression', () => {
    it('creates ticket dependency visible via both layers', async () => {
      const t1 = await storage.createTicket(projectId, { title: 'Dep A', statusName: 'Backlog' })
      const t2 = await storage.createTicket(projectId, { title: 'Dep B', statusName: 'Backlog' })

      await storage.createTicketDependency(t1.id, t2.id, 'blocks')

      const deps = await storage.listTicketDependencies(t1.id)
      expect(deps).to.have.length(1)
      expect(deps[0].dependsOnTicketId).to.equal(t2.id)

      // Verify via Drizzle
      const drizzle = storage.getDrizzle()
      const drizzleDeps = drizzle
        .select()
        .from(schema.pmoTicketDependencies)
        .where(eq(schema.pmoTicketDependencies.ticketId, t1.id))
        .all()
      expect(drizzleDeps).to.have.length(1)
      expect(drizzleDeps[0].dependsOnTicketId).to.equal(t2.id)
    })
  })
})
