import { expect } from 'chai'
import { getCleanableAgents, WorkspaceInfo } from '../../src/lib/agents/commands.js'
import type { Agent } from '../../src/lib/database/agents.js'

/**
 * Regression test for PRLT-1117: session prune includes actively running agents
 *
 * getCleanableAgents was including agents with status='running' in the cleanable
 * list. When those agents ran inside containers (where host tmux can't detect
 * their sessions), they appeared as candidates for cleanup. The fix ensures
 * agents with DB status 'running' are excluded when checkRunning=true.
 */
describe('@smoke getCleanableAgents excludes running agents (PRLT-1117)', () => {
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

  it('excludes agents with status=running when checkRunning=true', () => {
    const agents = [
      makeAgent({ name: 'idle-agent-1', status: 'active' }),
      makeAgent({ name: 'busy-agent-1', status: 'running' }),
      makeAgent({ name: 'idle-agent-2', status: 'active' }),
    ]
    const workspace = makeWorkspaceInfo(agents)

    // checkRunning=true — running agents should be excluded
    const cleanable = getCleanableAgents(workspace, true)
    const names = cleanable.map(a => a.name)

    expect(names).to.include('idle-agent-1')
    expect(names).to.include('idle-agent-2')
    expect(names).to.not.include('busy-agent-1')
  })

  it('includes agents with status=running when checkRunning=false', () => {
    const agents = [
      makeAgent({ name: 'idle-agent-1', status: 'active' }),
      makeAgent({ name: 'busy-agent-1', status: 'running' }),
    ]
    const workspace = makeWorkspaceInfo(agents)

    // checkRunning=false — all active/running agents returned
    const cleanable = getCleanableAgents(workspace, false)
    const names = cleanable.map(a => a.name)

    expect(names).to.include('idle-agent-1')
    expect(names).to.include('busy-agent-1')
  })

  it('excludes persistent agents regardless of status', () => {
    const agents = [
      makeAgent({ name: 'persistent-1', type: 'persistent', status: 'active' }),
      makeAgent({ name: 'ephemeral-1', type: 'ephemeral', status: 'active' }),
    ]
    const workspace = makeWorkspaceInfo(agents)

    const cleanable = getCleanableAgents(workspace, true)
    const names = cleanable.map(a => a.name)

    expect(names).to.not.include('persistent-1')
    expect(names).to.include('ephemeral-1')
  })

  it('excludes completed/dead/cleaned agents', () => {
    const agents = [
      makeAgent({ name: 'done-agent', status: 'completed' }),
      makeAgent({ name: 'dead-agent', status: 'dead' }),
      makeAgent({ name: 'cleaned-agent', status: 'cleaned' }),
      makeAgent({ name: 'active-agent', status: 'active' }),
    ]
    const workspace = makeWorkspaceInfo(agents)

    const cleanable = getCleanableAgents(workspace, true)
    const names = cleanable.map(a => a.name)

    expect(names).to.deep.equal(['active-agent'])
  })

  it('returns empty array when all ephemeral agents are running', () => {
    const agents = [
      makeAgent({ name: 'busy-1', status: 'running' }),
      makeAgent({ name: 'busy-2', status: 'running' }),
    ]
    const workspace = makeWorkspaceInfo(agents)

    const cleanable = getCleanableAgents(workspace, true)
    expect(cleanable).to.have.length(0)
  })
})
