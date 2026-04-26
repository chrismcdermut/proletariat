/**
 * PRLT-1296: Docker agents version pinning and credential refresh tests
 *
 * Ensures:
 * 1. getHostClaudeCodeVersion() correctly parses `claude --version` output
 * 2. ensureDockerContainer() passes host CC version as CC_VERSION build arg
 * 3. refreshCredentialVolume() copies host credentials into Docker volume with correct ownership
 * 4. refreshCredentialVolume() uses --pull never to avoid Docker Hub auth issues
 * 5. Credential refresh is called before container spawn in runDevcontainer()
 * 6. Early-exit detection catches agents that die immediately after spawn
 */
import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCCVersionOutput } from '../../src/lib/execution/cc-version.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

describe('Docker Version Pinning & Credential Refresh (PRLT-1296)', () => {
  // =========================================================================
  // 1. Host Claude Code version detection
  // =========================================================================
  describe('getHostClaudeCodeVersion()', () => {
    const managementFile = path.resolve(
      __dirname,
      '../../src/lib/execution/runners/docker-management.ts'
    )
    let content: string

    before(() => {
      content = fs.readFileSync(managementFile, 'utf-8')
    })

    it('should exist as an exported function', () => {
      expect(content).to.include('export function getHostClaudeCodeVersion()')
    })

    it('should call claude --version to detect host version', () => {
      const fnMatch = content.match(
        /export function getHostClaudeCodeVersion\(\)[\s\S]*?^}/m
      )
      expect(fnMatch, 'getHostClaudeCodeVersion function not found').to.exist
      expect(fnMatch![0]).to.include('claude --version')
    })

    it('should parse semver version from output', () => {
      const fnMatch = content.match(
        /export function getHostClaudeCodeVersion\(\)[\s\S]*?^}/m
      )
      expect(fnMatch, 'getHostClaudeCodeVersion function not found').to.exist
      // Should extract version pattern like getHostPrltVersion does
      expect(fnMatch![0]).to.match(/match.*\\d/)
    })

    it('should return null on failure (not throw)', () => {
      const fnMatch = content.match(
        /export function getHostClaudeCodeVersion\(\)[\s\S]*?^}/m
      )
      expect(fnMatch, 'getHostClaudeCodeVersion function not found').to.exist
      expect(fnMatch![0]).to.include('return null')
      expect(fnMatch![0]).to.include('catch')
    })

    it('should set a timeout to avoid hanging', () => {
      const fnMatch = content.match(
        /export function getHostClaudeCodeVersion\(\)[\s\S]*?^}/m
      )
      expect(fnMatch, 'getHostClaudeCodeVersion function not found').to.exist
      expect(fnMatch![0]).to.include('timeout')
    })
  })

  // =========================================================================
  // 2. CC version output parsing (unit tests using shared parseCCVersionOutput)
  // =========================================================================
  describe('parseCCVersionOutput()', () => {
    it('should parse "2.1.89" from "claude 2.1.89"', () => {
      expect(parseCCVersionOutput('claude 2.1.89')).to.equal('2.1.89')
    })

    it('should parse bare version string "2.1.100"', () => {
      expect(parseCCVersionOutput('2.1.100')).to.equal('2.1.100')
    })

    it('should parse version with pre-release suffix', () => {
      expect(parseCCVersionOutput('claude 2.1.89-beta.1')).to.equal('2.1.89-beta.1')
    })

    it('should return undefined for empty string', () => {
      expect(parseCCVersionOutput('')).to.be.undefined
    })

    it('should return undefined for non-version output', () => {
      expect(parseCCVersionOutput('Not logged in')).to.be.undefined
    })
  })

  // =========================================================================
  // 3. ensureDockerContainer() pins CC version to host
  // =========================================================================
  describe('ensureDockerContainer() — CC version pinning', () => {
    const managementFile = path.resolve(
      __dirname,
      '../../src/lib/execution/runners/docker-management.ts'
    )
    let content: string

    before(() => {
      content = fs.readFileSync(managementFile, 'utf-8')
    })

    it('should detect host CC version when no config pin exists', () => {
      const fnMatch = content.match(
        /export function ensureDockerContainer\([\s\S]*?^}/m
      )
      expect(fnMatch, 'ensureDockerContainer function not found').to.exist
      const fnBody = fnMatch![0]

      // Should call getHostClaudeCodeVersion() when no config pin
      expect(fnBody).to.include('getHostClaudeCodeVersion()')
    })

    it('should pass CC_VERSION as build arg', () => {
      const fnMatch = content.match(
        /export function ensureDockerContainer\([\s\S]*?^}/m
      )
      expect(fnMatch, 'ensureDockerContainer function not found').to.exist
      const fnBody = fnMatch![0]

      // Should set buildArgs.CC_VERSION from host version
      expect(fnBody).to.include("buildArgs.CC_VERSION")
    })

    it('should prefer devcontainer config pin over host detection', () => {
      const fnMatch = content.match(
        /export function ensureDockerContainer\([\s\S]*?^}/m
      )
      expect(fnMatch, 'ensureDockerContainer function not found').to.exist
      const fnBody = fnMatch![0]

      // The config-based pin should be checked first
      expect(fnBody).to.include('ccVersionFromConfig')
      // Config should be read from devcontainerJson
      expect(fnBody).to.include('CC_VERSION')
    })
  })

  // =========================================================================
  // 4. refreshCredentialVolume()
  // =========================================================================
  describe('refreshCredentialVolume()', () => {
    const credentialsFile = path.resolve(
      __dirname,
      '../../src/lib/execution/runners/docker-credentials.ts'
    )
    let content: string

    before(() => {
      content = fs.readFileSync(credentialsFile, 'utf-8')
    })

    it('should exist as an exported function', () => {
      expect(content).to.include('export function refreshCredentialVolume()')
    })

    it('should check for host credential directory before attempting copy', () => {
      const fnMatch = content.match(
        /export function refreshCredentialVolume\(\)[\s\S]*?^}/m
      )
      expect(fnMatch, 'refreshCredentialVolume function not found').to.exist
      const fnBody = fnMatch![0]

      // PRLT-1362: Should check ~/.claude directory (not just a single file)
      // and use CREDENTIAL_SYNC_FILES to determine which files to sync
      expect(fnBody).to.include('existsSync')
      expect(fnBody).to.include('CREDENTIAL_SYNC_FILES')
    })

    it('should use --pull never to avoid Docker Hub auth issues', () => {
      const fnMatch = content.match(
        /export function refreshCredentialVolume\(\)[\s\S]*?^}/m
      )
      expect(fnMatch, 'refreshCredentialVolume function not found').to.exist
      const fnBody = fnMatch![0]

      // All docker run commands must use --pull never
      const dockerRunCommands = fnBody.match(/docker run[^`'"]*(?=['"`])/g) || []
      for (const cmd of dockerRunCommands) {
        expect(cmd).to.include(
          '--pull never',
          `refreshCredentialVolume() has docker run without --pull never: "${cmd}"`
        )
      }
    })

    it('should mount host ~/.claude as read-only source', () => {
      const fnMatch = content.match(
        /export function refreshCredentialVolume\(\)[\s\S]*?^}/m
      )
      expect(fnMatch, 'refreshCredentialVolume function not found').to.exist
      const fnBody = fnMatch![0]

      // Host .claude dir should be mounted read-only
      expect(fnBody).to.include('/src:ro')
    })

    it('should mount claude-credentials volume as destination', () => {
      const fnMatch = content.match(
        /export function refreshCredentialVolume\(\)[\s\S]*?^}/m
      )
      expect(fnMatch, 'refreshCredentialVolume function not found').to.exist
      const fnBody = fnMatch![0]

      // Should mount the credential volume
      expect(fnBody).to.include('CLAUDE_CREDENTIALS_VOLUME')
    })

    it('should set file ownership to UID 1000 (node user)', () => {
      const fnMatch = content.match(
        /export function refreshCredentialVolume\(\)[\s\S]*?^}/m
      )
      expect(fnMatch, 'refreshCredentialVolume function not found').to.exist
      const fnBody = fnMatch![0]

      // Must chown to 1000:1000 (node user in container)
      expect(fnBody).to.include('1000:1000')
    })

    it('should return boolean indicating success/failure', () => {
      const fnMatch = content.match(
        /export function refreshCredentialVolume\(\)[\s\S]*?^}/m
      )
      expect(fnMatch, 'refreshCredentialVolume function not found').to.exist
      const fnBody = fnMatch![0]

      expect(fnBody).to.include('return true')
      expect(fnBody).to.include('return false')
    })

    it('should have a fallback when alpine image is not cached', () => {
      const fnMatch = content.match(
        /export function refreshCredentialVolume\(\)[\s\S]*?^}/m
      )
      expect(fnMatch, 'refreshCredentialVolume function not found').to.exist
      const fnBody = fnMatch![0]

      // Should have a fallback using node:22 which is already pulled for agent builds
      expect(fnBody).to.include('node:22')
    })
  })

  // =========================================================================
  // 5. Credential refresh wired into runDevcontainer()
  // =========================================================================
  describe('runDevcontainer() — credential refresh integration', () => {
    const devcontainerFile = path.resolve(
      __dirname,
      '../../src/lib/execution/runners/devcontainer.ts'
    )
    let content: string

    before(() => {
      content = fs.readFileSync(devcontainerFile, 'utf-8')
    })

    it('should import refreshCredentialVolume', () => {
      expect(content).to.include('refreshCredentialVolume')
    })

    it('should call refreshCredentialVolume() before ensureDockerContainer()', () => {
      const fnMatch = content.match(
        /export async function runDevcontainer\([\s\S]*?^}/m
      )
      expect(fnMatch, 'runDevcontainer function not found').to.exist
      const fnBody = fnMatch![0]

      // refreshCredentialVolume should appear before ensureDockerContainer
      const refreshIndex = fnBody.indexOf('refreshCredentialVolume()')
      const ensureIndex = fnBody.indexOf('ensureDockerContainer(')
      expect(refreshIndex, 'refreshCredentialVolume() not found in runDevcontainer').to.be.greaterThan(-1)
      expect(ensureIndex, 'ensureDockerContainer() not found in runDevcontainer').to.be.greaterThan(-1)
      expect(refreshIndex).to.be.lessThan(
        ensureIndex,
        'refreshCredentialVolume() must be called BEFORE ensureDockerContainer() to ensure fresh tokens'
      )
    })

    it('should only refresh credentials for Claude Code executors', () => {
      const fnMatch = content.match(
        /export async function runDevcontainer\([\s\S]*?^}/m
      )
      expect(fnMatch, 'runDevcontainer function not found').to.exist
      const fnBody = fnMatch![0]

      // Find the block containing refreshCredentialVolume
      // It should be inside an isClaudeExecutor check
      const lines = fnBody.split('\n')
      const refreshLine = lines.findIndex(l => l.includes('refreshCredentialVolume()'))
      expect(refreshLine).to.be.greaterThan(-1)

      // Look backward for the isClaudeExecutor guard
      const contextBefore = lines.slice(Math.max(0, refreshLine - 10), refreshLine).join('\n')
      expect(contextBefore).to.include(
        'isClaudeExecutor',
        'refreshCredentialVolume() should be guarded by isClaudeExecutor() check'
      )
    })
  })

  // =========================================================================
  // 6. Early-exit detection for dead Docker agents
  // =========================================================================
  describe('runDevcontainerInTmux() — early-exit detection', () => {
    const tmuxFile = path.resolve(
      __dirname,
      '../../src/lib/execution/runners/devcontainer-tmux.ts'
    )
    let content: string

    before(() => {
      content = fs.readFileSync(tmuxFile, 'utf-8')
    })

    it('should re-check tmux session after initial verification in background mode', () => {
      const fnMatch = content.match(
        /export async function runDevcontainerInTmux\([\s\S]*?^}/m
      )
      expect(fnMatch, 'runDevcontainerInTmux function not found').to.exist
      const fnBody = fnMatch![0]

      // Extract the background mode block
      const bgStartIdx = fnBody.indexOf("displayMode === 'background'")
      expect(bgStartIdx).to.be.greaterThan(-1, 'Background mode block not found')

      const bgBlock = fnBody.substring(bgStartIdx, bgStartIdx + 2000)

      // Should have TWO has-session checks in background mode (initial + re-check)
      const hasSessionMatches = bgBlock.match(/has-session/g) || []
      expect(hasSessionMatches.length).to.be.at.least(
        2,
        'Background mode should have at least 2 has-session checks: initial verification + early-exit detection'
      )
    })

    it('should return failure with descriptive error when session dies immediately', () => {
      const fnMatch = content.match(
        /export async function runDevcontainerInTmux\([\s\S]*?^}/m
      )
      expect(fnMatch, 'runDevcontainerInTmux function not found').to.exist
      const fnBody = fnMatch![0]

      // The early-exit error should mention authentication/credentials
      expect(fnBody).to.include('authentication failure')
      // Should suggest checking container logs
      expect(fnBody).to.include('docker logs')
    })

    it('should wait before re-checking to allow Claude to start', () => {
      const fnMatch = content.match(
        /export async function runDevcontainerInTmux\([\s\S]*?^}/m
      )
      expect(fnMatch, 'runDevcontainerInTmux function not found').to.exist
      const fnBody = fnMatch![0]

      // Extract background mode block
      const bgStartIdx = fnBody.indexOf("displayMode === 'background'")
      const bgBlock = fnBody.substring(bgStartIdx, bgStartIdx + 2000)

      // Should have a delay (setTimeout) between the two checks
      const setTimeoutMatches = bgBlock.match(/setTimeout/g) || []
      expect(setTimeoutMatches.length).to.be.at.least(
        2,
        'Background mode should have at least 2 setTimeout calls: initial wait + early-exit wait'
      )
    })
  })

  // =========================================================================
  // 7. Re-exports from shared.ts
  // =========================================================================
  describe('shared.ts re-exports', () => {
    const sharedFile = path.resolve(
      __dirname,
      '../../src/lib/execution/runners/shared.ts'
    )
    let content: string

    before(() => {
      content = fs.readFileSync(sharedFile, 'utf-8')
    })

    it('should re-export refreshCredentialVolume from docker-credentials', () => {
      expect(content).to.include('refreshCredentialVolume')
    })

    it('should re-export getHostClaudeCodeVersion from docker-management', () => {
      expect(content).to.include('getHostClaudeCodeVersion')
    })
  })

  // =========================================================================
  // 8. Dockerfile supports CC_VERSION build arg
  // =========================================================================
  describe('Dockerfile template — CC_VERSION arg', () => {
    const devcontainerFile = path.resolve(
      __dirname,
      '../../src/lib/execution/devcontainer.ts'
    )
    let content: string

    before(() => {
      content = fs.readFileSync(devcontainerFile, 'utf-8')
    })

    it('should declare CC_VERSION as a build arg', () => {
      expect(content).to.include('ARG CC_VERSION=')
    })

    it('should conditionally pin version when CC_VERSION is set', () => {
      // The Dockerfile should use ${CC_VERSION:+@${CC_VERSION}} syntax
      // which expands to @<version> when CC_VERSION is set, nothing otherwise
      expect(content).to.include('CC_VERSION:+@')
    })
  })
})
