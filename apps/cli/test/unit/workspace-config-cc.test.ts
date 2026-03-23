import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

import {
  readWorkspaceConfig,
  writeWorkspaceConfig,
  getClaudeCodeConfig,
  updateClaudeCodeConfig,
  getClaudeCodeVersion,
} from '../../src/lib/workspace-config.js'

/**
 * Unit tests for Claude Code version pinning in workspace config (PRLT-1084)
 */
describe('Workspace Config — Claude Code version (PRLT-1084)', () => {
  let testDir: string

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-config-test-'))
    const proletariatDir = path.join(testDir, '.proletariat')
    fs.mkdirSync(proletariatDir, { recursive: true })
    // Write minimal workspace config
    fs.writeFileSync(
      path.join(proletariatDir, 'config.json'),
      JSON.stringify({
        type: 'hq',
        name: 'test-workspace',
        version: '1.0.0',
        schemaVersion: 1,
      }, null, 2) + '\n'
    )
  })

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true })
    }
  })

  describe('getClaudeCodeConfig', () => {
    it('should return empty config when claude_code section is not present', () => {
      const config = getClaudeCodeConfig(testDir)
      expect(config).to.deep.equal({})
    })

    it('should return claude_code config when set', () => {
      const wsConfig = readWorkspaceConfig(testDir)!
      wsConfig.claude_code = { version: '2.1.80' }
      writeWorkspaceConfig(testDir, wsConfig)

      const config = getClaudeCodeConfig(testDir)
      expect(config).to.deep.equal({ version: '2.1.80' })
    })
  })

  describe('updateClaudeCodeConfig', () => {
    it('should add claude_code section to workspace config', () => {
      updateClaudeCodeConfig(testDir, { version: '2.1.80' })

      const config = readWorkspaceConfig(testDir)
      expect(config?.claude_code?.version).to.equal('2.1.80')
    })

    it('should update existing claude_code version', () => {
      updateClaudeCodeConfig(testDir, { version: '2.1.80' })
      updateClaudeCodeConfig(testDir, { version: '2.2.0' })

      const config = readWorkspaceConfig(testDir)
      expect(config?.claude_code?.version).to.equal('2.2.0')
    })

    it('should clear version when set to undefined', () => {
      updateClaudeCodeConfig(testDir, { version: '2.1.80' })
      updateClaudeCodeConfig(testDir, { version: undefined })

      const config = readWorkspaceConfig(testDir)
      expect(config?.claude_code?.version).to.be.undefined
    })

    it('should preserve other workspace config fields', () => {
      updateClaudeCodeConfig(testDir, { version: '2.1.80' })

      const config = readWorkspaceConfig(testDir)
      expect(config?.type).to.equal('hq')
      expect(config?.name).to.equal('test-workspace')
      expect(config?.claude_code?.version).to.equal('2.1.80')
    })

    it('should throw when workspace config does not exist', () => {
      const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'empty-'))
      try {
        expect(() => updateClaudeCodeConfig(emptyDir, { version: '2.1.80' })).to.throw('No workspace config found')
      } finally {
        fs.rmSync(emptyDir, { recursive: true, force: true })
      }
    })
  })

  describe('getClaudeCodeVersion', () => {
    it('should return undefined when no version is configured', () => {
      const version = getClaudeCodeVersion(testDir)
      expect(version).to.be.undefined
    })

    it('should return configured version', () => {
      updateClaudeCodeConfig(testDir, { version: '2.1.80' })

      const version = getClaudeCodeVersion(testDir)
      expect(version).to.equal('2.1.80')
    })

    it('should use override when provided', () => {
      updateClaudeCodeConfig(testDir, { version: '2.1.80' })

      const version = getClaudeCodeVersion(testDir, '3.0.0')
      expect(version).to.equal('3.0.0')
    })

    it('should prefer override over workspace config', () => {
      updateClaudeCodeConfig(testDir, { version: '2.1.80' })

      const version = getClaudeCodeVersion(testDir, '1.0.0')
      expect(version).to.equal('1.0.0')
    })
  })
})
