import { expect } from 'chai'
import { getShippedAgents, WorkspaceInfo } from '../../src/lib/agents/commands.js'
import type { Agent } from '../../src/lib/database/agents.js'

/**
 * Tests for PRLT-1359: Auto-prune agents whose work is done
 *
 * getShippedAgents() finds agents with completed/stopped executions that
 * are still in active/running lifecycle state — the "zombie" agents
 * consuming resources after their work has been shipped.
 */
describe('@smoke getShippedAgents identifies agents with completed work (PRLT-1359)', () => {
  function makeAgent(overrides: Partial<Agent> & { name: string }): Agent {
    return {
      type: 'ephemeral',
      status: 'active',
      base_name: null,
      theme_id: null,
      worktree_path: null,
      mount_mode: 'worktree',
      created_at: new Date().toISOString(),
      cleaned_at: null,
      ...overrides,
    }
  }

  function makeWorkspaceInfo(agents: Agent[]): WorkspaceInfo {
    return {
      path: '/tmp/test-workspace',
      type: 'hq',
      workspaceName: 'test',
      hasPMO: false,
      agents,
      repositories: [],
      agentsPath: '/tmp/test-workspace/temp',
      activeThemeId: null,
      persistentAgentsDir: 'staff',
      ephemeralAgentsDir: 'temp',
    }
  }

  it('returns agents with completed executions that are still active', () => {
    const agents = [
      makeAgent({ name: 'shipped-agent', status: 'active' }),
      makeAgent({ name: 'idle-agent', status: 'active' }),
    ]
    const workspace = makeWorkspaceInfo(agents)
    const completedAgentNames = new Set(['shipped-agent'])
    const busyAgentNames = new Set<string>()

    const shipped = getShippedAgents(workspace, completedAgentNames, busyAgentNames)
    const names = shipped.map(a => a.name)

    expect(names).to.deep.equal(['shipped-agent'])
  })

  it('returns agents with completed executions that are still running', () => {
    const agents = [
      makeAgent({ name: 'shipped-running', status: 'running' }),
    ]
    const workspace = makeWorkspaceInfo(agents)
    const completedAgentNames = new Set(['shipped-running'])
    const busyAgentNames = new Set<string>()

    const shipped = getShippedAgents(workspace, completedAgentNames, busyAgentNames)
    expect(shipped).to.have.length(1)
    expect(shipped[0].name).to.equal('shipped-running')
  })

  it('excludes agents with other running executions (safety)', () => {
    const agents = [
      makeAgent({ name: 'multi-task-agent', status: 'active' }),
    ]
    const workspace = makeWorkspaceInfo(agents)
    const completedAgentNames = new Set(['multi-task-agent'])
    const busyAgentNames = new Set(['multi-task-agent']) // Still has running work

    const shipped = getShippedAgents(workspace, completedAgentNames, busyAgentNames)
    expect(shipped).to.have.length(0)
  })

  it('excludes persistent agents', () => {
    const agents = [
      makeAgent({ name: 'persistent-done', type: 'persistent', status: 'active' }),
      makeAgent({ name: 'ephemeral-done', type: 'ephemeral', status: 'active' }),
    ]
    const workspace = makeWorkspaceInfo(agents)
    const completedAgentNames = new Set(['persistent-done', 'ephemeral-done'])
    const busyAgentNames = new Set<string>()

    const shipped = getShippedAgents(workspace, completedAgentNames, busyAgentNames)
    const names = shipped.map(a => a.name)

    expect(names).to.not.include('persistent-done')
    expect(names).to.include('ephemeral-done')
  })

  it('excludes already-cleaned agents', () => {
    const agents = [
      makeAgent({ name: 'already-cleaned', status: 'cleaned' }),
      makeAgent({ name: 'already-completed', status: 'completed' }),
      makeAgent({ name: 'already-dead', status: 'dead' }),
      makeAgent({ name: 'still-active', status: 'active' }),
    ]
    const workspace = makeWorkspaceInfo(agents)
    const completedAgentNames = new Set([
      'already-cleaned', 'already-completed', 'already-dead', 'still-active',
    ])
    const busyAgentNames = new Set<string>()

    const shipped = getShippedAgents(workspace, completedAgentNames, busyAgentNames)
    const names = shipped.map(a => a.name)

    expect(names).to.deep.equal(['still-active'])
  })

  it('excludes agents without completed executions', () => {
    const agents = [
      makeAgent({ name: 'agent-1', status: 'active' }),
      makeAgent({ name: 'agent-2', status: 'active' }),
    ]
    const workspace = makeWorkspaceInfo(agents)
    const completedAgentNames = new Set(['agent-1']) // only agent-1 has completed work
    const busyAgentNames = new Set<string>()

    const shipped = getShippedAgents(workspace, completedAgentNames, busyAgentNames)
    const names = shipped.map(a => a.name)

    expect(names).to.deep.equal(['agent-1'])
    expect(names).to.not.include('agent-2')
  })

  it('returns empty array when no agents have completed work', () => {
    const agents = [
      makeAgent({ name: 'agent-1', status: 'active' }),
      makeAgent({ name: 'agent-2', status: 'running' }),
    ]
    const workspace = makeWorkspaceInfo(agents)
    const completedAgentNames = new Set<string>()
    const busyAgentNames = new Set<string>()

    const shipped = getShippedAgents(workspace, completedAgentNames, busyAgentNames)
    expect(shipped).to.have.length(0)
  })

  it('handles multiple shipped agents correctly', () => {
    const agents = [
      makeAgent({ name: 'shipped-1', status: 'active' }),
      makeAgent({ name: 'shipped-2', status: 'running' }),
      makeAgent({ name: 'not-shipped', status: 'active' }),
      makeAgent({ name: 'shipped-but-busy', status: 'active' }),
    ]
    const workspace = makeWorkspaceInfo(agents)
    const completedAgentNames = new Set(['shipped-1', 'shipped-2', 'shipped-but-busy'])
    const busyAgentNames = new Set(['shipped-but-busy'])

    const shipped = getShippedAgents(workspace, completedAgentNames, busyAgentNames)
    const names = shipped.map(a => a.name)

    expect(names).to.include('shipped-1')
    expect(names).to.include('shipped-2')
    expect(names).to.not.include('not-shipped')
    expect(names).to.not.include('shipped-but-busy')
  })
})
