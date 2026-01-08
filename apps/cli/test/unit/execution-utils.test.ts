import { expect } from 'chai'
import { execSync } from 'node:child_process'

import { isDockerRunning } from '../../src/lib/execution/runners.js'

/**
 * Unit tests for execution utility functions
 */
describe('Execution Utils', () => {
  describe('isDockerRunning', () => {
    it('should return a boolean', () => {
      const result = isDockerRunning()
      expect(result).to.be.a('boolean')
    })

    it('should match actual docker info command result', () => {
      // Get the expected result by running docker info directly
      let dockerAvailable: boolean
      try {
        execSync('docker info', { stdio: 'pipe', timeout: 5000 })
        dockerAvailable = true
      } catch {
        dockerAvailable = false
      }

      const result = isDockerRunning()
      expect(result).to.equal(dockerAvailable)
    })

    it('should not throw an error regardless of Docker state', () => {
      // The function should handle errors gracefully
      expect(() => isDockerRunning()).to.not.throw()
    })
  })
})
