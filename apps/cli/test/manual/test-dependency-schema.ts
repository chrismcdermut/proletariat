/**
 * Manual test script to verify dependency schema and storage methods work correctly.
 * Run with: npx tsx test/manual/test-dependency-schema.ts
 */

import Database from 'better-sqlite3'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { PMO_SCHEMA_SQL, PMO_TABLES } from '../../src/lib/pmo/schema.js'
import { SQLiteStorage } from '../../src/lib/pmo/storage-sqlite.js'

const T = PMO_TABLES

async function testSchema() {
  console.log('=== Testing Schema (raw SQL) ===\n')

  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(PMO_SCHEMA_SQL)

  // Create test data
  db.exec(`INSERT INTO ${T.projects} (id, name) VALUES ('proj-1', 'Test Project')`)
  db.exec(`INSERT INTO ${T.epics} (id, project_id, title) VALUES ('epic-1', 'proj-1', 'Epic 1')`)
  db.exec(`INSERT INTO ${T.epics} (id, project_id, title) VALUES ('epic-2', 'proj-1', 'Epic 2')`)

  // Test epic dependency with RESTRICT
  db.exec(`INSERT INTO ${T.epic_dependencies} (epic_id, depends_on_epic_id, dependency_type) VALUES ('epic-1', 'epic-2', 'blocks')`)
  console.log('✓ Created epic dependency')

  // Test RESTRICT
  try {
    db.exec(`DELETE FROM ${T.epics} WHERE id = 'epic-2'`)
    console.log('✗ ERROR: Delete should have been prevented by RESTRICT!')
  } catch (e: unknown) {
    console.log('✓ RESTRICT worked:', (e as Error).message)
  }

  // Test self-link prevention
  try {
    db.exec(`INSERT INTO ${T.epic_dependencies} (epic_id, depends_on_epic_id, dependency_type) VALUES ('epic-1', 'epic-1', 'blocks')`)
    console.log('✗ ERROR: Self-link should have been prevented!')
  } catch (e: unknown) {
    console.log('✓ Self-link prevented:', (e as Error).message)
  }

  db.close()
  console.log('\n✓ Schema tests passed!\n')
}

async function testStorageMethods() {
  console.log('=== Testing Storage Methods ===\n')

  // Create temp directory and database
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmo-test-'))
  const dbPath = path.join(tempDir, 'test.db')

  // Create empty database file
  const db = new Database(dbPath)
  db.close()

  const storage = new SQLiteStorage(dbPath)

  // Initialize board with columns and apply workflow template
  await storage.init({
    name: 'Test Board',
    columns: ['Backlog', 'In Progress', 'Done'],
  })

  // Apply a workflow template to get statuses (required for ticket creation)
  // The default project ID is 'default' - apply the 'kanban' workflow template
  const projectId = storage.getCurrentProjectId()
  await storage.applyTemplate(projectId, 'kanban')

  // Test ticket dependencies
  console.log('--- Ticket Dependencies ---')
  const ticket1 = await storage.createTicket({ title: 'Ticket 1', column: 'Backlog' })
  const ticket2 = await storage.createTicket({ title: 'Ticket 2', column: 'Backlog' })
  await storage.createTicket({ title: 'Ticket 3', column: 'Backlog' })

  const ticketDep = await storage.createTicketDependency(ticket1.id, ticket2.id, 'blocks')
  console.log('✓ Created ticket dependency:', ticketDep.ticketId, 'blocks', ticketDep.dependsOnTicketId)

  const ticketDeps = await storage.listTicketDependencies(ticket1.id)
  console.log('✓ Listed ticket dependencies:', ticketDeps.length)

  const blockers = await storage.getTicketBlockers(ticket1.id)
  console.log('✓ Got blockers:', blockers.map(t => t.title))

  const isBlocked = await storage.isTicketBlocked(ticket1.id)
  console.log('✓ Is ticket blocked:', isBlocked)

  // Get the 'Done' status ID from the applied template
  const statuses = await storage.listStatuses(projectId)
  const doneStatus = statuses.find(s => s.category === 'completed')
  if (!doneStatus) throw new Error('No completed status found')

  await storage.updateTicket(ticket2.id, { statusId: doneStatus.id })
  const isBlockedAfter = await storage.isTicketBlocked(ticket1.id)
  console.log('✓ Is ticket blocked after completing blocker:', isBlockedAfter)

  // Test spec dependencies
  console.log('\n--- Spec Dependencies ---')
  const spec1 = await storage.createSpec({ id: 'spec-1', path: 'specs/1.md', title: 'Spec 1' })
  const spec2 = await storage.createSpec({ id: 'spec-2', path: 'specs/2.md', title: 'Spec 2' })

  const specDep = await storage.createSpecDependency(spec1.id, spec2.id, 'depends_on')
  console.log('✓ Created spec dependency:', specDep.specId, 'depends_on', specDep.dependsOnSpecId)

  const specDeps = await storage.listSpecDependencies(spec1.id)
  console.log('✓ Listed spec dependencies:', specDeps.length)

  // Test epic dependencies
  console.log('\n--- Epic Dependencies ---')
  const epic1 = await storage.createEpic({ title: 'Epic 1' })
  const epic2 = await storage.createEpic({ title: 'Epic 2' })

  const epicDep = await storage.createEpicDependency(epic1.id, epic2.id, 'blocks')
  console.log('✓ Created epic dependency:', epicDep.epicId, 'blocks', epicDep.dependsOnEpicId)

  const epicDeps = await storage.listEpicDependencies(epic1.id)
  console.log('✓ Listed epic dependencies:', epicDeps.length)

  const isEpicBlocked = await storage.isEpicBlocked(epic1.id)
  console.log('✓ Is epic blocked:', isEpicBlocked)

  await storage.updateEpic(epic2.id, { status: 'complete' })
  const isEpicBlockedAfter = await storage.isEpicBlocked(epic1.id)
  console.log('✓ Is epic blocked after completing blocker:', isEpicBlockedAfter)

  // Test error handling
  console.log('\n--- Error Handling ---')
  try {
    await storage.createTicketDependency(ticket1.id, ticket1.id)
    console.log('✗ ERROR: Self-dependency should have been prevented!')
  } catch (e: unknown) {
    console.log('✓ Self-dependency prevented:', (e as Error).message)
  }

  try {
    await storage.createTicketDependency(ticket1.id, ticket2.id, 'blocks')
    console.log('✗ ERROR: Duplicate dependency should have been prevented!')
  } catch (e: unknown) {
    console.log('✓ Duplicate dependency prevented:', (e as Error).message)
  }

  try {
    await storage.createTicketDependency('non-existent', ticket2.id)
    console.log('✗ ERROR: Non-existent ticket should have been caught!')
  } catch (e: unknown) {
    console.log('✓ Non-existent ticket caught:', (e as Error).message)
  }

  await storage.close()

  // Cleanup
  fs.rmSync(tempDir, { recursive: true })

  console.log('\n✓ Storage method tests passed!\n')
}

async function main() {
  await testSchema()
  await testStorageMethods()
  console.log('=== All tests passed! ===')
}

main().catch(console.error)
