import { expect } from 'chai'
import { SqliteDatabase } from '../../src/lib/database/sqlite.js'
import {
  createFastTestEnvironment,
  setupProductionSchemaOnDb,
  createHQConfig,
  createPMODirectories,
  type FastTestEnvironment,
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
  getAsanaTaskByGid,
  listAsanaTasks,
  importAsanaTaskToPmo,
} from '../../src/lib/external-issues/asana.js'
import { AsanaIssueAdapter } from '../../src/lib/external-issues/adapters.js'
import { ExternalIssueAdapterError } from '../../src/lib/external-issues/types.js'

describe('Asana Integration', () => {
  let env: FastTestEnvironment
  let db: SqliteDatabase

  before(() => {
    env = createFastTestEnvironment('asana-integration-', (db, pmoPath) => {
      setupProductionSchemaOnDb(db, pmoPath)
      db.exec(`
        CREATE TABLE IF NOT EXISTS workspace_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `)
    })
    db = env.db
    createHQConfig(env.proletariatDir)
    createPMODirectories(env.pmoPath)
  })

  beforeEach(() => {
    env.savepoint()
  })

  afterEach(() => {
    env.rollback()
  })

  after(() => {
    env.cleanup()
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

  describe('getAsanaTaskByGid', () => {
    const savedEnv: Record<string, string | undefined> = {}

    before(() => {
      savedEnv.PRLT_ASANA_ACCESS_TOKEN = process.env.PRLT_ASANA_ACCESS_TOKEN
      savedEnv.ASANA_ACCESS_TOKEN = process.env.ASANA_ACCESS_TOKEN
    })

    beforeEach(() => {
      delete process.env.PRLT_ASANA_ACCESS_TOKEN
      delete process.env.ASANA_ACCESS_TOKEN
    })

    after(() => {
      for (const [key, value] of Object.entries(savedEnv)) {
        if (value !== undefined) process.env[key] = value
        else delete process.env[key]
      }
    })

    it('throws MISSING_CONFIG when access token is missing', async () => {
      try {
        await getAsanaTaskByGid({}, '12345')
        expect.fail('expected to throw')
      } catch (error) {
        expect(error).to.be.instanceOf(ExternalIssueAdapterError)
        expect((error as ExternalIssueAdapterError).code).to.equal('MISSING_CONFIG')
      }
    })

    it('throws AUTH_FAILED for 401 responses', async () => {
      const fetchImpl = async () => new Response('{}', { status: 401 })
      try {
        await getAsanaTaskByGid(
          { accessToken: 'bad-token' },
          '12345',
          { fetchImpl },
        )
        expect.fail('expected to throw')
      } catch (error) {
        expect((error as ExternalIssueAdapterError).code).to.equal('AUTH_FAILED')
      }
    })

    it('returns null for 404 responses', async () => {
      const fetchImpl = async () => new Response('{}', { status: 404 })
      const result = await getAsanaTaskByGid(
        { accessToken: 'tok' },
        '99999',
        { fetchImpl },
      )
      expect(result).to.equal(null)
    })

    it('throws REQUEST_FAILED for server errors', async () => {
      const fetchImpl = async () => new Response('{}', { status: 500 })
      try {
        await getAsanaTaskByGid(
          { accessToken: 'tok' },
          '12345',
          { fetchImpl },
        )
        expect.fail('expected to throw')
      } catch (error) {
        expect((error as ExternalIssueAdapterError).code).to.equal('REQUEST_FAILED')
      }
    })

    it('throws REQUEST_FAILED for API errors in response body', async () => {
      const fetchImpl = async () => new Response(
        JSON.stringify({ errors: [{ message: 'Something went wrong' }] }),
        { status: 200 },
      )
      try {
        await getAsanaTaskByGid(
          { accessToken: 'tok' },
          '12345',
          { fetchImpl },
        )
        expect.fail('expected to throw')
      } catch (error) {
        expect((error as ExternalIssueAdapterError).code).to.equal('REQUEST_FAILED')
        expect((error as ExternalIssueAdapterError).message).to.include('Something went wrong')
      }
    })

    it('fetches and normalizes a task by GID', async () => {
      const sampleTask = {
        gid: '1234567890',
        name: 'Build login page',
        completed: false,
        notes: 'Implement the login page.',
        assignee: { gid: 'user-1', name: 'Alice' },
        tags: [{ gid: 'tag-1', name: 'frontend' }],
        memberships: [{
          project: { gid: 'proj-1', name: 'Web App' },
          section: { gid: 'sec-1', name: 'In Progress' },
        }],
        permalink_url: 'https://app.asana.com/0/proj-1/1234567890',
      }
      const fetchImpl = async () => new Response(
        JSON.stringify({ data: sampleTask }),
        { status: 200 },
      )

      const result = await getAsanaTaskByGid(
        { accessToken: 'tok' },
        '1234567890',
        { fetchImpl },
      )

      expect(result).to.not.equal(null)
      expect(result?.source.name).to.equal('asana')
      expect(result?.source.externalId).to.equal('1234567890')
      expect(result?.title).to.equal('Build login page')
      expect(result?.status).to.equal('In Progress')
    })

    it('returns null when data is missing from response', async () => {
      const fetchImpl = async () => new Response(
        JSON.stringify({}),
        { status: 200 },
      )

      const result = await getAsanaTaskByGid(
        { accessToken: 'tok' },
        '12345',
        { fetchImpl },
      )
      expect(result).to.equal(null)
    })
  })

  describe('listAsanaTasks', () => {
    const savedEnv: Record<string, string | undefined> = {}

    before(() => {
      savedEnv.PRLT_ASANA_ACCESS_TOKEN = process.env.PRLT_ASANA_ACCESS_TOKEN
      savedEnv.ASANA_ACCESS_TOKEN = process.env.ASANA_ACCESS_TOKEN
      savedEnv.PRLT_ASANA_PROJECT_GID = process.env.PRLT_ASANA_PROJECT_GID
    })

    beforeEach(() => {
      delete process.env.PRLT_ASANA_ACCESS_TOKEN
      delete process.env.ASANA_ACCESS_TOKEN
      delete process.env.PRLT_ASANA_PROJECT_GID
    })

    after(() => {
      for (const [key, value] of Object.entries(savedEnv)) {
        if (value !== undefined) process.env[key] = value
        else delete process.env[key]
      }
    })

    it('throws MISSING_CONFIG when access token is missing', async () => {
      try {
        await listAsanaTasks({})
        expect.fail('expected to throw')
      } catch (error) {
        expect(error).to.be.instanceOf(ExternalIssueAdapterError)
        expect((error as ExternalIssueAdapterError).code).to.equal('MISSING_CONFIG')
      }
    })

    it('throws MISSING_CONFIG when project GID is missing', async () => {
      try {
        await listAsanaTasks({ accessToken: 'tok' })
        expect.fail('expected to throw')
      } catch (error) {
        expect(error).to.be.instanceOf(ExternalIssueAdapterError)
        expect((error as ExternalIssueAdapterError).code).to.equal('MISSING_CONFIG')
      }
    })

    it('throws AUTH_FAILED for 401 responses', async () => {
      const fetchImpl = async () => new Response('{}', { status: 401 })
      try {
        await listAsanaTasks(
          { accessToken: 'bad-token', projectGid: 'proj-1' },
          { fetchImpl },
        )
        expect.fail('expected to throw')
      } catch (error) {
        expect((error as ExternalIssueAdapterError).code).to.equal('AUTH_FAILED')
      }
    })

    it('fetches and normalizes tasks from a project', async () => {
      const tasks = [
        {
          gid: '111',
          name: 'Task one',
          completed: false,
          notes: 'First task',
          permalink_url: 'https://app.asana.com/0/0/111',
        },
        {
          gid: '222',
          name: 'Task two',
          completed: true,
          notes: 'Second task',
          permalink_url: 'https://app.asana.com/0/0/222',
        },
      ]
      const fetchImpl = async () => new Response(
        JSON.stringify({ data: tasks }),
        { status: 200 },
      )

      const result = await listAsanaTasks(
        { accessToken: 'tok', projectGid: 'proj-1' },
        { fetchImpl },
      )

      expect(result).to.have.lengthOf(2)
      expect(result[0].source.externalId).to.equal('111')
      expect(result[0].title).to.equal('Task one')
      expect(result[1].source.externalId).to.equal('222')
      expect(result[1].status).to.equal('Completed')
    })

    it('throws BAD_PAYLOAD when data is not an array', async () => {
      const fetchImpl = async () => new Response(
        JSON.stringify({ data: 'not-an-array' }),
        { status: 200 },
      )
      try {
        await listAsanaTasks(
          { accessToken: 'tok', projectGid: 'proj-1' },
          { fetchImpl },
        )
        expect.fail('expected to throw')
      } catch (error) {
        expect((error as ExternalIssueAdapterError).code).to.equal('BAD_PAYLOAD')
      }
    })
  })

  describe('importAsanaTaskToPmo', () => {
    const sampleTask = {
      gid: '1234567890',
      name: 'Build login page',
      completed: false,
      notes: 'Implement the login page.',
      assignee: { gid: 'user-1', name: 'Alice' },
      tags: [{ gid: 'tag-1', name: 'frontend' }],
      memberships: [{
        project: { gid: 'proj-1', name: 'Web App' },
        section: { gid: 'sec-1', name: 'In Progress' },
      }],
      permalink_url: 'https://app.asana.com/0/proj-1/1234567890',
    }

    function makeEnvelope() {
      return normalizeAsanaTaskToEnvelope(sampleTask)
    }

    it('creates a new PMO ticket when none exists', async () => {
      const createdTicket = { id: 'TKT-001' }
      const storage = {
        listTickets: async () => [],
        createTicket: async (_projectId: string, input: Record<string, unknown>) => {
          expect(input.title).to.equal('Build login page')
          expect((input.metadata as Record<string, string>).external_source).to.equal('asana')
          expect((input.metadata as Record<string, string>).external_key).to.equal('1234567890')
          return createdTicket
        },
        updateTicket: async () => { throw new Error('should not be called') },
      }

      const result = await importAsanaTaskToPmo(storage, 'PROJ-001', makeEnvelope())
      expect(result.ticketId).to.equal('TKT-001')
      expect(result.created).to.equal(true)
    })

    it('updates existing PMO ticket matched by external_key', async () => {
      const existingTicket = {
        id: 'TKT-002',
        metadata: { external_source: 'asana', external_key: '1234567890', external_id: '1234567890' },
      }
      const storage = {
        listTickets: async () => [existingTicket],
        createTicket: async () => { throw new Error('should not be called') },
        updateTicket: async (ticketId: string) => {
          expect(ticketId).to.equal('TKT-002')
          return { id: ticketId }
        },
      }

      const result = await importAsanaTaskToPmo(storage, 'PROJ-001', makeEnvelope())
      expect(result.ticketId).to.equal('TKT-002')
      expect(result.created).to.equal(false)
    })

    it('does not match tickets from different sources', async () => {
      const linearTicket = {
        id: 'TKT-004',
        metadata: { external_source: 'linear', external_key: '1234567890' },
      }
      const createdTicket = { id: 'TKT-005' }
      const storage = {
        listTickets: async () => [linearTicket],
        createTicket: async () => createdTicket,
        updateTicket: async () => { throw new Error('should not be called') },
      }

      const result = await importAsanaTaskToPmo(storage, 'PROJ-001', makeEnvelope())
      expect(result.ticketId).to.equal('TKT-005')
      expect(result.created).to.equal(true)
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
