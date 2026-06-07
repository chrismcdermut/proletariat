/**
 * PRLT-1364 / PRLT-1365: Single source of truth for Docker container mounts
 * and consolidated Docker runner code path.
 *
 * Ensures:
 * 1. runDocker (simple detached runner) lives in docker-management.ts and uses buildContainerMounts()
 * 2. docker-management.ts createDockerContainer() uses buildContainerMounts()
 * 3. devcontainer.ts calls ensureDockerContainerDetailed() (which calls buildContainerMounts())
 * 4. buildContainerMounts() includes ~/.claude bind-mount for claude-code executor
 * 5. buildContainerMounts() does NOT include ~/.claude for non-claude executors
 * 6. The legacy docker.ts file no longer exists (PRLT-1365)
 * 7. No Docker code path builds its own mount list inline
 *
 * Regression guard: if a separate Docker runner file is reintroduced, or if a
 * new Docker code path is added that skips buildContainerMounts(), these tests fail.
 */
import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildContainerMounts, runDocker } from '../../src/lib/execution/runners/docker-management.js'
import type { ExecutionContext } from '../../src/lib/execution/types.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const RUNNERS_DIR = path.resolve(__dirname, '../../src/lib/execution/runners')

describe('Single mount code path (PRLT-1364) + consolidated runner (PRLT-1365)', () => {
  // =========================================================================
  // 1. runDocker lives in docker-management.ts and uses buildContainerMounts()
  // =========================================================================
  describe('runDocker — consolidated into docker-management.ts (PRLT-1365)', () => {
    const managementFile = path.join(RUNNERS_DIR, 'docker-management.ts')
    let content: string

    before(() => {
      content = fs.readFileSync(managementFile, 'utf-8')
    })

    it('runDocker is exported as a function', () => {
      expect(typeof runDocker).to.equal('function')
    })

    it('runDocker is defined inside docker-management.ts (not a separate file)', () => {
      const fnMatch = content.match(
        /export async function runDocker\([\s\S]*?^}/m
      )
      expect(fnMatch, 'runDocker function not found in docker-management.ts').to.exist
    })

    it('runDocker calls buildContainerMounts(context, executor)', () => {
      const fnMatch = content.match(
        /export async function runDocker\([\s\S]*?^}/m
      )
      expect(fnMatch, 'runDocker function not found').to.exist
      const fnBody = fnMatch![0]
      expect(fnBody).to.include('buildContainerMounts(context, executor)')
    })

    it('runDocker does NOT have inline -v worktreePath:/workspace mount', () => {
      const fnMatch = content.match(
        /export async function runDocker\([\s\S]*?^}/m
      )
      expect(fnMatch, 'runDocker function not found').to.exist
      const fnBody = fnMatch![0]
      // The old inline mount that was replaced by PRLT-1364:
      expect(fnBody).to.not.include('-v "${context.worktreePath}:/workspace"')
    })

    it('the legacy docker.ts file has been removed', () => {
      const legacyFile = path.join(RUNNERS_DIR, 'docker.ts')
      expect(fs.existsSync(legacyFile), 'legacy docker.ts should be deleted').to.equal(false)
    })
  })

  // =========================================================================
  // 2. docker-management.ts createDockerContainer() uses buildContainerMounts()
  // =========================================================================
  describe('docker-management.ts — createDockerContainer uses buildContainerMounts()', () => {
    const managementFile = path.join(RUNNERS_DIR, 'docker-management.ts')
    let content: string

    before(() => {
      content = fs.readFileSync(managementFile, 'utf-8')
    })

    it('createDockerContainer should call buildContainerMounts()', () => {
      const fnMatch = content.match(
        /export function createDockerContainer\([\s\S]*?^}/m
      )
      expect(fnMatch, 'createDockerContainer function not found').to.exist
      const fnBody = fnMatch![0]
      expect(fnBody).to.include('buildContainerMounts(context, executor)')
    })
  })

  // =========================================================================
  // 3. devcontainer.ts uses ensureDockerContainerDetailed() pipeline
  // =========================================================================
  describe('devcontainer.ts — uses docker-management pipeline', () => {
    const devcontainerFile = path.join(RUNNERS_DIR, 'devcontainer.ts')
    let content: string

    before(() => {
      content = fs.readFileSync(devcontainerFile, 'utf-8')
    })

    it('should import ensureDockerContainerDetailed from shared', () => {
      expect(content).to.include('ensureDockerContainerDetailed')
    })

    it('should call ensureDockerContainerDetailed in runDevcontainer()', () => {
      const fnMatch = content.match(
        /export async function runDevcontainer\([\s\S]*?^}/m
      )
      expect(fnMatch, 'runDevcontainer function not found').to.exist
      const fnBody = fnMatch![0]
      expect(fnBody).to.include('ensureDockerContainerDetailed(context, config, executor)')
    })

    it('should NOT build its own mount list with inline -v flags', () => {
      const fnMatch = content.match(
        /export async function runDevcontainer\([\s\S]*?^}/m
      )
      expect(fnMatch, 'runDevcontainer function not found').to.exist
      const fnBody = fnMatch![0]

      // Should not have inline volume mount construction
      expect(fnBody).to.not.match(/-v\s+"[^"]*:\/workspace/)
      expect(fnBody).to.not.match(/-v\s+"[^"]*:\/home\/node\/\.claude/)
    })
  })

  // =========================================================================
  // 4. buildContainerMounts() includes ~/.claude bind-mount for claude-code
  // =========================================================================
  describe('buildContainerMounts() — credential bind-mount', () => {
    const testContext: ExecutionContext = {
      ticketId: 'PRLT-TEST',
      ticketTitle: 'test ticket',
      agentName: 'test-agent',
      agentDir: '/tmp/test-agent',
      worktreePath: '/tmp/test-agent',
      branch: 'PRLT-TEST/feat/test',
    }

    it('should include ~/.claude:/home/node/.claude:ro for claude-code executor', () => {
      const mounts = buildContainerMounts(testContext, 'claude-code')
      const credentialMount = mounts.find(m => m.includes('/home/node/.claude'))
      expect(credentialMount, 'credential bind-mount not found').to.exist
      expect(credentialMount).to.include(':ro')
    })

    it('should include ~/.claude for default executor (claude-code)', () => {
      const mounts = buildContainerMounts(testContext)
      const credentialMount = mounts.find(m => m.includes('/home/node/.claude'))
      expect(credentialMount, 'credential bind-mount not found for default executor').to.exist
    })

    it('should NOT include ~/.claude for non-claude executors', () => {
      const mounts = buildContainerMounts(testContext, 'codex')
      const credentialMount = mounts.find(m => m.includes('/home/node/.claude'))
      expect(credentialMount, 'credential mount should NOT be present for codex').to.not.exist
    })

    it('should always include the workspace mount', () => {
      const mounts = buildContainerMounts(testContext, 'claude-code')
      const workspaceMount = mounts.find(m => m.includes(':/workspace'))
      expect(workspaceMount, 'workspace mount not found').to.exist
    })

    it('should include HQ mount when hqPath is set', () => {
      const contextWithHq = { ...testContext, hqPath: '/tmp/test-hq' }
      const mounts = buildContainerMounts(contextWithHq, 'claude-code')
      const hqMount = mounts.find(m => m.includes('/hq/.proletariat'))
      expect(hqMount, 'HQ mount not found').to.exist
    })
  })

  // =========================================================================
  // 5. No other Docker runner builds inline mounts (regression guard)
  // =========================================================================
  describe('Regression guard — no inline mount building in runners', () => {
    it('runDocker in docker-management.ts should not contain -v "${context. patterns', () => {
      const managementContent = fs.readFileSync(
        path.join(RUNNERS_DIR, 'docker-management.ts'),
        'utf-8'
      )
      const fnMatch = managementContent.match(
        /export async function runDocker\([\s\S]*?^}/m
      )
      expect(fnMatch, 'runDocker function not found').to.exist
      const fnBody = fnMatch![0]
      // Strip comments to check only code
      const codeLines = fnBody.split('\n')
        .filter(line => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
        .join('\n')

      // Should not have inline volume mounts referencing context paths directly
      const inlineMountPattern = /dockerCmd\s*\+=\s*.*-v\s+"?\$\{context\./
      expect(codeLines).to.not.match(inlineMountPattern)
    })
  })
})
