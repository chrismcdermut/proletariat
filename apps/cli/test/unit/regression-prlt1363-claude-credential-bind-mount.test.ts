/**
 * Regression test for PRLT-1363
 *
 * Verifies that the Docker runner bind-mounts the host's ~/.claude directory
 * (read-only) into agent containers instead of using a stale Docker volume.
 * The host's Claude Code keeps OAuth tokens fresh, so mounting the live
 * directory ensures containers always have valid credentials.
 */
import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildContainerMounts,
} from '../../src/lib/execution/runners/docker-management.js'
import type { ExecutionContext } from '../../src/lib/execution/types.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

describe('PRLT-1363: Claude credential bind-mount (not Docker volume)', () => {
  // =========================================================================
  // buildContainerMounts — host bind-mount for credentials
  // =========================================================================
  describe('buildContainerMounts (docker-management)', () => {
    function makeContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
      return {
        ticketId: 'TKT-001',
        ticketTitle: 'Test ticket',
        agentName: 'test-agent',
        agentDir: '/path/to/agent',
        worktreePath: '/path/to/worktree',
        branch: 'main',
        hqPath: '/path/to/hq',
        ...overrides,
      }
    }

    it('should mount host ~/.claude at /home/node/.claude for claude-code executor', () => {
      const mounts = buildContainerMounts(makeContext(), 'claude-code')
      const claudeMount = mounts.find(m => m.includes('/home/node/.claude'))
      expect(claudeMount, 'No mount found for /home/node/.claude').to.exist
      // Must contain the host's .claude directory path
      expect(claudeMount).to.include('.claude:/home/node/.claude')
    })

    it('should mount ~/.claude as read-only (:ro)', () => {
      const mounts = buildContainerMounts(makeContext(), 'claude-code')
      const claudeMount = mounts.find(m => m.includes('/home/node/.claude'))
      expect(claudeMount, 'No mount found for /home/node/.claude').to.exist
      expect(claudeMount).to.include(':ro')
    })

    it('should NOT use the claude-credentials Docker volume', () => {
      const mounts = buildContainerMounts(makeContext(), 'claude-code')
      const claudeMount = mounts.find(m => m.includes('/home/node/.claude'))
      expect(claudeMount, 'No mount found for /home/node/.claude').to.exist
      // Must be a host bind-mount (contains a path separator), NOT a Docker volume name
      expect(claudeMount).to.not.include('claude-credentials:/home/node/.claude')
    })

    it('should not include credential mount for non-claude executors', () => {
      const mounts = buildContainerMounts(makeContext(), 'custom-executor' as any)
      const claudeMount = mounts.find(m => m.includes('/home/node/.claude'))
      expect(claudeMount).to.not.exist
    })

    it('should still include other mounts alongside credential mount', () => {
      const mounts = buildContainerMounts(makeContext(), 'claude-code')
      // Workspace mount
      const wsMount = mounts.find(m => m.includes('/workspace:'))
      expect(wsMount).to.exist
      // HQ mount
      const hqMount = mounts.find(m => m.includes('.proletariat:/hq/.proletariat'))
      expect(hqMount).to.exist
    })
  })

  // =========================================================================
  // Source code analysis — verifyCredentialMount accepts bind-mounts
  // =========================================================================
  describe('verifyCredentialMount (docker-management)', () => {
    const managementFile = path.resolve(
      __dirname,
      '../../src/lib/execution/runners/docker-management.ts'
    )
    let content: string

    before(() => {
      content = fs.readFileSync(managementFile, 'utf-8')
    })

    it('should check for /home/node/.claude Destination in mount list', () => {
      const fnMatch = content.match(
        /export function verifyCredentialMount\([\s\S]*?^}/m
      )
      expect(fnMatch, 'verifyCredentialMount function not found').to.exist
      const fnBody = fnMatch![0]
      // Must check for the Destination path (works for both bind-mounts and volumes)
      expect(fnBody).to.include('/home/node/.claude')
    })
  })

  // =========================================================================
  // Source code analysis — settings written to project-level path
  // =========================================================================
  describe('runContainerSetup — project-level settings path', () => {
    const managementFile = path.resolve(
      __dirname,
      '../../src/lib/execution/runners/docker-management.ts'
    )
    let content: string

    before(() => {
      content = fs.readFileSync(managementFile, 'utf-8')
    })

    it('should write settings.json to /workspace/.claude/ (not /home/node/.claude/)', () => {
      const fnMatch = content.match(
        /export function runContainerSetup\([\s\S]*?^}/m
      )
      expect(fnMatch, 'runContainerSetup function not found').to.exist
      const fnBody = fnMatch![0]

      // Agent-specific settings must go to /workspace/.claude/ (project-level, writable)
      // because /home/node/.claude is now a read-only bind-mount of the host
      expect(fnBody).to.include('/workspace/.claude/settings.json')
      // Must NOT write to /home/node/.claude/settings.json (read-only mount)
      expect(fnBody).to.not.include('/home/node/.claude/settings.json')
    })

    it('should write enforce-tests hook to /workspace/.claude/hooks/ (not /home/node/.claude/hooks/)', () => {
      const fnMatch = content.match(
        /export function runContainerSetup\([\s\S]*?^}/m
      )
      expect(fnMatch, 'runContainerSetup function not found').to.exist
      const fnBody = fnMatch![0]

      // Hook scripts must go to project-level writable path
      expect(fnBody).to.include('/workspace/.claude/hooks/')
      // Must NOT write to read-only mount
      expect(fnBody).to.not.include('/home/node/.claude/hooks/')
    })
  })
})
