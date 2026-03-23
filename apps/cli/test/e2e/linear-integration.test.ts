import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import Database from 'better-sqlite3'
import {
  createTestEnvironment,
  cleanupTestEnvironment,
  setupProductionSchema,
  createHQConfig,
  createPMODirectories,
  type TestEnvironment,
} from './test-helpers.js'
import { LinearMapper } from '../../src/lib/linear/mapper.js'
import {
  isLinearConfigured,
  loadLinearConfig,
  saveLinearApiKey,
  saveLinearDefaultTeam,
  saveLinearOrganization,
  clearLinearConfig,
  getLinearApiKey,
} from '../../src/lib/linear/config.js'
import {
  LINEAR_STATE_TO_PMO_CATEGORY,
  LINEAR_PRIORITY_TO_PMO,
  PMO_PRIORITY_TO_LINEAR,
} from '../../src/lib/linear/types.js'
import type { LinearIssue } from '../../src/lib/linear/types.js'
import type { WorkflowStatus } from '../../src/lib/pmo/types.js'

/**
 * Linear Integration Tests
 *
 * Tests the Linear ↔ PMO integration layer including:
 * - Configuration storage
 * - Issue → ticket mapping
 * - Priority and state category mapping
 * - Mapping CRUD
 */
describe('Linear Integration', () => {
  let env: TestEnvironment
  let db: Database.Database

  beforeEach(() => {
    env = createTestEnvironment('linear-integration-')
    createHQConfig(env.proletariatDir)
    createPMODirectories(env.pmoPath)
    db = setupProductionSchema(env.dbPath, env.pmoPath)
    // Also create workspace_settings table (from workspace schema, not PMO schema)
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

  // ===========================================================================
  // Configuration Tests
  // ===========================================================================
  describe('Linear Config', () => {
    it('should report not configured when no API key is stored', () => {
      expect(isLinearConfigured(db)).to.be.false
    })

    it('should save and load API key', () => {
      saveLinearApiKey(db, 'lin_api_test123')
      expect(isLinearConfigured(db)).to.be.true

      const config = loadLinearConfig(db)
      expect(config).to.not.be.null
      expect(config!.apiKey).to.equal('lin_api_test123')
    })

    it('should save and load default team', () => {
      saveLinearApiKey(db, 'lin_api_test123')
      saveLinearDefaultTeam(db, 'team-id-1', 'ENG')

      const config = loadLinearConfig(db)
      expect(config!.defaultTeamId).to.equal('team-id-1')
      expect(config!.defaultTeamKey).to.equal('ENG')
    })

    it('should save and load organization name', () => {
      saveLinearApiKey(db, 'lin_api_test123')
      saveLinearOrganization(db, 'My Company')

      const config = loadLinearConfig(db)
      expect(config!.organizationName).to.equal('My Company')
    })

    it('should clear all config', () => {
      saveLinearApiKey(db, 'lin_api_test123')
      saveLinearDefaultTeam(db, 'team-id-1', 'ENG')
      saveLinearOrganization(db, 'My Company')

      clearLinearConfig(db)
      expect(isLinearConfigured(db)).to.be.false
      expect(loadLinearConfig(db)).to.be.null
    })

    it('should prefer environment variable over stored key', () => {
      saveLinearApiKey(db, 'lin_api_stored')
      process.env.LINEAR_API_KEY = 'lin_api_env'

      const key = getLinearApiKey(db)
      expect(key).to.equal('lin_api_env')

      delete process.env.LINEAR_API_KEY
    })

    it('should fall back to stored key when no env var', () => {
      delete process.env.LINEAR_API_KEY
      delete process.env.PRLT_LINEAR_API_KEY

      saveLinearApiKey(db, 'lin_api_stored')
      const key = getLinearApiKey(db)
      expect(key).to.equal('lin_api_stored')
    })

    it('should resolve API key from provider source apiKeyRef', () => {
      delete process.env.LINEAR_API_KEY
      delete process.env.PRLT_LINEAR_API_KEY

      // Configure a provider source with a custom apiKeyRef pointing to a workspace setting
      const sources = [{
        id: 'eng-linear',
        provider: 'linear',
        apiKeyRef: 'custom.linear_key',
        teamProjectId: 'ENG',
        prefix: 'ENG-',
      }]
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run(
        'work.provider_sources',
        JSON.stringify(sources),
      )
      // Store the key under the custom apiKeyRef
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run(
        'custom.linear_key',
        'lin_api_from_provider_source',
      )

      const key = getLinearApiKey(db)
      expect(key).to.equal('lin_api_from_provider_source')
    })

    it('should resolve API key from provider source env var apiKeyRef', () => {
      delete process.env.LINEAR_API_KEY
      delete process.env.PRLT_LINEAR_API_KEY

      // Configure a provider source with apiKeyRef pointing to an env var
      process.env.MY_CUSTOM_LINEAR_KEY = 'lin_api_custom_env'
      const sources = [{
        id: 'eng-linear',
        provider: 'linear',
        apiKeyRef: 'MY_CUSTOM_LINEAR_KEY',
        teamProjectId: 'ENG',
        prefix: 'ENG-',
      }]
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run(
        'work.provider_sources',
        JSON.stringify(sources),
      )

      const key = getLinearApiKey(db)
      expect(key).to.equal('lin_api_custom_env')

      delete process.env.MY_CUSTOM_LINEAR_KEY
    })

    it('should prefer provider source over legacy env var', () => {
      process.env.LINEAR_API_KEY = 'lin_api_legacy_env'

      // Configure provider source with workspace setting
      const sources = [{
        id: 'eng-linear',
        provider: 'linear',
        apiKeyRef: 'custom.linear_key',
        teamProjectId: 'ENG',
        prefix: 'ENG-',
      }]
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run(
        'work.provider_sources',
        JSON.stringify(sources),
      )
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run(
        'custom.linear_key',
        'lin_api_provider_source',
      )

      const key = getLinearApiKey(db)
      expect(key).to.equal('lin_api_provider_source')

      delete process.env.LINEAR_API_KEY
    })

    it('should fall back to legacy env var when provider source has no key', () => {
      process.env.PRLT_LINEAR_API_KEY = 'lin_api_legacy_fallback'

      // Configure provider source with a ref that doesn't resolve
      const sources = [{
        id: 'eng-linear',
        provider: 'linear',
        apiKeyRef: 'nonexistent.key',
        teamProjectId: 'ENG',
        prefix: 'ENG-',
      }]
      db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run(
        'work.provider_sources',
        JSON.stringify(sources),
      )

      const key = getLinearApiKey(db)
      expect(key).to.equal('lin_api_legacy_fallback')

      delete process.env.PRLT_LINEAR_API_KEY
    })
  })

  // ===========================================================================
  // Type Mapping Tests
  // ===========================================================================
  describe('Type Mappings', () => {
    it('should map all Linear state types to PMO categories', () => {
      expect(LINEAR_STATE_TO_PMO_CATEGORY.triage).to.equal('triage')
      expect(LINEAR_STATE_TO_PMO_CATEGORY.backlog).to.equal('backlog')
      expect(LINEAR_STATE_TO_PMO_CATEGORY.unstarted).to.equal('unstarted')
      expect(LINEAR_STATE_TO_PMO_CATEGORY.started).to.equal('started')
      expect(LINEAR_STATE_TO_PMO_CATEGORY.completed).to.equal('completed')
      expect(LINEAR_STATE_TO_PMO_CATEGORY.canceled).to.equal('canceled')
    })

    it('should map Linear priorities to PMO priorities', () => {
      expect(LINEAR_PRIORITY_TO_PMO[0]).to.equal('P3')   // No priority → Low
      expect(LINEAR_PRIORITY_TO_PMO[1]).to.equal('P0')   // Urgent → Critical
      expect(LINEAR_PRIORITY_TO_PMO[2]).to.equal('P1')   // High → High
      expect(LINEAR_PRIORITY_TO_PMO[3]).to.equal('P2')   // Medium → Medium
      expect(LINEAR_PRIORITY_TO_PMO[4]).to.equal('P3')   // Low → Low
    })

    it('should map PMO priorities back to Linear', () => {
      expect(PMO_PRIORITY_TO_LINEAR.P0).to.equal(1)
      expect(PMO_PRIORITY_TO_LINEAR.P1).to.equal(2)
      expect(PMO_PRIORITY_TO_LINEAR.P2).to.equal(3)
      expect(PMO_PRIORITY_TO_LINEAR.P3).to.equal(4)
    })
  })

  // ===========================================================================
  // Mapper Tests
  // ===========================================================================
  describe('LinearMapper', () => {
    let mapper: LinearMapper

    const mockStatuses: WorkflowStatus[] = [
      { id: 'status-backlog', workflowId: 'wf-1', name: 'Backlog', category: 'backlog', position: 0, isDefault: true, createdAt: new Date() },
      { id: 'status-todo', workflowId: 'wf-1', name: 'Todo', category: 'unstarted', position: 1, createdAt: new Date() },
      { id: 'status-progress', workflowId: 'wf-1', name: 'In Progress', category: 'started', position: 2, createdAt: new Date() },
      { id: 'status-done', workflowId: 'wf-1', name: 'Done', category: 'completed', position: 3, createdAt: new Date() },
    ]

    function createMockIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
      return {
        id: 'issue-1',
        identifier: 'ENG-123',
        title: 'Fix login bug',
        description: 'Users cannot log in with SSO',
        priority: 2,  // High
        state: {
          id: 'state-1',
          name: 'In Progress',
          type: 'started',
        },
        team: {
          id: 'team-1',
          key: 'ENG',
          name: 'Engineering',
        },
        labels: [
          { id: 'label-1', name: 'bug', color: '#ff0000' },
        ],
        url: 'https://linear.app/my-company/issue/ENG-123',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
        ...overrides,
      }
    }

    beforeEach(() => {
      mapper = new LinearMapper(db)
    })

    describe('issueToTicketInput', () => {
      it('should map a Linear issue to a ticket creation input', () => {
        const issue = createMockIssue()
        const input = mapper.issueToTicketInput(issue, mockStatuses)

        expect(input.title).to.equal('Fix login bug')
        expect(input.description).to.include('Users cannot log in with SSO')
        expect(input.description).to.include('ENG-123')
        expect(input.priority).to.equal('P1')  // High → P1
        expect(input.statusId).to.equal('status-progress')  // started → In Progress
        expect(input.labels).to.include('bug')
        expect(input.metadata).to.include({
          'linear.issue_id': 'issue-1',
          'linear.identifier': 'ENG-123',
          'linear.team': 'ENG',
        })
      })

      it('should map backlog state correctly', () => {
        const issue = createMockIssue({
          state: { id: 's-1', name: 'Backlog', type: 'backlog' },
        })
        const input = mapper.issueToTicketInput(issue, mockStatuses)
        expect(input.statusId).to.equal('status-backlog')
      })

      it('should map urgent priority to P0', () => {
        const issue = createMockIssue({ priority: 1 })
        const input = mapper.issueToTicketInput(issue, mockStatuses)
        expect(input.priority).to.equal('P0')
      })

      it('should map no-priority to P3', () => {
        const issue = createMockIssue({ priority: 0 })
        const input = mapper.issueToTicketInput(issue, mockStatuses)
        expect(input.priority).to.equal('P3')
      })

      it('should fall back to default status when category not found', () => {
        const issue = createMockIssue({
          state: { id: 's-1', name: 'Custom', type: 'triage' },
        })
        // Mock statuses don't have triage, should fall back to isDefault
        const input = mapper.issueToTicketInput(issue, mockStatuses)
        expect(input.statusId).to.equal('status-backlog')  // isDefault=true
      })

      it('should include Linear URL in description', () => {
        const issue = createMockIssue()
        const input = mapper.issueToTicketInput(issue, mockStatuses)
        expect(input.description).to.include('https://linear.app/my-company/issue/ENG-123')
      })

      it('should handle issue with no description', () => {
        const issue = createMockIssue({ description: undefined })
        const input = mapper.issueToTicketInput(issue, mockStatuses)
        expect(input.description).to.include('ENG-123')
      })

      it('should map multiple labels', () => {
        const issue = createMockIssue({
          labels: [
            { id: 'l-1', name: 'bug', color: '#ff0000' },
            { id: 'l-2', name: 'critical', color: '#ff0000' },
          ],
        })
        const input = mapper.issueToTicketInput(issue, mockStatuses)
        expect(input.labels).to.deep.equal(['bug', 'critical'])
      })

      it('should map assignee name when present', () => {
        const issue = createMockIssue({
          assignee: { id: 'user-1', name: 'Jane Doe', email: 'jane@example.com' },
        })
        const input = mapper.issueToTicketInput(issue, mockStatuses)
        expect(input.assignee).to.equal('Jane Doe')
      })

      it('should leave assignee undefined when not present', () => {
        const issue = createMockIssue({ assignee: undefined })
        const input = mapper.issueToTicketInput(issue, mockStatuses)
        expect(input.assignee).to.be.undefined
      })

      it('should persist estimate in metadata when available', () => {
        const issue = createMockIssue({ estimate: 5 })
        const input = mapper.issueToTicketInput(issue, mockStatuses)
        expect(input.metadata!['linear.estimate']).to.equal('5')
      })

      it('should omit estimate from metadata when not available', () => {
        const issue = createMockIssue({ estimate: undefined })
        const input = mapper.issueToTicketInput(issue, mockStatuses)
        expect(input.metadata!['linear.estimate']).to.be.undefined
      })

      it('should persist due date in metadata when available', () => {
        const issue = createMockIssue({ dueDate: '2025-06-15' })
        const input = mapper.issueToTicketInput(issue, mockStatuses)
        expect(input.metadata!['linear.due_date']).to.equal('2025-06-15')
      })

      it('should omit due date from metadata when not available', () => {
        const issue = createMockIssue({ dueDate: undefined })
        const input = mapper.issueToTicketInput(issue, mockStatuses)
        expect(input.metadata!['linear.due_date']).to.be.undefined
      })
    })

    describe('Mapping CRUD', () => {
      // Insert stub project + ticket rows to satisfy foreign key constraints
      function insertStubTicket(ticketId: string): void {
        db.exec(`INSERT OR IGNORE INTO pmo_projects (id, name, status) VALUES ('proj-test', 'Test Project', 'active')`)
        db.exec(`INSERT OR IGNORE INTO pmo_tickets (id, project_id, title, status) VALUES ('${ticketId}', 'proj-test', 'Stub ${ticketId}', 'backlog')`)
      }

      it('should create and retrieve a mapping by ticket ID', () => {
        insertStubTicket('TKT-001')
        mapper.createMapping({
          pmoTicketId: 'TKT-001',
          linearIssueId: 'lin-id-1',
          linearIdentifier: 'ENG-100',
          linearTeamKey: 'ENG',
          linearUrl: 'https://linear.app/issue/ENG-100',
          syncDirection: 'inbound',
          createdAt: new Date(),
        })

        const result = mapper.getByTicketId('TKT-001')
        expect(result).to.not.be.null
        expect(result!.linearIdentifier).to.equal('ENG-100')
        expect(result!.linearIssueId).to.equal('lin-id-1')
        expect(result!.linearTeamKey).to.equal('ENG')
        expect(result!.syncDirection).to.equal('inbound')
      })

      it('should look up by Linear issue ID', () => {
        insertStubTicket('TKT-001')
        mapper.createMapping({
          pmoTicketId: 'TKT-001',
          linearIssueId: 'lin-id-1',
          linearIdentifier: 'ENG-100',
          linearTeamKey: 'ENG',
          linearUrl: 'https://linear.app/issue/ENG-100',
          syncDirection: 'inbound',
          createdAt: new Date(),
        })

        const result = mapper.getByLinearId('lin-id-1')
        expect(result).to.not.be.null
        expect(result!.pmoTicketId).to.equal('TKT-001')
      })

      it('should look up by Linear identifier', () => {
        insertStubTicket('TKT-002')
        mapper.createMapping({
          pmoTicketId: 'TKT-002',
          linearIssueId: 'lin-id-2',
          linearIdentifier: 'ENG-200',
          linearTeamKey: 'ENG',
          linearUrl: 'https://linear.app/issue/ENG-200',
          syncDirection: 'inbound',
          createdAt: new Date(),
        })

        const result = mapper.getByIdentifier('ENG-200')
        expect(result).to.not.be.null
        expect(result!.pmoTicketId).to.equal('TKT-002')
      })

      it('should return null for non-existent mappings', () => {
        expect(mapper.getByTicketId('NONEXISTENT')).to.be.null
        expect(mapper.getByLinearId('NONEXISTENT')).to.be.null
        expect(mapper.getByIdentifier('NONEXISTENT')).to.be.null
      })

      it('should list all mappings', () => {
        insertStubTicket('TKT-001')
        insertStubTicket('TKT-002')
        mapper.createMapping({
          pmoTicketId: 'TKT-001',
          linearIssueId: 'lin-1',
          linearIdentifier: 'ENG-1',
          linearTeamKey: 'ENG',
          linearUrl: 'https://linear.app/issue/ENG-1',
          syncDirection: 'inbound',
          createdAt: new Date(),
        })
        mapper.createMapping({
          pmoTicketId: 'TKT-002',
          linearIssueId: 'lin-2',
          linearIdentifier: 'ENG-2',
          linearTeamKey: 'ENG',
          linearUrl: 'https://linear.app/issue/ENG-2',
          syncDirection: 'inbound',
          createdAt: new Date(),
        })

        const mappings = mapper.listMappings()
        expect(mappings).to.have.lengthOf(2)
      })

      it('should delete a mapping', () => {
        insertStubTicket('TKT-001')
        mapper.createMapping({
          pmoTicketId: 'TKT-001',
          linearIssueId: 'lin-1',
          linearIdentifier: 'ENG-1',
          linearTeamKey: 'ENG',
          linearUrl: 'https://linear.app/issue/ENG-1',
          syncDirection: 'inbound',
          createdAt: new Date(),
        })

        mapper.deleteMapping('TKT-001')
        expect(mapper.getByTicketId('TKT-001')).to.be.null
      })

      it('should update sync timestamp', () => {
        insertStubTicket('TKT-001')
        mapper.createMapping({
          pmoTicketId: 'TKT-001',
          linearIssueId: 'lin-1',
          linearIdentifier: 'ENG-1',
          linearTeamKey: 'ENG',
          linearUrl: 'https://linear.app/issue/ENG-1',
          syncDirection: 'inbound',
          createdAt: new Date(),
        })

        mapper.updateSyncTimestamp('TKT-001')
        const mapping = mapper.getByTicketId('TKT-001')
        expect(mapping!.lastSyncedAt).to.not.be.undefined
      })

      it('should enforce unique Linear issue ID', () => {
        insertStubTicket('TKT-001')
        insertStubTicket('TKT-002')
        mapper.createMapping({
          pmoTicketId: 'TKT-001',
          linearIssueId: 'lin-1',
          linearIdentifier: 'ENG-1',
          linearTeamKey: 'ENG',
          linearUrl: 'https://linear.app/issue/ENG-1',
          syncDirection: 'inbound',
          createdAt: new Date(),
        })

        expect(() => {
          mapper.createMapping({
            pmoTicketId: 'TKT-002',
            linearIssueId: 'lin-1',  // Same Linear ID
            linearIdentifier: 'ENG-1',
            linearTeamKey: 'ENG',
            linearUrl: 'https://linear.app/issue/ENG-1',
            syncDirection: 'inbound',
            createdAt: new Date(),
          })
        }).to.throw()
      })

      it('should create outbound mapping for Linear-created tickets', () => {
        insertStubTicket('TKT-003')
        mapper.createMapping({
          pmoTicketId: 'TKT-003',
          linearIssueId: 'lin-outbound-1',
          linearIdentifier: 'PRLT-500',
          linearTeamKey: 'PRLT',
          linearUrl: 'https://linear.app/proletariat/issue/PRLT-500',
          syncDirection: 'outbound',
          createdAt: new Date(),
        })

        const result = mapper.getByTicketId('TKT-003')
        expect(result).to.not.be.null
        expect(result!.linearIdentifier).to.equal('PRLT-500')
        expect(result!.linearTeamKey).to.equal('PRLT')
        expect(result!.syncDirection).to.equal('outbound')

        // Should also be retrievable by Linear ID
        const byLinearId = mapper.getByLinearId('lin-outbound-1')
        expect(byLinearId).to.not.be.null
        expect(byLinearId!.pmoTicketId).to.equal('TKT-003')
      })

      it('should create outbound mapping retrievable by identifier', () => {
        insertStubTicket('TKT-004')
        mapper.createMapping({
          pmoTicketId: 'TKT-004',
          linearIssueId: 'lin-outbound-2',
          linearIdentifier: 'PRLT-501',
          linearTeamKey: 'PRLT',
          linearUrl: 'https://linear.app/proletariat/issue/PRLT-501',
          syncDirection: 'outbound',
          createdAt: new Date(),
        })

        const result = mapper.getByIdentifier('PRLT-501')
        expect(result).to.not.be.null
        expect(result!.pmoTicketId).to.equal('TKT-004')
        expect(result!.syncDirection).to.equal('outbound')
      })
    })
  })
})
