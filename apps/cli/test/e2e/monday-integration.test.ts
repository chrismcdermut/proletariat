import { expect } from 'chai'
import { SqliteDatabase } from '../../src/lib/database/sqlite.js'
import {
  createTestEnvironment,
  cleanupTestEnvironment,
  setupProductionSchema,
  createHQConfig,
  createPMODirectories,
  type TestEnvironment,
} from './test-helpers.js'
import {
  isMondayConfigured,
  loadMondayConfig,
  saveMondayApiToken,
  saveMondayBoard,
  saveMondayAccountName,
  clearMondayConfig,
  getMondayApiToken,
  getMondayBoardId,
} from '../../src/lib/monday/config.js'
import { MondayMapper } from '../../src/lib/monday/mapper.js'
import { MondaySync } from '../../src/lib/monday/sync.js'
import type { Ticket } from '../../src/lib/pmo/types.js'
import type { MondayClient } from '../../src/lib/monday/client.js'

/**
 * Monday integration tests focused on local config/mapping/sync behavior.
 */
describe('Monday Integration', () => {
  let env: TestEnvironment
  let db: SqliteDatabase

  beforeEach(() => {
    env = createTestEnvironment('monday-integration-')
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
    delete process.env.MONDAY_API_TOKEN
    delete process.env.PRLT_MONDAY_API_TOKEN
    delete process.env.MONDAY_BOARD_ID
    delete process.env.PRLT_MONDAY_BOARD_ID

    if (db) db.close()
    cleanupTestEnvironment(env)
  })

  describe('Monday Config', () => {
    it('should report not configured without API token', () => {
      expect(isMondayConfigured(db)).to.be.false
    })

    it('should save and load configuration values', () => {
      saveMondayApiToken(db, 'monday_token_123')
      saveMondayBoard(db, '123456', 'Engineering Board')
      saveMondayAccountName(db, 'Acme Inc')

      const config = loadMondayConfig(db)
      expect(config).to.not.be.null
      expect(config!.apiToken).to.equal('monday_token_123')
      expect(config!.boardId).to.equal('123456')
      expect(config!.boardName).to.equal('Engineering Board')
      expect(config!.accountName).to.equal('Acme Inc')
    })

    it('should clear all config keys', () => {
      saveMondayApiToken(db, 'monday_token_123')
      saveMondayBoard(db, '123456', 'Engineering Board')
      saveMondayAccountName(db, 'Acme Inc')

      clearMondayConfig(db)
      expect(isMondayConfigured(db)).to.be.false
      expect(loadMondayConfig(db)).to.be.null
    })

    it('should prefer env vars for api token and board id', () => {
      saveMondayApiToken(db, 'stored_token')
      saveMondayBoard(db, 'stored_board', 'Stored Board')

      process.env.PRLT_MONDAY_API_TOKEN = 'env_token'
      process.env.MONDAY_BOARD_ID = 'env_board'

      expect(getMondayApiToken(db)).to.equal('env_token')
      expect(getMondayBoardId(db)).to.equal('env_board')
    })
  })

  describe('MondayMapper', () => {
    function insertStubTicket(ticketId: string): void {
      db.exec(`INSERT OR IGNORE INTO pmo_projects (id, name, status) VALUES ('proj-test', 'Test Project', 'active')`)
      db.exec(`INSERT OR IGNORE INTO pmo_tickets (id, project_id, title, status) VALUES ('${ticketId}', 'proj-test', 'Stub ${ticketId}', 'backlog')`)
    }

    it('should create and fetch mapping records', () => {
      insertStubTicket('TKT-100')
      const mapper = new MondayMapper(db)

      mapper.createOrUpdateMapping({
        pmoTicketId: 'TKT-100',
        mondayBoardId: '12345',
        mondayItemId: '98765',
        mondayItemName: 'TKT-100: Stub TKT-100',
        mondayItemUrl: 'https://monday.com/boards/12345/pulses/98765',
        syncDirection: 'outbound',
      })

      const byTicket = mapper.getByTicketId('TKT-100')
      expect(byTicket).to.not.be.null
      expect(byTicket!.mondayBoardId).to.equal('12345')
      expect(byTicket!.mondayItemId).to.equal('98765')

      const byItem = mapper.getByMondayItemId('98765')
      expect(byItem).to.not.be.null
      expect(byItem!.pmoTicketId).to.equal('TKT-100')

      expect(mapper.listMappings()).to.have.length(1)
    })
  })

  describe('MondaySync', () => {
    function insertTicket(ticketId: string, title: string): void {
      db.exec(`INSERT OR IGNORE INTO pmo_projects (id, name, status) VALUES ('proj-test', 'Test Project', 'active')`)
      db.exec(`
        INSERT OR REPLACE INTO pmo_tickets (id, project_id, title, status)
        VALUES ('${ticketId}', 'proj-test', '${title}', 'backlog')
      `)
    }

    it('should create a Monday item and mapping for an unmapped ticket', async () => {
      insertTicket('TKT-200', 'Implement sync')
      const mapper = new MondayMapper(db)

      const calls: string[] = []
      const fakeClient = {
        createItem: async (_boardId: string, itemName: string) => {
          calls.push(itemName)
          return {
            id: 'item-1',
            name: itemName,
            url: 'https://monday.com/item-1',
          }
        },
        updateItemName: async () => {},
      }

      const sync = new MondaySync(fakeClient as unknown as MondayClient, mapper)
      const ticket = {
        id: 'TKT-200',
        title: 'Implement sync',
      } as Ticket

      const result = await sync.syncTicket(ticket, 'board-1')
      expect(result.created).to.be.true
      expect(result.itemId).to.equal('item-1')
      expect(calls).to.deep.equal(['TKT-200: Implement sync'])

      const mapping = mapper.getByTicketId('TKT-200')
      expect(mapping).to.not.be.null
      expect(mapping!.mondayItemId).to.equal('item-1')
    })

    it('should update mapped item name when ticket title changes', async () => {
      insertTicket('TKT-201', 'Original title')
      const mapper = new MondayMapper(db)
      mapper.createOrUpdateMapping({
        pmoTicketId: 'TKT-201',
        mondayBoardId: 'board-1',
        mondayItemId: 'item-2',
        mondayItemName: 'TKT-201: Old title',
        mondayItemUrl: 'https://monday.com/item-2',
        syncDirection: 'outbound',
      })

      const updates: Array<{ boardId: string; itemId: string; name: string }> = []
      const fakeClient = {
        createItem: async () => ({ id: 'unused', name: 'unused' }),
        updateItemName: async (boardId: string, itemId: string, name: string) => {
          updates.push({ boardId, itemId, name })
        },
      }

      const sync = new MondaySync(fakeClient as unknown as MondayClient, mapper)
      const ticket = {
        id: 'TKT-201',
        title: 'Updated title',
      } as Ticket

      const result = await sync.syncTicket(ticket, 'board-1')
      expect(result.created).to.be.false
      expect(result.itemId).to.equal('item-2')
      expect(updates).to.deep.equal([
        { boardId: 'board-1', itemId: 'item-2', name: 'TKT-201: Updated title' },
      ])
    })
  })
})
