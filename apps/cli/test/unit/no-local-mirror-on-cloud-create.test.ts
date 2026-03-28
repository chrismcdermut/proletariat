import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveMirrorToPmo } from '../../src/lib/external-issues/work-start.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * Regression test for PRLT-1051: Stop creating local PMO tickets when cloud
 * provider is connected.
 *
 * When a cloud provider (Linear, Jira, etc.) is the source of truth,
 * `prlt ticket create` must NOT create a local TKT-xxx mirror ticket.
 * Mirrors are created on demand by `work start --mirror-to-pmo` instead.
 */
describe('no local PMO mirror on cloud ticket create (PRLT-1051)', () => {
  describe('ticket create source code contract', () => {
    let createLinearIssueSource: string

    before(() => {
      // Read the compiled createLinearIssue method from the source
      const createTsPath = path.resolve(__dirname, '../../src/commands/ticket/create.ts')
      const fullSource = fs.readFileSync(createTsPath, 'utf-8')

      // Extract the createLinearIssue method body
      const methodStart = fullSource.indexOf('createLinearIssue(')
      expect(methodStart).to.be.greaterThan(-1, 'createLinearIssue method should exist')
      createLinearIssueSource = fullSource.substring(methodStart)
    })

    it('does not call storage.createTicket in the Linear creation path', () => {
      // If this fails, someone re-added local mirror creation to createLinearIssue.
      // Local mirrors should NOT be created during ticket create when a cloud
      // provider is connected. Mirrors are deferred to `work start --mirror-to-pmo`.
      expect(createLinearIssueSource).to.not.include('this.storage.createTicket')
    })

    it('does not create a LinearMapper mapping in the Linear creation path', () => {
      // LinearMapper.createMapping would indicate a local mirror + sync record
      // being created. This should not happen during ticket create.
      expect(createLinearIssueSource).to.not.include('mapper.createMapping')
    })

    it('does not reference pmoTicketId in the Linear creation path', () => {
      // pmoTicketId was the variable that held the local mirror's ID.
      // Its absence confirms no local ticket is being tracked.
      expect(createLinearIssueSource).to.not.include('pmoTicketId')
    })

    it('does not import LinearMapper', () => {
      const createTsPath = path.resolve(__dirname, '../../src/commands/ticket/create.ts')
      const fullSource = fs.readFileSync(createTsPath, 'utf-8')
      // LinearMapper import would only be needed for local mirror creation
      expect(fullSource).to.not.include('LinearMapper')
    })
  })

  describe('mirror-to-pmo defaults to disabled for work start (PRLT-1167)', () => {
    it('defaults to disabled when no flag, env, or config is set', () => {
      const result = resolveMirrorToPmo({})
      expect(result.enabled).to.be.false
      expect(result.source).to.equal('default')
    })

    it('respects explicit flag override to disable', () => {
      const result = resolveMirrorToPmo({ flagValue: false })
      expect(result.enabled).to.be.false
      expect(result.source).to.equal('flag')
    })

    it('respects explicit flag override to enable', () => {
      const result = resolveMirrorToPmo({ flagValue: true })
      expect(result.enabled).to.be.true
      expect(result.source).to.equal('flag')
    })

    it('respects env override', () => {
      const result = resolveMirrorToPmo({ envValue: false })
      expect(result.enabled).to.be.false
      expect(result.source).to.equal('env')
    })

    it('respects config override', () => {
      const result = resolveMirrorToPmo({ configValue: false })
      expect(result.enabled).to.be.false
      expect(result.source).to.equal('config')
    })
  })
})
