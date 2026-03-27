/**
 * Regression tests for e2e test isolation (PRLT-1172)
 *
 * Ensures getIsolatedEnv strips all environment variables that could
 * affect test isolation — in particular PRLT_AGENT_NAME which, when
 * leaked into child processes, causes isReadOnlyHQMount() to treat
 * the test DB as a read-only container mount (SQLITE_READONLY errors).
 */
import { expect } from 'chai'
import { getIsolatedEnv } from '../e2e/test-helpers.js'

describe('e2e test isolation (PRLT-1172)', () => {
  it('should strip PRLT_AGENT_NAME from isolated env', () => {
    const saved = process.env.PRLT_AGENT_NAME
    try {
      process.env.PRLT_AGENT_NAME = 'some-agent'
      const env = getIsolatedEnv()
      expect(env.PRLT_AGENT_NAME).to.be.undefined
    } finally {
      if (saved !== undefined) {
        process.env.PRLT_AGENT_NAME = saved
      } else {
        delete process.env.PRLT_AGENT_NAME
      }
    }
  })

  it('should strip DEVCONTAINER from isolated env', () => {
    const saved = process.env.DEVCONTAINER
    try {
      process.env.DEVCONTAINER = 'true'
      const env = getIsolatedEnv()
      expect(env.DEVCONTAINER).to.be.undefined
    } finally {
      if (saved !== undefined) {
        process.env.DEVCONTAINER = saved
      } else {
        delete process.env.DEVCONTAINER
      }
    }
  })

  it('should strip PRLT_HQ_PATH from isolated env', () => {
    const saved = process.env.PRLT_HQ_PATH
    try {
      process.env.PRLT_HQ_PATH = '/some/path'
      const env = getIsolatedEnv()
      expect(env.PRLT_HQ_PATH).to.be.undefined
    } finally {
      if (saved !== undefined) {
        process.env.PRLT_HQ_PATH = saved
      } else {
        delete process.env.PRLT_HQ_PATH
      }
    }
  })
})
