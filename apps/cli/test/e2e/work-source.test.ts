import { expect } from 'chai'
import { SqliteDatabase } from '../../src/lib/database/sqlite.js'
import {
  createTestEnvironment,
  cleanupTestEnvironment,
  createHQConfig,
  createPMODirectories,
  setupProductionSchema,
  addWorkspaceTables,
  createTestProject,
  createTestTicket,
  execInProcess,
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
  let db: SqliteDatabase

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

  it('shows current default source and provider context', async () => {
    const output = await execInProcess('work source --json')
    const json = extractJson<JsonOutput>(output)

    expect(json).to.not.equal(null)
    expect(json!.type).to.equal('success')
    expect(json!.result?.activeSource).to.equal(null)
    expect(json!.result?.registeredSources?.map((source) => source.ref)).to.deep.equal(['pmo'])
  })

  it('persists default source with provider context via work source set', async () => {
    const setOutput = await execInProcess('work source set linear:PRO --json')
    const setJson = extractJson<JsonOutput>(setOutput)
    expect(setJson).to.not.equal(null)
    expect(setJson!.type).to.equal('success')
    expect(setJson!.result?.activeSource?.provider).to.equal('linear')
    expect(setJson!.result?.activeSource?.context).to.equal('PRO')
    expect(setJson!.result?.activeSource?.ref).to.equal('linear:PRO')

    // Should use new key
    const row = db.prepare(`
      SELECT value FROM workspace_settings WHERE key = 'work.default_source'
    `).get() as { value: string } | undefined

    expect(row?.value).to.equal('linear:PRO')

    // Old key should NOT exist
    const oldRow = db.prepare(`
      SELECT value FROM workspace_settings WHERE key = 'work.active_source'
    `).get() as { value: string } | undefined

    expect(oldRow).to.be.undefined
  })

  it('uses persisted default source in work spawn when --from is omitted', async () => {
    await execInProcess('work source set linear:PRO --json')

    const output = await execInProcess('work spawn -P test-project --json')
    const json = extractJson<JsonOutput>(output)

    expect(json).to.not.equal(null)
    expect(json!.type).to.equal('error')
    expect(json!.error?.code).to.equal('LINEAR_NOT_CONFIGURED')
  })

  it('work spawn --from overrides persisted default source', async () => {
    await execInProcess('work source set linear:PRO --json')

    const output = await execInProcess('work spawn TKT-020 -P test-project --from pmo --json')
    const json = extractJson<JsonOutput>(output)

    expect(json).to.not.equal(null)
    expect(json!.type).to.not.equal('error')
  })

  it('prompts for source selection when multiple sources are registered and no default source exists', async () => {
    db.prepare(`
      INSERT OR REPLACE INTO workspace_settings (key, value) VALUES ('linear.api_key', 'lin_api_test')
    `).run()
    db.prepare(`
      INSERT OR REPLACE INTO workspace_settings (key, value) VALUES ('linear.default_team_key', 'PRO')
    `).run()

    const output = await execInProcess('work spawn -P test-project --json')
    const json = extractJson<JsonOutput>(output)

    expect(json).to.not.equal(null)
    expect(json!.type).to.equal('prompt')
    expect(json!.prompt?.message).to.include('Select the default work source')
    const choiceValues = json!.prompt?.choices.map(choice => choice.value) ?? []
    expect(choiceValues).to.include('pmo')
    expect(choiceValues).to.include('linear:PRO')
  })

  it('interactive source selection does NOT auto-mutate default source', async () => {
    // Verify that selecting a source interactively does NOT persist it
    db.prepare(`
      INSERT OR REPLACE INTO workspace_settings (key, value) VALUES ('linear.api_key', 'lin_api_test')
    `).run()
    db.prepare(`
      INSERT OR REPLACE INTO workspace_settings (key, value) VALUES ('linear.default_team_key', 'PRO')
    `).run()

    // This will prompt (JSON mode) — the user hasn't selected yet
    await execInProcess('work spawn -P test-project --json')

    // Neither default_source nor active_source should be set
    const newRow = db.prepare(`
      SELECT value FROM workspace_settings WHERE key = 'work.default_source'
    `).get() as { value: string } | undefined
    expect(newRow).to.be.undefined

    const oldRow = db.prepare(`
      SELECT value FROM workspace_settings WHERE key = 'work.active_source'
    `).get() as { value: string } | undefined
    expect(oldRow).to.be.undefined
  })

  // Jira source registration tests
  it('persists jira as default source with project context', async () => {
    const setOutput = await execInProcess('work source set jira:PROJ --json')
    const setJson = extractJson<JsonOutput>(setOutput)
    expect(setJson).to.not.equal(null)
    expect(setJson!.type).to.equal('success')
    expect(setJson!.result?.activeSource?.provider).to.equal('jira')
    expect(setJson!.result?.activeSource?.context).to.equal('PROJ')
    expect(setJson!.result?.activeSource?.ref).to.equal('jira:PROJ')

    const row = db.prepare(`
      SELECT value FROM workspace_settings WHERE key = 'work.default_source'
    `).get() as { value: string } | undefined

    expect(row?.value).to.equal('jira:PROJ')
  })

  it('registers Jira as source when configured', async () => {
    // Configure Jira credentials
    db.prepare(`
      INSERT OR REPLACE INTO workspace_settings (key, value) VALUES ('jira.base_url', 'https://test.atlassian.net')
    `).run()
    db.prepare(`
      INSERT OR REPLACE INTO workspace_settings (key, value) VALUES ('jira.api_token', 'jira_tok_test')
    `).run()
    db.prepare(`
      INSERT OR REPLACE INTO workspace_settings (key, value) VALUES ('jira.project_key', 'PROJ')
    `).run()

    const output = await execInProcess('work source --json')
    const json = extractJson<JsonOutput>(output)

    expect(json).to.not.equal(null)
    expect(json!.type).to.equal('success')
    const providers = json!.result?.registeredSources?.map((s) => s.provider) ?? []
    expect(providers).to.include('pmo')
    expect(providers).to.include('jira')
  })

  it('uses persisted jira default source in work spawn when --from is omitted', async () => {
    await execInProcess('work source set jira:PROJ --json')

    const output = await execInProcess('work spawn -P test-project --json')
    const json = extractJson<JsonOutput>(output)

    expect(json).to.not.equal(null)
    expect(json!.type).to.equal('error')
    expect(json!.error?.code).to.equal('JIRA_NOT_CONFIGURED')
  })

  it('prompts for source when linear and jira are both registered and no default source', async () => {
    // Configure Linear
    db.prepare(`
      INSERT OR REPLACE INTO workspace_settings (key, value) VALUES ('linear.api_key', 'lin_api_test')
    `).run()
    db.prepare(`
      INSERT OR REPLACE INTO workspace_settings (key, value) VALUES ('linear.default_team_key', 'ENG')
    `).run()

    // Configure Jira
    db.prepare(`
      INSERT OR REPLACE INTO workspace_settings (key, value) VALUES ('jira.base_url', 'https://test.atlassian.net')
    `).run()
    db.prepare(`
      INSERT OR REPLACE INTO workspace_settings (key, value) VALUES ('jira.api_token', 'jira_tok_test')
    `).run()
    db.prepare(`
      INSERT OR REPLACE INTO workspace_settings (key, value) VALUES ('jira.project_key', 'PROJ')
    `).run()

    const output = await execInProcess('work spawn -P test-project --json')
    const json = extractJson<JsonOutput>(output)

    expect(json).to.not.equal(null)
    expect(json!.type).to.equal('prompt')
    const choiceValues = json!.prompt?.choices.map(choice => choice.value) ?? []
    expect(choiceValues).to.include('pmo')
    expect(choiceValues).to.include('linear:ENG')
    expect(choiceValues).to.include('jira:PROJ')
  })

  it('work spawn --from jira overrides persisted linear default source', async () => {
    await execInProcess('work source set linear:PRO --json')

    // --from jira should override and hit JIRA_NOT_CONFIGURED since no jira creds
    const output = await execInProcess('work spawn TKT-020 -P test-project --from jira --json')
    const json = extractJson<JsonOutput>(output)

    expect(json).to.not.equal(null)
    expect(json!.type).to.equal('error')
    expect(json!.error?.code).to.equal('JIRA_NOT_CONFIGURED')
  })

  // ==========================================================================
  // work start auto-detection of external issue identifiers
  // ==========================================================================

  it('work start with non-TKT ID and default source routes to external provider', async () => {
    // Set linear as default source
    await execInProcess('work source set linear:PRO --json')

    // PRLT-933 is not a local TKT-XXX ID, so it should route through the default source (linear).
    // Since no real Linear credentials exist, it will fail with LINEAR_NOT_CONFIGURED or similar.
    const output = await execInProcess('work start PRLT-933 -P test-project --json')
    const json = extractJson<JsonOutput>(output)

    expect(json).to.not.equal(null)
    expect(json!.type).to.equal('error')
    // The command should attempt to resolve via linear (the default source),
    // not return TICKET_NOT_FOUND from local PMO lookup.
    expect(json!.error?.code).to.not.equal('TICKET_NOT_FOUND')
  })

  it('work start with non-TKT ID and no default source returns NO_DEFAULT_SOURCE', async () => {
    // No default source configured — PRLT-933 can't be resolved
    const output = await execInProcess('work start PRLT-933 -P test-project --json')
    const json = extractJson<JsonOutput>(output)

    expect(json).to.not.equal(null)
    expect(json!.type).to.equal('error')
    expect(json!.error?.code).to.equal('NO_DEFAULT_SOURCE')
    expect(json!.error?.message).to.include('not a local ticket ID')
  })

  it('work start with TKT-XXX ID still uses local PMO lookup', async () => {
    // Set default source to linear, but TKT-020 should still resolve locally
    await execInProcess('work source set linear:PRO --json')

    // TKT-020 exists in the local PMO — should not route through linear
    const output = await execInProcess('work start TKT-020 -P test-project --json')
    const json = extractJson<JsonOutput>(output)

    expect(json).to.not.equal(null)
    // Should NOT return NO_DEFAULT_SOURCE or try external resolution
    expect(json!.error?.code).to.not.equal('NO_DEFAULT_SOURCE')
    // Should find the ticket (and prompt for next step like action selection)
    expect(json!.type).to.not.equal('error')
  })

  it('work start --from overrides default source for external resolution', async () => {
    // Default source is linear, but --from jira should override
    await execInProcess('work source set linear:PRO --json')

    const output = await execInProcess('work start --from jira:PROJ-456 -P test-project --json')
    const json = extractJson<JsonOutput>(output)

    expect(json).to.not.equal(null)
    expect(json!.type).to.equal('error')
    // Should attempt jira resolution (not linear), failing because no jira credentials
    // The error code varies by provider but should NOT be TICKET_NOT_FOUND (local lookup)
    expect(json!.error?.code).to.not.equal('TICKET_NOT_FOUND')
    expect(json!.error?.code).to.not.equal('NO_DEFAULT_SOURCE')
  })

  it('work start does not auto-mutate default source during execution', async () => {
    // Set default source to linear
    await execInProcess('work source set linear:PRO --json')

    // Run work start with a non-TKT ID — it will fail (no creds), but should not mutate the source
    await execInProcess('work start PRLT-933 -P test-project --json')

    // Verify default source is still linear:PRO
    const row = db.prepare(`
      SELECT value FROM workspace_settings WHERE key = 'work.default_source'
    `).get() as { value: string } | undefined
    expect(row?.value).to.equal('linear:PRO')

    // Verify legacy key was not created
    const oldRow = db.prepare(`
      SELECT value FROM workspace_settings WHERE key = 'work.active_source'
    `).get() as { value: string } | undefined
    expect(oldRow).to.be.undefined
  })

  // Legacy migration tests
  it('migrates legacy work.active_source to work.default_source on read', async () => {
    // Simulate legacy data
    db.prepare(`
      INSERT INTO workspace_settings (key, value) VALUES ('work.active_source', 'linear:PRO')
    `).run()

    const output = await execInProcess('work source --json')
    const json = extractJson<JsonOutput>(output)

    expect(json).to.not.equal(null)
    expect(json!.type).to.equal('success')
    expect(json!.result?.activeSource?.provider).to.equal('linear')
    expect(json!.result?.activeSource?.ref).to.equal('linear:PRO')

    // Legacy key should be cleaned up after migration
    const oldRow = db.prepare(`
      SELECT value FROM workspace_settings WHERE key = 'work.active_source'
    `).get() as { value: string } | undefined
    expect(oldRow).to.be.undefined

    // New key should exist
    const newRow = db.prepare(`
      SELECT value FROM workspace_settings WHERE key = 'work.default_source'
    `).get() as { value: string } | undefined
    expect(newRow?.value).to.equal('linear:PRO')
  })
})
