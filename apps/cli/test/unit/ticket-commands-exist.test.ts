import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * Regression test for PRLT-1212: ticket commands were accidentally deleted
 * by PRLT-1168 (PR #1032) which should have only removed raw PMO commands.
 *
 * This test ensures the ticket command files exist and export oclif commands.
 */
describe('PRLT-1212: ticket commands must exist', () => {
  const commandsDir = path.resolve(__dirname, '../../src/commands/ticket')

  const requiredCommands = [
    'index.ts',
    'create.ts',
    'list.ts',
    'show.ts',
    'edit.ts',
    'move.ts',
    'delete.ts',
    'update.ts',
  ]

  for (const cmd of requiredCommands) {
    it(`ticket/${cmd} exists`, () => {
      const filePath = path.join(commandsDir, cmd)
      expect(fs.existsSync(filePath), `${filePath} should exist`).to.be.true
    })
  }

  it('ticket commands directory exists', () => {
    expect(fs.existsSync(commandsDir), `${commandsDir} should exist`).to.be.true
    expect(fs.statSync(commandsDir).isDirectory(), `${commandsDir} should be a directory`).to.be.true
  })

  describe('MCP ticket tools', () => {
    const mcpToolsDir = path.resolve(__dirname, '../../src/lib/mcp/tools')

    it('ticket.ts MCP tool exists', () => {
      const filePath = path.join(mcpToolsDir, 'ticket.ts')
      expect(fs.existsSync(filePath), `${filePath} should exist`).to.be.true
    })

    it('action.ts MCP tool exists', () => {
      const filePath = path.join(mcpToolsDir, 'action.ts')
      expect(fs.existsSync(filePath), `${filePath} should exist`).to.be.true
    })

    it('MCP tools index exports ticket and action tools', () => {
      const indexPath = path.join(mcpToolsDir, 'index.ts')
      const content = fs.readFileSync(indexPath, 'utf-8')
      expect(content).to.include('registerTicketTools', 'MCP index should export registerTicketTools')
      expect(content).to.include('registerActionTools', 'MCP index should export registerActionTools')
    })
  })
})
