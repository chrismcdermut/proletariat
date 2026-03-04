import { expect } from 'chai'
import Database from 'better-sqlite3'
import {
  createTestEnvironment,
  cleanupTestEnvironment,
  setupProductionSchema,
  createHQConfig,
  createPMODirectories,
  type TestEnvironment,
} from '../e2e/test-helpers.js'
import {
  isAsanaConfigured,
  loadAsanaConfig,
  saveAsanaAccessToken,
  saveAsanaWorkspace,
  saveAsanaProject,
  clearAsanaConfig,
  getAsanaAccessToken,
} from '../../src/lib/asana/config.js'
import { AsanaMapper } from '../../src/lib/asana/mapper.js'
import { AsanaSync } from '../../src/lib/asana/sync.js'
import type { Ticket } from '../../src/lib/pmo/types.js'
import type { AsanaTask } from '../../src/lib/asana/types.js'

describe('Asana Integration', () => {
  let env: TestEnvironment
  let db: Database.Database

  beforeEach(() => {
    env = createTestEnvironment('asana-integration-')
    createHQConfig(env.proletariatDir)
    createPMODirectories(env.pmoPath)
    db = setupProductionSchema(env.dbPath, env.pmoPath)
    db.exec(`
      CREATE TABLE IF NOT EXISTS workspace_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `)
  })

  afterEach(() => {
    if (db) db.close()
    cleanupTestEnvironment(env)
  })

  function seedTicket(ticketId: string): void {
    db.prepare(`
      INSERT INTO pmo_projects (id, name, status, is_archived)
      VALUES ('PROJ-TEST', 'Test Project', 'active', 0)
      ON CONFLICT(id) DO NOTHING
    `).run()

    db.prepare(`
      INSERT INTO pmo_tickets (id, project_id, title, status, labels, position)
      VALUES (?, 'PROJ-TEST', 'Seed Ticket', 'backlog', '[]', 1000)
    `).run(ticketId)
  }

  describe('Asana Config', () => {
    it('reports not configured when no token exists', () => {
      expect(isAsanaConfigured(db)).to.equal(false)
    })

    it('returns null access token when unset in env and DB', () => {
      expect(getAsanaAccessToken(db)).to.equal(null)
    })

    it('saves and loads token/workspace/project settings', () => {
      saveAsanaAccessToken(db, 'token-1')
      saveAsanaWorkspace(db, 'ws-1', 'Workspace One')
      saveAsanaProject(db, 'proj-1', 'Project One')

      const config = loadAsanaConfig(db)
      expect(config).to.not.equal(null)
      expect(config!.accessToken).to.equal('token-1')
      expect(config!.workspaceGid).to.equal('ws-1')
      expect(config!.workspaceName).to.equal('Workspace One')
      expect(config!.projectGid).to.equal('proj-1')
      expect(config!.projectName).to.equal('Project One')
    })

    it('clears all stored settings', () => {
      saveAsanaAccessToken(db, 'token-1')
      saveAsanaWorkspace(db, 'ws-1', 'Workspace One')
      saveAsanaProject(db, 'proj-1', 'Project One')

      clearAsanaConfig(db)
      expect(isAsanaConfigured(db)).to.equal(false)
      expect(loadAsanaConfig(db)).to.equal(null)
    })

    it('prefers environment token over stored token', () => {
      saveAsanaAccessToken(db, 'stored-token')
      process.env.ASANA_ACCESS_TOKEN = 'env-token'

      expect(getAsanaAccessToken(db)).to.equal('env-token')

      delete process.env.ASANA_ACCESS_TOKEN
    })
  })

  describe('AsanaMapper', () => {
    it('creates and updates mappings', () => {
      const mapper = new AsanaMapper(db)
      seedTicket('TKT-1')

      mapper.createOrUpdateMapping('TKT-1', 'task-1', 'proj-1')
      let mapping = mapper.getByTicketId('TKT-1')
      expect(mapping).to.not.equal(null)
      expect(mapping!.asanaTaskGid).to.equal('task-1')
      expect(mapping!.asanaProjectGid).to.equal('proj-1')

      mapper.createOrUpdateMapping('TKT-1', 'task-2')
      mapping = mapper.getByTicketId('TKT-1')
      expect(mapping!.asanaTaskGid).to.equal('task-2')
      expect(mapping!.asanaProjectGid).to.equal(undefined)

      const all = mapper.listMappings()
      expect(all).to.have.lengthOf(1)
      expect(all[0].pmoTicketId).to.equal('TKT-1')
    })
  })

  describe('AsanaSync', () => {
    it('creates a task and records mapping', async () => {
      const mapper = new AsanaMapper(db)
      seedTicket('TKT-22')
      const created: AsanaTask[] = []

      const client = {
        createTask: async () => {
          const task = { gid: 'task-1', name: 'name', completed: false }
          created.push(task)
          return task
        },
      } as unknown as { createTask: (input: unknown) => Promise<AsanaTask> }

      const sync = new AsanaSync(client as never, mapper)

      const ticket = {
        id: 'TKT-22',
        title: 'Wire up sync',
        description: 'Sync this ticket',
        statusCategory: 'started',
      } as Ticket

      const taskGid = await sync.createTaskForTicket(ticket, 'proj-1')
      expect(taskGid).to.equal('task-1')
      expect(created).to.have.lengthOf(1)

      const mapping = mapper.getByTicketId('TKT-22')
      expect(mapping).to.not.equal(null)
      expect(mapping!.asanaTaskGid).to.equal('task-1')
    })

    it('marks completed/canceled tickets as completed in Asana updates', async () => {
      const mapper = new AsanaMapper(db)
      seedTicket('TKT-9')
      mapper.createOrUpdateMapping('TKT-9', 'task-9', 'proj-9')

      let captured: Record<string, unknown> | null = null
      const client = {
        updateTask: async (_taskGid: string, input: Record<string, unknown>) => {
          captured = input
          return { gid: 'task-9', name: 'task', completed: true }
        },
      } as unknown as { updateTask: (taskGid: string, input: Record<string, unknown>) => Promise<AsanaTask> }

      const sync = new AsanaSync(client as never, mapper)

      const ticket = {
        id: 'TKT-9',
        title: 'Done ticket',
        description: 'Already done',
        statusCategory: 'completed',
      } as Ticket

      await sync.syncTicket(ticket, 'task-9')
      expect(captured).to.not.equal(null)
      expect(captured!.completed).to.equal(true)
    })
  })
})
