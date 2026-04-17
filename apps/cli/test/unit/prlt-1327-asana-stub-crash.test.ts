/**
 * Regression test: PRLT-1327 — Asana-specific code paths still crashed after
 * PRLT-1319 stub audit because the agent only tested the Linear provider path.
 *
 * These tests lock in the fixes:
 *
 * 1. `resolveProjectProvider()` auto-detect must check Asana (not just Linear)
 *    so `prlt ticket list` doesn't fall to the dead PMOTicketProvider.
 * 2. `AsanaTicketProvider` must not call dead storage stubs — createTicket,
 *    getTicket, updateTicket, assignTicket, moveTicket, and deleteTicket must
 *    work without a live local ticket store.
 * 3. `commands/asana/import.ts` must route through the provider, not
 *    `this.storage.listTickets/createTicket/updateTicket`.
 * 4. `commands/work/asana.ts` must route through the provider, not
 *    `this.storage.listTickets/createTicket/updateTicket`.
 * 5. `ticket/list.ts` must not call the dead `getProjectBoard` stub.
 * 6. `importAsanaTaskToPmo()` must accept a provider-shaped interface.
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

describe('PRLT-1327: Asana stub crash regression', () => {
  // ===================================================================
  // 1. resolveProjectProvider auto-detect includes Asana
  // ===================================================================
  describe('resolveProjectProvider auto-detect includes Asana', () => {
    const resolverSource = read('lib/providers/resolver.ts')

    it('checks isAsanaConfigured in auto-detect path', () => {
      // The auto-detect section (after explicit source checks) should call isAsanaConfigured
      const autoSection = resolverSource.slice(resolverSource.indexOf('// auto:'))
      expect(autoSection).to.include(
        'isAsanaConfigured',
        'resolveProjectProvider auto mode must check Asana configuration',
      )
    })

    it('creates AsanaTicketProvider when Asana is configured', () => {
      const autoSection = resolverSource.slice(resolverSource.indexOf('// auto:'))
      expect(autoSection).to.include(
        'AsanaTicketProvider',
        'resolveProjectProvider auto mode must instantiate AsanaTicketProvider',
      )
    })

    it('also checks other providers (Jira, ClickUp, Trello, GitHub, Notion)', () => {
      const autoSection = resolverSource.slice(resolverSource.indexOf('// auto:'))
      for (const check of [
        'isJiraConfigured',
        'isClickUpConfigured',
        'isTrelloConfigured',
        'isGitHubConfigured',
        'isNotionConfigured',
      ]) {
        expect(autoSection).to.include(
          check,
          `resolveProjectProvider auto mode should check ${check}`,
        )
      }
    })
  })

  // ===================================================================
  // 2. AsanaTicketProvider does not call dead storage stubs
  // ===================================================================
  describe('AsanaTicketProvider does not call dead storage stubs', () => {
    const providerSource = read('lib/providers/asana-provider.ts')

    it('does not call this.storage.createTicket()', () => {
      expect(providerSource).to.not.include(
        'this.storage.createTicket(',
        'AsanaTicketProvider.createTicket() must not call dead storage stub (PRLT-1327)',
      )
    })

    it('does not call this.storage.getTicket()', () => {
      expect(providerSource).to.not.include(
        'this.storage.getTicket(',
        'AsanaTicketProvider.getTicket() must not call dead storage stub (PRLT-1327)',
      )
    })

    it('does not call this.storage.updateTicket()', () => {
      expect(providerSource).to.not.include(
        'this.storage.updateTicket(',
        'AsanaTicketProvider.updateTicket() must not call dead storage stub (PRLT-1327)',
      )
    })

    it('does not call this.storage.moveTicket()', () => {
      expect(providerSource).to.not.include(
        'this.storage.moveTicket(',
        'AsanaTicketProvider.moveTicket() must not call dead storage stub (PRLT-1327)',
      )
    })

    it('does not call this.storage.deleteTicket()', () => {
      expect(providerSource).to.not.include(
        'this.storage.deleteTicket(',
        'AsanaTicketProvider.deleteTicket() must not call dead storage stub (PRLT-1327)',
      )
    })

    it('does not call this.storage.listTickets()', () => {
      expect(providerSource).to.not.include(
        'this.storage.listTickets(',
        'AsanaTicketProvider.listTickets() must not call dead storage stub (PRLT-1327)',
      )
    })

    it('listTickets fetches from Asana API', () => {
      // Extract the listTickets method body
      const match = providerSource.match(/async listTickets[\s\S]*?return \{[^}]*success: true[^}]*\}/)
      expect(match, 'listTickets() should exist').to.not.be.null
      const body = match![0]
      expect(body).to.include('AsanaClient', 'listTickets should use AsanaClient')
      expect(body).to.include('client.listTasks', 'listTickets should call client.listTasks')
    })
  })

  // ===================================================================
  // 3. commands/asana/import.ts routes through provider
  // ===================================================================
  describe('asana import routes through provider', () => {
    const importSource = read('commands/asana/import.ts')

    const deadCalls = [
      'this.storage.listTickets',
      'this.storage.createTicket',
      'this.storage.updateTicket',
    ]

    for (const dead of deadCalls) {
      it(`does not call ${dead}(...)`, () => {
        expect(importSource).to.not.include(
          `${dead}(`,
          `asana import must not call dead ${dead}() stub (PRLT-1327)`,
        )
      })
    }

    it('uses resolveProjectProvider for ticket operations', () => {
      expect(importSource).to.include(
        'resolveProjectProvider',
        'asana import should use resolveProjectProvider for ticket operations',
      )
    })
  })

  // ===================================================================
  // 4. commands/work/asana.ts routes through provider
  // ===================================================================
  describe('work asana routes through provider', () => {
    const workAsanaSource = read('commands/work/asana.ts')

    const deadCalls = [
      'this.storage.listTickets',
      'this.storage.createTicket',
      'this.storage.updateTicket',
    ]

    for (const dead of deadCalls) {
      it(`does not call ${dead}(...)`, () => {
        expect(workAsanaSource).to.not.include(
          `${dead}(`,
          `work asana must not call dead ${dead}() stub (PRLT-1327)`,
        )
      })
    }

    it('uses resolveProjectProvider for ticket operations', () => {
      expect(workAsanaSource).to.include(
        'resolveProjectProvider',
        'work asana should use resolveProjectProvider for ticket operations',
      )
    })
  })

  // ===================================================================
  // 5. ticket/list.ts does not call dead getProjectBoard
  // ===================================================================
  describe('ticket list does not call dead getProjectBoard', () => {
    const listSource = read('commands/ticket/list.ts')

    it('does not call storage.getProjectBoard()', () => {
      expect(listSource).to.not.include(
        '.getProjectBoard(',
        'ticket list must not call dead getProjectBoard() stub (PRLT-1327)',
      )
    })

    it('derives columns from ticket statusName instead', () => {
      expect(listSource).to.include(
        'statusName',
        'ticket list should derive columns from ticket statusName',
      )
    })
  })

  // ===================================================================
  // 6. importAsanaTaskToPmo accepts provider-shaped interface
  // ===================================================================
  describe('importAsanaTaskToPmo uses provider interface', () => {
    const asanaSource = read('lib/external-issues/asana.ts')

    it('function parameter type has provider-shaped listTickets returning success/tickets', () => {
      // The function should take a provider-shaped first param, not raw storage.
      // Check that the listTickets return type wraps tickets in { success, tickets }
      const fnStart = asanaSource.indexOf('export async function importAsanaTaskToPmo(')
      expect(fnStart, 'importAsanaTaskToPmo should exist').to.be.greaterThan(-1)
      // Grab a generous slice of the function signature
      const sig = asanaSource.slice(fnStart, fnStart + 600)
      expect(sig).to.include('success: boolean', 'listTickets return type should include success: boolean')
      expect(sig).to.include('tickets: Array', 'listTickets return type should include tickets: Array')
    })

    it('does not accept raw storage interface (no direct array return)', () => {
      // The old signature had: listTickets(...): Promise<Array<...>>
      // The new one has: listTickets(...): Promise<{ success: boolean; tickets: Array<...> }>
      const match = asanaSource.match(
        /export async function importAsanaTaskToPmo\([\s\S]*?\): Promise/,
      )
      expect(match, 'importAsanaTaskToPmo should exist').to.not.be.null
      const sig = match![0]
      // Old pattern: "listTickets(projectId: string): Promise<Array<"
      expect(sig).to.not.match(
        /listTickets\([^)]*\):\s*Promise<Array/,
        'importAsanaTaskToPmo should not accept raw storage with listTickets returning Promise<Array<...>>',
      )
    })
  })
})
