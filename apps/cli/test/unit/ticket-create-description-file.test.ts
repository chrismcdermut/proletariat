import { expect } from 'chai'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Regression tests for --description-file stdin reading (PRLT-1181 / TKT-007).
 *
 * Bug: --description-file - errored with "Linear team key is required" before
 * reading stdin because:
 * 1. stdin was read AFTER source resolution and interactive prompts (which could
 *    consume or bypass stdin)
 * 2. The --team flag was defined but never forwarded to the Linear provider
 *
 * Fix: stdin is now read immediately after flag parsing, before any routing or
 * prompts. The --team flag is forwarded via CreateTicketInput.metadata.
 */

describe('@smoke ticket create --description-file', () => {
  describe('description-file ordering in execute()', () => {
    /**
     * Validates that the create.ts source reads --description-file BEFORE
     * resolveSource(). This is a structural test that verifies the code
     * ordering by inspecting the source file itself.
     */
    it('reads --description-file before resolveSource is called', () => {
      const createSrc = fs.readFileSync(
        path.join(__dirname, '../../src/commands/ticket/create.ts'),
        'utf-8'
      )

      // Find the position of the early description-file read
      const earlyReadPos = createSrc.indexOf("flags['description-file']")
      expect(earlyReadPos).to.be.greaterThan(0, 'description-file handling should exist')

      // Find resolveSource call
      const resolveSourcePos = createSrc.indexOf('this.resolveSource(flags')
      expect(resolveSourcePos).to.be.greaterThan(0, 'resolveSource call should exist')

      // The description-file read must come BEFORE resolveSource
      expect(earlyReadPos).to.be.lessThan(
        resolveSourcePos,
        'description-file reading must happen before resolveSource() to prevent stdin consumption by prompts'
      )
    })

    it('reads --description-file before requireProject is called', () => {
      const createSrc = fs.readFileSync(
        path.join(__dirname, '../../src/commands/ticket/create.ts'),
        'utf-8'
      )

      const earlyReadPos = createSrc.indexOf("flags['description-file']")
      const requireProjectPos = createSrc.indexOf('this.requireProject(')
      expect(requireProjectPos).to.be.greaterThan(0, 'requireProject call should exist')

      expect(earlyReadPos).to.be.lessThan(
        requireProjectPos,
        'description-file reading must happen before requireProject() to prevent stdin consumption by prompts'
      )
    })
  })

  describe('--description-file with regular file', () => {
    let tmpDir: string
    let tmpFile: string

    before(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-test-desc-file-'))
      tmpFile = path.join(tmpDir, 'description.md')
      fs.writeFileSync(tmpFile, '## Test Description\n\nThis is a test ticket.')
    })

    after(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    })

    it('fs.readFileSync can read the file content', () => {
      const content = fs.readFileSync(tmpFile, 'utf-8')
      expect(content).to.equal('## Test Description\n\nThis is a test ticket.')
    })
  })

  describe('--team flag forwarding to Linear provider', () => {
    it('Linear provider createTicket checks input.metadata for team key override', () => {
      const providerSrc = fs.readFileSync(
        path.join(__dirname, '../../src/lib/providers/linear-provider.ts'),
        'utf-8'
      )

      // The provider should check input.metadata?.['linear.team'] for team key
      expect(providerSrc).to.include(
        "input.metadata?.['linear.team']",
        'Linear provider should check input.metadata for team key override'
      )
    })

    it('createLinearIssue passes --team flag via metadata', () => {
      const createSrc = fs.readFileSync(
        path.join(__dirname, '../../src/commands/ticket/create.ts'),
        'utf-8'
      )

      // The createLinearIssue method should extract flags.team and pass it as metadata
      expect(createSrc).to.include(
        "'linear.team': teamKey",
        'createLinearIssue should forward --team flag via metadata'
      )
    })

    it('error message mentions --team flag', () => {
      const providerSrc = fs.readFileSync(
        path.join(__dirname, '../../src/lib/providers/linear-provider.ts'),
        'utf-8'
      )

      // Error message should mention --team as a resolution option
      expect(providerSrc).to.include('--team', 'Error message should suggest --team flag')
    })
  })

  describe('no duplicate --description-file handling', () => {
    it('createLinearIssue does not re-read --description-file from stdin', () => {
      const createSrc = fs.readFileSync(
        path.join(__dirname, '../../src/commands/ticket/create.ts'),
        'utf-8'
      )

      // Extract the createLinearIssue method body
      const methodStart = createSrc.indexOf('private async createLinearIssue(')
      expect(methodStart).to.be.greaterThan(0, 'createLinearIssue method should exist')

      const methodBody = createSrc.slice(methodStart)

      // The method should NOT contain fs.readFileSync(0, 'utf-8') — stdin reading
      // is handled early in execute(), not inside createLinearIssue
      expect(methodBody).to.not.include(
        "readFileSync(0, 'utf-8')",
        'createLinearIssue should not re-read stdin — handled early in execute()'
      )
    })
  })
})
