import { expect } from 'chai'
import Database from 'better-sqlite3'
import { ClickUpMapper } from '../../src/lib/clickup/mapper.js'
import type { ClickUpTask } from '../../src/lib/clickup/types.js'

function makeTask(overrides: Partial<ClickUpTask> = {}): ClickUpTask {
  return {
    id: 'task123',
    custom_id: null,
    name: 'Test task',
    description: 'A test task description',
    status: {
      status: 'open',
      type: 'open',
      orderindex: 0,
    },
    priority: {
      id: '2',
      priority: 'high',
      color: '#ffcc00',
      orderindex: '2',
    },
    assignees: [
      { id: 1, username: 'testuser', email: 'test@example.com', profilePicture: null },
    ],
    tags: [
      { name: 'bug', tag_fg: '#fff', tag_bg: '#f00' },
    ],
    list: { id: 'list123', name: 'Sprint 1' },
    folder: { id: 'folder123', name: 'Development' },
    space: { id: 'space123' },
    url: 'https://app.clickup.com/t/task123',
    date_created: '1700000000000',
    date_updated: '1700100000000',
    due_date: null,
    ...overrides,
  }
}

describe('ClickUp mapper', () => {
  let db: Database.Database
  let mapper: ClickUpMapper

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec(`
      CREATE TABLE IF NOT EXISTS workspace_settings (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `)
    // Create external_execution_map table for the ExternalExecutionMappingStore
    db.exec(`
      CREATE TABLE IF NOT EXISTS pmo_external_execution_map (
        provider TEXT NOT NULL,
        external_id TEXT NOT NULL,
        external_key TEXT,
        canonical_url TEXT,
        latest_state_snapshot TEXT,
        last_synced_at TIMESTAMP,
        last_spawned_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (provider, external_id)
      )
    `)
    db.exec(`
      CREATE TABLE IF NOT EXISTS pmo_external_execution_links (
        provider TEXT NOT NULL,
        external_id TEXT NOT NULL,
        execution_id TEXT NOT NULL,
        linked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (provider, external_id, execution_id)
      )
    `)
    db.exec(`
      CREATE TABLE IF NOT EXISTS pmo_external_execution_prs (
        provider TEXT NOT NULL,
        external_id TEXT NOT NULL,
        pr_url TEXT NOT NULL,
        linked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (provider, external_id, pr_url)
      )
    `)
    mapper = new ClickUpMapper(db)
  })

  afterEach(() => {
    db.close()
  })

  describe('createMapping / getByTicketId', () => {
    it('creates and retrieves a mapping', () => {
      mapper.createMapping({
        pmoTicketId: 'TKT-1',
        clickupTaskId: 'task123',
        clickupListId: 'list123',
        clickupSpaceId: 'space123',
        syncDirection: 'inbound',
        createdAt: new Date(),
      })

      const result = mapper.getByTicketId('TKT-1')
      expect(result).to.not.be.null
      expect(result!.pmoTicketId).to.equal('TKT-1')
      expect(result!.clickupTaskId).to.equal('task123')
      expect(result!.clickupListId).to.equal('list123')
      expect(result!.clickupSpaceId).to.equal('space123')
      expect(result!.syncDirection).to.equal('inbound')
    })

    it('returns null for non-existent ticket', () => {
      expect(mapper.getByTicketId('TKT-999')).to.be.null
    })
  })

  describe('getByClickUpId', () => {
    it('retrieves a mapping by ClickUp task ID', () => {
      mapper.createMapping({
        pmoTicketId: 'TKT-2',
        clickupTaskId: 'task456',
        clickupListId: 'list456',
        syncDirection: 'outbound',
        createdAt: new Date(),
      })

      const result = mapper.getByClickUpId('task456')
      expect(result).to.not.be.null
      expect(result!.pmoTicketId).to.equal('TKT-2')
      expect(result!.clickupTaskId).to.equal('task456')
    })
  })

  describe('deleteMapping', () => {
    it('removes a mapping', () => {
      mapper.createMapping({
        pmoTicketId: 'TKT-3',
        clickupTaskId: 'task789',
        clickupListId: 'list789',
        syncDirection: 'inbound',
        createdAt: new Date(),
      })

      expect(mapper.getByTicketId('TKT-3')).to.not.be.null
      mapper.deleteMapping('TKT-3')
      expect(mapper.getByTicketId('TKT-3')).to.be.null
    })
  })

  describe('listMappings', () => {
    it('returns all mappings', () => {
      mapper.createMapping({
        pmoTicketId: 'TKT-4',
        clickupTaskId: 'taskA',
        clickupListId: 'listA',
        syncDirection: 'inbound',
        createdAt: new Date(),
      })
      mapper.createMapping({
        pmoTicketId: 'TKT-5',
        clickupTaskId: 'taskB',
        clickupListId: 'listB',
        syncDirection: 'outbound',
        createdAt: new Date(),
      })

      const mappings = mapper.listMappings()
      expect(mappings).to.have.length(2)
    })
  })

  describe('taskToTicketInput', () => {
    it('converts a ClickUp task to ticket input', () => {
      const task = makeTask()
      const now = new Date()
      const statuses = [
        { id: 's1', workflowId: 'wf1', name: 'Backlog', category: 'backlog' as const, isDefault: true, position: 0, createdAt: now },
        { id: 's2', workflowId: 'wf1', name: 'In Progress', category: 'started' as const, isDefault: false, position: 1, createdAt: now },
        { id: 's3', workflowId: 'wf1', name: 'Done', category: 'completed' as const, isDefault: false, position: 2, createdAt: now },
      ]

      const input = mapper.taskToTicketInput(task, statuses)
      expect(input.title).to.equal('Test task')
      expect(input.description).to.include('A test task description')
      expect(input.description).to.include('Imported from ClickUp')
      expect(input.priority).to.equal('P1') // high priority maps to P1
      expect(input.assignee).to.equal('testuser')
      expect(input.labels).to.deep.equal(['bug'])
      expect(input.metadata?.['clickup.task_id']).to.equal('task123')
      expect(input.metadata?.['clickup.url']).to.equal('https://app.clickup.com/t/task123')
    })

    it('maps task with no priority to P3', () => {
      const task = makeTask({ priority: null })
      const statuses = [
        { id: 's1', workflowId: 'wf1', name: 'Backlog', category: 'backlog' as const, isDefault: true, position: 0, createdAt: new Date() },
      ]

      const input = mapper.taskToTicketInput(task, statuses)
      expect(input.priority).to.equal('P3')
    })

    it('maps task status type to correct PMO category', () => {
      const task = makeTask({
        status: { status: 'in progress', type: 'custom', orderindex: 1 },
      })
      const statuses = [
        { id: 's1', workflowId: 'wf1', name: 'Backlog', category: 'backlog' as const, isDefault: true, position: 0, createdAt: new Date() },
        { id: 's2', workflowId: 'wf1', name: 'In Progress', category: 'started' as const, isDefault: false, position: 1, createdAt: new Date() },
      ]

      const input = mapper.taskToTicketInput(task, statuses)
      // 'custom' type maps to 'started' category
      expect(input.statusId).to.equal('s2')
    })
  })
})
