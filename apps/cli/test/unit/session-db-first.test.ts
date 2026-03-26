import { expect } from 'chai'

import {
  probeExecutionLiveness,
  checkDockerContainerAlive,
  checkHostTmuxSessionAlive,
  checkContainerTmuxSessionAlive,
} from '../../src/lib/execution/session-utils.js'

/**
 * PRLT-1139: Regression tests for DB-first session discovery.
 *
 * Session list must be DB-first: query DB for sessions, then probe runtime
 * liveness (docker inspect for containers, tmux has-session for host).
 * Orphan tmux sessions (not in DB) must NOT appear as first-class sessions.
 */
describe('PRLT-1139: DB-first session discovery', () => {
  describe('probeExecutionLiveness', () => {
    it('should return false for host sessions without a session ID', () => {
      // DB record exists but has no session_id — can't verify
      const result = probeExecutionLiveness('host', undefined, undefined)
      expect(result).to.be.false
    })

    it('should return false for host sessions with nonexistent tmux session', () => {
      // DB record points to a session that doesn't exist in tmux
      const result = probeExecutionLiveness('host', undefined, 'nonexistent-session-id')
      expect(result).to.be.false
    })

    it('should return false for devcontainer without container ID', () => {
      // DB record says devcontainer but has no container_id
      const result = probeExecutionLiveness('devcontainer', undefined, 'some-session')
      expect(result).to.be.false
    })

    it('should return false for docker environment without container ID', () => {
      const result = probeExecutionLiveness('docker', undefined, 'some-session')
      expect(result).to.be.false
    })

    it('should return false for devcontainer with nonexistent container', () => {
      // DB record points to a container that doesn't exist
      const result = probeExecutionLiveness('devcontainer', 'nonexistent123', 'some-session')
      expect(result).to.be.false
    })

    it('should return false for docker environment with nonexistent container', () => {
      const result = probeExecutionLiveness('docker', 'nonexistent123', 'some-session')
      expect(result).to.be.false
    })

    it('should handle unknown environment types by checking tmux session', () => {
      // Unknown environment — falls through to host-style tmux check
      const result = probeExecutionLiveness('cloud', undefined, 'nonexistent-session')
      expect(result).to.be.false
    })
  })

  describe('checkDockerContainerAlive', () => {
    it('should return false for nonexistent container ID', () => {
      const result = checkDockerContainerAlive('nonexistent_container_12345')
      expect(result).to.be.false
    })

    it('should return false for empty container ID', () => {
      const result = checkDockerContainerAlive('')
      expect(result).to.be.false
    })
  })

  describe('checkHostTmuxSessionAlive', () => {
    it('should return false for nonexistent session', () => {
      const result = checkHostTmuxSessionAlive('nonexistent-prlt-session')
      expect(result).to.be.false
    })

    it('should return false for session ID that does not exist', () => {
      const result = checkHostTmuxSessionAlive('prlt-nonexistent-session-12345')
      expect(result).to.be.false
    })
  })

  describe('checkContainerTmuxSessionAlive', () => {
    it('should return false for nonexistent container', () => {
      const result = checkContainerTmuxSessionAlive('nonexistent123', 'some-session')
      expect(result).to.be.false
    })
  })

  describe('DB-first contract', () => {
    it('probeExecutionLiveness must exist and accept environment, containerId, sessionId', () => {
      // This test verifies the function signature exists — if the DB-first
      // implementation is reverted, this import will fail.
      expect(probeExecutionLiveness).to.be.a('function')
      expect(probeExecutionLiveness.length).to.be.greaterThanOrEqual(1)
    })

    it('checkDockerContainerAlive must exist for container liveness checks', () => {
      // Docker container liveness must use docker inspect, not tmux list-sessions.
      // If reverted to tmux-only approach, this function won't exist.
      expect(checkDockerContainerAlive).to.be.a('function')
    })

    it('checkHostTmuxSessionAlive must exist for host session liveness checks', () => {
      expect(checkHostTmuxSessionAlive).to.be.a('function')
    })

    it('checkContainerTmuxSessionAlive must exist for container tmux session checks', () => {
      expect(checkContainerTmuxSessionAlive).to.be.a('function')
    })
  })
})
