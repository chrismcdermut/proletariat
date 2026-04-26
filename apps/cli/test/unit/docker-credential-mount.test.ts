/**
 * PRLT-1362: Docker agent credential mount and freshness tests
 *
 * Ensures:
 * 1. refreshCredentialVolume() syncs ALL credential files (not just .credentials.json)
 * 2. CREDENTIAL_SYNC_FILES includes .credentials.json and settings.json
 * 3. buildContainerMounts() includes credential volume mount for claude-code executor
 * 4. Reused containers are verified for credential mount presence
 * 5. verifyCredentialMount() function exists and inspects container mounts
 * 6. Orchestrator also uses CLAUDE_CREDENTIALS_VOLUME constant
 */
import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CREDENTIAL_SYNC_FILES } from '../../src/lib/execution/runners/docker-credentials.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

describe('Docker Credential Mount & Freshness (PRLT-1362)', () => {
  // =========================================================================
  // 1. CREDENTIAL_SYNC_FILES includes all required files
  // =========================================================================
  describe('CREDENTIAL_SYNC_FILES', () => {
    it('should include .credentials.json', () => {
      expect(CREDENTIAL_SYNC_FILES).to.include('.credentials.json')
    })

    it('should include settings.json', () => {
      expect(CREDENTIAL_SYNC_FILES).to.include('settings.json')
    })

    it('should be an array with at least 2 entries', () => {
      expect(CREDENTIAL_SYNC_FILES).to.be.an('array')
      expect(CREDENTIAL_SYNC_FILES.length).to.be.at.least(2)
    })
  })

  // =========================================================================
  // 2. refreshCredentialVolume() syncs ALL files, not just .credentials.json
  // =========================================================================
  describe('refreshCredentialVolume() — full directory sync', () => {
    const credentialsFile = path.resolve(
      __dirname,
      '../../src/lib/execution/runners/docker-credentials.ts'
    )
    let content: string

    before(() => {
      content = fs.readFileSync(credentialsFile, 'utf-8')
    })

    it('should reference CREDENTIAL_SYNC_FILES for determining which files to copy', () => {
      const fnMatch = content.match(
        /export function refreshCredentialVolume\(\)[\s\S]*?^}/m
      )
      expect(fnMatch, 'refreshCredentialVolume function not found').to.exist
      const fnBody = fnMatch![0]

      expect(fnBody).to.include('CREDENTIAL_SYNC_FILES')
    })

    it('should filter files based on host filesystem existence', () => {
      const fnMatch = content.match(
        /export function refreshCredentialVolume\(\)[\s\S]*?^}/m
      )
      expect(fnMatch, 'refreshCredentialVolume function not found').to.exist
      const fnBody = fnMatch![0]

      // Should check existence of each file before attempting copy
      expect(fnBody).to.include('existsSync')
      expect(fnBody).to.include('filter')
    })

    it('should build copy commands for all sync files (not hardcoded to one file)', () => {
      const fnMatch = content.match(
        /export function refreshCredentialVolume\(\)[\s\S]*?^}/m
      )
      expect(fnMatch, 'refreshCredentialVolume function not found').to.exist
      const fnBody = fnMatch![0]

      // Should dynamically build copy commands from the file list
      expect(fnBody).to.include('copyCommands')
      expect(fnBody).to.include('.map')
    })

    it('should set ownership to UID 1000 for each copied file', () => {
      const fnMatch = content.match(
        /export function refreshCredentialVolume\(\)[\s\S]*?^}/m
      )
      expect(fnMatch, 'refreshCredentialVolume function not found').to.exist
      const fnBody = fnMatch![0]

      expect(fnBody).to.include('chown 1000:1000')
    })

    it('should check for ~/.claude directory existence (not just .credentials.json)', () => {
      const fnMatch = content.match(
        /export function refreshCredentialVolume\(\)[\s\S]*?^}/m
      )
      expect(fnMatch, 'refreshCredentialVolume function not found').to.exist
      const fnBody = fnMatch![0]

      // Should check the directory, not a specific file
      expect(fnBody).to.include("hostClaudeDir")
    })
  })

  // =========================================================================
  // 3. buildContainerMounts() includes credential mount
  // =========================================================================
  describe('buildContainerMounts() — credential volume mount', () => {
    const managementFile = path.resolve(
      __dirname,
      '../../src/lib/execution/runners/docker-management.ts'
    )
    let content: string

    before(() => {
      content = fs.readFileSync(managementFile, 'utf-8')
    })

    it('should include credential volume mount for Claude executor', () => {
      const fnMatch = content.match(
        /export function buildContainerMounts\([\s\S]*?^}/m
      )
      expect(fnMatch, 'buildContainerMounts function not found').to.exist
      const fnBody = fnMatch![0]

      expect(fnBody).to.include('CLAUDE_CREDENTIALS_VOLUME')
      expect(fnBody).to.include('/home/node/.claude')
      expect(fnBody).to.include('isClaudeExecutor')
    })

    it('should use CLAUDE_CREDENTIALS_VOLUME constant (not hardcoded string)', () => {
      const fnMatch = content.match(
        /export function buildContainerMounts\([\s\S]*?^}/m
      )
      expect(fnMatch, 'buildContainerMounts function not found').to.exist
      const fnBody = fnMatch![0]

      // Should use the constant, not the literal string 'claude-credentials'
      expect(fnBody).to.include('CLAUDE_CREDENTIALS_VOLUME')
    })

    it('should import CLAUDE_CREDENTIALS_VOLUME from docker-credentials', () => {
      expect(content).to.include("import { CLAUDE_CREDENTIALS_VOLUME } from './docker-credentials.js'")
    })
  })

  // =========================================================================
  // 4. verifyCredentialMount() exists and works correctly
  // =========================================================================
  describe('verifyCredentialMount()', () => {
    const managementFile = path.resolve(
      __dirname,
      '../../src/lib/execution/runners/docker-management.ts'
    )
    let content: string

    before(() => {
      content = fs.readFileSync(managementFile, 'utf-8')
    })

    it('should exist as an exported function', () => {
      expect(content).to.include('export function verifyCredentialMount(')
    })

    it('should accept containerId and executor parameters', () => {
      const fnMatch = content.match(
        /export function verifyCredentialMount\([\s\S]*?^}/m
      )
      expect(fnMatch, 'verifyCredentialMount function not found').to.exist
      const fnBody = fnMatch![0]

      expect(fnBody).to.include('containerId')
      expect(fnBody).to.include('executor')
    })

    it('should skip verification for non-Claude executors', () => {
      const fnMatch = content.match(
        /export function verifyCredentialMount\([\s\S]*?^}/m
      )
      expect(fnMatch, 'verifyCredentialMount function not found').to.exist
      const fnBody = fnMatch![0]

      expect(fnBody).to.include('isClaudeExecutor')
      // Should return true early for non-Claude executors
      expect(fnBody).to.include('return true')
    })

    it('should use docker inspect to check mounts', () => {
      const fnMatch = content.match(
        /export function verifyCredentialMount\([\s\S]*?^}/m
      )
      expect(fnMatch, 'verifyCredentialMount function not found').to.exist
      const fnBody = fnMatch![0]

      expect(fnBody).to.include('docker inspect')
      expect(fnBody).to.include('Mounts')
    })

    it('should check for /home/node/.claude destination or credential volume name', () => {
      const fnMatch = content.match(
        /export function verifyCredentialMount\([\s\S]*?^}/m
      )
      expect(fnMatch, 'verifyCredentialMount function not found').to.exist
      const fnBody = fnMatch![0]

      expect(fnBody).to.include('/home/node/.claude')
      expect(fnBody).to.include('CLAUDE_CREDENTIALS_VOLUME')
    })

    it('should return false when inspect fails (safe default)', () => {
      const fnMatch = content.match(
        /export function verifyCredentialMount\([\s\S]*?^}/m
      )
      expect(fnMatch, 'verifyCredentialMount function not found').to.exist
      const fnBody = fnMatch![0]

      // On failure, should assume mount is missing
      expect(fnBody).to.include('return false')
    })
  })

  // =========================================================================
  // 5. ensureDockerContainerDetailed() checks credential mount on reuse
  // =========================================================================
  describe('ensureDockerContainerDetailed() — credential mount verification on reuse', () => {
    const managementFile = path.resolve(
      __dirname,
      '../../src/lib/execution/runners/docker-management.ts'
    )
    let content: string

    before(() => {
      content = fs.readFileSync(managementFile, 'utf-8')
    })

    it('should call verifyCredentialMount when reusing a running container', () => {
      const fnMatch = content.match(
        /export function ensureDockerContainerDetailed\([\s\S]*?^}/m
      )
      expect(fnMatch, 'ensureDockerContainerDetailed function not found').to.exist
      const fnBody = fnMatch![0]

      expect(fnBody).to.include('verifyCredentialMount')
    })

    it('should force container recreation when credential mount is missing', () => {
      const fnMatch = content.match(
        /export function ensureDockerContainerDetailed\([\s\S]*?^}/m
      )
      expect(fnMatch, 'ensureDockerContainerDetailed function not found').to.exist
      const fnBody = fnMatch![0]

      // Should contain logic to remove container when mount is missing
      // Look for the pattern: if (!verifyCredentialMount...) { ... docker rm ...}
      const verifyIdx = fnBody.indexOf('verifyCredentialMount')
      expect(verifyIdx).to.be.greaterThan(-1)

      // After the verify check, there should be a docker rm -f
      const afterVerify = fnBody.substring(verifyIdx, verifyIdx + 500)
      expect(afterVerify).to.include('docker rm -f')
    })

    it('should log a debug message when recreating due to missing mount', () => {
      const fnMatch = content.match(
        /export function ensureDockerContainerDetailed\([\s\S]*?^}/m
      )
      expect(fnMatch, 'ensureDockerContainerDetailed function not found').to.exist
      const fnBody = fnMatch![0]

      expect(fnBody).to.include('missing credential mount')
    })
  })

  // =========================================================================
  // 6. Orchestrator uses CLAUDE_CREDENTIALS_VOLUME constant
  // =========================================================================
  describe('Orchestrator — credential volume mount', () => {
    const orchestratorFile = path.resolve(
      __dirname,
      '../../src/lib/execution/runners/orchestrator.ts'
    )
    let content: string

    before(() => {
      content = fs.readFileSync(orchestratorFile, 'utf-8')
    })

    it('should import CLAUDE_CREDENTIALS_VOLUME', () => {
      expect(content).to.include('CLAUDE_CREDENTIALS_VOLUME')
    })

    it('should use CLAUDE_CREDENTIALS_VOLUME constant for mount (not hardcoded)', () => {
      // Find the mount definition in the orchestrator
      expect(content).to.include('CLAUDE_CREDENTIALS_VOLUME')
      expect(content).to.include('/home/node/.claude')
    })
  })

  // =========================================================================
  // 7. shared.ts re-exports
  // =========================================================================
  describe('shared.ts — new re-exports', () => {
    const sharedFile = path.resolve(
      __dirname,
      '../../src/lib/execution/runners/shared.ts'
    )
    let content: string

    before(() => {
      content = fs.readFileSync(sharedFile, 'utf-8')
    })

    it('should re-export verifyCredentialMount from docker-management', () => {
      expect(content).to.include('verifyCredentialMount')
    })

    it('should re-export CREDENTIAL_SYNC_FILES from docker-credentials', () => {
      expect(content).to.include('CREDENTIAL_SYNC_FILES')
    })
  })
})
