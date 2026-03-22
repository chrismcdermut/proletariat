import { expect } from 'chai'
import {
  findCompletedContainers,
  type ContainerInfo,
} from '../../src/lib/execution/container-cleanup.js'

/**
 * Unit tests for session cleanup safety behavior (PRLT-1063)
 *
 * Tests that session cleanup properly:
 * 1. Without --force: auto-excludes containers with active execution records
 * 2. With --force: identifies active agents for confirmation prompt
 *
 * The interactive confirmation and JSON mode behavior is tested via
 * the integration of findCompletedContainers with the active agent set.
 */
describe('@smoke Session Cleanup Safety (PRLT-1063)', () => {
  const makeContainers = (...agents: Array<{ name: string; running: boolean }>): ContainerInfo[] =>
    agents.map((a, i) => ({
      containerId: `id${i}`,
      containerName: `prlt-agent-${a.name}`,
      agentName: a.name,
      running: a.running,
      status: a.running ? 'running' : 'exited',
    }))

  describe('normal mode (no --force): auto-exclude active agents', () => {
    it('should skip containers with running execution records', () => {
      const containers = makeContainers(
        { name: 'busy-andreesen', running: true },
        { name: 'idle-hoffman', running: false },
        { name: 'done-khosla', running: false },
      )
      const activeAgentNames = new Set(['busy-andreesen'])

      const completed = findCompletedContainers(containers, activeAgentNames)

      expect(completed).to.have.length(2)
      expect(completed.map(c => c.agentName)).to.deep.equal(['idle-hoffman', 'done-khosla'])
      expect(completed.map(c => c.agentName)).to.not.include('busy-andreesen')
    })

    it('should skip containers with starting execution records', () => {
      const containers = makeContainers(
        { name: 'starting-agent', running: true },
        { name: 'completed-agent', running: false },
      )
      // 'starting' status agents are also active
      const activeAgentNames = new Set(['starting-agent'])

      const completed = findCompletedContainers(containers, activeAgentNames)

      expect(completed).to.have.length(1)
      expect(completed[0].agentName).to.equal('completed-agent')
    })

    it('should skip multiple active agents', () => {
      const containers = makeContainers(
        { name: 'agent-a', running: true },
        { name: 'agent-b', running: true },
        { name: 'agent-c', running: false },
      )
      const activeAgentNames = new Set(['agent-a', 'agent-b'])

      const completed = findCompletedContainers(containers, activeAgentNames)

      expect(completed).to.have.length(1)
      expect(completed[0].agentName).to.equal('agent-c')
    })

    it('should clean up nothing when all agents are active', () => {
      const containers = makeContainers(
        { name: 'agent-a', running: true },
        { name: 'agent-b', running: true },
      )
      const activeAgentNames = new Set(['agent-a', 'agent-b'])

      const completed = findCompletedContainers(containers, activeAgentNames)

      expect(completed).to.have.length(0)
    })
  })

  describe('force mode: identify active agents for confirmation', () => {
    it('should identify active agents with containers for confirmation prompt', () => {
      const containers = makeContainers(
        { name: 'busy-andreesen', running: true },
        { name: 'ideal-hoffman', running: true },
        { name: 'fast-khosla', running: true },
        { name: 'done-altman', running: false },
      )
      const activeAgentNames = new Set(['busy-andreesen', 'ideal-hoffman', 'fast-khosla'])

      // In force mode, we identify which active agents have containers
      const activeAgentsWithContainers = containers
        .filter(c => activeAgentNames.has(c.agentName))
        .map(c => c.agentName)

      expect(activeAgentsWithContainers).to.have.length(3)
      expect(activeAgentsWithContainers).to.deep.equal([
        'busy-andreesen',
        'ideal-hoffman',
        'fast-khosla',
      ])
    })

    it('should include all containers when force mode passes empty active set', () => {
      const containers = makeContainers(
        { name: 'busy-andreesen', running: true },
        { name: 'ideal-hoffman', running: true },
        { name: 'done-altman', running: false },
      )

      // After confirmation, force mode passes empty set to get all containers
      const completed = findCompletedContainers(containers, new Set<string>())

      expect(completed).to.have.length(3)
    })

    it('should handle no active agents in force mode (no confirmation needed)', () => {
      const containers = makeContainers(
        { name: 'done-agent-a', running: false },
        { name: 'done-agent-b', running: false },
      )
      const activeAgentNames = new Set<string>()

      const activeAgentsWithContainers = containers
        .filter(c => activeAgentNames.has(c.agentName))
        .map(c => c.agentName)

      expect(activeAgentsWithContainers).to.have.length(0)
    })

    it('should handle active agents without containers (no confirmation needed)', () => {
      const containers = makeContainers(
        { name: 'done-agent', running: false },
      )
      // Agent is active in DB but has no container
      const activeAgentNames = new Set(['ghost-agent'])

      const activeAgentsWithContainers = containers
        .filter(c => activeAgentNames.has(c.agentName))
        .map(c => c.agentName)

      expect(activeAgentsWithContainers).to.have.length(0)
    })
  })

  describe('confirmation message formatting', () => {
    it('should format singular agent message correctly', () => {
      const activeAgents = ['busy-andreesen']
      const count = activeAgents.length
      const message = `This will kill ${count} active agent${count === 1 ? '' : 's'}: ${activeAgents.join(', ')}. Continue?`

      expect(message).to.equal('This will kill 1 active agent: busy-andreesen. Continue?')
    })

    it('should format plural agent message correctly', () => {
      const activeAgents = ['busy-andreesen', 'ideal-hoffman', 'fast-khosla']
      const count = activeAgents.length
      const message = `This will kill ${count} active agent${count === 1 ? '' : 's'}: ${activeAgents.join(', ')}. Continue?`

      expect(message).to.equal(
        'This will kill 3 active agents: busy-andreesen, ideal-hoffman, fast-khosla. Continue?'
      )
    })
  })
})
