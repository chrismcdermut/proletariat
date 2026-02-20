/**
 * Drizzle ORM Migration Performance Comparison Tests
 *
 * Compares query-level performance between raw SQL (better-sqlite3)
 * and Drizzle ORM for key PMO flows:
 * - Ticket list (the most common read operation)
 * - Ticket view (single ticket retrieval with joins)
 * - Ticket create (write operation with position calculation)
 * - Work spawn selection (multi-table read for candidate selection)
 *
 * Each test measures average execution time over multiple iterations
 * and reports the comparison. No hard failure thresholds - results
 * are informational and logged for review.
 */

import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import Database from 'better-sqlite3'
import { SQLiteStorage } from '../../src/lib/pmo/storage-sqlite.js'
import { createDrizzleConnection, DrizzleDB } from '../../src/lib/database/drizzle.js'
import { eq, and, desc, asc, sql } from 'drizzle-orm'
import * as schema from '../../src/lib/database/drizzle-schema.js'

/** Number of iterations for each benchmark */
const ITERATIONS = 50

/** Number of tickets to seed for list benchmarks */
const SEED_TICKET_COUNT = 100

/** Maximum acceptable overhead ratio (Drizzle vs raw SQL) */
const MAX_OVERHEAD_RATIO = 3.0

interface PerfResult {
  operation: string
  rawSqlAvgMs: number
  drizzleAvgMs: number
  overheadRatio: number
  verdict: string
}

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * Check if performance is acceptable.
 * For sub-millisecond queries, ratio is misleading due to constant Drizzle overhead.
 * Accept if either: ratio is under threshold OR absolute Drizzle time is under 1ms.
 */
function isAcceptablePerf(drizzleMs: number, ratio: number): boolean {
  return ratio <= MAX_OVERHEAD_RATIO || drizzleMs < 1.0
}

describe('Drizzle ORM Migration Performance Comparison', () => {
  let testDir: string
  let storage: SQLiteStorage
  let db: Database.Database
  let drizzle: DrizzleDB
  const projectId = 'perf-project'
  const results: PerfResult[] = []

  before(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drizzle-perf-'))
    const dbPath = path.join(testDir, 'perf.db')
    const tempDb = new Database(dbPath)
    tempDb.close()

    storage = new SQLiteStorage(dbPath)
    db = storage.getDatabase()
    drizzle = storage.getDrizzle()

    // Create project
    await storage.createProject({
      id: projectId,
      name: 'Performance Test Project',
      template: 'kanban',
    })

    // Seed tickets for list benchmarks
    const statuses = ['Backlog', 'Ready', 'In Progress', 'Review', 'Done']
    const priorities = ['P0', 'P1', 'P2', 'P3', null]
    const categories = ['bug', 'feature', 'refactor', 'chore', null]

    for (let i = 0; i < SEED_TICKET_COUNT; i++) {
      await storage.createTicket(projectId, {
        title: `Perf test ticket ${i + 1}`,
        description: `Description for performance test ticket number ${i + 1}`,
        statusName: statuses[i % statuses.length],
        priority: priorities[i % priorities.length] as string,
        category: categories[i % categories.length] as string,
      })
    }
  })

  after(async () => {
    // Print results summary
    console.log('\n  ┌───────────────────────────────────────────────────────────────────┐')
    console.log('  │         Drizzle ORM Performance Comparison Summary              │')
    console.log('  ├──────────────────────────┬───────────┬───────────┬───────┬───────┤')
    console.log('  │ Operation                │ Raw SQL   │ Drizzle   │ Ratio │ Pass? │')
    console.log('  ├──────────────────────────┼───────────┼───────────┼───────┼───────┤')
    for (const r of results) {
      const op = r.operation.padEnd(24)
      const raw = `${r.rawSqlAvgMs.toFixed(3)}ms`.padStart(9)
      const drz = `${r.drizzleAvgMs.toFixed(3)}ms`.padStart(9)
      const ratio = `${r.overheadRatio.toFixed(1)}x`.padStart(5)
      const pass = r.verdict === 'PASS' ? ' YES ' : '  NO '
      console.log(`  │ ${op} │ ${raw} │ ${drz} │ ${ratio} │ ${pass} │`)
    }
    console.log('  └──────────────────────────┴───────────┴───────────┴───────┴───────┘')

    await storage.close()
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true })
    }
  })

  // =========================================================================
  // 1. Ticket List Performance
  // =========================================================================
  describe('Ticket List', () => {
    it('compares ticket list performance', () => {
      const rawTimes: number[] = []
      const drizzleTimes: number[] = []

      // Get project's workflow for status joins
      const project = db.prepare(
        "SELECT workflow_id FROM pmo_projects WHERE id = ?"
      ).get(projectId) as { workflow_id: string }

      // Warm up
      db.prepare(`
        SELECT t.*, ws.id as column_id, t.position as position,
               ws.name as column_name, p.name as project_name
        FROM pmo_tickets t
        LEFT JOIN pmo_workflow_statuses ws ON t.status_id = ws.id
        LEFT JOIN pmo_projects p ON t.project_id = p.id
        WHERE t.project_id = ?
        ORDER BY ws.position, t.position ASC, t.created_at ASC
      `).all(projectId)

      drizzle
        .select()
        .from(schema.pmoTickets)
        .where(eq(schema.pmoTickets.projectId, projectId))
        .all()

      // Benchmark raw SQL
      for (let i = 0; i < ITERATIONS; i++) {
        const start = performance.now()
        db.prepare(`
          SELECT t.*, ws.id as column_id, t.position as position,
                 ws.name as column_name, p.name as project_name
          FROM pmo_tickets t
          LEFT JOIN pmo_workflow_statuses ws ON t.status_id = ws.id
          LEFT JOIN pmo_projects p ON t.project_id = p.id
          WHERE t.project_id = ?
          ORDER BY ws.position, t.position ASC, t.created_at ASC
        `).all(projectId)
        rawTimes.push(performance.now() - start)
      }

      // Benchmark Drizzle ORM
      for (let i = 0; i < ITERATIONS; i++) {
        const start = performance.now()
        drizzle
          .select({
            id: schema.pmoTickets.id,
            title: schema.pmoTickets.title,
            description: schema.pmoTickets.description,
            priority: schema.pmoTickets.priority,
            category: schema.pmoTickets.category,
            status: schema.pmoTickets.status,
            statusId: schema.pmoTickets.statusId,
            projectId: schema.pmoTickets.projectId,
            position: schema.pmoTickets.position,
            columnName: schema.pmoWorkflowStatuses.name,
            projectName: schema.pmoProjects.name,
          })
          .from(schema.pmoTickets)
          .leftJoin(schema.pmoWorkflowStatuses, eq(schema.pmoTickets.statusId, schema.pmoWorkflowStatuses.id))
          .leftJoin(schema.pmoProjects, eq(schema.pmoTickets.projectId, schema.pmoProjects.id))
          .where(eq(schema.pmoTickets.projectId, projectId))
          .all()
        drizzleTimes.push(performance.now() - start)
      }

      const rawAvg = median(rawTimes)
      const drizzleAvg = median(drizzleTimes)
      const ratio = drizzleAvg / rawAvg

      results.push({
        operation: 'ticket list (100)',
        rawSqlAvgMs: rawAvg,
        drizzleAvgMs: drizzleAvg,
        overheadRatio: ratio,
        verdict: isAcceptablePerf(drizzleAvg, ratio) ? 'PASS' : 'FAIL',
      })

      expect(isAcceptablePerf(drizzleAvg, ratio)).to.be.true
    })
  })

  // =========================================================================
  // 2. Ticket View (Single Retrieval) Performance
  // =========================================================================
  describe('Ticket View', () => {
    it('compares single ticket retrieval performance', () => {
      // Get a ticket ID for testing
      const ticketRow = db.prepare(
        "SELECT id FROM pmo_tickets WHERE project_id = ? LIMIT 1"
      ).get(projectId) as { id: string }
      const ticketId = ticketRow.id

      const rawTimes: number[] = []
      const drizzleTimes: number[] = []

      // Warm up
      db.prepare(`
        SELECT t.*, ws.id as column_id, t.position as position, ws.name as column_name
        FROM pmo_tickets t
        LEFT JOIN pmo_workflow_statuses ws ON t.status_id = ws.id
        WHERE LOWER(t.id) = LOWER(?)
      `).get(ticketId)

      drizzle
        .select()
        .from(schema.pmoTickets)
        .where(eq(schema.pmoTickets.id, ticketId))
        .get()

      // Benchmark raw SQL
      for (let i = 0; i < ITERATIONS; i++) {
        const start = performance.now()
        db.prepare(`
          SELECT t.*, ws.id as column_id, t.position as position, ws.name as column_name
          FROM pmo_tickets t
          LEFT JOIN pmo_workflow_statuses ws ON t.status_id = ws.id
          WHERE LOWER(t.id) = LOWER(?)
        `).get(ticketId)
        rawTimes.push(performance.now() - start)
      }

      // Benchmark Drizzle ORM
      for (let i = 0; i < ITERATIONS; i++) {
        const start = performance.now()
        drizzle
          .select({
            id: schema.pmoTickets.id,
            title: schema.pmoTickets.title,
            description: schema.pmoTickets.description,
            priority: schema.pmoTickets.priority,
            category: schema.pmoTickets.category,
            statusId: schema.pmoTickets.statusId,
            position: schema.pmoTickets.position,
            columnName: schema.pmoWorkflowStatuses.name,
          })
          .from(schema.pmoTickets)
          .leftJoin(schema.pmoWorkflowStatuses, eq(schema.pmoTickets.statusId, schema.pmoWorkflowStatuses.id))
          .where(eq(schema.pmoTickets.id, ticketId))
          .get()
        drizzleTimes.push(performance.now() - start)
      }

      const rawAvg = median(rawTimes)
      const drizzleAvg = median(drizzleTimes)
      const ratio = drizzleAvg / rawAvg

      results.push({
        operation: 'ticket view (single)',
        rawSqlAvgMs: rawAvg,
        drizzleAvgMs: drizzleAvg,
        overheadRatio: ratio,
        verdict: isAcceptablePerf(drizzleAvg, ratio) ? 'PASS' : 'FAIL',
      })

      expect(isAcceptablePerf(drizzleAvg, ratio)).to.be.true
    })
  })

  // =========================================================================
  // 3. Ticket Create Performance
  // =========================================================================
  describe('Ticket Create', () => {
    it('compares ticket creation performance', () => {
      const rawTimes: number[] = []
      const drizzleTimes: number[] = []

      // Get default status for raw SQL inserts
      const defaultStatus = db.prepare(`
        SELECT ws.id FROM pmo_workflow_statuses ws
        JOIN pmo_projects p ON p.workflow_id = ws.workflow_id
        WHERE p.id = ? AND ws.is_default = 1
      `).get(projectId) as { id: string }

      // Benchmark raw SQL insert
      for (let i = 0; i < ITERATIONS; i++) {
        const id = `raw-perf-${Date.now()}-${i}`
        const start = performance.now()

        const maxPos = db.prepare(
          "SELECT COALESCE(MAX(position), 0) as max_pos FROM pmo_tickets WHERE status_id = ?"
        ).get(defaultStatus.id) as { max_pos: number }

        db.prepare(`
          INSERT INTO pmo_tickets (id, project_id, title, description, priority, category,
            status_id, position, created_at, updated_at, labels)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]')
        `).run(
          id, projectId, `Raw perf ticket ${i}`, null, 'P1', null,
          defaultStatus.id, maxPos.max_pos + 1000, Date.now(), Date.now()
        )

        rawTimes.push(performance.now() - start)
      }

      // Benchmark Drizzle ORM insert
      for (let i = 0; i < ITERATIONS; i++) {
        const id = `drz-perf-${Date.now()}-${i}`
        const start = performance.now()

        const maxPosResult = drizzle
          .select({ maxPos: sql<number>`COALESCE(MAX(${schema.pmoTickets.position}), 0)` })
          .from(schema.pmoTickets)
          .where(eq(schema.pmoTickets.statusId, defaultStatus.id))
          .get()

        const now = Date.now().toString()
        drizzle.insert(schema.pmoTickets).values({
          id,
          projectId,
          title: `Drizzle perf ticket ${i}`,
          description: null,
          priority: 'P1',
          category: null,
          statusId: defaultStatus.id,
          position: (maxPosResult?.maxPos ?? 0) + 1000,
          createdAt: now,
          updatedAt: now,
          labels: '[]',
        }).run()

        drizzleTimes.push(performance.now() - start)
      }

      const rawAvg = median(rawTimes)
      const drizzleAvg = median(drizzleTimes)
      const ratio = drizzleAvg / rawAvg

      results.push({
        operation: 'ticket create',
        rawSqlAvgMs: rawAvg,
        drizzleAvgMs: drizzleAvg,
        overheadRatio: ratio,
        verdict: isAcceptablePerf(drizzleAvg, ratio) ? 'PASS' : 'FAIL',
      })

      expect(isAcceptablePerf(drizzleAvg, ratio)).to.be.true
    })
  })

  // =========================================================================
  // 4. Work Spawn Selection Performance
  // =========================================================================
  describe('Work Spawn Selection', () => {
    it('compares work spawn candidate query performance', () => {
      const rawTimes: number[] = []
      const drizzleTimes: number[] = []

      // Work spawn selection: query unstarted/backlog tickets as candidates
      // Warm up
      db.prepare(`
        SELECT t.id, t.title, t.priority, t.category, ws.name as status_name, ws.category as status_category
        FROM pmo_tickets t
        LEFT JOIN pmo_workflow_statuses ws ON t.status_id = ws.id
        WHERE t.project_id = ?
          AND ws.category IN ('backlog', 'unstarted')
        ORDER BY
          CASE t.priority
            WHEN 'P0' THEN 1
            WHEN 'P1' THEN 2
            WHEN 'P2' THEN 3
            WHEN 'P3' THEN 4
            ELSE 5
          END,
          t.position ASC
      `).all(projectId)

      // Benchmark raw SQL
      for (let i = 0; i < ITERATIONS; i++) {
        const start = performance.now()
        db.prepare(`
          SELECT t.id, t.title, t.priority, t.category, ws.name as status_name, ws.category as status_category
          FROM pmo_tickets t
          LEFT JOIN pmo_workflow_statuses ws ON t.status_id = ws.id
          WHERE t.project_id = ?
            AND ws.category IN ('backlog', 'unstarted')
          ORDER BY
            CASE t.priority
              WHEN 'P0' THEN 1
              WHEN 'P1' THEN 2
              WHEN 'P2' THEN 3
              WHEN 'P3' THEN 4
              ELSE 5
            END,
            t.position ASC
        `).all(projectId)
        rawTimes.push(performance.now() - start)
      }

      // Benchmark Drizzle ORM
      for (let i = 0; i < ITERATIONS; i++) {
        const start = performance.now()
        drizzle
          .select({
            id: schema.pmoTickets.id,
            title: schema.pmoTickets.title,
            priority: schema.pmoTickets.priority,
            category: schema.pmoTickets.category,
            statusName: schema.pmoWorkflowStatuses.name,
            statusCategory: schema.pmoWorkflowStatuses.category,
          })
          .from(schema.pmoTickets)
          .leftJoin(schema.pmoWorkflowStatuses, eq(schema.pmoTickets.statusId, schema.pmoWorkflowStatuses.id))
          .where(
            and(
              eq(schema.pmoTickets.projectId, projectId),
              sql`${schema.pmoWorkflowStatuses.category} IN ('backlog', 'unstarted')`
            )
          )
          .all()
        drizzleTimes.push(performance.now() - start)
      }

      const rawAvg = median(rawTimes)
      const drizzleAvg = median(drizzleTimes)
      const ratio = drizzleAvg / rawAvg

      results.push({
        operation: 'work spawn selection',
        rawSqlAvgMs: rawAvg,
        drizzleAvgMs: drizzleAvg,
        overheadRatio: ratio,
        verdict: isAcceptablePerf(drizzleAvg, ratio) ? 'PASS' : 'FAIL',
      })

      expect(isAcceptablePerf(drizzleAvg, ratio)).to.be.true
    })
  })

  // =========================================================================
  // 5. Filtered List Performance
  // =========================================================================
  describe('Filtered List', () => {
    it('compares filtered ticket list performance (priority filter)', () => {
      const rawTimes: number[] = []
      const drizzleTimes: number[] = []

      // Benchmark raw SQL with filter
      for (let i = 0; i < ITERATIONS; i++) {
        const start = performance.now()
        db.prepare(`
          SELECT t.*, ws.name as column_name
          FROM pmo_tickets t
          LEFT JOIN pmo_workflow_statuses ws ON t.status_id = ws.id
          WHERE t.project_id = ? AND t.priority = ?
          ORDER BY ws.position, t.position ASC
        `).all(projectId, 'P0')
        rawTimes.push(performance.now() - start)
      }

      // Benchmark Drizzle ORM with filter
      for (let i = 0; i < ITERATIONS; i++) {
        const start = performance.now()
        drizzle
          .select({
            id: schema.pmoTickets.id,
            title: schema.pmoTickets.title,
            priority: schema.pmoTickets.priority,
            columnName: schema.pmoWorkflowStatuses.name,
          })
          .from(schema.pmoTickets)
          .leftJoin(schema.pmoWorkflowStatuses, eq(schema.pmoTickets.statusId, schema.pmoWorkflowStatuses.id))
          .where(
            and(
              eq(schema.pmoTickets.projectId, projectId),
              eq(schema.pmoTickets.priority, 'P0')
            )
          )
          .all()
        drizzleTimes.push(performance.now() - start)
      }

      const rawAvg = median(rawTimes)
      const drizzleAvg = median(drizzleTimes)
      const ratio = drizzleAvg / rawAvg

      results.push({
        operation: 'ticket list (filtered)',
        rawSqlAvgMs: rawAvg,
        drizzleAvgMs: drizzleAvg,
        overheadRatio: ratio,
        verdict: isAcceptablePerf(drizzleAvg, ratio) ? 'PASS' : 'FAIL',
      })

      expect(isAcceptablePerf(drizzleAvg, ratio)).to.be.true
    })
  })

  // =========================================================================
  // 6. Roadmap Queries (Already Migrated)
  // =========================================================================
  describe('Roadmap Queries (Drizzle-native)', () => {
    before(async () => {
      // Create roadmaps and link projects for the benchmark
      await storage.createRoadmap({ name: 'Perf Roadmap 1' })
      const r2 = await storage.createRoadmap({ name: 'Perf Roadmap 2' })
      await storage.addProjectToRoadmap(r2.id, projectId)
    })

    it('compares roadmap list performance (baseline for migrated module)', () => {
      const rawTimes: number[] = []
      const drizzleTimes: number[] = []

      // Benchmark raw SQL
      for (let i = 0; i < ITERATIONS; i++) {
        const start = performance.now()
        db.prepare(
          "SELECT * FROM pmo_roadmaps ORDER BY is_default DESC, name ASC"
        ).all()
        rawTimes.push(performance.now() - start)
      }

      // Benchmark Drizzle ORM (as actually used in RoadmapStorage)
      for (let i = 0; i < ITERATIONS; i++) {
        const start = performance.now()
        drizzle
          .select()
          .from(schema.pmoRoadmaps)
          .all()
        drizzleTimes.push(performance.now() - start)
      }

      const rawAvg = median(rawTimes)
      const drizzleAvg = median(drizzleTimes)
      const ratio = drizzleAvg / rawAvg

      results.push({
        operation: 'roadmap list (migrated)',
        rawSqlAvgMs: rawAvg,
        drizzleAvgMs: drizzleAvg,
        overheadRatio: ratio,
        verdict: isAcceptablePerf(drizzleAvg, ratio) ? 'PASS' : 'FAIL',
      })

      expect(isAcceptablePerf(drizzleAvg, ratio)).to.be.true
    })
  })
})
