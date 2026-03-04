import { expect } from 'chai'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { hostCredentialsExist } from '../../src/lib/execution/runners.js'

describe('Host Credentials Check', () => {
  let originalEnv: NodeJS.ProcessEnv
  let tempHome: string

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

    it('returns false when credentials file does not exist', () => {
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
  })
})
