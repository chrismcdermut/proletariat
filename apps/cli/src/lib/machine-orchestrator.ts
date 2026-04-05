/**
 * Machine Orchestrator — Prompt builder and state reader for machine-level orchestration.
 *
 * The machine orchestrator is the root-level supervisor. It reads machine.db
 * to see ALL sessions across ALL repos on the machine, and can spawn, poke,
 * kill, and ship agents in any repo.
 *
 * Unlike HQ-scoped orchestrators (which read workspace.db and see only one project),
 * the machine orchestrator operates at the machine level — it's the `init` process
 * for your development fleet.
 */

import { MachineDB, type MachineExecution } from './machine-db.js'

// =============================================================================
// State Snapshot
// =============================================================================

export interface MachineState {
  /** All active (starting/running) executions across all repos */
  activeExecutions: MachineExecution[]
  /** All persistent agents (any status) */
  persistentAgents: MachineExecution[]
  /** Persistent agents that died and need restart */
  diedPersistentAgents: MachineExecution[]
  /** Recent completed executions (last 10) for context */
  recentCompleted: MachineExecution[]
  /** Unique repo paths with active work */
  activeRepos: string[]
}

/**
 * Read the current machine state from machine.db.
 */
export function readMachineState(db: MachineDB): MachineState {
  const activeExecutions = db.getActiveExecutions()
  const persistentAgents = db.listPersistentAgents()
  const diedPersistentAgents = db.getDiedPersistentAgents()
  const recentCompleted = db.listExecutions({ status: 'completed', limit: 10 })

  const activeRepos = [...new Set(activeExecutions.map(e => e.repoPath))]

  return {
    activeExecutions,
    persistentAgents,
    diedPersistentAgents,
    recentCompleted,
    activeRepos,
  }
}

// =============================================================================
// Prompt Builder
// =============================================================================

/**
 * Build the system prompt for the machine-level orchestrator.
 *
 * This prompt gives the orchestrator visibility into all agents across all repos
 * and the commands to manage them.
 */
export function buildMachineOrchestratorPrompt(state: MachineState, actionPrompt?: string): string {
  let prompt = ''

  // ─── Identity ──────────────────────────────────────────────
  prompt += `# Machine Orchestrator\n\n`
  prompt += `You are the **machine-level orchestrator** — the root supervisor for all AI agents across every repository on this machine.\n\n`
  prompt += `Unlike HQ-scoped orchestrators (which manage one project), you see and control **all agents, all repos, all sessions**. `
  prompt += `You are the \`init\` process for the development fleet.\n\n`

  // ��── Capabilities ──────────────────────────────────────────
  prompt += `## Your Role\n\n`
  prompt += `- **Spawn** agents in any repo: \`prlt work run --dir /path/to/repo --prompt "task"\`\n`
  prompt += `- **Monitor** all sessions: \`prlt session list\` (reads machine.db, works from anywhere)\n`
  prompt += `- **Poke** running agents: \`prlt session poke <session-id> "message"\`\n`
  prompt += `- **Stop** agents: \`prlt work stop <execution-id>\`\n`
  prompt += `- **Restart** died persistent agents: \`prlt work run --name <name> --keep-alive --prompt "..."\`\n`
  prompt += `- **Ship** completed work: \`prlt work ship <ticket-id>\` (when inside an HQ)\n`
  prompt += `- **Spawn persistent agents**: \`prlt work run --name reviewer --keep-alive --prompt "..."\`\n\n`

  // ─── Current State ─────────────────────────────────────────
  prompt += `## Current Machine State\n\n`

  if (state.activeExecutions.length === 0 && state.persistentAgents.length === 0) {
    prompt += `No active agents. The machine is idle.\n\n`
  } else {
    // Active executions
    if (state.activeExecutions.length > 0) {
      prompt += `### Active Agents (${state.activeExecutions.length})\n\n`
      prompt += `| ID | Agent | Status | Repo | Prompt |\n`
      prompt += `|----|-------|--------|------|--------|\n`
      for (const exec of state.activeExecutions) {
        const repoShort = exec.repoPath.split('/').slice(-2).join('/')
        const promptShort = exec.prompt.substring(0, 40) + (exec.prompt.length > 40 ? '...' : '')
        const persistent = exec.persistent ? ' (persistent)' : ''
        prompt += `| ${exec.id} | ${exec.agentName}${persistent} | ${exec.status} | ${repoShort} | ${promptShort} |\n`
      }
      prompt += `\n`
    }

    // Persistent agents (all statuses)
    const stoppedPersistent = state.persistentAgents.filter(
      a => a.status !== 'running' && a.status !== 'starting'
    )
    if (stoppedPersistent.length > 0) {
      prompt += `### Stopped Persistent Agents (restart candidates)\n\n`
      for (const agent of stoppedPersistent) {
        prompt += `- **${agent.agentName}** (${agent.id}): ${agent.status}`
        if (agent.errorMessage) prompt += ` — ${agent.errorMessage}`
        prompt += `\n`
      }
      prompt += `\n`
    }

    // Died persistent agents
    if (state.diedPersistentAgents.length > 0) {
      prompt += `### Died Persistent Agents (need restart)\n\n`
      for (const agent of state.diedPersistentAgents) {
        const repoShort = agent.repoPath.split('/').slice(-2).join('/')
        prompt += `- **${agent.agentName}** in ${repoShort}: ${agent.errorMessage || 'died'}\n`
        prompt += `  Restart: \`prlt work run --name ${agent.agentName} --keep-alive --dir ${agent.repoPath} --prompt "${agent.prompt.substring(0, 60)}"\`\n`
      }
      prompt += `\n`
    }
  }

  // Active repos
  if (state.activeRepos.length > 0) {
    prompt += `### Active Repos\n\n`
    for (const repo of state.activeRepos) {
      const agentCount = state.activeExecutions.filter(e => e.repoPath === repo).length
      prompt += `- \`${repo}\` (${agentCount} agent${agentCount !== 1 ? 's' : ''})\n`
    }
    prompt += `\n`
  }

  // Recent history
  if (state.recentCompleted.length > 0) {
    prompt += `### Recent Completions\n\n`
    for (const exec of state.recentCompleted.slice(0, 5)) {
      const repoShort = exec.repoPath.split('/').slice(-2).join('/')
      const exitInfo = exec.exitCode !== undefined ? ` (exit ${exec.exitCode})` : ''
      prompt += `- ${exec.agentName} in ${repoShort}: "${exec.prompt.substring(0, 50)}"${exitInfo}\n`
    }
    prompt += `\n`
  }

  // ─── Command Reference ─────────────────────────────────────
  prompt += `## Command Reference\n\n`
  prompt += `### Agent Lifecycle\n`
  prompt += `| Command | Description |\n`
  prompt += `|---------|-------------|\n`
  prompt += `| \`prlt work run --prompt "..." --dir /repo\` | Spawn ephemeral agent in a repo |\n`
  prompt += `| \`prlt work run --name X --keep-alive --prompt "..."\` | Spawn persistent named agent |\n`
  prompt += `| \`prlt session list\` | List all sessions (machine-wide) |\n`
  prompt += `| \`prlt session attach <id>\` | Attach to agent session |\n`
  prompt += `| \`prlt session poke <id> "msg"\` | Send message to running agent |\n`
  prompt += `| \`prlt session peek <id>\` | View agent output without attaching |\n`
  prompt += `| \`prlt work stop <id>\` | Stop a running agent |\n`
  prompt += `| \`prlt session prune\` | Clean up stale sessions |\n\n`

  prompt += `### Anti-patterns\n\n`
  prompt += `- **NEVER** use \`docker exec\` or \`tmux send-keys\` directly — use \`prlt session poke\`\n`
  prompt += `- **NEVER** use \`gh pr create\` — use \`prlt work propose\` or \`prlt pr create\`\n`
  prompt += `- **NEVER** kill tmux sessions directly — use \`prlt work stop\`\n`
  prompt += `- **NEVER** write code yourself — you are a supervisor, delegate to agents\n\n`

  // ─── Action prompt ─────────────────────────────────────────
  if (actionPrompt) {
    prompt += `## Instructions\n\n${actionPrompt}\n`
  }

  return prompt
}
