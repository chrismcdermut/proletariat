/**
 * Docker Auth Fallback — Regression tests for PRLT-1108
 *
 * Ensures:
 * 1. dockerCredentialsExist() and getDockerCredentialInfo() never pull images
 *    from Docker Hub (uses --pull never to avoid locked keychain / headless failures)
 * 2. Non-interactive mode (--yes or !isTTY) never silently falls back to host
 *    when Docker credentials are missing — must error with actionable message
 */
import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

describe('Docker Auth Fallback Guards (PRLT-1108)', () => {
  // =========================================================================
  // Guard 1: Credential check must not pull images from Docker Hub
  // =========================================================================
  describe('docker-credentials.ts — no image pulls', () => {
    const credentialsFile = path.resolve(
      __dirname,
      '../../src/lib/execution/runners/docker-credentials.ts'
    )
    let content: string

    before(() => {
      content = fs.readFileSync(credentialsFile, 'utf-8')
    })

    it('dockerCredentialsExist() should use --pull never to avoid Docker Hub auth', () => {
      // Extract the dockerCredentialsExist function body
      const fnMatch = content.match(
        /export function dockerCredentialsExist\(\)[\s\S]*?^}/m
      )
      expect(fnMatch, 'dockerCredentialsExist function not found').to.exist

      const fnBody = fnMatch![0]

      // If it uses `docker run`, it MUST include --pull never
      if (fnBody.includes('docker run')) {
        expect(fnBody).to.include(
          '--pull never',
          'dockerCredentialsExist() uses `docker run` without --pull never. ' +
            'This will fail when the macOS Keychain is locked because Docker ' +
            'cannot authenticate with Docker Hub to pull the image.'
        )

        // Must NOT have a bare `docker run` without --pull never
        // Match `docker run` that is NOT followed by `--pull never` in the same command
        const dockerRunCommands = fnBody.match(/docker run[^`\n]*/g) || []
        for (const cmd of dockerRunCommands) {
          expect(cmd).to.include(
            '--pull never',
            `Found docker run command without --pull never: "${cmd}"`
          )
        }
      }
    })

    it('dockerCredentialsExist() should check volume existence before running a container', () => {
      const fnMatch = content.match(
        /export function dockerCredentialsExist\(\)[\s\S]*?^}/m
      )
      expect(fnMatch, 'dockerCredentialsExist function not found').to.exist

      const fnBody = fnMatch![0]

      // Must call credentialsVolumeExists() as a lightweight first check
      expect(fnBody).to.include(
        'credentialsVolumeExists()',
        'dockerCredentialsExist() should call credentialsVolumeExists() as a ' +
          'lightweight first check (docker volume inspect) before attempting ' +
          'to run a container.'
      )
    })

    it('getDockerCredentialInfo() should use --pull never to avoid Docker Hub auth', () => {
      const fnMatch = content.match(
        /export function getDockerCredentialInfo\(\)[\s\S]*?^}/m
      )
      expect(fnMatch, 'getDockerCredentialInfo function not found').to.exist

      const fnBody = fnMatch![0]

      if (fnBody.includes('docker run')) {
        const dockerRunCommands = fnBody.match(/docker run[^`\n]*/g) || []
        for (const cmd of dockerRunCommands) {
          expect(cmd).to.include(
            '--pull never',
            `getDockerCredentialInfo() has docker run without --pull never: "${cmd}"`
          )
        }
      }
    })
  })

  // =========================================================================
  // Guard 2: Non-interactive mode must never silently fall back to host
  // =========================================================================
  describe('work/start.ts — no silent host fallback in non-interactive mode', () => {
    const startFile = path.resolve(
      __dirname,
      '../../src/commands/work/start.ts'
    )
    let content: string

    before(() => {
      content = fs.readFileSync(startFile, 'utf-8')
    })

    it('should not contain "Switched to host environment" in non-interactive credential blocks', () => {
      // Find all blocks that check flags.yes or !process.stdout.isTTY
      // and ensure none of them silently switch to host when credentials are missing.
      //
      // The pattern we're guarding against:
      //   if (flags.yes || !process.stdout.isTTY) {
      //     environment = 'host'
      //     this.log(...'Switched to host environment'...)
      //   }
      //
      // Instead, these blocks should call this.error() to force the user
      // to explicitly opt in with --run-on-host.

      const lines = content.split('\n')
      const violations: string[] = []

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]

        // Look for the silent fallback pattern: setting environment to 'host'
        // after a "Switched to host" message in a non-interactive block
        if (
          line.includes("'Switched to host environment") ||
          line.includes('"Switched to host environment')
        ) {
          // Check the surrounding context (10 lines above) for non-interactive check
          const context = lines.slice(Math.max(0, i - 10), i + 1).join('\n')
          if (
            context.includes('flags.yes') ||
            context.includes('!process.stdout.isTTY')
          ) {
            // This is a silent fallback in non-interactive mode — it should use this.error() instead
            // Exception: interactive prompt callbacks (user chose 'host' from a menu) are OK
            const isAfterPrompt = context.includes('dockerAction') ||
              context.includes('authAction') ||
              context.includes('tokenAction')
            if (!isAfterPrompt) {
              violations.push(`Line ${i + 1}: "${line.trim()}"`)
            }
          }
        }
      }

      expect(violations, [
        'Found silent host fallback in non-interactive mode (flags.yes / !isTTY).',
        'Non-interactive mode must this.error() instead of silently switching to host.',
        'The user must explicitly use --run-on-host to run on host.',
        '',
        'Violations:',
        ...violations,
      ].join('\n')).to.be.empty
    })

    it('non-interactive credential-missing blocks should call this.error()', () => {
      // Verify that when flags.yes || !process.stdout.isTTY and credentials
      // are missing, the code calls this.error() (which throws and exits)
      // rather than setting environment = 'host'.
      const lines = content.split('\n')
      const credentialBlocks: Array<{ startLine: number; block: string }> = []

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        // Find non-interactive mode checks
        if (
          (line.includes('flags.yes') || line.includes('!process.stdout.isTTY')) &&
          line.includes('if')
        ) {
          // Get the block following this check (next 10 lines)
          const block = lines.slice(i, Math.min(i + 10, lines.length)).join('\n')

          // Only care about blocks related to credentials/Docker
          if (
            block.includes('credential') ||
            block.includes('OAuth') ||
            block.includes('Docker')
          ) {
            credentialBlocks.push({ startLine: i + 1, block })
          }
        }
      }

      // Each credential-related non-interactive block should contain this.error()
      const blocksWithoutError = credentialBlocks.filter(
        b => !b.block.includes('this.error(')
      )

      expect(blocksWithoutError.map(b => `Line ${b.startLine}`), [
        'Non-interactive credential blocks should call this.error() instead of',
        'silently falling back to host. Found blocks without this.error():',
      ].join('\n')).to.be.empty
    })
  })
})
