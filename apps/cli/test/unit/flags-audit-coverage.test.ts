import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * Validates that the flags-audit.md document exists and covers
 * all required command namespaces per PRLT-313.
 */
describe('flags-audit coverage', () => {
  const auditPath = path.resolve(__dirname, '../../../../docs/flags-audit.md')
  let auditContent: string

  before(() => {
    auditContent = fs.readFileSync(auditPath, 'utf-8')
  })

  it('audit document exists', () => {
    expect(fs.existsSync(auditPath)).to.equal(true)
  })

  const requiredNamespaces = [
    'work',
    'session',
    'ticket',
    'orchestrate',
    'orchestrator',
    'pr',
    'agent',
    'hook',
    'notify',
  ]

  for (const ns of requiredNamespaces) {
    it(`covers the "${ns}" namespace`, () => {
      // The namespace should appear as a section header or in the inventory
      const pattern = new RegExp(`\`${ns}[:\`\\s]`, 'i')
      expect(auditContent).to.match(pattern, `Audit doc should reference the "${ns}" namespace`)
    })
  }

  const requiredSections = [
    'Flag Inconsistencies',
    'Flag Redundancies',
    'Overlapping Commands',
    'Non-Interactive',
    'Missing --json',
    'Namespace Bloat',
    'process.exit',
    'Recommendations',
  ]

  for (const section of requiredSections) {
    it(`includes "${section}" section`, () => {
      expect(auditContent).to.include(section, `Audit doc should have a "${section}" section`)
    })
  }

  it('documents the --skip-permissions vs --permission-mode inconsistency', () => {
    expect(auditContent).to.include('--skip-permissions')
    expect(auditContent).to.include('--permission-mode')
  })

  it('documents the --display vs --display-mode naming inconsistency', () => {
    expect(auditContent).to.include('--display-mode')
    expect(auditContent).to.include('--display')
  })

  it('documents the --json / --machine redundancy', () => {
    expect(auditContent).to.include('--machine')
    expect(auditContent).to.include('--json')
  })

  it('documents ticket:edit vs ticket:update overlap', () => {
    expect(auditContent).to.include('ticket:edit')
    expect(auditContent).to.include('ticket:update')
  })

  it('documents orchestrate vs orchestrator namespace confusion', () => {
    expect(auditContent).to.include('orchestrate')
    expect(auditContent).to.include('orchestrator')
  })

  it('all command directories are accounted for in the inventory', () => {
    const commandsDir = path.resolve(__dirname, '../../src/commands')
    const entries = fs.readdirSync(commandsDir, { withFileTypes: true })
    const directories = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      // Filter out autocomplete (oclif built-in) which doesn't need auditing
      .filter((name) => name !== 'autocomplete')

    for (const dir of directories) {
      expect(auditContent.toLowerCase()).to.include(
        dir.toLowerCase(),
        `Audit doc should mention the "${dir}" command directory`
      )
    }
  })
})
