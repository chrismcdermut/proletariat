/**
 * Regression test for PRLT-1366
 *
 * Verifies that the devcontainer runner bind-mounts the host's ~/.claude
 * directory (read-only) instead of using a stale Docker volume.
 *
 * The devcontainer path (devcontainer.ts) was using `source=claude-credentials,
 * target=/home/node/.claude,type=volume` while the Docker runner path
 * (docker-management.ts) had already been fixed in PRLT-1363 to use a host
 * bind mount. This test ensures both paths use the host bind mount.
 */
import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  generateDevcontainerJson,
  DevcontainerOptions,
} from '../../src/lib/execution/devcontainer.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

describe('PRLT-1366: Devcontainer credential bind-mount (not Docker volume)', () => {
  const makeOptions = (overrides: Partial<DevcontainerOptions> = {}): DevcontainerOptions => ({
    agentName: 'test-agent',
    agentDir: '/path/to/agents/staff/test-agent',
    ...overrides,
  })

  // =========================================================================
  // generateDevcontainerJson — host bind-mount for credentials
  // =========================================================================
  describe('generateDevcontainerJson — credential mount', () => {
    it('should use host bind mount for ~/.claude, not a Docker volume', () => {
      const result = generateDevcontainerJson(makeOptions())
      const credentialMount = result.mounts.find(m => m.includes('/home/node/.claude'))

      expect(credentialMount, 'No mount found for /home/node/.claude').to.exist
      // Must be type=bind, NOT type=volume
      expect(credentialMount).to.include('type=bind')
      expect(credentialMount).to.not.include('type=volume')
    })

    it('should reference host HOME directory via ${localEnv:HOME}/.claude', () => {
      const result = generateDevcontainerJson(makeOptions())
      const credentialMount = result.mounts.find(m => m.includes('/home/node/.claude'))

      expect(credentialMount, 'No mount found for /home/node/.claude').to.exist
      expect(credentialMount).to.include('${localEnv:HOME}/.claude')
    })

    it('should mount ~/.claude as readonly', () => {
      const result = generateDevcontainerJson(makeOptions())
      const credentialMount = result.mounts.find(m => m.includes('/home/node/.claude'))

      expect(credentialMount, 'No mount found for /home/node/.claude').to.exist
      expect(credentialMount).to.include('readonly')
    })

    it('should NOT use the claude-credentials Docker volume name', () => {
      const result = generateDevcontainerJson(makeOptions())
      const badMount = result.mounts.find(m => m.includes('claude-credentials'))

      expect(badMount, 'Found stale claude-credentials volume mount').to.not.exist
    })

    it('should not include credential mount for non-claude executors', () => {
      const result = generateDevcontainerJson(makeOptions({ executor: 'codex' }))
      const credentialMount = result.mounts.find(m => m.includes('/home/node/.claude'))

      expect(credentialMount).to.not.exist
    })

    it('should still include other mounts alongside credential bind mount', () => {
      const result = generateDevcontainerJson(makeOptions())

      // Workspace mount
      const wsMount = result.mounts.find(m => m.includes('/workspace'))
      expect(wsMount, 'workspace mount missing').to.exist
      // HQ mount
      const hqMount = result.mounts.find(m => m.includes('.proletariat'))
      expect(hqMount, 'HQ .proletariat mount missing').to.exist
      // PMO mount
      const pmoMount = result.mounts.find(m => m.includes('/hq/pmo'))
      expect(pmoMount, 'PMO mount missing').to.exist
    })
  })

  // =========================================================================
  // Source code analysis — updateDevcontainerMounts uses bind mount too
  // =========================================================================
  describe('updateDevcontainerMounts — also uses host bind mount', () => {
    const devcontainerFile = path.resolve(
      __dirname,
      '../../src/lib/execution/devcontainer.ts'
    )
    let content: string

    before(() => {
      content = fs.readFileSync(devcontainerFile, 'utf-8')
    })

    it('should NOT contain claude-credentials volume anywhere in the file', () => {
      // After PRLT-1366, no code path should reference the old Docker volume
      expect(content).to.not.include("source=claude-credentials,target=/home/node/.claude,type=volume")
    })

    it('should use ${localEnv:HOME}/.claude bind mount in updateDevcontainerMounts', () => {
      const fnMatch = content.match(
        /export function updateDevcontainerMounts\([\s\S]*?^}/m
      )
      expect(fnMatch, 'updateDevcontainerMounts function not found').to.exist
      const fnBody = fnMatch![0]

      expect(fnBody).to.include('${localEnv:HOME}/.claude')
      expect(fnBody).to.include('type=bind')
      expect(fnBody).to.include('readonly')
    })
  })
})
