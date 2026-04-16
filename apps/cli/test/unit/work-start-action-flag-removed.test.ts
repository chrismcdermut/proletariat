import { expect } from 'chai'
import WorkStart from '../../src/commands/work/start.js'

/**
 * Regression test for PRLT-1316.
 *
 * The `--action` flag on `work start` was removed because it let users
 * bypass the verb layer (`work groom`, `work review`, `work resolve`,
 * `work implement`) by naming an action directly, duplicating the future
 * `prlt action run` entry point.
 *
 * If the flag ever sneaks back into the class definition, this test fails.
 */
describe('work start: --action flag removed (PRLT-1316)', () => {
  it('does not declare an `action` oclif flag', () => {
    const flags = (WorkStart as unknown as { flags: Record<string, unknown> }).flags
    expect(flags).to.be.an('object')
    expect(flags).to.not.have.property('action',
      '`--action` was removed in PRLT-1316 — use `work groom/review/implement/resolve` instead of adding this flag back.'
    )
  })

  it('still declares `prompt` (the supported override)', () => {
    // `--prompt` is the legitimate override for custom prompts and was NOT
    // removed. Keep this assertion as a guardrail so we don't accidentally
    // nuke it along with --action in a future refactor.
    const flags = (WorkStart as unknown as { flags: Record<string, unknown> }).flags
    expect(flags).to.have.property('prompt')
  })

  it('still declares `session-action` (a separate concern — session conflict handling)', () => {
    // `--session-action` controls how to handle an existing tmux session
    // (attach/spawn/kill/cancel). It is unrelated to the removed `--action`
    // flag; keep it distinguishable to prevent regressions.
    const flags = (WorkStart as unknown as { flags: Record<string, unknown> }).flags
    expect(flags).to.have.property('session-action')
  })
})
