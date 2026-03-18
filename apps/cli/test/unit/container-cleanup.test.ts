import { expect } from 'chai'
import {
  findCompletedContainers,
  type ContainerInfo,
} from '../../src/lib/execution/container-cleanup.js'

/**
 * Unit tests for container cleanup module (TKT-172)
 *
 * Tests the pure business logic functions that don't require Docker.
 */
describe('@smoke Container Cleanup', () => {
  describe('findCompletedContainers', () => {
    it('should return containers not in the active set', () => {
      const containers: ContainerInfo[] = [
        { containerId: 'abc123', containerName: 'prlt-agent-bold-turing', agentName: 'bold-turing', running: true, status: 'running' },
        { containerId: 'def456', containerName: 'prlt-agent-clever-lovelace', agentName: 'clever-lovelace', running: false, status: 'exited' },
        { containerId: 'ghi789', containerName: 'prlt-agent-quick-hopper', agentName: 'quick-hopper', running: true, status: 'running' },
      ]

      const activeAgentNames = new Set(['bold-turing'])
      const completed = findCompletedContainers(containers, activeAgentNames)

      expect(completed).to.have.length(2)
      expect(completed.map(c => c.agentName)).to.deep.equal(['clever-lovelace', 'quick-hopper'])
    })

    it('should return empty array when all containers are active', () => {
      const containers: ContainerInfo[] = [
        { containerId: 'abc123', containerName: 'prlt-agent-bold-turing', agentName: 'bold-turing', running: true, status: 'running' },
      ]

      const activeAgentNames = new Set(['bold-turing'])
      const completed = findCompletedContainers(containers, activeAgentNames)

      expect(completed).to.have.length(0)
    })

    it('should return all containers when none are active', () => {
      const containers: ContainerInfo[] = [
        { containerId: 'abc123', containerName: 'prlt-agent-bold-turing', agentName: 'bold-turing', running: false, status: 'exited' },
        { containerId: 'def456', containerName: 'prlt-agent-clever-lovelace', agentName: 'clever-lovelace', running: false, status: 'exited' },
      ]

      const activeAgentNames = new Set<string>()
      const completed = findCompletedContainers(containers, activeAgentNames)

      expect(completed).to.have.length(2)
    })

    it('should handle empty container list', () => {
      const activeAgentNames = new Set(['bold-turing'])
      const completed = findCompletedContainers([], activeAgentNames)

      expect(completed).to.have.length(0)
    })

    it('should match agent names exactly (no partial matching)', () => {
      const containers: ContainerInfo[] = [
        { containerId: 'abc123', containerName: 'prlt-agent-bold-turing', agentName: 'bold-turing', running: true, status: 'running' },
        { containerId: 'def456', containerName: 'prlt-agent-bold', agentName: 'bold', running: true, status: 'running' },
      ]

      // Only "bold-turing" is active — "bold" should still be in the completed set
      const activeAgentNames = new Set(['bold-turing'])
      const completed = findCompletedContainers(containers, activeAgentNames)

      expect(completed).to.have.length(1)
      expect(completed[0].agentName).to.equal('bold')
    })

    it('should include both running and stopped containers in results', () => {
      const containers: ContainerInfo[] = [
        { containerId: 'abc123', containerName: 'prlt-agent-idle-running', agentName: 'idle-running', running: true, status: 'running' },
        { containerId: 'def456', containerName: 'prlt-agent-idle-stopped', agentName: 'idle-stopped', running: false, status: 'exited' },
      ]

      const completed = findCompletedContainers(containers, new Set<string>())

      expect(completed).to.have.length(2)
      const runningContainer = completed.find(c => c.agentName === 'idle-running')
      const stoppedContainer = completed.find(c => c.agentName === 'idle-stopped')
      expect(runningContainer?.running).to.be.true
      expect(stoppedContainer?.running).to.be.false
    })
  })
})
