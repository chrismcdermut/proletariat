import { expect } from 'chai'
import Database from 'better-sqlite3'
import {
  createTestEnvironment,
  cleanupTestEnvironment,
  createHQConfig,
  createPMODirectories,
  setupProductionSchema,
  addWorkspaceTables,
  createTestProject,
  createTestTicket,
  execProduction as exec,
  extractJson,
  type TestEnvironment,
} from './test-helpers.js'

interface JsonOutput {
  type: string
  error?: { code: string; message: string }
  prompt?: {
    type: string
    message: string
    choices: Array<{ name: string; value: string; command?: string }>
  }
  result?: {
    activeSource?: { provider: string; context: string | null; ref: string } | null
    registeredSources?: Array<{ provider: string; context: string | null; ref: string }>
  }
}

describe('work source', () => {
  let env: TestEnvironment
  let db: Database.Database

  beforeEach(() => {
    env = createTestEnvironment('work-source-')
    createHQConfig(env.proletariatDir)
    createPMODirectories(env.pmoPath)

    db = setupProductionSchema(env.dbPath, env.pmoPath)
    addWorkspaceTables(db, { type: 'hq', workspaceName: 'test-hq', hasPmo: true })
    createTestProject(db, { id: 'test-project', name: 'Test Project' })
    createTestTicket(db, 'test-project', {
      id: 'TKT-020',
      title: 'Spawn ticket',
      status: 'Backlog',
      statusId: 'default-backlog',
    })
  })

  afterEach(() => {
    if (db) db.close()
    cleanupTestEnvironment(env)
  })

  it('shows current active source and provider context', () => {
    const output = exec('work source --json')
    const json = extractJson<JsonOutput>(output)

    expect(json).to.not.equal(null)
    expect(json!.type).to.equal('success')
    expect(json!.result?.activeSource).to.equal(null)
    expect(json!.result?.registeredSources?.map((source) => source.ref)).to.deep.equal(['pmo'])
  })

  it('persists active source with provider context', () => {
    const setOutput = exec('work source set linear:PRO --json')
    const setJson = extractJson<JsonOutput>(setOutput)
    expect(setJson).to.not.equal(null)
    expect(setJson!.type).to.equal('success')
    expect(setJson!.result?.activeSource?.provider).to.equal('linear')
    expect(setJson!.result?.activeSource?.context).to.equal('PRO')
    expect(setJson!.result?.activeSource?.ref).to.equal('linear:PRO')

    const row = db.prepare(`
      SELECT value FROM workspace_settings WHERE key = 'work.active_source'
    `).get() as { value: string } | undefined

    expect(row?.value).to.equal('linear:PRO')
  })

  it('uses persisted active source in work spawn when --from is omitted', () => {
    exec('work source set linear:PRO --json')

    const output = exec('work spawn -P test-project --json')
    const json = extractJson<JsonOutput>(output)

    expect(json).to.not.equal(null)
    expect(json!.type).to.equal('error')
    expect(json!.error?.code).to.equal('LINEAR_NOT_CONFIGURED')
  })

  it('work spawn --from overrides persisted active source', () => {
    exec('work source set linear:PRO --json')

    const output = exec('work spawn TKT-020 -P test-project --from pmo --json')
    const json = extractJson<JsonOutput>(output)

    expect(json).to.not.equal(null)
    expect(json!.type).to.not.equal('error')
  })

  it('prompts for source selection when multiple sources are registered and no active source exists', () => {
    db.prepare(`
      INSERT OR REPLACE INTO workspace_settings (key, value) VALUES ('linear.api_key', 'lin_api_test')
    `).run()
    db.prepare(`
      INSERT OR REPLACE INTO workspace_settings (key, value) VALUES ('linear.default_team_key', 'PRO')
    `).run()

    const output = exec('work spawn -P test-project --json')
    const json = extractJson<JsonOutput>(output)

    expect(json).to.not.equal(null)
    expect(json!.type).to.equal('prompt')
    expect(json!.prompt?.message).to.include('Select the default work source')
    const choiceValues = json!.prompt?.choices.map(choice => choice.value) ?? []
    expect(choiceValues).to.include('pmo')
    expect(choiceValues).to.include('linear:PRO')
  })
})
