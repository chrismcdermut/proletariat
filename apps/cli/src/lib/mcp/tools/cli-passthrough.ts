/**
 * MCP CLI Passthrough Tools
 *
 * These tools call CLI commands that don't have a clean storage API.
 * They're wrapped for MCP but return formatted text output.
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpToolContext } from '../types.js'
import { errorResponse, textResponse, strictTool } from '../helpers.js'

export function registerAgentTools(server: McpServer, ctx: McpToolContext): void {
  strictTool(server,
    'agent_list',
    'List all agents',
    { type: z.enum(['staff', 'temp', 'all']).optional() },
    async (params) => {
      try {
        const typeFlag = params.type ? `--type ${params.type}` : ''
        const output = ctx.runCommand(`prlt agent list ${typeFlag} --json 2>/dev/null || prlt agent list ${typeFlag}`)
        return textResponse(output)
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'agent_status',
    'Check agent status. With agent param, returns that agent\'s status. Without, auto-detects current agent or returns all agent statuses.',
    { agent: z.string().optional().describe('Agent name. If omitted, auto-detects current agent or returns all.') },
    async (params) => {
      try {
        if (params.agent) {
          const output = ctx.runCommand(`prlt agent status ${params.agent} --json`)
          return textResponse(output)
        }

        // Try auto-detecting current agent via whoami
        try {
          const whoamiOutput = ctx.runCommand('prlt whoami --json')
          const whoami = JSON.parse(whoamiOutput)
          if (whoami.agent) {
            const output = ctx.runCommand(`prlt agent status ${whoami.agent} --json`)
            return textResponse(output)
          }
        } catch {
          // whoami failed or no agent detected, fall through
        }

        // No agent detected - return all agent statuses
        const output = ctx.runCommand('prlt agent status --json')
        return textResponse(output)
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'agent_add',
    'Add new agents',
    {
      names: z.array(z.string()).optional().describe('Agent names'),
      theme: z.string().optional().describe('Theme for names'),
      clone: z.boolean().optional().describe('Use git clone instead of worktree'),
    },
    async (params) => {
      try {
        const namesArg = params.names?.join(' ') || ''
        const themeFlag = params.theme ? `--theme ${params.theme}` : ''
        const cloneFlag = params.clone ? '--clone' : ''
        const output = ctx.runCommand(`prlt agent staff add ${namesArg} ${themeFlag} ${cloneFlag} --json`)
        return textResponse(output)
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'agent_remove',
    'Remove an agent',
    { name: z.string().describe('Agent name') },
    async (params) => {
      try {
        const output = ctx.runCommand(`prlt agent remove ${params.name} --json`)
        return textResponse(output)
      } catch (error) {
        return errorResponse(error)
      }
    }
  )
}

export function registerDockerTools(server: McpServer, ctx: McpToolContext): void {
  strictTool(server,
    'docker_status',
    'Check Docker daemon status',
    {},
    async () => {
      try {
        const output = ctx.runCommand('prlt docker status')
        return textResponse(output)
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'docker_list',
    'List Docker containers',
    {},
    async () => {
      try {
        const output = ctx.runCommand('prlt docker list')
        return textResponse(output)
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'docker_start',
    'Start Docker containers',
    { agent: z.string().optional().describe('Agent name') },
    async (params) => {
      try {
        const agentArg = params.agent || ''
        const output = ctx.runCommand(`prlt docker start ${agentArg}`)
        return textResponse(output)
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'docker_stop',
    'Stop Docker containers',
    { agent: z.string().optional().describe('Agent name') },
    async (params) => {
      try {
        const agentArg = params.agent || ''
        const output = ctx.runCommand(`prlt docker stop ${agentArg}`)
        return textResponse(output)
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'docker_logs',
    'Get container logs',
    {
      agent: z.string().describe('Agent name'),
      lines: z.number().optional().describe('Number of lines'),
    },
    async (params) => {
      try {
        const linesFlag = params.lines ? `-n ${params.lines}` : ''
        const output = ctx.runCommand(`prlt docker logs ${params.agent} ${linesFlag}`)
        return textResponse(output)
      } catch (error) {
        return errorResponse(error)
      }
    }
  )
}

export function registerRepoTools(server: McpServer, ctx: McpToolContext): void {
  strictTool(server,
    'repo_list',
    'List repositories in workspace',
    {},
    async () => {
      try {
        const output = ctx.runCommand('prlt repo list')
        return textResponse(output)
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'repo_add',
    'Add a repository',
    {
      path: z.string().describe('Repository path or URL'),
      name: z.string().optional().describe('Name for the repo'),
    },
    async (params) => {
      try {
        const nameFlag = params.name ? `--name ${params.name}` : ''
        const output = ctx.runCommand(`prlt repo add ${params.path} ${nameFlag}`)
        return textResponse(output)
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'repo_remove',
    'Remove a repository',
    { name: z.string().describe('Repository name') },
    async (params) => {
      try {
        const output = ctx.runCommand(`prlt repo remove ${params.name}`)
        return textResponse(output)
      } catch (error) {
        return errorResponse(error)
      }
    }
  )
}

export function registerBranchTools(server: McpServer, ctx: McpToolContext): void {
  strictTool(server,
    'branch_list',
    'List branches (across all HQ repos if not in a git repo)',
    {},
    async () => {
      try {
        const output = ctx.runCommand('prlt branch list')
        return textResponse(output)
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'branch_create',
    'Create a branch for a ticket',
    {
      ticket_id: z.string().describe('Ticket ID'),
      name: z.string().optional().describe('Branch name override'),
    },
    async (params) => {
      try {
        const nameFlag = params.name ? `--name ${params.name}` : ''
        const output = ctx.runCommand(`prlt branch create ${params.ticket_id} ${nameFlag}`)
        return textResponse(output)
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'branch_where',
    'Find which directory a branch is checked out in',
    {
      search: z.string().describe('Branch name or ticket ID to search for'),
    },
    async (params) => {
      try {
        const output = ctx.runCommand(`prlt branch where ${params.search}`)
        return textResponse(output)
      } catch (error) {
        return errorResponse(error)
      }
    }
  )
}

export function registerGitHubTools(server: McpServer, ctx: McpToolContext): void {
  strictTool(server,
    'gh_status',
    'Check GitHub CLI status',
    {},
    async () => {
      try {
        const output = ctx.runCommand('prlt gh status')
        return textResponse(output)
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'gh_login',
    'Login to GitHub',
    {},
    async () => {
      try {
        const output = ctx.runCommand('prlt gh login')
        return textResponse(output)
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'pr_create',
    'Create a pull request',
    {
      ticket_id: z.string().optional().describe('Ticket ID'),
      title: z.string().optional().describe('PR title'),
      body: z.string().optional().describe('PR body'),
      draft: z.boolean().optional().describe('Create as draft'),
    },
    async (params) => {
      try {
        const ticketArg = params.ticket_id || ''
        const titleFlag = params.title ? `--title "${params.title}"` : ''
        const bodyFlag = params.body ? `--body "${params.body}"` : ''
        const draftFlag = params.draft ? '--draft' : ''
        const output = ctx.runCommand(`prlt pr create ${ticketArg} ${titleFlag} ${bodyFlag} ${draftFlag}`)
        return textResponse(output)
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'pr_list',
    'List pull requests',
    {},
    async () => {
      try {
        const output = ctx.runCommand('prlt pr list')
        return textResponse(output)
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'pr_status',
    'Check PR status',
    {},
    async () => {
      try {
        const output = ctx.runCommand('prlt pr status')
        return textResponse(output)
      } catch (error) {
        return errorResponse(error)
      }
    }
  )
}

export function registerInitTools(server: McpServer, ctx: McpToolContext): void {
  strictTool(server,
    'init',
    'Initialize an HQ workspace',
    {
      name: z.string().describe('HQ name'),
      path: z.string().optional().describe('HQ path'),
      repos: z.array(z.string()).optional().describe('Repository paths'),
      agents: z.array(z.string()).optional().describe('Agent names'),
      pmo: z.boolean().optional().describe('Include PMO'),
    },
    async (params) => {
      try {
        const pathFlag = params.path ? `--path ${params.path}` : ''
        const reposFlag = params.repos?.length ? `--repos ${params.repos.join(',')}` : ''
        const agentsFlag = params.agents?.length ? `--agents ${params.agents.join(',')}` : ''
        const pmoFlag = params.pmo === false ? '--no-pmo' : '--pmo'
        const output = ctx.runCommand(`prlt new --name ${params.name} ${pathFlag} ${reposFlag} ${agentsFlag} ${pmoFlag} --json`)
        return textResponse(output)
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'pmo_init',
    'Initialize PMO in existing workspace',
    {
      template: z.string().optional().describe('Board template'),
      name: z.string().optional().describe('Board name'),
    },
    async (params) => {
      try {
        const templateFlag = params.template ? `--template ${params.template}` : ''
        const nameFlag = params.name ? `--name ${params.name}` : ''
        const output = ctx.runCommand(`prlt pmo init ${templateFlag} ${nameFlag}`)
        return textResponse(output)
      } catch (error) {
        return errorResponse(error)
      }
    }
  )
}

export function registerUtilityTools(server: McpServer, ctx: McpToolContext): void {
  strictTool(server,
    'whoami',
    'Show current context (agent, workspace)',
    {},
    async () => {
      try {
        const output = ctx.runCommand('prlt whoami')
        return textResponse(output)
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'commit',
    'Create a commit with ticket reference',
    {
      message: z.string().describe('Commit message'),
      ticket_id: z.string().optional().describe('Ticket ID'),
    },
    async (params) => {
      try {
        const ticketArg = params.ticket_id || ''
        const output = ctx.runCommand(`prlt commit "${params.message}" ${ticketArg}`)
        return textResponse(output)
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'execution_list',
    'List work executions',
    {},
    async () => {
      try {
        const output = ctx.runCommand('prlt execution list')
        return textResponse(output)
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'execution_view',
    'View execution details',
    { id: z.string().describe('Execution ID') },
    async (params) => {
      try {
        const output = ctx.runCommand(`prlt execution view ${params.id}`)
        return textResponse(output)
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'execution_logs',
    'Get execution logs',
    { id: z.string().describe('Execution ID') },
    async (params) => {
      try {
        const output = ctx.runCommand(`prlt execution logs ${params.id}`)
        return textResponse(output)
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'session_list',
    'List tmux sessions',
    {},
    async () => {
      try {
        const output = ctx.runCommand('prlt session list --json')
        return textResponse(output)
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'session_inspect',
    'Comprehensive agent status inspection — git, PR, process, output, and execution metadata',
    {
      target: z.string().describe('Agent name, ticket ID, or execution ID'),
      lines: z.number().optional().describe('Number of output lines to capture (default 100)'),
    },
    async (params) => {
      try {
        const linesFlag = params.lines ? `--lines ${params.lines}` : ''
        const output = ctx.runCommand(`prlt session inspect ${params.target} ${linesFlag} --json`)
        return textResponse(output)
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'session_restart',
    'Gracefully restart a stuck agent — send Ctrl-C, wait, re-launch',
    {
      target: z.string().describe('Agent name, ticket ID, or execution ID'),
      fresh: z.boolean().optional().describe('Reset worktree to branch HEAD before restarting'),
      resume: z.boolean().optional().describe('Continue from where the agent left off'),
      timeout: z.number().optional().describe('Seconds to wait for clean exit (default 15)'),
    },
    async (params) => {
      try {
        const freshFlag = params.fresh ? '--fresh' : ''
        const resumeFlag = params.resume ? '--resume' : ''
        const timeoutFlag = params.timeout ? `--timeout ${params.timeout}` : ''
        const output = ctx.runCommand(`prlt session restart ${params.target} ${freshFlag} ${resumeFlag} ${timeoutFlag} --json`)
        return textResponse(output)
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'session_exec',
    'Run a command in an agent\'s worktree/container context',
    {
      target: z.string().describe('Agent name, ticket ID, or execution ID'),
      command: z.string().describe('Shell command to execute'),
      timeout: z.number().optional().describe('Command timeout in seconds (default 30)'),
    },
    async (params) => {
      try {
        const timeoutFlag = params.timeout ? `--timeout ${params.timeout}` : ''
        const output = ctx.runCommand(`prlt session exec ${params.target} ${timeoutFlag} --json -- ${params.command}`)
        return textResponse(output)
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'session_peek',
    'View agent tmux pane content without attaching',
    {
      target: z.string().describe('Agent name, ticket ID, or execution ID'),
      lines: z.number().optional().describe('Number of scrollback lines (default 200)'),
      full: z.boolean().optional().describe('Capture entire scrollback buffer'),
    },
    async (params) => {
      try {
        const linesFlag = params.lines ? `--lines ${params.lines}` : ''
        const fullFlag = params.full ? '--full' : ''
        const output = ctx.runCommand(`prlt session peek ${params.target} ${linesFlag} ${fullFlag} --json`)
        return textResponse(output)
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'session_poke',
    'Send a message to a running agent session',
    {
      target: z.string().describe('Agent name or ticket ID'),
      message: z.string().describe('Message to send'),
      wait: z.boolean().optional().describe('Wait for response after sending'),
      timeout: z.number().optional().describe('Timeout in seconds for wait mode (default 30)'),
    },
    async (params) => {
      try {
        const waitFlag = params.wait ? '--wait' : ''
        const timeoutFlag = params.timeout ? `--timeout ${params.timeout}` : ''
        const output = ctx.runCommand(`prlt session poke ${params.target} "${params.message}" ${waitFlag} ${timeoutFlag} --json`)
        return textResponse(output)
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'config_show',
    'Show configuration',
    {},
    async () => {
      try {
        const output = ctx.runCommand('prlt config')
        return textResponse(output)
      } catch (error) {
        return errorResponse(error)
      }
    }
  )
}
