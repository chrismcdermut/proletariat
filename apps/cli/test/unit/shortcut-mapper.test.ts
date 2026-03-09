import { expect } from 'chai'
import Database from 'better-sqlite3'
import { ShortcutMapper } from '../../src/lib/shortcut/mapper.js'

describe('ShortcutMapper', () => {
  let db: Database.Database
  let mapper: ShortcutMapper

  beforeEach(() => {
    db = new Database(':memory:')
    // Create the tickets table that the mapper references
    db.exec(`
      CREATE TABLE IF NOT EXISTS pmo_tickets (
        id TEXT PRIMARY KEY,
        title TEXT,
        description TEXT,
        status_name TEXT,
        status_category TEXT
      )
    `)
    // Insert a sample ticket for FK constraint
    db.prepare('INSERT INTO pmo_tickets (id, title) VALUES (?, ?)').run('TKT-001', 'Test Ticket')
    db.prepare('INSERT INTO pmo_tickets (id, title) VALUES (?, ?)').run('TKT-002', 'Another Ticket')

    mapper = new ShortcutMapper(db)
  })

  afterEach(() => {
    db.close()
  })

  it('creates a mapping', () => {
    mapper.createOrUpdateMapping('TKT-001', '12345', 'my-workspace')

    const result = mapper.getByTicketId('TKT-001')
    expect(result).to.not.equal(null)
    expect(result!.pmoTicketId).to.equal('TKT-001')
    expect(result!.shortcutStoryId).to.equal('12345')
    expect(result!.shortcutWorkspaceSlug).to.equal('my-workspace')
  })

  it('updates an existing mapping', () => {
    mapper.createOrUpdateMapping('TKT-001', '12345', 'old-workspace')
    mapper.createOrUpdateMapping('TKT-001', '67890', 'new-workspace')

    const result = mapper.getByTicketId('TKT-001')
    expect(result!.shortcutStoryId).to.equal('67890')
    expect(result!.shortcutWorkspaceSlug).to.equal('new-workspace')
  })

  it('looks up by story ID', () => {
    mapper.createOrUpdateMapping('TKT-001', '12345')

    const result = mapper.getByStoryId('12345')
    expect(result).to.not.equal(null)
    expect(result!.pmoTicketId).to.equal('TKT-001')
  })

  it('returns null for non-existent mapping', () => {
    expect(mapper.getByTicketId('TKT-999')).to.equal(null)
    expect(mapper.getByStoryId('99999')).to.equal(null)
  })

  it('lists all mappings', () => {
    mapper.createOrUpdateMapping('TKT-001', '12345')
    mapper.createOrUpdateMapping('TKT-002', '67890')

    const mappings = mapper.listMappings()
    expect(mappings).to.have.length(2)
  })

  it('updates sync timestamp', () => {
    mapper.createOrUpdateMapping('TKT-001', '12345')

    const before = mapper.getByTicketId('TKT-001')
    mapper.updateSyncTimestamp('TKT-001')
    const after = mapper.getByTicketId('TKT-001')

    expect(after!.lastSyncedAt).to.not.equal(null)
  })

  it('creates mapping without workspace slug', () => {
    mapper.createOrUpdateMapping('TKT-001', '12345')

    const result = mapper.getByTicketId('TKT-001')
    expect(result!.shortcutWorkspaceSlug).to.equal(undefined)
  })
})
