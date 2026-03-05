import { expect } from 'chai'
import { shouldSuppressPrompt } from '../../src/lib/update-prompt.js'

describe('Update Prompt', () => {
  let originalEnv: Record<string, string | undefined>
  let originalStdoutIsTTY: boolean | undefined
  let originalStdinIsTTY: boolean | undefined

  beforeEach(() => {
    originalEnv = {
      CI: process.env.CI,
      GITHUB_ACTIONS: process.env.GITHUB_ACTIONS,
      GITLAB_CI: process.env.GITLAB_CI,
      JENKINS_URL: process.env.JENKINS_URL,
      CIRCLECI: process.env.CIRCLECI,
      BUILDKITE: process.env.BUILDKITE,
      TRAVIS: process.env.TRAVIS,
      TF_BUILD: process.env.TF_BUILD,
      PRLT_NO_UPDATE_PROMPT: process.env.PRLT_NO_UPDATE_PROMPT,
      PRLT_SKIP_NEW_VERSION_CHECK: process.env.PRLT_SKIP_NEW_VERSION_CHECK,
      OCLIF_COMPILATION: process.env.OCLIF_COMPILATION,
      PRLT_TEST_ENV: process.env.PRLT_TEST_ENV,
    }
    originalStdoutIsTTY = process.stdout.isTTY
    originalStdinIsTTY = process.stdin.isTTY

    // Clear all relevant env vars for clean tests
    for (const key of Object.keys(originalEnv)) {
      delete process.env[key]
    }

    // Set TTY to true for tests that don't test TTY suppression
    Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true, configurable: true })
    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true, configurable: true })
  })

  afterEach(() => {
    // Restore env vars
    for (const [key, val] of Object.entries(originalEnv)) {
      if (val === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = val
      }
    }

    // Restore TTY status
    Object.defineProperty(process.stdout, 'isTTY', { value: originalStdoutIsTTY, writable: true, configurable: true })
    Object.defineProperty(process.stdin, 'isTTY', { value: originalStdinIsTTY, writable: true, configurable: true })
  })

  describe('shouldSuppressPrompt', () => {
    it('returns false in normal TTY environment', () => {
      expect(shouldSuppressPrompt()).to.be.false
    })

    it('returns true when stdout is not TTY', () => {
      Object.defineProperty(process.stdout, 'isTTY', { value: false, writable: true, configurable: true })
      expect(shouldSuppressPrompt()).to.be.true
    })

    it('returns true when stdin is not TTY', () => {
      Object.defineProperty(process.stdin, 'isTTY', { value: false, writable: true, configurable: true })
      expect(shouldSuppressPrompt()).to.be.true
    })

    it('returns true when CI env var is set', () => {
      process.env.CI = 'true'
      expect(shouldSuppressPrompt()).to.be.true
    })

    it('returns true when GITHUB_ACTIONS is set', () => {
      process.env.GITHUB_ACTIONS = 'true'
      expect(shouldSuppressPrompt()).to.be.true
    })

    it('returns true when PRLT_NO_UPDATE_PROMPT=1', () => {
      process.env.PRLT_NO_UPDATE_PROMPT = '1'
      expect(shouldSuppressPrompt()).to.be.true
    })

    it('returns true when PRLT_SKIP_NEW_VERSION_CHECK=true', () => {
      process.env.PRLT_SKIP_NEW_VERSION_CHECK = 'true'
      expect(shouldSuppressPrompt()).to.be.true
    })

    it('returns true when OCLIF_COMPILATION is set', () => {
      process.env.OCLIF_COMPILATION = '1'
      expect(shouldSuppressPrompt()).to.be.true
    })

    it('returns true when PRLT_TEST_ENV is set', () => {
      process.env.PRLT_TEST_ENV = '1'
      expect(shouldSuppressPrompt()).to.be.true
    })
  })
})
