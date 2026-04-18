/**
 * PRLT-1336: Ensure work/ready, pr/create, and work/propose do NOT call
 * SQLiteStorage.getTicket(), listTickets(), or updateTicket() directly.
 *
 * These commands must use resolveTicketProvider() / resolveProjectProvider()
 * instead, since local ticket storage was removed in PRLT-1299.
 *
 * This is a static analysis guard — it reads the source code and checks for
 * the banned patterns. If someone re-introduces a this.storage.getTicket()
 * call, this test will catch it.
 */
import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Commands in the propose / pr-create flow that must not use SQLiteStorage
const GUARDED_FILES = [
  'work/ready.ts',
  'work/propose.ts',
  'pr/create.ts',
]

// Banned patterns — any call to this.storage.<deadMethod>
const BANNED_PATTERNS = [
  /this\.storage\.getTicket\s*\(/,
  /this\.storage\.listTickets\s*\(/,
  /this\.storage\.updateTicket\s*\(/,
  /this\.storage\.createTicket\s*\(/,
  /this\.storage\.moveTicket\s*\(/,
  /this\.storage\.deleteTicket\s*\(/,
]

describe('PRLT-1336: No SQLiteStorage ticket methods in propose/pr-create paths', () => {
  const commandsDir = path.resolve(__dirname, '../../src/commands')

  for (const relPath of GUARDED_FILES) {
    it(`${relPath} must not call SQLiteStorage ticket methods directly`, () => {
      const filePath = path.join(commandsDir, relPath)
      expect(fs.existsSync(filePath), `${relPath} should exist`).to.be.true

      const content = fs.readFileSync(filePath, 'utf-8')
      const violations: string[] = []

      for (const pattern of BANNED_PATTERNS) {
        const match = content.match(pattern)
        if (match) {
          violations.push(match[0])
        }
      }

      expect(
        violations,
        `${relPath} still calls dead SQLiteStorage methods: ${violations.join(', ')}. ` +
        `Use resolveTicketProvider() / resolveProjectProvider() instead.`
      ).to.have.length(0)
    })
  }

  // Positive check — ensure the migrated files use the provider pattern
  it('work/ready.ts uses resolveProjectProvider for listing tickets', () => {
    const content = fs.readFileSync(path.join(commandsDir, 'work/ready.ts'), 'utf-8')
    expect(content).to.include('resolveProjectProvider')
  })

  it('work/ready.ts uses resolveTicketProvider for getting a ticket', () => {
    const content = fs.readFileSync(path.join(commandsDir, 'work/ready.ts'), 'utf-8')
    expect(content).to.include('resolveTicketProvider')
  })

  it('pr/create.ts uses resolveProjectProvider for listing tickets', () => {
    const content = fs.readFileSync(path.join(commandsDir, 'pr/create.ts'), 'utf-8')
    expect(content).to.include('resolveProjectProvider')
  })

  it('pr/create.ts uses resolveTicketProvider for getting a ticket', () => {
    const content = fs.readFileSync(path.join(commandsDir, 'pr/create.ts'), 'utf-8')
    expect(content).to.include('resolveTicketProvider')
  })
})
