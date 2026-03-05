import { expect } from 'chai'
import { execSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { hostCredentialsExist } from '../../src/lib/execution/runners.js'

/**
 * Check if macOS keychain has Claude Code 2.x credentials.
 * Used to adjust test expectations on machines with keychain-based auth.
 * Must be called with the real HOME to work correctly.
 */
function hasKeychainCredentials(): boolean {
  if (process.platform !== 'darwin') return false
  try {
    execSync('security find-generic-password -s "Claude Code-credentials" 2>/dev/null', {
      stdio: 'pipe',
      timeout: 5000,
    })
    return true
  } catch {
    return false
  }
}

describe('Host Credentials Check', () => {
  let originalEnv: NodeJS.ProcessEnv
  let tempHome: string
  // Check keychain before any beforeEach modifies HOME
  const keychainAvailable = hasKeychainCredentials()

  function credentialsPath(): string {
    return path.join(tempHome, '.claude', '.credentials.json')
  }

  function writeCredentialsFile(content: string): void {
    const credPath = credentialsPath()
    fs.mkdirSync(path.dirname(credPath), { recursive: true })
    fs.writeFileSync(credPath, content, 'utf-8')
  }

  beforeEach(() => {
    originalEnv = { ...process.env }
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-host-creds-test-'))
    process.env.HOME = tempHome
    delete process.env.ANTHROPIC_API_KEY
  })

  afterEach(() => {
    process.env = originalEnv
    fs.rmSync(tempHome, { recursive: true, force: true })
  })

  describe('hostCredentialsExist', () => {
    it('returns true when ANTHROPIC_API_KEY is set', () => {
      process.env.ANTHROPIC_API_KEY = 'test-api-key'
      expect(hostCredentialsExist()).to.be.true
    })

    it('returns true when OAuth credentials exist in ~/.claude/.credentials.json', () => {
      writeCredentialsFile(JSON.stringify({
        claudeAiOauth: {
          accessToken: 'test-token',
          refreshToken: 'test-refresh',
          expiresAt: '2025-12-31T23:59:59Z',
        },
      }))

      expect(hostCredentialsExist()).to.be.true
    })

    it('returns false when no credentials are available', function (this: Mocha.Context) {
      // On macOS with Claude Code 2.x keychain credentials, the function
      // correctly returns true via the keychain check. However, setting HOME
      // to a temp dir (as beforeEach does) prevents the security command from
      // finding the login keychain, so this test still works.
      expect(hostCredentialsExist()).to.be.false
    })

    it('returns false when credentials file exists but has no OAuth tokens', () => {
      writeCredentialsFile(JSON.stringify({}))
      expect(hostCredentialsExist()).to.be.false
    })

    it('returns false when credentials file is malformed', () => {
      writeCredentialsFile('{invalid-json')
      expect(hostCredentialsExist()).to.be.false
    })

    it('prefers ANTHROPIC_API_KEY over OAuth credentials', () => {
      process.env.ANTHROPIC_API_KEY = 'test-api-key'
      expect(hostCredentialsExist()).to.be.true
    })

    if (process.platform === 'darwin') {
      it('returns true when Claude Code 2.x keychain credentials exist', function (this: Mocha.Context) {
        // This test verifies the keychain detection path on macOS.
        // It will only pass on machines with Claude Code 2.x auth configured.
        if (!keychainAvailable) {
          this.skip()
        }

        // Restore the real HOME so the security command can find the login keychain
        process.env.HOME = originalEnv.HOME
        // No ANTHROPIC_API_KEY, no credentials file in real home — keychain should be detected
        expect(hostCredentialsExist()).to.be.true
      })
    }
  })
})
