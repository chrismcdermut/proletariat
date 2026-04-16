/**
 * Regression test: audit of runtime-stubbed methods left over from PRLT-1299.
 *
 * PRLT-1319: PRLT-1299 removed the dead PMO ticket tables but kept many
 * storage methods as runtime-throwing stubs. The stubs silently let callers
 * compile and then exploded at runtime. The known break was `prlt ticket
 * edit`, which routed through `PMOCommand.resolveTicketProvider()` → called
 * `storage.getTicket()` (a stub) → threw before anything could happen.
 *
 * These tests lock in the fixes:
 *
 * 1. `PMOCommand.resolveTicketProvider()` must not touch the dead
 *    `storage.getTicket` stub — it builds provider metadata from the ticket
 *    ID pattern and workspace config instead.
 * 2. `ticket edit` must not call any of the dead subtask / AC / board stubs
 *    directly — subtask and acceptance-criteria updates go through the
 *    provider's `updateTicket()` with a full final array.
 * 3. The resolver's status DB queries must not reference dropped tables
 *    (`pmo_workflow_statuses`, `pmo_tickets`).
 * 4. Stubs that have no remaining callers (createColumn, listWorkflows,
 *    getSpec, pull, push, …) must be fully deleted from `SQLiteStorage`, so
 *    any new caller fails at compile time instead of silently blowing up at
 *    runtime.
 */

import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const SRC_ROOT = path.resolve(__dirname, '../../src')

function read(rel: string): string {
  return fs.readFileSync(path.join(SRC_ROOT, rel), 'utf8')
}

describe('PRLT-1319: runtime-stubbed method audit', () => {
  describe('resolveTicketProvider no longer calls dead storage.getTicket', () => {
    const baseCommand = read('lib/pmo/base-command.ts')

    it('does not call this.storage.getTicket() inside resolveTicketProvider()', () => {
      // Extract the body of resolveTicketProvider and assert no storage.getTicket call.
      const match = baseCommand.match(/protected async resolveTicketProvider[\s\S]*?\n\s{2}\}/)
      expect(match, 'resolveTicketProvider() should exist on PMOCommand').to.not.be.null
      const body = match![0]
      expect(body).to.not.match(
        /this\.storage\.getTicket\(/,
        'PMOCommand.resolveTicketProvider() must not call the dead storage.getTicket stub',
      )
    })

    it('builds synthetic provider metadata from the ticket ID pattern', () => {
      const match = baseCommand.match(/protected async resolveTicketProvider[\s\S]*?\n\s{2}\}/)!
      const body = match[0]
      // We still derive metadata for PRLT-xxx / similar external keys so the
      // resolver picks the configured external provider.
      expect(body).to.match(/external_key/, 'should derive external_key from ticket ID pattern')
    })
  })

  describe('ticket edit routes subtask / AC updates through the provider', () => {
    const editSource = read('commands/ticket/edit.ts')

    const deadStubCalls = [
      'storage.addSubtask',
      'storage.removeSubtask',
      'storage.toggleSubtask',
      'storage.addAcceptanceCriterion',
      'storage.removeAcceptanceCriterion',
      'storage.clearAcceptanceCriteria',
      'storage.getProjectBoard',
    ]

    for (const dead of deadStubCalls) {
      it(`ticket edit does not call ${dead}(...)`, () => {
        expect(editSource).to.not.include(
          `${dead}(`,
          `${dead}() was removed by PRLT-1299 and must not be called from ticket edit`,
        )
      })
    }

    it('ticket edit calls ticketProvider.updateTicket(...) to persist changes', () => {
      expect(editSource).to.match(
        /ticketProvider\.updateTicket\(/,
        'ticket edit should persist updates via the provider',
      )
    })

    it('ticket edit builds a final subtasks array for provider.updateTicket', () => {
      expect(editSource).to.match(/finalSubtasks/, 'should aggregate subtasks into a single updateTicket call')
      // The final array gets attached to the updates object before the one provider.updateTicket call
      expect(editSource).to.match(
        /\.subtasks\s*=\s*finalSubtasks/,
        'should attach subtasks to the updateTicket input',
      )
    })

    it('ticket edit builds a final acceptanceCriteria array for provider.updateTicket', () => {
      expect(editSource).to.match(/finalAC/, 'should aggregate AC into a single updateTicket call')
      expect(editSource).to.match(
        /\.acceptanceCriteria\s*=\s*finalAC/,
        'should attach acceptanceCriteria to the updateTicket input',
      )
    })
  })

  describe('provider resolver status queries do not hit dropped tables', () => {
    const resolverSource = read('lib/providers/resolver.ts')

    const droppedTables = ['pmo_workflow_statuses', 'pmo_tickets']

    for (const table of droppedTables) {
      it(`resolver.ts does not SELECT from dropped table ${table}`, () => {
        expect(resolverSource).to.not.match(
          new RegExp(`FROM\\s+${table}\\b`, 'i'),
          `${table} was dropped in migration 0024 and must not be queried`,
        )
        expect(resolverSource).to.not.match(
          new RegExp(`JOIN\\s+${table}\\b`, 'i'),
          `${table} was dropped in migration 0024 and must not be joined`,
        )
      })
    }
  })

  describe('stubs with no callers are fully deleted (not just emptied)', () => {
    const storageSource = read('lib/pmo/storage/index.ts')

    // These methods had zero callers per the PRLT-1319 audit, and should be
    // completely absent from SQLiteStorage so the compiler catches any future
    // accidental usage.
    const deletedStubs = [
      'createColumn',
      'renameColumn',
      'moveColumn',
      'deleteColumn',
      'getTicketById',
      'getTicketByExternalKey',
      'createEpic',
      'updateEpic',
      'deleteEpic',
      'reorderEpic',
      'createSpec',
      'getSpec',
      'listSpecs',
      'updateSpec',
      'deleteSpec',
      'unlinkTicketFromSpec',
      'getTicketsForSpec',
      'getSpecsForTicket',
      'addSpecDependency',
      'removeSpecDependency',
      'getSpecDependencies',
      'getSpecDependents',
      'linkProjectToSpec',
      'unlinkProjectFromSpec',
      'getSpecsForProject',
      'getProjectsForSpec',
      'listWorkflows',
      'getWorkflow',
      'createWorkflow',
      'updateWorkflow',
      'deleteWorkflow',
      'getStatus',
      'createStatus',
      'updateStatus',
      'deleteStatus',
      'reorderStatus',
      'getDefaultStatus',
      'createTicketTemplateFromTicket',
      'pull',
      'push',
      'status',
      'getCacheMetadata',
      'setCacheMetadata',
      'rebuildFromBoard',
    ]

    for (const stub of deletedStubs) {
      it(`SQLiteStorage no longer declares ${stub}(`, () => {
        // Match declarations only (method signature), not references in strings
        // like `deadMethod('moveTicket')`.
        const declRegex = new RegExp(`\\b(async\\s+)?${stub}\\s*\\(`)
        expect(storageSource).to.not.match(
          declRegex,
          `${stub}() had no remaining callers — it must be fully deleted from SQLiteStorage`,
        )
      })
    }
  })

  describe('remaining runtime stubs keep the PRLT-1299 error marker', () => {
    const storageSource = read('lib/pmo/storage/index.ts')

    it('deadMethod() still throws an error mentioning PRLT-1299', () => {
      expect(storageSource).to.match(
        /SQLiteStorage\.\$\{name\}\(\)\s+removed\s+\(PRLT-1299\)/,
        'Remaining stubs should keep a PRLT-1299 marker so future audits can grep for survivors',
      )
    })
  })
})
