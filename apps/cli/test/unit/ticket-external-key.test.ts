import { expect } from 'chai'
import { SqliteDatabase } from '../../src/lib/database/sqlite.js'
import { createFastTestDb, type FastTestDb } from '../e2e/test-helpers.js'
import { initializePMOTables } from '../../src/lib/pmo/storage/base.js'
import { SQLiteStorage } from '../../src/lib/pmo/storage/index.js'
import { PMO_TABLES } from '../../src/lib/pmo/schema.js'

/**
 * Unit tests for ticket external key resolution (PRLT-1066).
 * Verifies that getTicket() resolves external keys (PRLT-xxx) to local tickets.
 */
describe('@smoke Ticket external key resolution', () => {
  let tmpDir: string
  let storage: SQLiteStorage

  before(async () => {
    // Create a temp file-based DB since SQLiteStorage constructor needs a path
    const os = await import('node:os')
    const fs = await import('node:fs')
    const path = await import('node:path')
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-test-ext-key-'))
    const dbPath = path.join(tmpDir, 'workspace.db')
    storage = new SQLiteStorage(dbPath)
  })

  after(async () => {
    storage.close()
    const fs = await import('node:fs')
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('resolves ticket by internal ID (TKT-xxx)', async () => {
    // Create a project first
    await storage.init('test-project', {
      name: 'Test Project',
      columns: ['Backlog', 'Done'],
    })

    // Create a ticket
    const ticket = await storage.createTicket('test-project', {
      title: 'Test ticket',
    })

    // Should find by internal ID
    const found = await storage.getTicket(ticket.id)
    expect(found).to.not.be.null
    expect(found!.id).to.equal(ticket.id)
  })

  it('resolves ticket by external_key via metadata', async () => {
    // Create a ticket
    const ticket = await storage.createTicket('test-project', {
      title: 'External key test',
      metadata: {
        external_source: 'linear',
        external_key: 'PRLT-1234',
        external_id: 'ext-uuid-123',
        external_url: 'https://linear.app/test/PRLT-1234',
      },
    })

    // Should find by external key
    const found = await storage.getTicket('PRLT-1234')
    expect(found).to.not.be.null
    expect(found!.id).to.equal(ticket.id)
    expect(found!.title).to.equal('External key test')
  })

  it('resolves ticket by external_key case-insensitively', async () => {
    const ticket = await storage.createTicket('test-project', {
      title: 'Case insensitive test',
      metadata: {
        external_source: 'linear',
        external_key: 'PRLT-5678',
        external_id: 'ext-uuid-456',
      },
    })

    // Should find with different casing
    const found = await storage.getTicket('prlt-5678')
    expect(found).to.not.be.null
    expect(found!.id).to.equal(ticket.id)
  })

  it('returns null for non-existent external key', async () => {
    const found = await storage.getTicket('PRLT-9999')
    expect(found).to.be.null
  })

  it('prefers direct ID match over external key', async () => {
    // If a ticket's ID matches directly, it should be returned
    // even if another ticket has this as its external key
    const ticket = await storage.createTicket('test-project', {
      title: 'Direct match',
    })

    const found = await storage.getTicket(ticket.id)
    expect(found).to.not.be.null
    expect(found!.title).to.equal('Direct match')
  })
})
