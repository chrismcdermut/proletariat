import { expect } from 'chai'
import { shouldAutoCreateBranch } from '../../src/commands/work/start.js'

/**
 * Regression tests for PRLT-1335.
 *
 * The branch picker prompt in `work start` was blocking non-interactive
 * spawns even when -y or --display background was set. The -y flag skipped
 * confirmation prompts but not selection pickers, causing the orchestrator's
 * spawn flow to hang.
 *
 * shouldAutoCreateBranch() centralises the "is this invocation non-interactive?"
 * check so we can unit-test it directly.
 */
describe('work start: branch picker non-interactive bypass (PRLT-1335)', () => {
  const baseOpts = {
    internalAction: undefined as string | undefined,
    force: false,
    jsonMode: false,
    yes: false,
    backgroundDisplay: false,
  }

  describe('shouldAutoCreateBranch', () => {
    it('returns false when all flags are off (interactive mode)', () => {
      expect(shouldAutoCreateBranch(baseOpts)).to.equal(false)
    })

    it('returns true when -y/--yes flag is set', () => {
      expect(shouldAutoCreateBranch({ ...baseOpts, yes: true })).to.equal(true)
    })

    it('returns true when --display background is set', () => {
      expect(shouldAutoCreateBranch({ ...baseOpts, backgroundDisplay: true })).to.equal(true)
    })

    it('returns true when --force flag is set', () => {
      expect(shouldAutoCreateBranch({ ...baseOpts, force: true })).to.equal(true)
    })

    it('returns true when jsonMode is active', () => {
      expect(shouldAutoCreateBranch({ ...baseOpts, jsonMode: true })).to.equal(true)
    })

    it('returns true when internalAction is set', () => {
      expect(shouldAutoCreateBranch({ ...baseOpts, internalAction: 'implement' })).to.equal(true)
    })

    it('returns true when both -y and --display background are set', () => {
      expect(shouldAutoCreateBranch({ ...baseOpts, yes: true, backgroundDisplay: true })).to.equal(true)
    })

    it('returns true when -y and --force are combined', () => {
      expect(shouldAutoCreateBranch({ ...baseOpts, yes: true, force: true })).to.equal(true)
    })
  })

  describe('flag declarations (guardrails)', () => {
    // Import WorkStart lazily to check flag definitions
    let flags: Record<string, unknown>

    before(async () => {
      const { default: WorkStart } = await import('../../src/commands/work/start.js')
      flags = (WorkStart as unknown as { flags: Record<string, unknown> }).flags
    })

    it('declares the -y/--yes flag', () => {
      expect(flags).to.have.property('yes')
    })

    it('declares the --display flag', () => {
      expect(flags).to.have.property('display')
    })

    it('declares the --force flag', () => {
      expect(flags).to.have.property('force')
    })
  })
})
