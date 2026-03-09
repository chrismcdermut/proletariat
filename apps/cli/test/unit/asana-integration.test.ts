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
import {
  normalizeAsanaTask,
  normalizeAsanaTaskToEnvelope,
  buildAsanaTicketDescription,
  buildAsanaMetadata,
  buildAsanaSpawnContextMessage,
  buildAsanaTaskChoiceCommand,
} from '../../src/lib/external-issues/asana.js'
import { AsanaIssueAdapter } from '../../src/lib/external-issues/adapters.js'

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

  describe('Asana External Issue Normalizer', () => {
    const sampleTask = {
      gid: '1234567890',
      name: 'Build login page',
      completed: false,
      notes: 'Implement the login page with OAuth support.',
      assignee: { gid: 'user-1', name: 'Alice Smith' },
      tags: [{ gid: 'tag-1', name: 'frontend' }, { gid: 'tag-2', name: 'auth' }],
      memberships: [{
        project: { gid: 'proj-1', name: 'Web App' },
        section: { gid: 'sec-1', name: 'In Progress' },
      }],
      due_on: '2026-04-01',
      permalink_url: 'https://app.asana.com/0/proj-1/1234567890',
    }

    it('normalizes a raw Asana task into an IssueEnvelope', () => {
      const envelope = normalizeAsanaTask(sampleTask)

      expect(envelope.source).to.equal('asana')
      expect(envelope.external_id).to.equal('1234567890')
      expect(envelope.external_key).to.equal('1234567890')
      expect(envelope.title).to.equal('Build login page')
      expect(envelope.description).to.equal('Implement the login page with OAuth support.')
      expect(envelope.labels).to.deep.equal(['frontend', 'auth'])
      expect(envelope.priority).to.equal(null)
      expect(envelope.status).to.equal('In Progress')
      expect(envelope.url).to.equal('https://app.asana.com/0/proj-1/1234567890')
      expect(envelope.project_key).to.equal('Web App')
      expect(envelope.assignee).to.equal('Alice Smith')
      expect(envelope.item_type).to.equal('task')
    })

    it('normalizes to NormalizedIssueEnvelope', () => {
      const envelope = normalizeAsanaTaskToEnvelope(sampleTask)

      expect(envelope.source.name).to.equal('asana')
      expect(envelope.source.externalId).to.equal('1234567890')
      expect(envelope.source.externalKey).to.equal('1234567890')
      expect(envelope.title).to.equal('Build login page')
      expect(envelope.category).to.equal('feature')
    })

    it('handles completed tasks', () => {
      const completedTask = { ...sampleTask, completed: true }
      const envelope = normalizeAsanaTask(completedTask)
      expect(envelope.status).to.equal('Completed')
    })

    it('handles tasks with no section or assignee', () => {
      const minimalTask = {
        gid: '9999',
        name: 'Minimal task',
        completed: false,
        notes: '',
        permalink_url: 'https://app.asana.com/0/0/9999',
      }
      const envelope = normalizeAsanaTask(minimalTask)
      expect(envelope.status).to.equal('Open')
      expect(envelope.assignee).to.equal(null)
      expect(envelope.labels).to.deep.equal([])
      expect(envelope.project_key).to.equal('ASANA')
    })

    it('builds ticket description with external issue context', () => {
      const envelope = normalizeAsanaTaskToEnvelope(sampleTask)
      const description = buildAsanaTicketDescription(envelope)

      expect(description).to.include('Implement the login page with OAuth support.')
      expect(description).to.include('## External Issue Context')
      expect(description).to.include('Source: asana')
      expect(description).to.include('External key: 1234567890')
    })

    it('builds metadata for traceability', () => {
      const envelope = normalizeAsanaTaskToEnvelope(sampleTask)
      const metadata = buildAsanaMetadata(envelope)

      expect(metadata.external_source).to.equal('asana')
      expect(metadata.external_key).to.equal('1234567890')
      expect(metadata.external_id).to.equal('1234567890')
      expect(metadata.external_url).to.equal('https://app.asana.com/0/proj-1/1234567890')
    })

    it('builds spawn context message', () => {
      const envelope = normalizeAsanaTaskToEnvelope(sampleTask)
      const message = buildAsanaSpawnContextMessage(envelope)

      expect(message).to.include('External issue source: asana')
      expect(message).to.include('External issue key: 1234567890')
    })

    it('builds spawn context message with additional message', () => {
      const envelope = normalizeAsanaTaskToEnvelope(sampleTask)
      const message = buildAsanaSpawnContextMessage(envelope, 'Focus on tests')

      expect(message).to.include('External issue source: asana')
      expect(message).to.include('Focus on tests')
    })

    it('builds choice command string', () => {
      expect(buildAsanaTaskChoiceCommand('1234567890')).to.equal(
        'prlt work asana --task 1234567890 --json'
      )
      expect(buildAsanaTaskChoiceCommand('1234567890', 'my-project')).to.equal(
        'prlt work asana --task 1234567890 --json -P my-project'
      )
    })
  })

  describe('AsanaIssueAdapter', () => {
    it('normalizes an Asana task via the adapter', () => {
      const adapter = new AsanaIssueAdapter()
      expect(adapter.source).to.equal('asana')

      const envelope = adapter.normalize({
        gid: '111',
        name: 'Adapter test',
        completed: false,
        notes: 'Testing adapter',
        permalink_url: 'https://app.asana.com/0/0/111',
      })

      expect(envelope.source).to.equal('asana')
      expect(envelope.external_id).to.equal('111')
      expect(envelope.title).to.equal('Adapter test')
    })

    it('fetches by key using configured fetcher', async () => {
      const adapter = new AsanaIssueAdapter({
        fetchByKey: async (key: string) => ({
          gid: key,
          name: 'Fetched task',
          completed: false,
          notes: '',
          permalink_url: `https://app.asana.com/0/0/${key}`,
        }),
      })

      const envelope = await adapter.fetchByKey('222')
      expect(envelope.external_id).to.equal('222')
      expect(envelope.title).to.equal('Fetched task')
    })

    it('fetches by query using configured fetcher', async () => {
      const adapter = new AsanaIssueAdapter({
        fetchByQuery: async () => [
          {
            gid: '333',
            name: 'Query result 1',
            completed: false,
            notes: '',
            permalink_url: 'https://app.asana.com/0/0/333',
          },
          {
            gid: '444',
            name: 'Query result 2',
            completed: false,
            notes: '',
            permalink_url: 'https://app.asana.com/0/0/444',
          },
        ],
      })

      const envelopes = await adapter.fetchByQuery({})
      expect(envelopes).to.have.lengthOf(2)
      expect(envelopes[0].external_id).to.equal('333')
      expect(envelopes[1].external_id).to.equal('444')
    })
  })
})
